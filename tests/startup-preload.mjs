import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { dependencyClosure, staticImports, prepareStartupPreloads } from "../scripts/prepare_startup_preloads.mjs";
import { prewarmModels, modelQueryKey, patchModelPrewarm } from "../scripts/patch_codex_web_model_prewarm.mjs";

const source = `import './state.js'; import {x} from './shared.js'; export {x} from './exports.js';
export const label = 'not-a-module'; const lazy = () => import('./lazy.js');
const meta = import.meta.url; // import './comment.js'
const text = "import './string.js'";`;
assert.deepEqual(staticImports(source), ["./state.js", "./shared.js", "./exports.js"]);
const graph = { "entry.js": "import './state.js'; import('./unused.js');", "state.js": "export * from './entry.js'" };
assert.deepEqual(await dependencyClosure(["entry.js"], async (file) => graph[file]), ["entry.js", "state.js"]);
await assert.rejects(dependencyClosure(["entry.js"], async () => "import '../outside.js'"), /outside assets/);
const root = await mkdtemp(path.join(os.tmpdir(), "codex-preload-test-"));
try {
  await mkdir(path.join(root, "assets"));
  for (const [file, body] of Object.entries({
    "app-main-a.js": "import './app-initial-b.js';",
    "app-initial-b.js": "import './shared.js'; import('./not-needed.js');",
    "app-primary-c.js": "import './shared.js';",
    "local-conversation-page-d.js": "import './app-primary-c.js';",
    "shared.js": "export {};",
  })) await writeFile(path.join(root, "assets", file), body);
  await writeFile(path.join(root, "index.html"), '<html><head><link rel="modulepreload" href="./assets/shared.js" /></head><body></body></html>');
  assert.deepEqual(await prepareStartupPreloads(root), { modules: 4 });
  const first = await readFile(path.join(root, "index.html"), "utf8");
  await prepareStartupPreloads(root);
  assert.equal(await readFile(path.join(root, "index.html"), "utf8"), first);
  assert.ok(!first.includes("not-needed.js"));
  assert.equal(first.match(/href="\.\/assets\/shared.js"/g).length, 1);
} finally { await rm(root, { recursive: true, force: true }); }

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
let calls = 0, resolve;
const request = { sendRequest(method, params, options) {
  calls++;
  assert.equal(method, "model/list");
  assert.deepEqual(params, { includeHidden: true, cursor: null, limit: 100 });
  assert.equal(options.priority, "background");
  return new Promise((done) => { resolve = done; });
} };
const base = ["models", "list", "local", "chatgpt", 100];
assert.deepEqual(modelQueryKey(base, {}, false), base);
const key = modelQueryKey(base, { model_provider: "custom", model_catalog_json: "catalog.json" }, true);
assert.deepEqual(key, [...base, "custom", "catalog.json"]);
const warming = prewarmModels(client, request, key);
client.removeQueries({ exact: true, queryKey: base });
const normal = client.fetchQuery({ queryKey: key, staleTime: 300000, queryFn: () => { throw Error("Duplicate model request"); } });
const result = { data: [{ id: "real-model" }], nextCursor: null };
resolve(result);
await warming;
assert.equal(await normal, result);
await prewarmModels(client, request, key);
assert.equal(calls, 1, "Native query shares the in-flight/cached real response");
await prewarmModels(client, { sendRequest: async () => { throw Error("offline"); } }, [...key, "failed"]);
assert.equal(client.getQueryData([...key, "failed"]), undefined);
client.clear();

const bundle = await readFile(new URL("../scratch/asar/webview/assets/app-initial-c95ddb62696e.js", import.meta.url), "utf8");
const patched = patchModelPrewarm(bundle);
assert.equal(patchModelPrewarm(patched), patched);
assert.throws(() => patchModelPrewarm("unknown version"));
const hook = patched.slice(patched.indexOf("function codexWebPrewarmModels(auth) {"), patched.indexOf("function p0l(e) {"));
assert.ok(hook);
for (const [web, auth, connected, expected] of [[false, "chatgpt", true, false], [true, "apikey", true, false], [true, "chatgpt", false, false], [true, "chatgpt", true, true]]) {
  let invoked = false;
  const scope = { get: () => connected ? ["local"] : [], query: { fetch: async () => ({ config: {} }) }, queryClient: { prefetchQuery: () => { invoked = true; return Promise.resolve(); } } };
  const run = new Function("E", "J", "I8", "window", "dh", "ET", "gh", "_zn", "bC", "Xm", "ewt", `${hook};return codexWebPrewarmModels`)(
    () => scope, {}, { useEffect: (effect) => effect() }, web ? { __ELECTRON_SHIM__: {} } : {}, {}, () => {}, () => request, () => key, {}, (config) => config, () => false);
  run({ authMethod: auth, isLoading: false });
  await new Promise(setImmediate);
  assert.equal(invoked, expected);
}
console.log("Startup preloads: static graph/cycles/dynamic exclusion, real query deduplication, failures, native/auth/host guards passed");

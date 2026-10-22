#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The SDK's sync initializer uses its own identity-scoped cache/defaults and
// refreshes in the background. It never invents evaluations or account grants.
export function initializeStatsig(client, browserHost) {
  return browserHost
    ? Promise.resolve().then(() => client.initializeSync())
    : client.initializeAsync();
}

export function patchStartup(source) {
  if (source.includes("/* codex-web:bounded-statsig-startup */")) return source;
  function once(pattern, replacement, label) {
    if ([...source.matchAll(pattern)].length !== 1) {
      throw Error(`Expected one ${label}`);
    }
    source = source.replace(pattern, replacement);
  }
  once(/\(J\$l = 1e4\)/g,
    "(J$l = window.__ELECTRON_SHIM__ != null ? 2000 : 1e4) /* codex-web:bounded-statsig-startup */",
    "post-login Statsig timeout");
  once(/async function b0l\(e, t\) \{/g,
    "async function b0l(e, t) {\nif (window.__ELECTRON_SHIM__ != null) { t.current += 1; return q$l(e); }",
    "post-login bootstrap retry loop");
  once(/i\s*\.initializeAsync\(\)\s*\.catch\(t\.Log\.error\)/g,
    `(${initializeStatsig.toString()})(i, window.__ELECTRON_SHIM__ != null).catch(t.Log.error)`,
    "Statsig React hook initialization");
  once(/\.\.\.L0l\.networkConfig,\s*preventAllNetworkTraffic: !1,/g,
    "...L0l.networkConfig,\n...(window.__ELECTRON_SHIM__ != null ? { networkTimeoutMs: 2000 } : {}),\npreventAllNetworkTraffic: !1,",
    "Statsig background network config");
  once(/\(D = \(0, ML\.jsx\)\(`div`, \{ className: v, children: S \}\)\)/g,
    '(D = (0, ML.jsx)(`div`, { className: v, "data-codex-loading-stage": s ?? "unlabeled", children: S }))',
    "loading-stage DOM marker");
  once(/if \(r\.isLoading \|\| a \|\| s \|\| c\) \{/g,
    'if (r.isLoading || a || s || c) {\nif (window.__ELECTRON_SHIM__ != null) return (0, L8.jsx)(D8, { debugName: `Startup inputs auth=${!!r.isLoading} version=${!!a} system=${!!s} config=${!!c}` });',
    "startup input diagnostics");
  return source;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw Error("Usage: patch_codex_web_startup.mjs <webview-assets-dir>");
  const files = (await readdir(dir)).filter((name) => /^app-initial-.*\.js$/.test(name));
  if (files.length !== 1) throw Error("Expected one app-initial bundle");
  const file = path.join(dir, files[0]);
  await writeFile(file, patchStartup(await readFile(file, "utf8")));
  console.log(`Bounded browser Statsig startup in ${files[0]}`);
}

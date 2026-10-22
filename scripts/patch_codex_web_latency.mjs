#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function prefetchTurnHeads(turns, load, itemLimit, budget) {
  if (!(itemLimit > 0) || !(budget > 0)) return null;
  const entries = turns.slice(0, 5), result = new Array(entries.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, async () => {
    while (next < entries.length) {
      const index = next++;
      result[index] = await load(entries[index], Math.min(100, itemLimit, budget));
    }
  }));
  return result;
}

export async function refreshBootstrap(client, request, isCurrent) {
  const identity = (user) => ({
    user: user?.userID,
    account: user?.customIDs?.account_id ?? user?.custom?.account_id ?? user?.custom?.workspace_id ?? null,
  });
  const before = identity(client.getContext().user);
  if (typeof before.user !== "string" || !before.user) return false;
  const response = await request();
  const current = identity(client.getContext().user), returned = identity(response.user);
  if (!isCurrent() || current.user !== before.user || current.account !== before.account ||
      returned.user !== before.user || returned.account !== before.account) return false;
  client.dataAdapter.setData(response.statsigPayload);
  client.updateUserSync(response.user, { disableBackgroundCacheRefresh: true });
  return true;
}

export function patchLatency(source) {
  if (source.includes("/* codex-web:parallel-history */")) return source;
  function once(pattern, replacement, label) {
    if ([...source.matchAll(pattern)].length !== 1) throw Error(`Expected one ${label}`);
    source = source.replace(pattern, replacement);
  }
  once(/f\.data\.map\(\(n\) => gx\(e\.sendRequest\.bind\(e\), r, n\.id, a, s, t\)\),\s*\)\s*: null;/g,
    `f.data.map((n) => gx(e.sendRequest.bind(e), r, n.id, a, s, t)),
        )
      : window.__ELECTRON_SHIM__ != null
        ? await (${prefetchTurnHeads.toString()})(f.data, (turn, limit) => gx(e.sendRequest.bind(e), r, turn.id, a, s, limit), t, y)
        : null; /* codex-web:parallel-history */`,
    "serial history head-page branch");
  // A previous turn can consume the remaining global budget while heads load.
  // In that case retain the original smaller read/cursor, rather than truncating
  // an already paginated response or exceeding the upstream item budget.
  once(/let a = b\?\.\[n\],\s*p =/g,
    `let a = b?.[n];
      if (window.__ELECTRON_SHIM__ != null && a?.items.length > Math.min(100, y, t - c.length)) a = void 0;
      let p =`,
    "history budget validation");
  once(/\(0, L8\.jsx\)\(y0l, \{/g,
    '(0, L8.jsx)(window.__ELECTRON_SHIM__ != null ? h0l : y0l, {',
    "browser cached Statsig provider");
  once(/let \{ client: S, isLoading: C \} = \(0, O0l\.useClientAsyncInit\)\(d, b, x\),\s*w;/g,
    `let { client: S, isLoading: C } = (0, O0l.useClientAsyncInit)(d, b, x), w;
  codexWebRefreshBootstrap(S, v, g);`,
    "background bootstrap hook");
  once(/function _0l\(e\) \{/g,
    `/* codex-web:background-bootstrap */
function codexWebRefreshBootstrap(client, context, beta) {
  I8.useEffect(() => {
    if (window.__ELECTRON_SHIM__ == null || context.authMethod !== "chatgpt" || client.loadingStatus !== "Ready") return;
    let cancelled = false;
    (${refreshBootstrap.toString()})(client, () => q$l({ ...context, beta }), () => !cancelled).catch(() => {});
    return () => { cancelled = true; };
  }, [client, client.loadingStatus, context, beta]);
}
function _0l(e) {`,
    "background bootstrap implementation");
  return source;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw Error("Usage: patch_codex_web_latency.mjs <webview-assets-dir>");
  const files = (await readdir(dir)).filter((name) => /^app-initial-.*\.js$/.test(name));
  if (files.length !== 1) throw Error("Expected one app-initial bundle");
  const file = path.join(dir, files[0]);
  await writeFile(file, patchLatency(await readFile(file, "utf8")));
  console.log(`Parallelized history reads and background Statsig refresh in ${files[0]}`);
}

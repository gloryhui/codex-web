#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { patchExtractedStartup } from "./extracted_startup.mjs";

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
  once(/Promise\.all\(p\.data\.map\(\(e\) => lT\(t, i, e\.id, o, c, n\)\)\)\s*: null;/g,
    `Promise.all(p.data.map((e) => lT(t, i, e.id, o, c, n)))
      : window.__ELECTRON_SHIM__ != null
        ? await (${prefetchTurnHeads.toString()})(p.data, (turn, limit) => lT(t, i, turn.id, o, c, limit), n, b)
        : null; /* codex-web:parallel-history */`,
    "serial history head-page branch");
  // A previous turn can consume the remaining global budget while heads load.
  // In that case retain the original smaller read/cursor, rather than truncating
  // an already paginated response or exceeding the upstream item budget.
  once(/let o = x\?\.\[e\],\s*p =/g,
    `let o = x?.[e];
      if (window.__ELECTRON_SHIM__ != null && o?.items.length > Math.min(100, b, n - s.length)) o = void 0;
      let p =`,
    "history budget validation");
  once(/\(0, wO\.jsx\)\(lO, \{/g,
    '(0, wO.jsx)(window.__ELECTRON_SHIM__ != null ? aO : lO, {',
    "browser cached Statsig provider");
  once(/let \{ client: S, isLoading: C \} = \(0, yO\.useClientAsyncInit\)\(d, b, x\),\s*w;/g,
    `let { client: S, isLoading: C } = (0, yO.useClientAsyncInit)(d, b, x), w;
  codexWebRefreshBootstrap(S, v, g);`,
    "background bootstrap hook");
  once(/function nO\(e\) \{/g,
    `/* codex-web:background-bootstrap */
function codexWebRefreshBootstrap(client, context, beta) {
  CO.useEffect(() => {
    if (window.__ELECTRON_SHIM__ == null || context.authMethod !== "chatgpt" || client.loadingStatus !== "Ready") return;
    let cancelled = false;
    (${refreshBootstrap.toString()})(client, () => bD({ ...context, beta }), () => !cancelled).catch(() => {});
    return () => { cancelled = true; };
  }, [client, client.loadingStatus, context, beta]);
}
function nO(e) {`,
    "background bootstrap implementation");
  return source;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw Error("Usage: patch_codex_web_latency.mjs <webview-assets-dir>");
  await patchExtractedStartup(dir, patchLatency);
  console.log("Parallelized history reads and background Statsig refresh across extracted modules");
}

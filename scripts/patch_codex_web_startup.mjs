#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { patchExtractedStartup } from "./extracted_startup.mjs";

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
  once(/\(eO = 1e4\)/g,
    "(eO = window.__ELECTRON_SHIM__ != null ? 2000 : 1e4) /* codex-web:bounded-statsig-startup */",
    "post-login Statsig timeout");
  once(/async function UO\(e, t\) \{/g,
    "async function UO(e, t) {\nif (window.__ELECTRON_SHIM__ != null) { t.current += 1; return $D(e); }",
    "post-login bootstrap retry loop");
  once(/i\s*\.initializeAsync\(\)\s*\.catch\(t\.Log\.error\)/g,
    `(${initializeStatsig.toString()})(i, window.__ELECTRON_SHIM__ != null).catch(t.Log.error)`,
    "Statsig React hook initialization");
  once(/\.\.\.lk\.networkConfig,\s*preventAllNetworkTraffic: !1,/g,
    "...lk.networkConfig,\n...(window.__ELECTRON_SHIM__ != null ? { networkTimeoutMs: 2000 } : {}),\npreventAllNetworkTraffic: !1,",
    "Statsig background network config");
  once(/\(E = \(0, jH\.jsx\)\(`div`, \{ className: _, children: x \}\)\)/g,
    '(E = (0, jH.jsx)(`div`, { className: _, "data-codex-loading-stage": o ?? "unlabeled", children: x }))',
    "loading-stage DOM marker");
  once(/if \(r\.isLoading \|\| a \|\| s \|\| c\) \{/g,
    'if (r.isLoading || a || s || c) {\nif (window.__ELECTRON_SHIM__ != null) return (0, rk.jsx)(V_, { debugName: `Startup inputs auth=${!!r.isLoading} version=${!!a} system=${!!s} config=${!!c}` });',
    "startup input diagnostics");
  return source;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw Error("Usage: patch_codex_web_startup.mjs <webview-assets-dir>");
  await patchExtractedStartup(dir, patchStartup);
  console.log("Bounded browser Statsig startup across extracted modules");
}

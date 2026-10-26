import assert from "node:assert/strict";
import { initializeStatsig, patchStartup } from "../scripts/patch_codex_web_startup.mjs";

let sync = 0, async = 0;
const cached = { source: "Cache", success: true };
const client = {
  initializeSync() { sync++; return cached; },
  initializeAsync() { async++; return new Promise(() => {}); },
};
assert.equal(await initializeStatsig(client, true), cached);
assert.equal(sync, 1);
assert.equal(async, 0);
initializeStatsig(client, false);
assert.equal(async, 1);
await assert.rejects(initializeStatsig({ initializeSync() { throw Error("invalid cache"); } }, true), /invalid cache/);

const fixture = `
(xD = 1e4)
async function uO(e, t) { return retry(e); }
i.initializeAsync().catch(t.Log.error)
({...AO.networkConfig, preventAllNetworkTraffic: !1,})
(E = (0, $V.jsx)(\`div\`, { className: _, children: x }))
if (r.isLoading || a || s || c) { return null; }
`;
const patched = patchStartup(fixture);
assert.equal(patchStartup(patched), patched);
assert.throws(() => patchStartup(fixture + fixture));
assert.throws(() => patchStartup(fixture.replace("xD", "changed")));
const bootstrap = new Function("window", "bD", "retry", `${patched.match(/async function uO[\s\S]*?return retry\(e\); \}/)[0]};return uO`);
let attempts = 0;
const read = bootstrap({ __ELECTRON_SHIM__: {} }, async () => { attempts++; throw Error("offline"); }, () => { throw Error("must not retry"); });
const count = { current: 0 };
await assert.rejects(read({}, count), /offline/);
assert.equal(attempts, 1);
assert.equal(count.current, 1);
assert.equal(await bootstrap({}, null, () => "native retry")({}, count), "native retry");
console.log("Startup config: offline cache path, bounded bootstrap, native fallback and patch contracts passed");

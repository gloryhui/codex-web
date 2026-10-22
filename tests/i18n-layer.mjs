import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const shim = await readFile(new URL("../src/browser/shim.ts", import.meta.url), "utf8");
const adapterSource = shim.match(/electronShim\.overrideAdapter = \{[\s\S]*?\n\};/);
assert.ok(adapterSource, "Expected browser override adapter");
const host = {};
new Function("electronShim", ts.transpileModule(adapterSource[0], {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText)(host);

// Exercise the SDK's actual getter/override merge, which replaces custom get().
// This catches accidentally using Dynamic Config's value field for a Layer.
const bundle = await readFile(new URL("../scratch/asar/webview/assets/app-initial-c95ddb62696e.js", import.meta.url), "utf8");
const sdkSource = bundle.match(/function r\(e, t, n, r\) \{\s*return \{\s*name: e,[\s\S]*?e\._makeTypedGet = l;/);
assert.ok(sdkSource, "Expected current extracted Statsig SDK merge contract");
const sdk = {};
new Function("e", "t", "n", sdkSource[0])(sdk, {
  Log: { warn() { throw Error("Unexpected SDK type mismatch"); } },
}, { _isTypeMatch: (a, b) => typeof a === typeof b });

for (const value of [{}, { enable_i18n: false, locale_source: "SYSTEM", other: 7 }]) {
  const original = sdk._makeLayer("72216192", { reason: "Cache" }, { value });
  const override = host.overrideAdapter.getLayerOverride(original);
  const merged = sdk._mergeOverride(original, override, override.__value);
  assert.equal(merged.get("enable_i18n", false), true);
  assert.equal(merged.get("locale_source", "IDE"), value.locale_source ?? "IDE");
  assert.equal(merged.get("other", 0), value.other ?? 0);
  assert.deepEqual(original.__value, value, "Do not mutate cached server values");
  assert.equal(merged.details.reason, "Cache");
}
assert.equal(host.overrideAdapter.getLayerOverride(sdk._makeLayer("another-layer", {}, { value: {} })), null);
const legacy = sdk._makeDynamicConfig("72216192", {}, { value: { other: 7 } });
assert.equal(host.overrideAdapter.getDynamicConfigOverride(legacy).get("enable_i18n", false), true);
assert.equal(host.overrideAdapter.getDynamicConfigOverride(legacy).get("other", 0), 7);
assert.equal(host.overrideAdapter.getDynamicConfigOverride({ ...legacy, name: "another-config" }), null);
assert.equal(host.overrideAdapter.getGateOverride({ name: "another-gate", value: false }), null);
console.log("I18n: actual SDK Layer merge enables localization with defaults/cache, preserves other values and legacy behavior");

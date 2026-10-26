import { extractedBundle, extractedStartup } from "./extracted-bundles.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { patchStatsig } from "../scripts/patch_codex_web_statsig.mjs";

const source = await extractedStartup();
const patched = patchStatsig(source);
assert.equal(patchStatsig(patched), patched);
assert.throws(() => patchStatsig("unrecognized upstream"));
const start = patched.match(/start\(\) \{\s*\/\* codex-web:disabled-statsig-flush \*\/[\s\S]*?\n      \}\n      stop\(\)/)?.[0].replace(/\n      stop\(\)$/, "");
assert.ok(start, "Expected actual SDK logger startup method");
let flushStarts = 0, queuedReads = 0;
const makeLogger = (loggingEnabled) => ({
  _loggingEnabled: loggingEnabled,
  _options: { loggingEnabled },
  _initFlushCoordinator() {
    return {
      loadAndRetryShutdownFailedEvents() { queuedReads++; return Promise.resolve(); },
      startScheduledFlushCycle() { flushStarts++; },
    };
  },
});
const dependencies = [{ _isServerEnv: () => false }, {}, { _subscribeToVisiblityChanged() {} }, {}];
const makeStart = (window) => new Function("window", "u", "v", "h", "e", `return ({${start}}).start`)(window, ...dependencies);
const disabled = makeLogger("disabled");
makeStart({ __ELECTRON_SHIM__: {} }).call(disabled);
assert.equal(flushStarts, 0);
assert.equal(queuedReads, 0, "Disabled logging must not replay stored events");
makeStart({}).call(disabled);
assert.equal(flushStarts, 1, "Native Desktop retains upstream behavior");
makeStart({ __ELECTRON_SHIM__: {} }).call(makeLogger("browser-only"));
assert.equal(flushStarts, 2, "Enabled logging is unchanged");
const initializer = patched.match(/function initializeStatsig\(client, browserHost\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(initializer);
let options;
const initialize = new Function(`${initializer}; return initializeStatsig`)();
await initialize({ initializeSync(value) { options = value; } }, true);
assert.deepEqual(options, { disableBackgroundCacheRefresh: true });
assert.equal(await initialize({ initializeAsync() { return "native async"; } }, false), "native async");
console.log("Statsig: disabled logger does not replay/flush events; fallback avoids duplicate startup request; native and enabled logging unchanged");

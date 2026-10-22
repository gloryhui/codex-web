import assert from "node:assert/strict";
import { keepMigrationCutoff, patchMigrationState } from "../scripts/patch_codex_web_state.mjs";

const key = "pull-request-core-attachment-backfill-cutoff-at-v1";
assert.equal(keepMigrationCutoff(key, null, 100), false);
assert.equal(keepMigrationCutoff(key, 100, null), true);
assert.equal(keepMigrationCutoff(key, 100, undefined), true);
assert.equal(keepMigrationCutoff(key, 100, 101), true);
assert.equal(keepMigrationCutoff(key, 100, 100), false);
assert.equal(keepMigrationCutoff("other", 100, null), false);
const original = 'function dL(e, t, n) { if (e !== `cloud-aeon-sidebar-cache-v1` || n == null) return true; return false; }';
const patched = patchMigrationState(original);
assert.equal(patchMigrationState(patched), patched);
assert.throws(() => patchMigrationState(original + original));
const accepts = new Function(`${patched};return dL`)();
let state = null;
let changes = 0;
// Concurrent tabs alternate gate-off resets and gate-on initializations.
for (let i = 1; i <= 100; i++) {
  for (const incoming of [i, null]) {
    if (accepts(key, state, incoming) && state !== incoming) { state = incoming; changes++; }
  }
}
assert.equal(state, 1);
assert.equal(changes, 1);
assert.equal(accepts("other", 100, null), true);
console.log("Migration state compatibility: first cutoff retained; concurrent resets converge");

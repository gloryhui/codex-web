import assert from "node:assert/strict";
import { extractedBundle } from "./extracted-bundles.mjs";

const source = await extractedBundle(/^app-primary-.*\.js$/);
const start = source.indexOf("function mN(e,"), end = source.indexOf("function hN(", start);
assert.ok(start >= 0 && end > start);
const fn = source.slice(start, end);
for (const [web, device, expected] of [[true, "local", "folder"], [false, "local", "modal"], [true, "remote", "modal"]]) {
  const calls = [];
  const create = new Function("window", "gN", "vw", "v_", "YDt", `${fn}; return mN`)(
    web ? { __ELECTRON_SHIM__: {} } : {},
    (scope) => calls.push(["folder", scope]),
    (options) => calls.push(["telemetry", options]),
    (scope, modal, options) => calls.push(["modal", scope, options]), {},
  );
  const scope = {}, done = () => {};
  create(scope, { device, hostId: "host", onProjectCreated: done });
  assert.equal(calls.at(-1)[0], expected);
  assert.equal(calls.at(-1)[1], scope);
  if (expected === "modal") {
    assert.equal(calls.at(-1)[2].onProjectCreated, done);
    assert.equal(calls.at(-1)[2].initialRequest?.hostId, device === "remote" ? "host" : undefined);
  }
}
console.log("Workspace projects: Web selects host folders; native and remote modal contracts remain intact");

import { extractedBundle, extractedStartup } from "./extracted-bundles.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { patchLatency, prefetchTurnHeads, refreshBootstrap } from "../scripts/patch_codex_web_latency.mjs";

let active = 0, peak = 0;
const heads = await prefetchTurnHeads([0, 1, 2, 3, 4, 5], async (turn, limit) => {
  active++; peak = Math.max(peak, active);
  await new Promise(setImmediate);
  active--;
  assert.equal(limit, 100);
  return turn;
}, 1000, 500);
assert.deepEqual(heads, [0, 1, 2, 3, 4]);
assert.equal(peak, 3);
assert.equal(await prefetchTurnHeads([1], () => { throw Error("No reads with zero budget"); }, 100, 0), null);

const source = await extractedStartup();
const patched = patchLatency(source);
assert.equal(patchLatency(patched), patched);
assert.throws(() => patchLatency("unknown upstream"));
const gx = patched.slice(patched.indexOf("async function gE("), patched.indexOf("async function v1t("));
const m6t = patched.slice(patched.indexOf("async function v1t("), patched.indexOf("async function y1t("));
const make = (web) => new Function("window", "Jn", "iE", "y1t", "b1t", `${gx}\n${m6t}\nreturn v1t`)(
  web ? { __ELECTRON_SHIM__: {} } : {}, (id) => id, () => [], () => { throw Error("Unexpected progressive path"); }, async () => ({ openingUserMessageId: null }));
async function readHistory(web, sizes, turnLimit = 1000, maxTurns = 5, fail = false) {
  let running = 0, maxRunning = 0;
  const turns = sizes.map((size, index) => ({ id: `turn-${index}`, size, status: "completed" }));
  const client = {
    getConversation: () => null,
    async sendRequest(method, params) {
      if (method === "thread/turns/list") return { data: turns, nextCursor: null };
      assert.equal(method, "thread/items/list");
      running++; maxRunning = Math.max(maxRunning, running);
      await new Promise(setImmediate);
      running--;
      if (fail) throw Error("real backend failure");
      const turn = turns.find((turn) => turn.id === params.turnId), offset = Number(params.cursor ?? 0);
      const end = Math.min(turn.size, offset + params.limit);
      return {
        data: Array.from({ length: end - offset }, (_, index) => ({
          item: { id: `${turn.id}-item-${turn.size - offset - index}` }, turnId: turn.id, completedAtMs: 1,
        })),
        nextCursor: end < turn.size ? String(end) : null,
      };
    },
  };
  const result = await make(web)(() => null, client.sendRequest.bind(client), turnLimit, null, "thread", null, null, maxTurns, {}, "desc");
  return { result, peak: maxRunning };
}
for (const [sizes, limit, maxTurns] of [
  [[104, 10, 76, 71, 8], 1000, 5],
  [[180, 190, 160, 100, 50], 1000, 5],
  [[180, 190, 160, 100, 50], 28, 5],
  [[200, 100], 1000, 1],
  [[], 1000, 5],
]) {
  const native = await readHistory(false, sizes, limit, maxTurns), web = await readHistory(true, sizes, limit, maxTurns);
  assert.deepEqual(web.result, native.result, "Preserve items, order, cursors, completed IDs and budgets");
  assert.ok(web.peak <= 3);
  assert.ok(web.result.response.data.reduce((sum, turn) => sum + turn.items.length, 0) <= Math.min(maxTurns, 5) * 100);
}
await assert.rejects(readHistory(true, [100, 100, 100], 100, 5, true), /real backend failure/);

const user = (id = "user", account = "account") => ({ userID: id, custom: { account_id: account } });
let current = user(), applied, updated;
const client = {
  getContext: () => ({ user: current }),
  dataAdapter: { setData: (data) => { applied = data; } },
  updateUserSync: (value, options) => { updated = value; assert.deepEqual(options, { disableBackgroundCacheRefresh: true }); },
};
const response = { user: user(), statsigPayload: "real server payload" };
assert.equal(await refreshBootstrap(client, async () => response, () => true), true);
assert.equal(applied, response.statsigPayload);
assert.equal(updated, response.user);
for (const [returned, allowed, switched] of [[user("different"), true, false], [user("user", "different"), true, false], [user(), false, false], [user(), true, true]]) {
  applied = updated = undefined; current = user();
  assert.equal(await refreshBootstrap(client, async () => {
    if (switched) current = user("new identity");
    return { user: returned, statsigPayload: "must not apply" };
  }, () => allowed), false);
  assert.equal(applied, undefined); assert.equal(updated, undefined);
}
current = user();
await assert.rejects(refreshBootstrap(client, async () => { throw Error("offline"); }, () => true), /offline/);
console.log("Startup latency: bounded parallel real history loader preserves pagination/budgets/order; bootstrap applies only same-identity real responses");

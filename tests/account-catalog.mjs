import assert from "node:assert/strict";
import { patchAccountQuery, toRendererAccounts, readRendererAccounts } from "../scripts/patch_codex_web_accounts.mjs";

const member = {
  id: "personal", account_user_id: "member", account_user_role: "owner",
  structure: "personal", plan_type: "prolite", is_zdr: false,
  can_access_with_session: false, is_deactivated: true,
};
const workspace = { ...member, id: "workspace", structure: "workspace", plan_type: "team" };
const converted = toRendererAccounts({ accounts: [member, workspace], account_ordering: ["workspace", "personal"] });
assert.deepEqual(converted.account_ordering, ["workspace", "personal"]);
assert.equal(converted.accounts.personal.account.plan_type, "prolite");
assert.equal(converted.accounts.personal.can_access_with_session, false);
assert.equal(converted.accounts.personal.account.is_deactivated, true);
assert.equal(converted.accounts.workspace.account.structure, "workspace");
assert.deepEqual(converted.accounts.personal.entitlement, {});
assert.equal(converted.accounts.personal.entitlement.has_active_subscription, undefined);
for (const bad of [null, {}, { accounts: [member, member] },
  { accounts: [{ ...member, account_user_role: null }] },
  { accounts: [member], account_ordering: ["other"] }]) {
  assert.throws(() => toRendererAccounts(bad));
}
const original = 'let o = await a.safeGet(`/accounts/check/{version}`, { additionalHeaders: e == null ? void 0 : { "ChatGPT-Account-ID": e }, parameters: { path: { version: sEt } }, signal: t, });';
const patched = patchAccountQuery(original);
assert.equal(patchAccountQuery(patched), patched);
assert.throws(() => patchAccountQuery(original + original));
let routes = [];
const run = new Function("window", "a", "e", "sEt", "t", `return (async()=>{${patched};return o})()`);
await run({ __ELECTRON_SHIM__: {} }, { safeGet: async (route) => { routes.push(route); return { accounts: [member] }; } });
assert.deepEqual(routes, ["/wham/accounts/check"]);
await assert.rejects(run({ __ELECTRON_SHIM__: {} }, {
  safeGet: async () => { throw Error("Account catalog unavailable"); },
}), /Account catalog unavailable/);
routes = [];
await run({}, { safeGet: async (route) => { routes.push(route); return {}; } });
assert.deepEqual(routes, ["/accounts/check/{version}"]);
let calls = 0;
await readRendererAccounts({ safeGet: async () => {
  if (++calls < 3) throw Object.assign(Error("Transient fetch failure"), { responseStatus: 500 });
  return { accounts: [member] };
} });
assert.equal(calls, 3);
for (const status of [401, 403, 500]) {
  calls = 0;
  await assert.rejects(readRendererAccounts({ safeGet: async () => {
    calls++;
    throw Object.assign(Error("Request failed"), { responseStatus: status });
  } }));
  assert.equal(calls, status === 500 ? 3 : 1);
}
const controller = new AbortController();
calls = 0;
const cancelled = readRendererAccounts({ safeGet: async () => {
  calls++;
  throw Object.assign(Error("Fetch failed"), { errorKind: "network" });
} }, controller.signal);
controller.abort();
await assert.rejects(cancelled);
assert.equal(calls, 1);
console.log("Account catalog compatibility: membership, denials, invalid data and native fallback passed");

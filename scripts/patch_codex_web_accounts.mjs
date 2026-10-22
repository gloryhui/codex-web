#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Codex credentials support the Codex catalog, whereas the shared ChatGPT
// renderer also queries a legacy web-only catalog. Preserve membership and
// denial metadata; missing subscription presentation data remains unknown.
export function toRendererAccounts(catalog) {
  if (!Array.isArray(catalog?.accounts)) {
    throw Error("Account catalog is missing accounts");
  }
  const accounts = Object.create(null);
  const ids = [];
  for (const account of catalog.accounts) {
    if (
      typeof account?.id !== "string" || !account.id ||
      Object.hasOwn(accounts, account.id) ||
      ["account_user_id", "account_user_role", "structure", "plan_type", "is_zdr"]
        .some((key) => account[key] == null)
    ) {
      throw Error("Account catalog has invalid membership metadata");
    }
    ids.push(account.id);
    accounts[account.id] = {
      account: { ...account, account_id: account.id },
      can_access_with_session: account.can_access_with_session,
      sso_connection_name: account.sso_connection_name,
      entitlement: {},
    };
  }
  const ordering = catalog.account_ordering ?? ids;
  if (!Array.isArray(ordering) || new Set(ordering).size !== ordering.length ||
      ordering.length !== ids.length ||
      ordering.some((id) => !Object.hasOwn(accounts, id))) {
    throw Error("Account catalog has invalid account ordering");
  }
  return { ...catalog, accounts, account_ordering: ordering };
}

export async function readRendererAccounts(request, signal, normalize = toRendererAccounts) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    let catalog;
    try {
      catalog = await request.safeGet(`/wham/accounts/check`, { signal });
    } catch (error) {
      const status = error?.responseStatus ?? error?.status;
      if (signal?.aborted || attempt >= 2 ||
          !(error?.errorKind === "network" || (status >= 500 && status < 600))) {
        throw error;
      }
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        }, 250 * (attempt + 1));
        signal?.addEventListener("abort", abort, { once: true });
      });
      continue;
    }
    signal?.throwIfAborted();
    return normalize(catalog);
  }
}

export function patchAccountQuery(source) {
  if (source.includes("/* codex-web:account-catalog */")) return source;
  const query = /let (\w+) = await (\w+)\.safeGet\(`\/accounts\/check\/\{version\}`, \{\s*additionalHeaders:\s*(\w+) == null \? void 0 : \{ "ChatGPT-Account-ID": \3 \},\s*parameters: \{ path: \{ version: (\w+) \} \},\s*signal: (\w+),\s*\}\);/g;
  if ([...source.matchAll(query)].length !== 1) {
    throw Error("Expected one renderer legacy account catalog query");
  }
  return source.replace(query, (original, result, request, account, version, signal) =>
    `/* codex-web:account-catalog */\nlet ${result} = window.__ELECTRON_SHIM__ != null\n` +
    `? await (${readRendererAccounts.toString()})(${request}, ${signal}, ${toRendererAccounts.toString()})\n` +
    `: ${original.slice(original.indexOf("await"), -1)};`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const assetsDir = process.argv[2];
  if (!assetsDir) throw Error("Usage: patch_codex_web_accounts.mjs <webview-assets-dir>");
  const files = (await readdir(assetsDir)).filter((name) => /^app-initial-.*\.js$/.test(name));
  if (files.length !== 1) throw Error("Expected one app-initial bundle");
  const file = path.join(assetsDir, files[0]);
  await writeFile(file, patchAccountQuery(await readFile(file, "utf8")));
  console.log(`Adapted browser account catalog in ${files[0]}`);
}

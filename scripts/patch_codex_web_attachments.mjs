#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const assetsDir = process.argv[2];
if (!assetsDir) throw new Error("Usage: patch_codex_web_attachments.mjs <webview-assets-dir>");
const names = await readdir(assetsDir);
for (const [bundle, pattern, replacement] of [
  // Browser files have no Electron filesystem path. Enable the existing
  // content-copy fallback in the composer rather than silently dropping them.
  ["composer-content", /canCopyBrowserFileAttachments:\s*!1/g,
    "canCopyBrowserFileAttachments: window.__ELECTRON_SHIM__ != null /* codex-web:browser-files */"],
  // Desktop's local-copy branch uses native file asset APIs. Web transfers the
  // Blob through app-host RPC instead, using the JSON-compatible serializer.
  ["composer-attachment-actions", /(\b[A-Za-z_$][\w$]*\s*=\s*\(?[A-Za-z_$][\w$]*\)?\s*=>\s*[A-Za-z_$][\w$]*\([^)]*?{\s*copyFromLocalFile:\s*)([A-Za-z_$][\w$]*)(?=\s*})/g,
    "$1$2 && window.__ELECTRON_SHIM__ == null /* codex-web:browser-files */"],
]) {
  const files = names.filter((name) => new RegExp(`^${bundle}-.*\\.js$`).test(name));
  const candidates = [];
  for (const name of files) {
    const source = await readFile(path.join(assetsDir, name), "utf8");
    if (source.includes("/* codex-web:browser-files */") || (source.match(pattern) ?? []).length > 0) candidates.push(name);
  }
  if (candidates.length !== 1) throw new Error(`Expected one ${bundle} attachment implementation`);
  const file = path.join(assetsDir, candidates[0]);
  const source = await readFile(file, "utf8");
  if (source.includes("/* codex-web:browser-files */")) continue;
  if ((source.match(pattern) ?? []).length !== 1) {
    throw new Error(`Expected one browser attachment branch in ${file}`);
  }
  await writeFile(file, source.replace(pattern, replacement));
  console.log(`Enabled browser file attachments in ${candidates[0]}`);
}

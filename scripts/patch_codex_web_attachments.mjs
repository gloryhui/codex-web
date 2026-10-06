#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const assetsDir = process.argv[2];
if (!assetsDir) throw new Error("Usage: patch_codex_web_attachments.mjs <webview-assets-dir>");
const names = await readdir(assetsDir);
for (const [bundle, pattern, replacement] of [
  // Browser files have no Electron filesystem path. Enable the existing
  // content-copy fallback in the composer rather than silently dropping them.
  ["primary", /canCopyBrowserFileAttachments:\s*!1/g,
    "canCopyBrowserFileAttachments: window.__ELECTRON_SHIM__ != null /* codex-web:browser-files */"],
  // Desktop's local-copy branch uses native file asset APIs. Web transfers the
  // Blob through app-host RPC instead, using the JSON-compatible serializer.
  ["initial", /(\b[A-Za-z_$][\w$]*\s*=\s*\([^)]*\)\s*=>\s*[A-Za-z_$][\w$]*\([^)]*?{\s*copyFromLocalFile:\s*)([A-Za-z_$][\w$]*)(?=\s*})/g,
    "$1$2 && window.__ELECTRON_SHIM__ == null /* codex-web:browser-files */"],
]) {
  const files = names.filter((name) => new RegExp(`^app-${bundle}-.*\\.js$`).test(name));
  if (files.length !== 1) throw new Error(`Expected one ${bundle} bundle`);
  const file = path.join(assetsDir, files[0]);
  const source = await readFile(file, "utf8");
  if (source.includes("/* codex-web:browser-files */")) continue;
  if ((source.match(pattern) ?? []).length !== 1) {
    throw new Error(`Expected one browser attachment branch in ${file}`);
  }
  await writeFile(file, source.replace(pattern, replacement));
  console.log(`Enabled browser file attachments in ${files[0]}`);
}

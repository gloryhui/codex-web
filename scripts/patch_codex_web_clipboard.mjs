#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const assetsDir = process.argv[2];
if (!assetsDir) {
  throw new Error("Usage: patch_codex_web_clipboard.mjs <webview-assets-dir>");
}

const sharedFiles = (await readdir(assetsDir))
  .filter((name) => /^app-shared-.*\.js$/.test(name))
  .map((name) => path.join(assetsDir, name));
if (sharedFiles.length !== 1) {
  throw new Error(
    `Expected one app-shared bundle, found ${sharedFiles.length}`,
  );
}

const filePath = sharedFiles[0];
const source = await readFile(filePath, "utf8");
const copyErrorPosition = source.indexOf("clipboard.copyError.title");
if (copyErrorPosition < 0) {
  throw new Error(`Could not find the clipboard error helper in ${filePath}`);
}

const helperPosition = source.indexOf("async function ", copyErrorPosition);
const clipboardWriteMatch = /appServices\s*:\s*t/.exec(source.slice(helperPosition, helperPosition + 2400));
const browserBranch =
  "try{if(o&&window.__ELECTRON_SHIM__?.copyTextToClipboard)c=window.__ELECTRON_SHIM__.copyTextToClipboard(e,i);else if(o){";
const alreadyPatchedPosition = source.indexOf("window.__ELECTRON_SHIM__?.copyTextToClipboard", helperPosition);
if (
  alreadyPatchedPosition >= 0 &&
  alreadyPatchedPosition - helperPosition < 1800
) {
  console.log("Codex Web clipboard copy is already enabled");
  process.exit(0);
}
const branch = /try\s*\{\s*if\s*\(o\)\s*\{/.exec(source.slice(helperPosition, helperPosition + 1800));
const branchPosition = branch ? helperPosition + branch.index : -1;
if (
  helperPosition < 0 ||
  helperPosition - copyErrorPosition > 1100 ||
  !clipboardWriteMatch ||
  branchPosition < 0 ||
  branchPosition - helperPosition > 1800
) {
  throw new Error(`Clipboard copy helper changed in ${filePath}`);
}

const patched =
  source.slice(0, branchPosition) +
  browserBranch +
  source.slice(branchPosition + branch[0].length);
await writeFile(filePath, patched);
console.log(`Enabled browser clipboard copy in ${path.basename(filePath)}`);

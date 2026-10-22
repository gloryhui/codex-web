#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function patchStatsig(source) {
  if (source.includes("/* codex-web:disabled-statsig-flush */")) return source;
  function once(pattern, replacement, label) {
    if ([...source.matchAll(pattern)].length !== 1) throw Error(`Expected one ${label}`);
    source = source.replace(pattern, replacement);
  }
  once(/start\(\) \{\s*let t = \(0, u\._isServerEnv\)\(\);/g,
    `start() {
        /* codex-web:disabled-statsig-flush */
        if (window.__ELECTRON_SHIM__ != null && this._loggingEnabled === "disabled") return;
        let t = (0, u._isServerEnv)();`,
    "Statsig event logger startup");
  // The authenticated bootstrap was already attempted before this fallback.
  // Avoid an immediate duplicate initialize request; periodic live refresh and
  // identity changes keep their upstream behavior.
  once(/Promise\.resolve\(\)\.then\(\(\) => client\.initializeSync\(\)\)/g,
    "Promise.resolve().then(() => client.initializeSync({ disableBackgroundCacheRefresh: true }))",
    "browser fallback cache initialization");
  return source;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw Error("Usage: patch_codex_web_statsig.mjs <webview-assets-dir>");
  const files = (await readdir(dir)).filter((name) => /^app-initial-.*\.js$/.test(name));
  if (files.length !== 1) throw Error("Expected one app-initial bundle");
  const file = path.join(dir, files[0]);
  await writeFile(file, patchStatsig(await readFile(file, "utf8")));
  console.log(`Preserved disabled Statsig logging in ${files[0]}`);
}

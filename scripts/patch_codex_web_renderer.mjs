#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const assetsDir = process.argv[2];
if (!assetsDir) {
  throw new Error("Usage: patch_codex_web_renderer.mjs <webview-assets-dir>");
}

const appInitialFiles = (await readdir(assetsDir, { withFileTypes: true }))
  .filter(
    (entry) =>
      entry.isFile() && /^app-initial-.*\.js$/.test(entry.name),
  )
  .map((entry) => path.join(assetsDir, entry.name));

if (appInitialFiles.length !== 1) {
  throw new Error(
    `Expected one app-initial bundle in ${assetsDir}, found ${appInitialFiles.length}`,
  );
}

const appInitialPath = appInitialFiles[0];
const source = await readFile(appInitialPath, "utf8");
const alreadyPatchedGate =
  /\bE\s*=\s*\((?:cr\(JI\)|Y\(sA\))\s*===\s*`work`\)\s*\|\|\s*window\.__ELECTRON_SHIM__\s*!=\s*null/;
if (alreadyPatchedGate.test(source)) {
  console.log("Codex Web sidebar actions are already enabled");
  process.exit(0);
}

const sidebarSurfaceGates = [
  /(\bE\s*=\s*)(cr\(JI\)\s*===\s*`work`)/g,
  /(\bE\s*=\s*)(Y\(sA\)\s*===\s*`work`)/g,
];
const matchingGates = sidebarSurfaceGates.filter(
  (gate) => (source.match(gate) ?? []).length > 0,
);

if (matchingGates.length === 0) {
  throw new Error(
    `Could not find the sidebar row action gate in ${appInitialPath}`,
  );
}
if (
  matchingGates.length !== 1 ||
  (source.match(matchingGates[0]) ?? []).length !== 1
) {
  throw new Error(
    `Expected one sidebar row action gate in ${appInitialPath}`,
  );
}

const patched = source.replace(
  matchingGates[0],
  (_match, assignment, condition) =>
    `${assignment}(${condition}) || window.__ELECTRON_SHIM__ != null`,
);
await writeFile(appInitialPath, patched);
console.log(
  `Enabled sidebar action menus for the browser shim in ${path.basename(appInitialPath)}`,
);

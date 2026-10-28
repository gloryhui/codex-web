#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const assetsDir = process.argv[2];
if (!assetsDir)
  throw new Error("Usage: patch_codex_web_transport.mjs <webview-assets-dir>");
const files = (await readdir(assetsDir)).filter((name) =>
  /^app-shared-.*\.js$/.test(name),
);
if (files.length !== 1)
  throw new Error(`Expected one shared bundle, found ${files.length}`);
const file = path.join(assetsDir, files[0]);
const source = await readFile(file, "utf8");
const marker = "/* codex-web:json-message-port */";
if (source.includes(marker)) {
  console.log("Browser MessagePort transport is already JSON compatible");
} else {
  // Both ends of the app-host RPC transport must select the same serializer.
  // structuredClonable emits raw Uint8Array values; JSON WebSockets lose their
  // type, poisoning the shared connection after a pasted image or file.
  const transport = /encodingLevel\s*=\s*`structuredClonable`/g;
  if ((source.match(transport) ?? []).length !== 1) {
    throw new Error(`Expected one app-host MessagePort transport in ${file}`);
  }
  await writeFile(
    file,
    source.replace(transport, `encodingLevel=\`jsonCompatible\`${marker}`),
  );
  console.log(`Enabled JSON-compatible browser MessagePort in ${files[0]}`);
}

// Git's new Electron-only direct port is unavailable in the Web host. Keep the
// upstream worker bus for requests, cancellation and subscription events.
const initial = (await readdir(assetsDir)).filter((name) =>
  /^app-initial-.*\.js$/.test(name),
);
if (initial.length !== 1)
  throw Error(`Expected one initial bundle, found ${initial.length}`);
const initialFile = path.join(assetsDir, initial[0]);
let renderer = await readFile(initialFile, "utf8");
if (!renderer.includes("/* codex-web:git-worker-ipc */")) {
  const replacements = [
    [
      /return e\.workerId === `git`;/g,
      "return window.__ELECTRON_SHIM__ == null && e.workerId === `git`; /* codex-web:git-worker-ipc */",
    ],
    [
      /e !== `git` &&\s*window\.electronBridge\?\.subscribeToWorkerMessages\?\./g,
      "(e !== `git` || window.__ELECTRON_SHIM__ != null) && window.electronBridge?.subscribeToWorkerMessages?.",
    ],
    [
      /this\.workerId === `git`\s*\? !t\?\.connectGitWorker/g,
      "this.workerId === `git` && window.__ELECTRON_SHIM__ == null ? !t?.connectGitWorker",
    ],
  ];
  for (const [pattern, replacement] of replacements) {
    const count = [...renderer.matchAll(pattern)].length;
    if (count !== 1)
      throw Error(
        `Expected one Git renderer transport ${pattern}, found ${count}`,
      );
    renderer = renderer.replace(pattern, replacement);
  }
  await writeFile(initialFile, renderer);
}
console.log(`Enabled browser Git worker IPC in ${initial[0]}`);

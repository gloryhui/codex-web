#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const assetsDir = process.argv[2];
if (!assetsDir) throw new Error("Usage: patch_codex_web_transport.mjs <webview-assets-dir>");
const files = (await readdir(assetsDir)).filter((name) => /^app-shared-.*\.js$/.test(name));
if (files.length !== 1) throw new Error(`Expected one shared bundle, found ${files.length}`);
const file = path.join(assetsDir, files[0]);
const source = await readFile(file, "utf8");
const marker = "/* codex-web:json-message-port */";
if (source.includes(marker)) {
  console.log("Browser MessagePort transport is already JSON compatible");
  process.exit(0);
}
// Both ends of the app-host RPC transport must select the same serializer.
// structuredClonable emits raw Uint8Array values; JSON WebSockets lose their
// type, poisoning the shared connection after a pasted image or file.
const transport = /encodingLevel\s*=\s*`structuredClonable`/g;
if ((source.match(transport) ?? []).length !== 1) {
  throw new Error(`Expected one app-host MessagePort transport in ${file}`);
}
await writeFile(file, source.replace(transport, `encodingLevel=\`jsonCompatible\`${marker}`));
console.log(`Enabled JSON-compatible browser MessagePort in ${files[0]}`);

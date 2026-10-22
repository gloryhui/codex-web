#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function keepMigrationCutoff(key, current, incoming) {
  return key === "pull-request-core-attachment-backfill-cutoff-at-v1" &&
    typeof current === "number" && Number.isFinite(current) && current > 0 &&
    incoming !== current;
}

export function patchMigrationState(source) {
  if (source.includes("/* codex-web:stable-migration-cutoff */")) return source;
  const predicate = /function (\w+)\((\w+), (\w+), (\w+)\) \{\s*if \(\2 !== `cloud-aeon-sidebar-cache-v1`/g;
  if ([...source.matchAll(predicate)].length !== 1) {
    throw Error("Expected one persisted atom conflict predicate");
  }
  return source.replace(predicate, (original, fn, key, current, incoming) =>
    `function ${fn}(${key}, ${current}, ${incoming}) {\n` +
    `/* codex-web:stable-migration-cutoff */\n` +
    `if ((${keepMigrationCutoff.toString()})(${key}, ${current}, ${incoming})) return false;\n` +
    `if (${key} !== \`cloud-aeon-sidebar-cache-v1\``);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw Error("Usage: patch_codex_web_state.mjs <vite-build-dir>");
  const files = (await readdir(dir)).filter((name) => /^main-.*\.js$/.test(name));
  if (files.length !== 1) throw Error("Expected one main bundle");
  const file = path.join(dir, files[0]);
  await writeFile(file, patchMigrationState(await readFile(file, "utf8")));
  console.log(`Preserved migration cutoff across browser windows in ${files[0]}`);
}

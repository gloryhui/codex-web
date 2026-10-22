#!/usr/bin/env node
import { readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { brotliCompress, constants, gzip } from "node:zlib";
import { promisify } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";

const br = promisify(brotliCompress), gz = promisify(gzip);
export async function precompressWebAssets(root) {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && file === path.join(root, "generations")) continue;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && /\.(js|css|html|json|svg)$/.test(entry.name)) files.push(file);
    }
  }
  await walk(root);
  let originalBytes = 0, compressedBytes = 0, count = 0, next = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next++], source = await readFile(file);
      // Tiny files are cheaper to transmit directly. Remove stale siblings.
      if (source.length < 1024) {
        await Promise.all([".br", ".gz"].map((ext) => unlink(file + ext).catch((e) => { if (e.code !== "ENOENT") throw e; })));
        continue;
      }
      const [brotli, zipped] = await Promise.all([
        br(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
        gz(source, { level: 6 }),
      ]);
      for (const [ext, data] of [[".br", brotli], [".gz", zipped]]) {
        if (data.length >= source.length) {
          await unlink(file + ext).catch((e) => { if (e.code !== "ENOENT") throw e; });
        } else {
          await writeFile(file + ext + ".tmp", data);
          await rename(file + ext + ".tmp", file + ext);
        }
      }
      count++; originalBytes += source.length; compressedBytes += Math.min(source.length, brotli.length);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  return { count, originalBytes, compressedBytes };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw Error("Usage: precompress_web_assets.mjs <webview-dir>");
  console.log(JSON.stringify(await precompressWebAssets(process.argv[2])));
}

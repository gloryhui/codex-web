#!/usr/bin/env node
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, stat, link, chmod, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, gzipSync, constants as zlibConstants } from "node:zlib";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function optionalJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
export async function prepareAssetVersion(root) {
  const assets = path.join(root, "assets"), generations = path.join(root, "generations");
  const files = {}, all = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) all.push(path.relative(assets, file).split(path.sep).join("/"));
      else if (entry.isSymbolicLink()) throw Error(`Asset symlink is unsupported: ${file}`);
    }
  }
  await walk(assets);
  const names = new Set(all);
  for (const file of all) {
    // Packaged data can itself be a standalone .gz/.br resource.
    if (/\.(?:br|gz)$/.test(file) && names.has(file.replace(/\.(?:br|gz)$/, ""))) continue;
    files[file] = digest(await readFile(path.join(assets, file)));
  }
  const version = digest(JSON.stringify(files)).slice(0, 24), target = path.join(generations, version);
  const pointer = path.join(root, "asset-version.json"), previous = await optionalJson(pointer);
  const validPrevious = /^[a-f0-9]{24}$/.test(previous?.version ?? "");
  const previousRoot = validPrevious ? path.join(generations, previous.version) : null;
  const previousManifest = previousRoot ? await optionalJson(path.join(previousRoot, "_manifest.json")) : null;
  if (!(await optionalJson(path.join(target, "_manifest.json")))) {
    const stage = path.join(generations, `.building-${version}-${process.pid}`);
    await mkdir(stage, { recursive: true });
    for (const [file, hash] of Object.entries(files)) {
      for (const ext of ["", ".br", ".gz"]) {
        const from = path.join(assets, file + ext), to = path.join(stage, file + ext);
        try { await stat(from); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
        await mkdir(path.dirname(to), { recursive: true });
        if (previousRoot && previousManifest?.files?.[file] === hash) {
          try { await link(path.join(previousRoot, file + ext), to); }
          catch (error) { if (error.code !== "ENOENT") throw error; await copyFile(from, to, constants.COPYFILE_FICLONE); }
        } else await copyFile(from, to, constants.COPYFILE_FICLONE);
        await chmod(to, 0o444);
      }
    }
    await writeFile(path.join(stage, "_manifest.json"), JSON.stringify({ version, files }));
    await rename(stage, target);
  }
  const index = path.join(root, "index.html");
  let html = await readFile(index, "utf8");
  html = html.replace(/(?:\.\/|\/)web-assets\/[a-f0-9]{24}\//g, "./assets/")
    .replace(/((?:src|href)=")\.\/assets\//g, `$1/web-assets/${version}/`);
  await writeFile(index, html);
  const bytes = Buffer.from(html);
  for (const [ext, data] of [[".br", brotliCompressSync(bytes, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })], [".gz", gzipSync(bytes, { level: 6 })]]) {
    await writeFile(index + ext + ".tmp", data); await rename(index + ext + ".tmp", index + ext);
  }
  await writeFile(pointer + ".tmp", JSON.stringify({ version, files: Object.keys(files).length }));
  await rename(pointer + ".tmp", pointer);
  return { version, files: Object.keys(files).length, previous: previous?.version ?? null };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw Error("Usage: prepare_asset_version.mjs <webview-dir>");
  console.log(JSON.stringify(await prepareAssetVersion(process.argv[2])));
}

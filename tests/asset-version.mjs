import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import Fastify from "fastify";
import staticPlugin from "@fastify/static";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { prepareAssetVersion } from "../scripts/prepare_asset_version.mjs";
import { precompressWebAssets } from "../scripts/precompress_web_assets.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "codex-version-test-")), app = Fastify();
try {
  await mkdir(path.join(root, "assets"));
  const original = 'import "./shared.js"; console.log("old implementation");\n'.repeat(40);
  await writeFile(path.join(root, "assets", "app.js"), original);
  await writeFile(path.join(root, "assets", "shared.js"), 'export const value = "same singleton";');
  await writeFile(path.join(root, "assets", "standalone.gz"), "packaged compressed data");
  await writeFile(path.join(root, "index.html"), '<script type="module" src="./assets/app.js"></script>');
  await precompressWebAssets(root);
  const first = await prepareAssetVersion(root), html = await readFile(path.join(root, "index.html"), "utf8");
  assert.ok(html.includes(`/web-assets/${first.version}/app.js`));
  assert.equal((await prepareAssetVersion(root)).version, first.version);
  assert.equal(await readFile(path.join(root, "index.html"), "utf8"), html);
  assert.equal(await readFile(path.join(root, "generations", first.version, "standalone.gz"), "utf8"), "packaged compressed data");
  const updated = original.replaceAll("old implementation", "new implementation");
  await writeFile(path.join(root, "assets", "app.js"), updated);
  await precompressWebAssets(root); // Must skip immutable generation files.
  const second = await prepareAssetVersion(root);
  assert.notEqual(second.version, first.version);
  assert.equal(await readFile(path.join(root, "generations", first.version, "app.js"), "utf8"), original);
  assert.equal(await readFile(path.join(root, "generations", second.version, "app.js"), "utf8"), updated);
  assert.equal((await stat(path.join(root, "generations", first.version, "shared.js"))).ino,
    (await stat(path.join(root, "generations", second.version, "shared.js"))).ino);
  await app.register(staticPlugin, { root: path.join(root, "generations"), prefix: "/web-assets/",
    preCompressed: true, immutable: true, maxAge: "1y",
    setHeaders(response) { response.setHeader("Vary", "Accept-Encoding"); },
  });
  for (const [version, expected] of [[first.version, original], [second.version, updated]]) {
    for (const [encoding, decode] of [["br", brotliDecompressSync], ["gzip", gunzipSync], ["identity", (bytes) => bytes]]) {
      const response = await app.inject({ url: `/web-assets/${version}/app.js`, headers: { "accept-encoding": encoding } });
      assert.equal(response.statusCode, 200);
      assert.match(response.headers["content-type"], /javascript/);
      assert.match(response.headers["cache-control"], /immutable/);
      assert.ok(Number(response.headers["cache-control"].match(/max-age=(\d+)/)[1]) >= 31000000);
      assert.equal(response.headers.vary, "Accept-Encoding");
      assert.equal(decode(response.rawPayload).toString(), expected);
    }
  }
  assert.equal((await app.inject({ url: "/web-assets/missing/app.js" })).statusCode, 404);
  assert.equal((await app.inject({ url: `/web-assets/${second.version}/missing.js` })).statusCode, 404);
  assert.equal(gunzipSync(await readFile(path.join(root, "index.html.gz"))).toString(), await readFile(path.join(root, "index.html"), "utf8"));
} finally { await app.close(); await rm(root, { recursive: true, force: true }); }
console.log("Versioned assets: immutable snapshots, changed URLs, old-tab compatibility, shared unchanged files, real encodings/headers, missing-file 404 and standalone compressed data passed");

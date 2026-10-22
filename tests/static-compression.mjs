import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import Fastify from "fastify";
import staticPlugin from "@fastify/static";
import { precompressWebAssets } from "../scripts/precompress_web_assets.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "codex-static-test-"));
const app = Fastify();
try {
  let source = Buffer.from('console.log("unchanged source bytes");\n'.repeat(200));
  await writeFile(path.join(root, "app.js"), source);
  await precompressWebAssets(root);
  await app.register(staticPlugin, { root, preCompressed: true,
    setHeaders(response) { response.setHeader("Vary", "Accept-Encoding"); },
  });
  for (const [encoding, decode] of [["br", brotliDecompressSync], ["gzip", gunzipSync], ["identity", (x) => x]]) {
    const response = await app.inject({ url: "/app.js", headers: { "accept-encoding": encoding } });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /javascript/);
    assert.equal(response.headers.vary, "Accept-Encoding");
    assert.equal(response.headers["content-encoding"], encoding === "identity" ? undefined : encoding);
    assert.deepEqual(decode(response.rawPayload), source);
  }
  source = Buffer.from('console.log("new release bytes");\n'.repeat(220));
  await writeFile(path.join(root, "app.js"), source);
  await precompressWebAssets(root);
  assert.deepEqual(brotliDecompressSync(await readFile(path.join(root, "app.js.br"))), source);
  await writeFile(path.join(root, "app.js"), "small");
  await precompressWebAssets(root);
  await assert.rejects(readFile(path.join(root, "app.js.br")), { code: "ENOENT" });
  console.log("Static compression: Brotli/gzip/identity, release refresh and stale sibling removal passed");
} finally { await app.close(); await rm(root, { recursive: true, force: true }); }

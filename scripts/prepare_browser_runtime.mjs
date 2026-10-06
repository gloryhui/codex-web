import fs from "node:fs/promises";
import path from "node:path";
const source = path.resolve(
  process.argv[2] ?? "scratch/ChatGPT.app/Contents/Resources",
);
const destination = path.resolve(
  process.argv[3] ?? "scratch/asar/host-resources",
);
const manifest = JSON.parse(
  await fs.readFile(path.join(source, "cua_node/manifest.json"), "utf8"),
);
if (
  !["darwin", "linux", "win32"].includes(manifest.platform) ||
  !["arm64", "x64"].includes(manifest.arch)
)
  throw new Error("Unsupported official runtime target");
const root = path.join(destination, `${manifest.platform}-${manifest.arch}`);
const executableSuffix = manifest.platform === "win32" ? ".exe" : "";
for (const file of [
  `cua_node/bin/node${executableSuffix}`,
  `cua_node/bin/node_repl${executableSuffix}`,
  "plugins/openai-bundled/.agents/plugins/marketplace.json",
])
  await fs.access(path.join(source, file));
// Keep the official helper, Node modules and plugin payload together, per target.
await fs.mkdir(root, { recursive: true });
for (const name of ["cua_node", "plugins"]) {
  await fs.rm(path.join(root, name), { recursive: true, force: true });
  await fs.cp(path.join(source, name), path.join(root, name), {
    recursive: true,
    dereference: false,
  });
}
console.log(
  `[browser-runtime] prepared ${manifest.platform}-${manifest.arch} in ${root}`,
);

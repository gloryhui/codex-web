import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Desktop 26.1021 splits startup services out of app-initial. Keep semantic
// patches together while writing each module back to its original file/scope.
const separator = "\n/* codex-web:startup-module-boundary */\n";
export async function patchExtractedStartup(dir, patch) {
  const names = await readdir(dir);
  const files = [/^app-initial-.*\.js$/, /^initialize-app-host-services-.*\.js$/].map((pattern) => {
    const matches = names.filter((name) => pattern.test(name));
    if (matches.length !== 1) throw Error(`Expected one startup module ${pattern}`);
    return path.join(dir, matches[0]);
  });
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join(separator);
  const parts = patch(source).split(separator);
  if (parts.length !== files.length) throw Error("Startup patch changed module boundaries");
  for (let i = 0; i < files.length; i++) await writeFile(files[i], parts[i]);
}

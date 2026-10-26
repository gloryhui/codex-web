import { readFile, readdir } from "node:fs/promises";

const root = new URL("../scratch/asar/webview/assets/", import.meta.url);
export async function extractedBundle(pattern) {
  const names = (await readdir(root)).filter((name) => pattern.test(name));
  if (names.length !== 1) throw Error(`Expected one extracted bundle ${pattern}`);
  return readFile(new URL(names[0], root), "utf8");
}
export async function extractedStartup() {
  return (await Promise.all([
    extractedBundle(/^app-initial-.*\.js$/),
    extractedBundle(/^initialize-app-host-services-.*\.js$/),
  ])).join("\n");
}

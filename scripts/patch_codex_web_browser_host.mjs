import fs from "node:fs";
import path from "node:path";
const root = process.argv[2];
if (!root) throw new Error("Pass the extracted webview/assets directory");
let count = 0;
for (const name of fs
  .readdirSync(root)
  .filter((name) => /^app-shared-.*\.js$/.test(name))) {
  const file = path.join(root, name);
  let source = fs.readFileSync(file, "utf8");
  if (source.includes("window.__CODEX_WEB_CREATE_WEBVIEW__()")) {
    count++;
    continue;
  }
  const pattern = /document\.createElement\((`webview`|"webview"|'webview')\)/g;
  const matches = [...source.matchAll(pattern)];
  if (
    matches.length !== 1 ||
    !source.includes("data-browser-sidebar-browser-tab-id")
  )
    throw new Error(
      `Expected exactly one managed browser webview constructor in ${name}`,
    );
  source = source.replace(pattern, "window.__CODEX_WEB_CREATE_WEBVIEW__()");
  fs.writeFileSync(file, source);
  count++;
}
if (count !== 1)
  throw new Error(
    `Expected one app-shared browser host bundle, found ${count}`,
  );
console.log("[browser-host] adapted one managed webview constructor");

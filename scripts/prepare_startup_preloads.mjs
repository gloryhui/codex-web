#!/usr/bin/env node
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export function staticImports(source) {
  const file = ts.createSourceFile("preload.js", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  return file.statements.flatMap((statement) =>
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text] : []);
}

export async function dependencyClosure(entries, read) {
  const seen = new Set();
  async function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of staticImports(await read(file))) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (dependency.startsWith("../") || dependency.startsWith("/")) throw Error("Preload outside assets");
      if (dependency.endsWith(".js")) await visit(dependency);
    }
  }
  for (const entry of entries) await visit(entry);
  return [...seen];
}

export async function prepareStartupPreloads(root) {
  const assets = path.join(root, "assets"), files = await readdir(assets);
  const one = (pattern) => {
    const matches = files.filter((file) => pattern.test(file));
    if (matches.length !== 1) throw Error(`Expected one startup entry ${pattern}`);
    return matches[0];
  };
  const core = [one(/^app-main-.*\.js$/), one(/^app-initial-.*\.js$/), one(/^app-primary-.*\.js$/)];
  const route = files.filter((name) => /^local-conversation-page-.*\.js$/.test(name));
  if (!route.length) throw Error("Missing local conversation route");
  const dependencies = await dependencyClosure([...core, ...route], (file) => readFile(path.join(assets, file), "utf8"));
  const index = path.join(root, "index.html");
  let html = (await readFile(index, "utf8")).replace(/\n\s*<!-- codex-web:startup-preloads -->[\s\S]*?<!-- \/codex-web:startup-preloads -->\n?/g, "\n");
  const existing = new Set([...html.matchAll(/(?:href|src)="\.\/assets\/([^"]+)"/g)].map((match) => match[1]));
  const links = dependencies.filter((file) => !existing.has(file)).map((file) =>
    `    <link rel="modulepreload" crossorigin fetchpriority="${core.includes(file) ? "high" : "low"}" href="./assets/${file}" />`);
  const block = `\n    <!-- codex-web:startup-preloads -->\n${links.join("\n")}\n    <!-- /codex-web:startup-preloads -->\n`;
  if (!html.includes("</head>")) throw Error("Missing HTML head");
  html = html.replace(/\s*<\/head>/, block + "  </head>");
  await writeFile(index, html);
  return { modules: links.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw Error("Usage: prepare_startup_preloads.mjs <webview-dir>");
  console.log(JSON.stringify(await prepareStartupPreloads(process.argv[2])));
}

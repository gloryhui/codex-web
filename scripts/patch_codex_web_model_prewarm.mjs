#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function prewarmModels(queryClient, requestClient, queryKey) {
  return queryClient.prefetchQuery({
    queryKey,
    staleTime: 300000,
    queryFn: () => requestClient.sendRequest("model/list", {
      includeHidden: true, cursor: null, limit: 100,
    }, { priority: "background" }),
  });
}

export function modelQueryKey(base, config, customProvider) {
  return [...base,
    ...(customProvider ? [typeof config.model_provider === "string" ? config.model_provider : null] : []),
    ...(typeof config.model_catalog_json === "string" ? [config.model_catalog_json] : []),
  ];
}

export function patchModelPrewarm(source) {
  // The hook runs after local auth is ready, before Statsig/account loading.
  const anchor = /let \{ appSessionId: h, browserLocale: g \} = m,\s*_;\s*t\[5\] === p/g;
  const hook = `
/* codex-web:model-prewarm */
function codexWebPrewarmModels(auth) {
  let scope = E(J);
  I8.useEffect(() => {
    if (window.__ELECTRON_SHIM__ == null || auth.isLoading || auth.authMethod !== "chatgpt" || !scope.get(dh).includes("local")) return;
    ET();
    let cancelled = false;
    (async () => {
      const response = await scope.query.fetch(bC, "local");
      if (cancelled) return;
      const config = Xm(response.config);
      const key = (${modelQueryKey.toString()})(_zn("local", auth.authMethod, 100), config, ewt(config));
      await (${prewarmModels.toString()})(scope.queryClient, gh(scope, "local"), key);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [scope, auth.isLoading, auth.authMethod, auth.accountId, auth.userId]);
}
`;
  const marker = "/* codex-web:model-prewarm */";
  if (source.includes(marker)) {
    const start = source.indexOf(marker), end = source.indexOf("function p0l(e) {", start);
    if (end < 0) throw Error("Missing prewarm hook boundary");
    return source.slice(0, start) + hook.trimStart() + "\n" + source.slice(end);
  }
  if ([...source.matchAll(anchor)].length !== 1) throw Error("Expected one authenticated Statsig provider");
  if (!source.includes("function p0l(e) {")) throw Error("Missing Statsig provider entry");
  source = source.replace("function p0l(e) {", hook + "\nfunction p0l(e) {");
  return source.replace(anchor, (match) => match.replace("t[5] === p", "codexWebPrewarmModels(n);\n  t[5] === p"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw Error("Usage: patch_codex_web_model_prewarm.mjs <webview-assets-dir>");
  const files = (await readdir(dir)).filter((name) => /^app-initial-.*\.js$/.test(name));
  if (files.length !== 1) throw Error("Expected one app-initial bundle");
  const file = path.join(dir, files[0]);
  await writeFile(file, patchModelPrewarm(await readFile(file, "utf8")));
  console.log(`Prewarmed local model query in ${files[0]}`);
}

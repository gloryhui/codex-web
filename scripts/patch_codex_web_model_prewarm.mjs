#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { patchExtractedStartup } from "./extracted_startup.mjs";

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
  if (source.includes("/* codex-web:model-prewarm */")) return source;
  const anchor = /let \{ appSessionId: h, browserLocale: g \} = m,\s*_;\s*t\[5\] === p/g;
  if ([...source.matchAll(anchor)].length !== 1) throw Error("Expected one authenticated Statsig provider");
  const initialImport = /from "(\.\/app-initial-[^"/]+\.js)";/g;
  if ([...source.matchAll(initialImport)].length !== 1) throw Error("Expected one startup import from app-initial");
  source = source.replace(initialImport, (match, file) => `${match}\nimport { codexWebPrewarmModels } from "${file}";`);
  const hook = `
/* codex-web:model-prewarm */
export function codexWebPrewarmModels(auth) {
  V(); Tct(); YSn(); rg();
  let scope = Or(Q);
  Pr().useEffect(() => {
    if (window.__ELECTRON_SHIM__ == null || auth.isLoading || auth.authMethod !== "chatgpt" || !scope.get(cg).includes("local")) return;
    let cancelled = false;
    (async () => {
      const response = await scope.query.fetch(yg, { hostId: "local", cwd: null, failClosed: true });
      if (cancelled) return;
      const config = ng(response.config);
      const key = (${modelQueryKey.toString()})(qSn("local", auth.authMethod, 100), config, Zst(config));
      await (${prewarmModels.toString()})(scope.queryClient, pg(scope, "local"), key);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [scope, auth.isLoading, auth.authMethod, auth.accountId, auth.userId]);
}
`;
  if (source.split("function qSn(e, t, n = 100, r) {").length !== 2) throw Error("Missing native model key helper");
  source = source.replace("function qSn(e, t, n = 100, r) {", hook + "\nfunction qSn(e, t, n = 100, r) {");
  return source.replace(anchor, (match) => match.replace("t[5] === p", "codexWebPrewarmModels(n);\n  t[5] === p"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw Error("Usage: patch_codex_web_model_prewarm.mjs <webview-assets-dir>");
  await patchExtractedStartup(dir, patchModelPrewarm);
  console.log("Prewarmed local model query across extracted modules");
}

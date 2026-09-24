#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const buildDir = process.argv[2];
if (!buildDir) {
  throw new Error("Usage: patch_codex_web_bundle.mjs <vite-build-dir>");
}

const wslSetter =
  /if\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*throw Error\(`shouldSpawnInsideWsl already set`\);\s*\1\s*=\s*([A-Za-z_$][\w$]*)\s*;?/g;
const nativeIntlGetter =
  /function\s+([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\{\s*if\s*\(\s*([A-Za-z_$][\w$]*)\s*==\s*null\s*\)\s*throw Error\(`NativeIntl has not been configured\.`\);?\s*return\s+\2\.nativeIntl\s*;?\s*\}/g;
let wslSettersPatched = 0;
let nativeIntlGettersPatched = 0;
let rendererWindowFactoriesPatched = 0;

for (const entry of await readdir(buildDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".js")) continue;

  const filePath = path.join(buildDir, entry.name);
  const source = await readFile(filePath, "utf8");
  let fileWslSettersPatched = 0;
  let fileNativeIntlGettersPatched = 0;
  let fileRendererWindowFactoriesPatched = 0;

  const patchedSetters = source.replace(wslSetter, (_match, flag, value) => {
    fileWslSettersPatched += 1;
    return `${flag} ??= ${value};`;
  });
  let patched = patchedSetters.replace(
    nativeIntlGetter,
    (_match, getter, state) => {
      const intlClass = patchedSetters.match(
        /\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*class\s+[A-Za-z_$][\w$]*\s*\{\s*messages\s*;/,
      )?.[1];
      if (!intlClass) {
        throw new Error(
          `Could not find the NativeIntl fallback class in ${entry.name}`,
        );
      }

      fileNativeIntlGettersPatched += 1;
      return `function ${getter}(){return ${state}?.nativeIntl??${intlClass}.createDefault()}`;
    },
  );

  patched = patched.replace(
    /windowManager:\s*([A-Za-z_$][\w$]*),[\s\S]{0,1000}?setWindowContext:\s*\(([A-Za-z_$][\w$]*)\)\s*=>\s*\{\s*([A-Za-z_$][\w$]*)\s*=\s*\2;/g,
    (match, windowManager) => {
      fileRendererWindowFactoriesPatched += 1;
      return `${match}\n      globalThis.__codexElectronIpcBridge?.setRendererWindowFactory?.(() => ${windowManager}.createPrimaryWindow({show:false}));`;
    },
  );

  if (
    fileWslSettersPatched > 0 ||
    fileNativeIntlGettersPatched > 0 ||
    fileRendererWindowFactoriesPatched > 0
  ) {
    await writeFile(filePath, patched);
    wslSettersPatched += fileWslSettersPatched;
    nativeIntlGettersPatched += fileNativeIntlGettersPatched;
    rendererWindowFactoriesPatched += fileRendererWindowFactoriesPatched;
  }
}

if (wslSettersPatched === 0) {
  throw new Error("No shouldSpawnInsideWsl setter found in the Vite build");
}
if (nativeIntlGettersPatched === 0) {
  throw new Error("No NativeIntl getter found in the Vite build");
}
if (rendererWindowFactoriesPatched !== 1) {
  throw new Error(
    `Expected one renderer window factory, found ${rendererWindowFactoriesPatched}`,
  );
}

console.log(
  `Patched ${wslSettersPatched} WSL setter(s), ${nativeIntlGettersPatched} NativeIntl getter(s), and ${rendererWindowFactoriesPatched} renderer window factory`,
);

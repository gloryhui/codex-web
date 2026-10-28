import assert from "node:assert/strict";
import { Worker, MessageChannel } from "node:worker_threads";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = process.env.GIT_TEST_REPOSITORY ?? root;
const build = path.join(root, "scratch/asar/.vite/build");
const main = (await readdir(build)).filter((name) =>
  /^main-.*\.js$/.test(name),
);
assert.equal(main.length, 1);
assert.match(
  await readFile(path.join(build, main[0]), "utf8"),
  /git-worker-thread-fallback/,
);
const assets = path.join(root, "scratch/asar/webview/assets");
const initial = (await readdir(assets)).find((name) =>
  /^app-initial-.*\.js$/.test(name),
);
const renderer = await readFile(path.join(assets, initial), "utf8");
const direct = renderer.match(
  /function (\w+)\(e\) \{\s*return window\.__ELECTRON_SHIM__ == null && e\.workerId === `git`;[^}]+\}/,
)?.[0];
assert.ok(direct, "Git direct-port guard must be patched");
const useDirect = Function("window", `return (${direct})`);
assert.equal(useDirect({ __ELECTRON_SHIM__: {} })({ workerId: "git" }), false);
assert.equal(useDirect({})({ workerId: "git" }), true);
const workerClass = renderer.match(
  /\(CHn = (class \{[\s\S]+?\n      \})\)\);/,
)?.[1];
assert.ok(workerClass);
let subscription;
const sent = [];
const bridge = {
  subscribeToWorkerMessages(id, listener) {
    subscription = { id, listener };
  },
  async sendWorkerMessageFromView(id, message) {
    sent.push({ id, message });
  },
};
const makeClient = (window) =>
  Function(
    "window",
    "pHn",
    "bHn",
    `return new (${workerClass})("git")`,
  )(window, class {}, useDirect(window));
const git = makeClient({ __ELECTRON_SHIM__: {}, electronBridge: bridge });
assert.equal(subscription.id, "git");
assert.equal(git.workerId, "git");
for (const type of ["worker-request", "worker-request-cancel"]) {
  await git.sendMessage({ type, workerId: "git", id: "test" });
}
assert.deepEqual(
  sent.map(({ id, message }) => [id, message.type]),
  [
    ["git", "worker-request"],
    ["git", "worker-request-cancel"],
  ],
);
subscription = undefined;
makeClient({ electronBridge: bridge });
assert.equal(
  subscription,
  undefined,
  "native Git must retain direct-port subscriptions",
);
console.log(
  "Git renderer: Web subscribes through IPC; native Desktop retains direct ports",
);
const sentry = new MessageChannel();
const worker = new Worker(path.join(build, "worker.js"), {
  workerData: {
    workerId: "git",
    analyticsEnabled: false,
    maxLogLevel: "error",
    sentryInitOptions: {
      appVersion: "26.1023.51421",
      buildFlavor: "prod",
      codexAppSessionId: "web-git-regression",
    },
    sentryRewriteFramesRoot: root,
    spawnInsideWsl: false,
    resourcesPath: path.join(root, "scratch/asar"),
    sentryRpcPort: sentry.port2,
    mainRpcPort: null,
  },
  transferList: [sentry.port2],
});
try {
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Git worker request timed out")),
      20000,
    );
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code) reject(Error(`Git worker exited ${code}`));
    });
    worker.on("message", (message) => {
      if (message.type !== "worker-response") return;
      clearTimeout(timer);
      resolve(message);
    });
    worker.postMessage({
      type: "worker-request",
      workerId: "git",
      request: {
        id: "git-worker-regression",
        method: "current-branch",
        params: { root: repository, operationSource: "test" },
      },
    });
  });
  assert.equal(response.workerId, "git");
  assert.equal(response.response.result.type, "ok", JSON.stringify(response));
  const branch = execFileSync(
    "git",
    ["-C", repository, "branch", "--show-current"],
    { encoding: "utf8" },
  ).trim();
  assert.ok(
    JSON.stringify(response.response.result).includes(branch),
    JSON.stringify(response),
  );
  console.log(
    "Git worker: actual extracted worker_threads path reads the current repository branch",
  );
} finally {
  await worker.terminate();
  sentry.port1.close();
}

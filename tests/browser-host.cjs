const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
if (
  process.env.TEST_ISOLATED !== "1" ||
  !process.env.TEST_URL ||
  !process.env.TEST_HOST_LOG
)
  throw Error(
    "Run against an isolated Web host; set TEST_ISOLATED=1, TEST_URL and TEST_HOST_LOG.",
  );
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE || "playwright-core",
);
function pipeRpc(pipe) {
  const s = net.createConnection(pipe);
  let seq = 0,
    buf = Buffer.alloc(0),
    pending = new Map();
  s.on("data", (data) => {
    buf = Buffer.concat([buf, data]);
    while (buf.length >= 4) {
      const n = buf.readUInt32LE(0);
      if (buf.length < n + 4) break;
      const m = JSON.parse(buf.subarray(4, n + 4));
      buf = buf.subarray(n + 4);
      const p = pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(m.id);
        m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
      }
    }
  });
  const failPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  s.on("error", failPending);
  s.on("close", () => failPending(Error("IAB pipe closed")));
  return {
    close: () => s.destroy(),
    call: (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++seq,
          body = Buffer.from(
            JSON.stringify({ jsonrpc: "2.0", id, method, params }),
          );
        const size = Buffer.alloc(4);
        size.writeUInt32LE(body.length);
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("pipe timeout " + method));
        }, 20000);
        pending.set(id, { resolve, reject, timer });
        s.write(Buffer.concat([size, body]));
      }),
  };
}
(async () => {
  const b = await chromium.launch({
    ...(process.env.CODEX_WEB_BROWSER_EXECUTABLE
      ? { executablePath: process.env.CODEX_WEB_BROWSER_EXECUTABLE }
      : { channel: "chrome" }),
  });
  let pipe;
  const fixture = require("node:http").createServer((req, res) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<title>Browser regression</title><h1>Real Chromium page</h1><input placeholder="Name"><button id="increment" onclick="this.innerText=Number(this.innerText)+1">0</button><div style="height:1800px">Scroll fixture</div><a href="/next">Next</a>',
    );
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const fixtureUrl = "http://127.0.0.1:" + fixture.address().port;
  try {
    const p = await b.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("[browser]"))
        console.error(message.text());
    });
    await p.goto(process.env.TEST_URL);
    await p
      .locator("[contenteditable=true]")
      .first()
      .waitFor({ timeout: 60000 });
    const rpc = (method, params) =>
      p.evaluate(
        ({ method, params }) =>
          new Promise((resolve, reject) => {
            const id = crypto.randomUUID();
            const timer = setTimeout(() => reject(Error("RPC timeout")), 20000);
            const listener = (e) => {
              if (e.data?.type === "mcp-response" && e.data.message.id === id) {
                clearTimeout(timer);
                window.removeEventListener("message", listener);
                e.data.message.error
                  ? reject(Error(JSON.stringify(e.data.message.error)))
                  : resolve(e.data.message.result);
              }
            };
            window.addEventListener("message", listener);
            window.electronBridge
              .sendMessageFromView({
                type: "mcp-request",
                hostId: "local",
                request: { id, method, params },
              })
              .catch(reject);
          }),
        { method, params },
      );
    const r = process.env.TEST_THREAD_ID
      ? { thread: { id: process.env.TEST_THREAD_ID } }
      : await rpc("thread/start", {
          cwd: process.cwd(),
          model: "gpt-6.1-sol",
          ephemeral: false,
        });
    const id = r.thread.id;
    await rpc("thread/name/set", {
      threadId: id,
      name: "Browser 自动操作验证",
    });
    await p.goto(process.env.TEST_URL + "/thread/" + id);
    await p
      .locator("[contenteditable=true]")
      .first()
      .waitFor({ timeout: 60000 });
    await p.evaluate(
      (url) =>
        window.postMessage(
          {
            type: "toggle-browser-panel",
            open: true,
            url,
            source: "manual",
            initiator: "side_panel_menu",
          },
          "*",
        ),
      fixtureUrl,
    );
    const panel = p.locator(
      "[data-browser-sidebar-browser-tab-id][role=region]",
    );
    await panel.locator("img").waitFor();
    await p
      .waitForFunction(
        () =>
          document
            .querySelector(
              "[data-browser-sidebar-browser-tab-id][role=region] img",
            )
            ?.src.startsWith("data:image/jpeg"),
        {},
        { timeout: 30000 },
      )
      .catch(async (error) => {
        console.error("Browser panel:", await panel.innerText());
        throw error;
      });
    console.log("PASS real browser displayed (X-Frame-Options DENY)");
    let socketPath;
    for (let i = 0; i < 40; i++) {
      const lines = fs
        .readFileSync(process.env.TEST_HOST_LOG, "utf8")
        .split("\n")
        .filter(
          (l) =>
            l.includes("browser_use_iab_backend_startup_ready") &&
            l.includes("sessionId=" + id),
        );
      const match = lines.at(-1)?.match(/pipePath=(\S+)/);
      if (match && fs.existsSync(match[1])) {
        socketPath = match[1];
        break;
      }
      await p.waitForTimeout(250);
    }
    assert(socketPath, "official IAB socket started");
    let toolsReady = false;
    for (let i = 0; i < 40; i++) {
      const status = await rpc("mcpServerStatus/list", {});
      toolsReady = status.data?.some(
        (server) =>
          server.name === "node_repl" &&
          Object.keys(server.tools ?? {}).length > 0,
      );
      if (toolsReady) break;
      await p.waitForTimeout(250);
    }
    assert(toolsReady, "official node_repl tools exposed by CLI");
    console.log("PASS CLI exposes official node_repl tools");
    pipe = pipeRpc(socketPath);
    const session = { session_id: id, turn_id: "browser-regression-turn" };
    console.log("INFO", (await pipe.call("getInfo", session)).type);
    const tabs = await pipe.call("getTabs", session);
    assert(tabs.length >= 1);
    const tabId = tabs[0].id;
    const cdp = (method, commandParams = {}) =>
      pipe.call("executeCdp", {
        ...session,
        target: { tabId },
        method,
        commandParams,
        timeoutMs: 15000,
      });
    assert(
      (await cdp("Page.getLayoutMetrics")).cssVisualViewport.clientWidth > 100,
    );
    await cdp("Runtime.enable");
    const evalValue = async (expression) =>
      (await cdp("Runtime.evaluate", { expression, returnByValue: true }))
        .result.value;
    assert.equal(await evalValue("document.title"), "Browser regression");
    const rect = await evalValue(
      '(()=>{const r=document.querySelector("#increment").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
    );
    await cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...rect,
    });
    await cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...rect,
    });
    assert.equal(
      await evalValue('document.querySelector("#increment").textContent'),
      "1",
    );
    console.log("PASS official browser-use CDP click");
    await cdp("Runtime.evaluate", {
      expression: 'document.querySelector("input").focus()',
    });
    await cdp("Input.insertText", { text: "自动输入中文" });
    assert.equal(
      await evalValue('document.querySelector("input").value'),
      "自动输入中文",
    );
    const shot = await cdp("Page.captureScreenshot", { format: "png" });
    assert(Buffer.from(shot.data, "base64").length > 1000);
    console.log("PASS official browser-use input + screenshot");
    await pipe.call("turnEnded", session);
    await p.waitForTimeout(500);
    const pos = await evalValue(
      '(()=>{const r=document.querySelector("#increment").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:innerWidth,h:innerHeight}})()',
    );
    await pipe.call("turnEnded", session);
    await p.waitForTimeout(500); // turnEnded releases the official renderer input overlay asynchronously.
    await p.waitForFunction(
      ({ w, h }) => {
        const image = document.querySelector(
          "[data-browser-sidebar-browser-tab-id][role=region] img",
        );
        return (
          image?.complete &&
          image.naturalWidth === w &&
          image.naturalHeight === h
        );
      },
      { w: pos.w, h: pos.h },
      { timeout: 10000 },
    );
    const box = await panel.boundingBox();
    await p.mouse.click(
      box.x + (pos.x * box.width) / pos.w,
      box.y + (pos.y * box.height) / pos.h,
    );
    await p.waitForTimeout(500);
    assert.equal(
      await evalValue('document.querySelector("#increment").textContent'),
      "2",
    );
    console.log("PASS panel pointer reaches the same browser-use page");
    await pipe.call("turnEnded", session);
    const inputPos = await evalValue(
      '(()=>{const r=document.querySelector("input").getBoundingClientRect();return {x:r.x+20,y:r.y+10,w:innerWidth,h:innerHeight}})()',
    );
    await pipe.call("turnEnded", session);
    await p.waitForTimeout(500);
    const b2 = await panel.boundingBox();
    await p.mouse.click(
      b2.x + (inputPos.x * b2.width) / inputPos.w,
      b2.y + (inputPos.y * b2.height) / inputPos.h,
    );
    await p.keyboard.insertText("手动中文");
    await p.waitForTimeout(300);
    assert(
      (await evalValue('document.querySelector("input").value')).includes(
        "手动中文",
      ),
    );
    console.log("PASS panel IME text input");
    const newTab = await pipe.call("createTab", session);
    const tid = typeof newTab === "number" ? newTab : newTab.id;
    await pipe.call("executeCdp", {
      ...session,
      target: { tabId: tid },
      method: "Page.navigate",
      commandParams: { url: fixtureUrl + "/next" },
      timeoutMs: 15000,
    });
    await p.waitForTimeout(1000);
    const result = await pipe.call("executeCdp", {
      ...session,
      target: { tabId: tid },
      method: "Runtime.evaluate",
      commandParams: { expression: "document.title", returnByValue: true },
      timeoutMs: 15000,
    });
    assert.equal(result.result.value, "Browser regression");
    console.log("PASS agent creates + navigates its own tab");
    await pipe.call("turnEnded", session);
    if (process.env.TEST_SCREENSHOT)
      await p.screenshot({ path: process.env.TEST_SCREENSHOT });
    if (process.env.TEST_THREAD_ID) {
      await p.reload();
      await p.waitForFunction(
        () => document.title.includes("Browser 自动操作验证"),
        {},
        { timeout: 30000 },
      );
      await p
        .locator("[contenteditable=true]")
        .first()
        .waitFor({ timeout: 60000 });
      // Opening the panel is a fresh user action after renderer reload.
      await p.evaluate(
        (url) =>
          window.postMessage(
            {
              type: "toggle-browser-panel",
              open: true,
              url,
              source: "manual",
              initiator: "side_panel_menu",
            },
            "*",
          ),
        fixtureUrl + "/next",
      );
      await p
        .waitForFunction(
          () =>
            Array.from(
              document.querySelectorAll(
                "[data-browser-sidebar-browser-tab-id][role=region] img",
              ),
            ).some((image) => image.src.startsWith("data:image/jpeg")),
          {},
          { timeout: 30000 },
        )
        .catch(async (error) => {
          console.error("REFRESH", await p.locator("body").innerText());
          throw error;
        });
      console.log("PASS browser panel reopens after Web refresh");
    } else
      console.log(
        "SKIP Web refresh for empty thread; use TEST_THREAD_ID with isolated persisted history",
      );
    assert.deepEqual(errors, []);
    console.log("PASS no renderer page errors");
  } finally {
    pipe?.close();
    await b.close();
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

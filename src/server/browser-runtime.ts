import { EventEmitter } from "node:events";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

type Params = Record<string, any>;

/** A private CDP connection. Never expose Chromium's debugging port to clients. */
class Chromium extends EventEmitter {
  child?: ChildProcess;
  socket?: WebSocket;
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private starting?: Promise<void>;

  constructor() {
    super();
    process.once("exit", () => this.child?.kill());
  }

  ready(): Promise<void> {
    return (this.starting ??= this.start().catch((error) => {
      this.starting = undefined;
      this.socket?.close();
      this.child?.kill();
      throw error;
    }));
  }

  private async start(): Promise<void> {
    let executable = process.env.CODEX_WEB_BROWSER_EXECUTABLE;
    if (!executable) {
      const candidates =
        process.platform === "darwin"
          ? [
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium",
            ]
          : [
              "chromium",
              "chromium-browser",
              "google-chrome",
              "google-chrome-stable",
            ];
      for (const candidate of candidates) {
        try {
          executable = candidate.startsWith("/")
            ? (await fs.access(candidate), candidate)
            : execFileSync("which", [candidate], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
              }).trim();
          if (executable) break;
        } catch {
          /* Try the next installed browser. */
        }
      }
    }
    if (!executable)
      throw new Error(
        "Install Chromium/Google Chrome on the Web host, or set CODEX_WEB_BROWSER_EXECUTABLE.",
      );
    const profile =
      process.env.CODEX_WEB_BROWSER_PROFILE ??
      path.join(
        process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
        "codex-web-browser",
      );
    await fs.mkdir(profile, { recursive: true });
    const args = [
      "--headless=new",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "about:blank",
    ];
    // Keep Chromium's sandbox on. Root deployments must explicitly opt out.
    if (process.env.CODEX_WEB_BROWSER_NO_SANDBOX === "1")
      args.push("--no-sandbox");
    const child = (this.child = spawn(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
    }));
    const endpoint = await new Promise<string>((resolve, reject) => {
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Chromium startup timed out: ${stderr.slice(-1500)}`));
      }, 15000);
      child.stderr!.on("data", (data) => {
        stderr = (stderr + String(data)).slice(-8000);
        const match =
          /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/.exec(
            stderr,
          );
        if (match) {
          clearTimeout(timer);
          resolve(match[1]!);
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`Chromium exited: ${stderr.slice(-1500)}`));
      });
    });
    const socket = (this.socket = new WebSocket(endpoint));
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.on("error", (error) => {
      console.error("[browser] Chromium connection failed", error.message);
      socket.close();
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(message.id);
        if (message.error)
          request.reject(new Error(`${message.error.message}`));
        else request.resolve(message.result ?? {});
      } else this.emit("event", message);
    });
    socket.on("close", () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Chromium disconnected"));
      }
      this.pending.clear();
      this.starting = undefined;
      this.emit("disconnected");
    });
    await this.command("Target.setDiscoverTargets", { discover: true });
  }

  command(
    method: string,
    params: Params = {},
    sessionId?: string,
  ): Promise<any> {
    if (this.socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("Chromium is not connected"));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  }

  async close(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN)
      await this.command("Browser.close").catch(() => {});
    this.socket?.close();
    this.child?.kill();
  }
}

export const chromium = new Chromium();
export const browserGuests = new Map<number, BrowserGuest>();
let nextGuestId = 1000000;

export class BrowserImage {
  constructor(
    private buffer: Buffer,
    private width: number,
    private height: number,
  ) {}
  isEmpty() {
    return this.buffer.length === 0;
  }
  getSize() {
    return { width: this.width, height: this.height };
  }
  toPNG() {
    return this.buffer;
  }
  toDataURL() {
    return `data:image/png;base64,${this.buffer.toString("base64")}`;
  }
}

/** Electron's guest contract backed by the same real target used by browser-use. */
export class BrowserGuest extends EventEmitter {
  id = nextGuestId++;
  viewInstanceId: number;
  token = randomUUID();
  mainFrame = { url: "about:blank", processId: 0, routingId: 0 };
  targetId = "";
  sessionId = "";
  session: any;
  owner: any;
  private destroyed = false;
  private loading = false;
  private title = "";
  private audioMuted = true;
  private history = { currentIndex: -1, entries: [] as Params[] };
  private attached = false;
  private childSessions = new Set<string>();
  private viewport = { width: 1280, height: 720 };
  private sockets = new Set<WebSocket>();
  private popupHandler?: (details: Params) => Params;
  private eventListener = (event: Params) => this.handleEvent(event);
  private disconnectListener = () => this.destroy();
  private init?: Promise<void>;
  debugger: EventEmitter & {
    attach: (version?: string) => void;
    detach: () => void;
    isAttached: () => boolean;
    sendCommand: (
      method: string,
      params?: Params,
      sessionId?: string,
    ) => Promise<any>;
  };
  navigationHistory = {
    getActiveIndex: () => this.history.currentIndex,
    getAllEntries: () => this.history.entries,
    canGoBack: () => this.canGoBack(),
    canGoForward: () => this.canGoForward(),
    goBack: () => this.goBack(),
    goForward: () => this.goForward(),
    restore: async ({
      entries,
      index,
    }: {
      entries: Params[];
      index?: number;
    }) => {
      // Persisted Desktop history cannot restore native Chromium entry ids.
      const url = entries[index ?? entries.length - 1]?.url;
      if (typeof url === "string") await this.loadURL(url);
    },
  };

  constructor(owner: any, instanceId: number, session: any) {
    super();
    this.owner = owner;
    this.viewInstanceId = instanceId;
    this.session = session;
    this.debugger = Object.assign(new EventEmitter(), {
      attach: () => {
        this.attached = true;
      },
      detach: () => {
        this.attached = false;
        this.debugger.emit("detach", {}, "target closed");
      },
      isAttached: () => this.attached,
      sendCommand: async (
        method: string,
        params: Params = {},
        sessionId?: string,
      ) => {
        await this.ready();
        if (sessionId && !this.childSessions.has(sessionId))
          throw new Error("CDP session belongs to another tab");
        if (method === "Emulation.setDeviceMetricsOverride") {
          this.viewport = {
            width: params.width || 1280,
            height: params.height || 720,
          };
          this.emit("viewport-changed", this.viewport);
        }
        if (method === "Emulation.clearDeviceMetricsOverride") {
          // Headless pages have no native window; retain the last panel viewport.
          return {};
        }
        const result = await chromium.command(
          method,
          params,
          sessionId || this.sessionId,
        );
        if (method === "Target.attachToTarget" && result.sessionId)
          this.childSessions.add(result.sessionId);
        return result;
      },
    });
    browserGuests.set(this.id, this);
  }

  ready(): Promise<void> {
    return (this.init ??= this.initialize());
  }
  private async initialize(): Promise<void> {
    await chromium.ready();
    if (this.destroyed) throw new Error("Browser tab was closed");
    chromium.on("event", this.eventListener);
    chromium.on("disconnected", this.disconnectListener);
    this.targetId = (
      await chromium.command("Target.createTarget", { url: "about:blank" })
    ).targetId;
    if (this.destroyed) {
      await chromium
        .command("Target.closeTarget", { targetId: this.targetId })
        .catch(() => {});
      throw new Error("Browser tab was closed");
    }
    this.sessionId = (
      await chromium.command("Target.attachToTarget", {
        targetId: this.targetId,
        flatten: true,
      })
    ).sessionId;
    if (this.destroyed) throw new Error("Browser tab was closed");
    await chromium.command("Page.enable", {}, this.sessionId);
    await chromium.command("Runtime.enable", {}, this.sessionId);
    await chromium.command("Target.activateTarget", {
      targetId: this.targetId,
    });
    await chromium.command(
      "Emulation.setDeviceMetricsOverride",
      { ...this.viewport, deviceScaleFactor: 1, mobile: false },
      this.sessionId,
    );
    await this.syncHistory();
  }

  private handleEvent({ method, params: p = {}, sessionId }: Params): void {
    if (method === "Target.targetDestroyed" && p.targetId === this.targetId) {
      this.destroy();
      return;
    }
    if (
      method === "Target.targetInfoChanged" &&
      p.targetInfo.targetId === this.targetId
    ) {
      this.title = p.targetInfo.title;
      this.emit("page-title-updated", {}, this.title);
      return;
    }
    if (
      method === "Target.targetCreated" &&
      p.targetInfo.openerId === this.targetId
    ) {
      const info = p.targetInfo;
      this.popupHandler?.({
        url: info.url,
        disposition: "new-window",
        referrer: { url: this.getURL() },
      });
      // The official handler opens a managed sidebar tab. Close the unmanaged popup.
      void chromium
        .command("Target.closeTarget", { targetId: info.targetId })
        .catch(() => {});
      return;
    }
    if (
      !this.sessionId ||
      (sessionId !== this.sessionId && !this.childSessions.has(sessionId))
    )
      return;
    if (method === "Target.attachedToTarget")
      this.childSessions.add(p.sessionId);
    if (this.attached)
      this.debugger.emit(
        "message",
        {},
        method,
        p,
        sessionId === this.sessionId ? "" : sessionId,
      );
    if (sessionId !== this.sessionId) return;
    if (method === "Page.screencastFrame") {
      for (const socket of this.sockets)
        if (
          socket.readyState === WebSocket.OPEN &&
          socket.bufferedAmount < 2_000_000
        )
          socket.send(
            JSON.stringify({
              type: "frame",
              data: p.data,
              width: this.viewport.width,
              height: this.viewport.height,
            }),
          );
      void chromium
        .command(
          "Page.screencastFrameAck",
          { sessionId: p.sessionId },
          this.sessionId,
        )
        .catch(() => {});
    }
    if (method === "Page.frameStartedLoading") {
      this.loading = true;
      this.emit("did-start-loading");
    }
    if (method === "Page.frameNavigated" && !p.frame.parentId) {
      this.mainFrame.url = p.frame.url;
      this.emit("did-navigate", {}, this.getURL());
      void this.syncHistory();
    }
    if (method === "Page.navigatedWithinDocument") {
      this.mainFrame.url = p.url;
      this.emit("did-navigate-in-page", {}, p.url, true);
      void this.syncHistory();
    }
    if (method === "Page.domContentEventFired") this.emit("dom-ready");
    if (method === "Page.loadEventFired") {
      this.loading = false;
      const completedUrl = this.getURL();
      // Electron's did-finish-load contract already includes committed history.
      // Official browser-use checks getActiveIndex() while resolving readiness.
      void this.syncHistory().then(() => {
        if (this.destroyed || this.getURL() !== completedUrl) return;
        this.emit("did-finish-load");
        this.emit("did-stop-loading");
        if (this.sockets.size)
          void this.refreshFrames().catch((error) =>
            this.emit("browser-error", error),
          );
      });
    }
    if (method === "Page.javascriptDialogOpening")
      void chromium
        .command(
          "Page.handleJavaScriptDialog",
          { accept: false },
          this.sessionId,
        )
        .catch(() => {});
  }
  private async syncHistory(): Promise<void> {
    try {
      this.history = await chromium.command(
        "Page.getNavigationHistory",
        {},
        this.sessionId,
      );
    } catch {
      /* Closed tab. */
    }
  }
  getURL() {
    return this.mainFrame.url;
  }
  getTitle() {
    return this.title;
  }
  isDestroyed() {
    return this.destroyed;
  }
  isLoading() {
    return this.loading;
  }
  isLoadingMainFrame() {
    return this.loading;
  }
  canGoBack() {
    return this.history.currentIndex > 0;
  }
  canGoForward() {
    return this.history.currentIndex < this.history.entries.length - 1;
  }
  isCurrentlyAudible() {
    return false;
  }
  isCapturingUserMedia() {
    return false;
  }
  isCapturingCamera() {
    return false;
  }
  isCapturingMicrophone() {
    return false;
  }
  isBeingCaptured() {
    return false;
  }
  isFocused() {
    return true;
  }
  getZoomFactor() {
    return 1;
  }
  setZoomFactor(factor: number) {
    void this.debugger
      .sendCommand("Emulation.setPageScaleFactor", { pageScaleFactor: factor })
      .catch((error) => this.emit("browser-error", error));
  }
  isAudioMuted() {
    return this.audioMuted;
  }
  setAudioMuted(muted: boolean) {
    this.audioMuted = muted;
    void this.executeJavaScript(
      `document.querySelectorAll("audio,video").forEach(el => el.muted = ${muted})`,
    ).catch(() => {});
  }
  setAgentActive(_active: boolean) {}
  setContentInsets(_insets: unknown) {}
  setBackgroundThrottling(_value: boolean) {}
  // Chromium runs without background throttling for the life of this host.
  setPageCapturePaintLeaseEnabled(_enabled: boolean) {}
  focus() {}
  setWindowOpenHandler(handler: (details: Params) => Params) {
    this.popupHandler = handler;
  }
  getLastWebPreferences() {
    return { webviewTag: false, sandbox: true };
  }
  getOwnerBrowserWindow() {
    return this.owner;
  }
  getProcessId() {
    return 0;
  }
  getOSProcessId() {
    return this.id;
  }
  async loadURL(url: string): Promise<void> {
    await this.ready();
    const parsed = new URL(url);
    if (!["http:", "https:", "about:", "data:"].includes(parsed.protocol))
      throw new Error("Unsupported browser URL scheme");
    this.loading = true;
    this.emit("did-start-navigation", {}, url, false, true);
    const result = await chromium.command(
      "Page.navigate",
      { url },
      this.sessionId,
    );
    if (result.errorText) {
      this.loading = false;
      this.emit("did-fail-load", {}, -2, result.errorText, url, true);
      throw new Error(result.errorText);
    }
  }
  async executeJavaScript(expression: string): Promise<any> {
    const result = await this.debugger.sendCommand("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async capturePage(): Promise<BrowserImage> {
    const result = await this.debugger.sendCommand("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    return new BrowserImage(
      Buffer.from(result.data, "base64"),
      this.viewport.width,
      this.viewport.height,
    );
  }
  goBack() {
    void this.navigateHistory(-1).catch((error) =>
      this.emit("browser-error", error),
    );
  }
  goForward() {
    void this.navigateHistory(1).catch((error) =>
      this.emit("browser-error", error),
    );
  }
  private async navigateHistory(delta: number) {
    await this.syncHistory();
    const entry = this.history.entries[this.history.currentIndex + delta];
    if (entry)
      await this.debugger.sendCommand("Page.navigateToHistoryEntry", {
        entryId: entry.id,
      });
  }
  reload() {
    void this.debugger
      .sendCommand("Page.reload")
      .catch((error) => this.emit("browser-error", error));
  }
  reloadIgnoringCache() {
    void this.debugger
      .sendCommand("Page.reload", { ignoreCache: true })
      .catch((error) => this.emit("browser-error", error));
  }
  stop() {
    void this.debugger.sendCommand("Page.stopLoading").catch(() => {});
  }
  // Annotation preload is Desktop-specific. Plain browsing/CDP stays functional.
  send(_channel: string, ..._args: unknown[]) {}
  sendInputEvent(event: Params) {
    void this.input(event).catch((error) => this.emit("browser-error", error));
  }
  async input(event: Params): Promise<void> {
    await this.ready();
    if (event.type === "text") {
      await this.debugger.sendCommand("Input.insertText", {
        text: String(event.text).slice(0, 100000),
      });
      return;
    }
    if (
      ["mouseDown", "mouseUp", "mouseMove", "mouseWheel"].includes(event.type)
    ) {
      await this.debugger.sendCommand("Input.dispatchMouseEvent", {
        type: (
          {
            mouseDown: "mousePressed",
            mouseUp: "mouseReleased",
            mouseMove: "mouseMoved",
            mouseWheel: "mouseWheel",
          } as Params
        )[event.type],
        x: Number(event.x),
        y: Number(event.y),
        button: event.button ?? "none",
        buttons: event.buttons ?? 0,
        clickCount: event.clickCount ?? 1,
        modifiers: event.modifiers ?? 0,
        ...(event.type === "mouseWheel"
          ? {
              deltaX: Number(event.deltaX) || 0,
              deltaY: Number(event.deltaY) || 0,
            }
          : {}),
      });
      return;
    }
    if (["keyDown", "keyUp"].includes(event.type)) {
      await this.debugger.sendCommand("Input.dispatchKeyEvent", {
        type: event.type === "keyUp" ? "keyUp" : "rawKeyDown",
        key: event.key ?? event.keyCode,
        code: event.code,
        windowsVirtualKeyCode: event.keyCodeNumber ?? 0,
        modifiers: typeof event.modifiers === "number" ? event.modifiers : 0,
      });
      return;
    }
    if (event.type === "resize") {
      const width = Math.max(100, Math.min(3840, Math.round(event.width)));
      const height = Math.max(100, Math.min(2160, Math.round(event.height)));
      if (Number.isFinite(width) && Number.isFinite(height))
        await this.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        });
    }
  }
  async connectStream(socket: WebSocket): Promise<void> {
    await this.ready();
    await chromium.command("Target.activateTarget", {
      targetId: this.targetId,
    });
    if (socket.readyState !== WebSocket.OPEN) return;
    this.sockets.add(socket);
    let inputs = Promise.resolve();
    socket.on("message", (raw) => {
      try {
        const event = JSON.parse(String(raw));
        inputs = inputs
          .then(() => this.input(event))
          .catch((error) => {
            if (socket.readyState === WebSocket.OPEN)
              socket.send(
                JSON.stringify({ type: "error", message: String(error) }),
              );
          });
      } catch {
        socket.close(1007);
      }
    });
    socket.on("close", () => {
      this.sockets.delete(socket);
      if (this.sockets.size === 0 && !this.destroyed)
        void chromium
          .command("Page.stopScreencast", {}, this.sessionId)
          .catch(() => {});
    });
    // Navigation can temporarily leave Page without an active renderer. The
    // persistent stream must survive that transition, including restored tabs.
    for (let attempt = 0; ; attempt++) {
      try {
        await chromium.command(
          "Page.startScreencast",
          { format: "jpeg", quality: 80, everyNthFrame: 1 },
          this.sessionId,
        );
        break;
      } catch (error) {
        if (
          attempt >= 30 ||
          this.destroyed ||
          socket.readyState !== WebSocket.OPEN
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    // A fresh screenshot covers static pages which do not emit another paint.
    const shot = await chromium
      .command(
        "Page.captureScreenshot",
        { format: "jpeg", quality: 80, captureBeyondViewport: false },
        this.sessionId,
      )
      .catch(() => null);
    if (!shot) return; // Navigation will supply the next screencast frame.

    if (socket.readyState === WebSocket.OPEN)
      socket.send(
        JSON.stringify({ type: "frame", data: shot.data, ...this.viewport }),
      );
  }
  private async refreshFrames(): Promise<void> {
    if (this.destroyed || !this.sockets.size) return;
    await chromium.command(
      "Page.startScreencast",
      { format: "jpeg", quality: 80, everyNthFrame: 1 },
      this.sessionId,
    );
    const shot = await chromium.command(
      "Page.captureScreenshot",
      { format: "jpeg", quality: 80, captureBeyondViewport: false },
      this.sessionId,
    );
    for (const socket of this.sockets) {
      if (
        socket.readyState === WebSocket.OPEN &&
        socket.bufferedAmount < 2_000_000
      )
        socket.send(
          JSON.stringify({ type: "frame", data: shot.data, ...this.viewport }),
        );
    }
  }
  close() {
    this.destroy();
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    chromium.removeListener("event", this.eventListener);
    chromium.removeListener("disconnected", this.disconnectListener);
    browserGuests.delete(this.id);
    for (const socket of this.sockets) socket.close();
    this.sockets.clear();
    if (this.targetId)
      void chromium
        .command("Target.closeTarget", { targetId: this.targetId })
        .catch(() => {});
    if (this.attached) this.debugger.detach();
    this.emit("destroyed");
  }
}

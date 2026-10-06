type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
let nextInstance = 0;

/** Paint the host's Chromium target; pointer and keyboard input use that same target. */
export function installBrowserView(invoke: Invoke): void {
  (window as any).__CODEX_WEB_CREATE_WEBVIEW__ = () => {
    const element = document.createElement("div");
    const image = document.createElement("img");
    const input = document.createElement("textarea");
    const status = document.createElement("div");
    element.tabIndex = 0;
    element.setAttribute("role", "region");
    element.setAttribute("aria-label", "Browser page");
    Object.assign(element.style, {
      display: "block",
      position: "relative",
      overflow: "hidden",
      outline: "none",
    });
    Object.assign(image.style, {
      width: "100%",
      height: "100%",
      objectFit: "fill",
      userSelect: "none",
      pointerEvents: "none",
    });
    image.draggable = false;
    image.alt = "";
    input.setAttribute("aria-label", "Browser keyboard input");
    Object.assign(input.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      opacity: "0",
      left: "0",
      top: "0",
      pointerEvents: "none",
    });
    Object.assign(status.style, {
      position: "absolute",
      inset: "0",
      display: "grid",
      placeItems: "center",
      padding: "24px",
      background: "var(--color-surface, #fff)",
      fontSize: "13px",
    });
    status.textContent = "正在连接浏览器…";
    element.append(image, input, status);
    const instanceId = ++nextInstance;
    let disposed = false;
    let attaching = false;
    let failed = false;
    let guestId: number | undefined;
    let socket: WebSocket | undefined;
    let width = 1280,
      height = 720;
    let currentFrame = "";
    let framePending = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const send = (message: object) => {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(message));
    };
    const showError = (message: string) => {
      status.textContent = message;
      status.style.display = "grid";
    };
    const resize = new ResizeObserver(() => {
      if (element.clientWidth > 0 && element.clientHeight > 0)
        send({
          type: "resize",
          width: element.clientWidth,
          height: element.clientHeight,
        });
    });
    resize.observe(element);
    const destroy = () => {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      resize.disconnect();
      clearTimeout(retryTimer);
      socket?.close();
      if (guestId != null)
        void invoke("codex_web:browser", "destroy", { id: guestId }).catch(
          () => {},
        );
    };
    Object.assign(element, {
      destroy,
      getWebContentsId: () => guestId,
      getURL: () => element.getAttribute("src"),
      getZoomFactor: () => 1,
    });
    Object.defineProperty(element, "currentCSSZoom", { get: () => 1 });
    const attach = async (attempt = 0) => {
      if (
        disposed ||
        failed ||
        retryTimer != null ||
        attaching ||
        guestId != null ||
        !element.isConnected ||
        !element.getAttribute("partition")
      )
        return;
      attaching = true;
      try {
        const attributes = Object.fromEntries(
          Array.from(element.attributes, (attribute) => [
            attribute.name,
            attribute.value,
          ]),
        );
        const result = (await invoke("codex_web:browser", "attach", {
          attributes,
          instanceId,
        })) as { id: number; token: string };
        guestId = result.id;
        if (disposed) {
          void invoke("codex_web:browser", "destroy", { id: guestId }).catch(
            () => {},
          );
          return;
        }
        const url = new URL(
          `/__backend/browser/${result.token}`,
          location.href,
        );
        url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(url);
        socket.onopen = () => {
          send({
            type: "resize",
            width: element.clientWidth || 1280,
            height: element.clientHeight || 720,
          });
        };
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.type === "error") {
            showError(message.message);
            return;
          }
          if (message.type !== "frame") return;
          width = message.width;
          height = message.height;
          currentFrame = `data:image/jpeg;base64,${message.data}`;
          if (!framePending) {
            framePending = true;
            requestAnimationFrame(() => {
              framePending = false;
              if (!disposed) {
                image.src = currentFrame;
                status.style.display = "none";
              }
            });
          }
        };
        socket.onerror = () => showError("浏览器连接失败，请重新打开标签页。");
        socket.onclose = () => {
          if (!disposed) showError("浏览器连接已断开，请重新打开标签页。");
        };
        element.dispatchEvent(new Event("dom-ready"));
      } catch (error) {
        if (disposed) return;
        if (String(error).includes("not registered yet") && attempt < 30)
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            void attach(attempt + 1);
          }, 150);
        else {
          failed = true;
          console.error("[browser] attachment failed", error);
          showError(
            "浏览器启动失败，请检查宿主浏览器和运行时配置后重新打开标签页。",
          );
        }
      } finally {
        attaching = false;
      }
    };
    // Official host parks/backgrounds the node. Only explicit destroy closes a tab.
    const observer = new MutationObserver(() => {
      if (!disposed && element.isConnected) void attach();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    observer.observe(element, {
      attributes: true,
      attributeFilter: [
        "partition",
        "src",
        "data-browser-sidebar-conversation-id",
        "data-browser-sidebar-browser-tab-id",
      ],
    });
    const modifiers = (event: MouseEvent | KeyboardEvent) =>
      (event.altKey ? 1 : 0) |
      (event.ctrlKey ? 2 : 0) |
      (event.metaKey ? 4 : 0) |
      (event.shiftKey ? 8 : 0);
    const position = (clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) * width) / rect.width,
        y: ((clientY - rect.top) * height) / rect.height,
      };
    };
    const button = (value: number) =>
      ["left", "middle", "right"][value] ?? "none";
    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      input.focus({ preventScroll: true });
      element.setPointerCapture(event.pointerId);
      send({
        type: "mouseDown",
        ...position(event.clientX, event.clientY),
        button: button(event.button),
        buttons: event.buttons,
        clickCount: event.detail || 1,
        modifiers: modifiers(event),
      });
    });
    element.addEventListener("pointerup", (event) => {
      send({
        type: "mouseUp",
        ...position(event.clientX, event.clientY),
        button: button(event.button),
        buttons: event.buttons,
        clickCount: event.detail || 1,
        modifiers: modifiers(event),
      });
      if (element.hasPointerCapture(event.pointerId))
        element.releasePointerCapture(event.pointerId);
    });
    element.addEventListener("pointermove", (event) => {
      send({
        type: "mouseMove",
        ...position(event.clientX, event.clientY),
        buttons: event.buttons,
        modifiers: modifiers(event),
      });
    });
    element.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        send({
          type: "mouseWheel",
          ...position(event.clientX, event.clientY),
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          modifiers: modifiers(event),
        });
      },
      { passive: false },
    );
    element.addEventListener("contextmenu", (event) => event.preventDefault());
    for (const type of ["keydown", "keyup"] as const)
      element.addEventListener(type, (event) => {
        if (event.isComposing) return;
        send({
          type: type === "keydown" ? "keyDown" : "keyUp",
          key: event.key,
          code: event.code,
          keyCodeNumber: event.keyCode,
          modifiers: modifiers(event),
        });
        if (
          [
            "Tab",
            "Enter",
            "Escape",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Backspace",
            "Delete",
            "Home",
            "End",
            "PageUp",
            "PageDown",
          ].includes(event.key)
        )
          event.preventDefault();
        event.stopPropagation();
      });
    input.addEventListener("input", (event) => {
      if ((event as InputEvent).isComposing) return;
      if (input.value) send({ type: "text", text: input.value });
      input.value = "";
    });
    input.addEventListener("compositionend", () => {
      if (input.value) send({ type: "text", text: input.value });
      input.value = "";
    });
    element.addEventListener("paste", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = event.clipboardData?.getData("text/plain");
      if (text) send({ type: "text", text });
    });
    return element;
  };
}

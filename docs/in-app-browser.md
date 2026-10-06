# 内置浏览器 / In-app browser

Web 面板现在显示宿主 Chrome/Chromium 的真实页面。手动点击、键盘/中文输入和官方 browser-use 的 CDP 自动操作连接同一个 target；不是 iframe，因此 `X-Frame-Options: DENY` 页面也可以正常显示。网页网络请求和登录状态属于服务端浏览器，客户端仅接收画面并发送输入。

## 裸机准备

1. 在 Web 服务宿主安装可运行、具有可用沙箱的 Google Chrome 或 Chromium。Mac 自动查找 `/Applications/Google Chrome.app`、`/Applications/Chromium.app`；Linux 从 PATH 查找 chromium/google-chrome。
2. 提取 Desktop 时，`scripts/prepare_asar` 同时调用 `scripts/prepare_browser_runtime.mjs`，保留官方 `cua_node` 与 `plugins`。自动操作必须使用与**宿主操作系统和架构**一致的资源：Mac 前端部署到 Linux 时，另从官方 Linux Desktop 包提取运行时，不能使用 Mac 可执行文件。
3. Linux 官方 deb 的资源位于 `usr/lib/chatgpt/resources`。解包后执行：

   ```sh
   node scripts/prepare_browser_runtime.mjs /path/to/usr/lib/chatgpt/resources
   ```

   默认输出 `scratch/asar/host-resources/linux-x64` 等目录。不要把用户设置或登录凭据混入资源包。
4. 保持 CLI 与 Desktop 的 browser-use 契约兼容。本次验证 CLI 为 `0.159.2`，不是永久锁版。启动日志应有 `browser_use_runtime_paths_selected` 和 `server=node_repl status=ready`；CLI `mcpServerStatus/list` 应提供 node_repl 工具。

| 环境变量 | 用途 |
| --- | --- |
| `CODEX_WEB_BROWSER_EXECUTABLE` | 指定宿主 Chromium 可执行文件的完整路径。 |
| `CODEX_WEB_BROWSER_PROFILE` | 专用 profile 目录；默认 `${CODEX_HOME:-~/.codex}/codex-web-browser`，不要指向日常 Chrome profile。 |
| `CODEX_WEB_DESKTOP_RESOURCES` | 指定包含 `cua_node/manifest.json` 与 `plugins` 的**平台资源根目录**。默认选择 asar 下 `host-resources/<platform>-<arch>`；manifest 必须与宿主匹配。 |
| `CODEX_WEB_RUNTIME_SOURCE` | 提取阶段的官方资源源目录，默认解包的 Mac Desktop Resources。 |
| `CODEX_WEB_BROWSER_NO_SANDBOX=1` | 显式关闭 Chromium 沙箱。默认不开启；不能以此自动绕过线上系统限制。 |

Ubuntu 可能因 AppArmor 对用户命名空间的限制而报 `No usable sandbox`。应安装具有可用 sandbox 配置的浏览器并由服务用户验证，或由管理员按该浏览器的安装方式配置系统策略。本次 Ubuntu **隔离**功能测试使用显式关闭沙箱的临时 headless shell；不代表线上默认配置已经可运行。没有更改线上系统策略。

Docker 仍只推荐尝鲜：现有镜像没有自动安装 Chromium，也没有把 Mac runtime 转为 Linux runtime。若要在容器中使用，必须额外准备匹配的官方运行时、浏览器依赖、profile 挂载和可用沙箱。充分发挥功能仍推荐裸机 Codex CLI + Codex Web。


### 这台 Ubuntu 的线上配置（2026-10-06）

已部署的浏览器为官方 Playwright CDN 发布的 Chromium headless shell `153.0.8010.12`（build 1243），位于 root 管理的 `/opt/codex-web/chromium_headless_shell-1243`。systemd drop-in `browser-runtime.conf` 设置 `CODEX_WEB_BROWSER_EXECUTABLE`；沙箱保持开启。

Ubuntu 使用 `/etc/apparmor.d/codex-web-chromium`，仅对上述**精确二进制路径**允许 user namespaces；未关闭全局 AppArmor 限制。做法参照 [Chromium 官方说明](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md)。更换浏览器路径时必须同步核对该配置并重新验证沙箱。完整 Chrome 154 在本机首次 HTTP 导航出现阻塞，暂不作为服务运行时；根因未完全确定。

发布前已经验证此配置下的真实页面显示、官方 CDP 操作、中文输入、截图及新建标签页；生产页面与模型查询另行核对。安装和回滚记录见 [线上部署记录](upgrades/2026-10-06-browser-production.md)。

## 提取和分发注意事项

`prepare_browser_runtime.mjs` 按平台覆盖该 target 的完整 runtime/plugins。其他平台目录不会自动升级：跨平台发布时必须逐个平台核对 manifest 的 runtime 版本与官方包来源，不能把旧 Linux runtime 无条件沿用。验证前端与 runtime 不同 Desktop build 时需记录该组合。

普通目录部署需保留完整 `host-resources`。npm pack 会忽略名为 `node_modules` 的目录，包括官方运行时内部依赖；npm/Nix 打包结果应另行分发完整 runtime 目录并通过 `CODEX_WEB_DESKTOP_RESOURCES` 指向它，不能仅凭打包成功认定自动操作依赖已齐全。本轮未验收 npm/Nix/Docker 内置浏览器发布包。

## 验证

只针对隔离的 CODEX_HOME、browser profile 和服务端口运行：

```sh
TEST_ISOLATED=1 \
TEST_URL=http://127.0.0.1:8221 \
TEST_HOST_LOG=/tmp/isolated-host.log \
npm run test:browser-host
```

测试通过真实 Web UI 和官方 IAB socket 验证 DENY 页面显示、CLI 工具暴露、CDP 点击、中文输入、PNG 截图、手动点击/输入、自动新建标签页和刷新后重新打开面板。默认测试创建空闲测试会话；Web 刷新项需通过 `TEST_THREAD_ID` 指定隔离环境中已持久化的测试会话（空会话没有 rollout，该项跳过）。测试不发模型生成请求；这验证实际工具通道，不能替代模型自主选择工具的完整生成验收。`PLAYWRIGHT_MODULE`、`CODEX_WEB_BROWSER_EXECUTABLE` 可以指定测试客户端依赖和浏览器。

## 当前边界

支持页面显示、导航以及真实 CDP 自动操作。画面流没有音频；网页注释 preload、下载交付、文件选择器、原生窗口转移、系统剪贴板同步尚未接入。宿主浏览器使用专用共享 profile，不作为不同用户之间的隔离机制。Web 页面刷新后需重新打开浏览器面板；关闭整个 Web 服务会关闭 Chromium；关闭客户端标签页会清理对应 browser guest。

## English

The Web panel displays a real host-side Chrome/Chromium page. Manual input and official browser-use CDP automation operate on the same target, including pages that forbid iframe embedding. Network access, cookies, and browser state live on the host.

Install a browser with a working sandbox and preserve the official `cua_node` and `plugins` resources for the host OS/architecture. A Mac frontend deployed to Linux needs a separately extracted official Linux runtime. The CLI must expose the official node_repl tools; the tested CLI is 0.159.2, not a permanent limit. Environment variables above select the executable, dedicated profile, and platform resources. Sandbox stays enabled unless explicitly disabled.

Ubuntu isolation tests required an explicit sandbox opt-out because of AppArmor restrictions. Production policy and service were untouched. Docker remains for experimentation; the existing image does not automatically provide Chromium or a Linux browser runtime. Bare-metal Codex CLI + Codex Web remains the recommended deployment.

Directory deployment must preserve complete runtime dependencies. npm pack omits nested node_modules; distribute official resources separately and set CODEX_WEB_DESKTOP_RESOURCES for npm/Nix packages. Those packaging paths were not validated for browser support in this change.

Integration tests exercise the actual browser-use channel and reopening the panel after a Web refresh, without a model generation request. Audio streaming, annotation preload, download delivery, file chooser integration, native window transfer, and system clipboard synchronization are not implemented. The dedicated shared profile is not a multi-user security boundary.

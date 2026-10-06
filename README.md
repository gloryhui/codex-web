# Codex Web · glory

把 Codex Desktop 的界面带到浏览器，在自己的服务器上使用 Codex。

Use the Codex Desktop interface in your browser, with Codex running on your own server.

[中文](#中文) · [English](#english) · [自定义修复索引 / Customizations](CUSTOMIZATIONS.md) · [升级说明 / Upgrading](UPGRADING.md)

## 中文

### 这个版本是什么

这是由 [gloryhui](https://github.com/gloryhui/codex-web/tree/glory) 维护的 Codex Web 自托管版本，基于 [0xcaff/codex-web](https://github.com/0xcaff/codex-web) 继续开发。它提取官方 Codex Desktop 的前端资源，通过浏览器与服务端的 Electron 兼容层连接 Codex CLI，让你从浏览器访问部署机器上的项目、文件和工具。

浏览器是操作入口，任务在服务端执行。客户端无需安装 Codex Desktop，也无需复制项目到每台设备；可以从电脑或手机访问同一台 Web 宿主。这是社区维护的项目，并非 OpenAI 官方 Web 产品。

我们重点维护远程使用、中文界面、移动端交互和升级后的修复回归。

### 特点与优势

| 特点 | 这个版本提供的体验 |
| --- | --- |
| 自托管与远程工作 | Web 宿主和 CLI 运行在你自己的机器上，使用该机器已有的工作区、Git、配置和工具。已在 macOS 与 Ubuntu 环境验证。 |
| 沿用官方界面 | 提取 Codex Desktop 前端，跟进官方界面和模型功能变化；需要新 CLI 支持时同步评估、升级和验证。 |
| 中文默认开启 | Web 宿主默认中文，补齐国际化开关和 locale 适配；保留用户显式语言设置。 |
| 服务端目录选择 | 在浏览器中选择远程宿主的目录，支持编辑路径、Enter 浏览、返回上级及确认添加项目；修复弹窗焦点和滚动冲突。 |
| 手机与 H5 适配 | 调整窄屏视口、底部输入框、触摸激活和侧栏滚动，改善浏览器窗口变化及软键盘场景下的布局。 |
| 多标签与断线恢复 | 为浏览器标签提供独立 IPC 和消息端口，修复标签间相互影响的问题；连接断开后自动重连并重新初始化页面。 |
| 浏览器剪贴板 | 代码片段复制到当前客户端的剪贴板；Async Clipboard API 不可用时提供选择复制的降级处理。 |
| 图片与文件附件 | 支持浏览器文件选择、上传及图片/文件粘贴；修复二进制传输错误导致侧栏会话消失、发送不可用的问题。 |
| 会话导航与操作 | 保留侧栏操作菜单，支持会话深链、浏览器历史同步与会话标题更新，分享入口可以将内容填入草稿。 |
| Web 入口适配 | 提供图标、PWA manifest 和分享接收路由；可用体验取决于浏览器支持，不提供离线执行能力。 |
| 内置浏览器 | 宿主 Chromium 页面显示、手动操作和官方 browser-use 自动点击、输入、截图、新建标签页；需匹配的平台运行时与浏览器依赖，见 [运行说明](docs/in-app-browser.md) 和 [验证记录](docs/upgrades/2026-10-06-in-app-browser.md)。 |
| 升级修复可追踪 | 每项 Web 适配都有行为说明、代码索引和回归要求。确认官方已原生实现并验证通过后，再移除相应补丁。 |

### 当前验证基线

截至 **2026-10-06**，最近一次提取和验证的组合为：

| 项目 | 已验证版本 / 状态 |
| --- | --- |
| Desktop 前端资源 | `26.930.51102` |
| Codex CLI | `0.159.2` |
| Node.js | `22.23.1` |
| 宿主 | macOS 本地环境、Ubuntu 服务端 |
| 模型列表 | 已确认包含 `gpt-6.1-sol`；实际可用模型以账号权限和 CLI 返回为准 |

这些版本记录可复现的验证结果，不是长期版本上限。跟进官方更新时，会同时检查前端与 CLI 的兼容性。图片/文件粘贴、多标签、断线恢复、目录选择、复制降级和窄屏布局已有浏览器自动化验证；具体记录见 [本次升级与回归记录](docs/upgrades/2026-10-06-desktop-26.930.51102.md)。真机软键盘、不同浏览器的触控体验仍需实际使用确认。

### 从源码运行

**推荐部署方式：在宿主机直接运行 Codex CLI + Codex Web。** 这样可以使用宿主机的文件、开发工具、SSH 配置和运行环境，更充分地发挥 Codex 的能力，适合日常开发与长期使用。

宿主需要 Node.js 22、已安装且完成认证的 Codex CLI，以及 `git`、`curl`、`unzip`、`patch`、Python 3 和原生模块编译工具。构建会下载 Desktop 资源，需能访问相应下载地址。

```bash
git clone --branch glory https://github.com/gloryhui/codex-web.git
cd codex-web

npm ci --ignore-scripts
npm rebuild better-sqlite3
npm run prepare

# 在运行 Web 服务的同一用户下完成 CLI 登录
codex login --device-auth

CODEX_CLI_PATH="$(command -v codex)" \
  node src/server/main.js --host 127.0.0.1 --port 8214
```

打开 [http://127.0.0.1:8214](http://127.0.0.1:8214)。需要指定其他 CLI 时，将 `CODEX_CLI_PATH` 设置为对应可执行文件的绝对路径。

服务端入口默认只监听本机；仓库的 `npm run server` 脚本会监听 `0.0.0.0`。远程访问时请明确选择监听地址，并通过 SSH 隧道、私有网络或带认证的反向代理访问。反向代理需要支持 `/__backend/ipc` 的 WebSocket 连接。

### Docker / Compose

**Docker 仅建议用于尝鲜和快速体验。** 容器可访问的文件、工具、凭据和网络环境受挂载及容器配置限制，宿主系统集成也需要额外接入。想充分使用 Codex 的本机工具链和工作区，推荐采用上面的宿主机部署方式。

容器使用 `/workspace` 作为工作目录，将 Codex 配置和登录状态持久化到 `/home/codex/.codex`。先准备可写的配置目录，并用挂载该目录的 CLI 完成登录或配置认证。

```bash
mkdir -p "$HOME/.codex"

CODEX_WORKSPACE=/absolute/path/to/projects \
CODEX_CONFIG_DIR="$HOME/.codex" \
  docker compose up --build -d
```

将项目路径替换为实际目录。默认 Compose 会发布 `8214` 端口；镜像以 UID/GID `1000` 运行，挂载目录需具备相应权限。构建使用仓库中当前验证的 CLI 版本，升级时同步更新构建配置。

### 使用边界与维护

Web 界面的访问者可以通过服务端 Codex 操作该用户有权访问的文件和命令。当前宿主没有内置多用户认证和权限隔离，应将访问控制放在私有网络、隧道或认证代理上，并妥善保管 `.codex` 中的凭据。

默认模式下，重启 Web 服务可能中断正在执行的任务。仓库提供独立 app-server 的 [代理脚本](scripts/codex_remote_proxy)，用于需要分离进程生命周期的部署，但需单独配置和验证。Desktop 的原生系统能力并非全部已接入 Web；终端、语音和远程控制不能仅凭界面出现就视为完整可用。内置浏览器已接入页面和 CDP 操作，音频、注释及下载等仍有 [功能边界](docs/in-app-browser.md)。

本仓库只保留两个分支：`glory` 用于开发、修复和发布，`main` 用于与源项目比对。每次提取新资源都按自定义索引核对既有修复；线上切换前检查运行任务并保留回滚目录。

| 文档 | 用途 |
| --- | --- |
| [CUSTOMIZATIONS.md](CUSTOMIZATIONS.md) | Web 功能、bugfix、代码位置与回归清单 |
| [UPGRADING.md](UPGRADING.md) | Desktop 资源提取和补丁迁移流程 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 提取资源、Electron 兼容层与 IPC 架构 |
| [Ubuntu 运维说明](docs/ubuntu-codex-web-operations.md) | 服务检查、CLI 登录与常见故障排查 |
| [AGENTS.md](AGENTS.md) | 分支、版本跟进和升级协作约定 |

问题反馈请提交到 [本仓库 Issues](https://github.com/gloryhui/codex-web/issues)，附上版本、浏览器、复现步骤和脱敏后的错误信息。

### 致谢与许可

感谢 **[0xcaff](https://github.com/0xcaff)** 和 [codex-web 上游项目](https://github.com/0xcaff/codex-web) 的贡献者，为将 Codex Desktop 接入浏览器建立了基础。我们的 Web 适配和维护工作在此基础上继续进行。也感谢 OpenAI 提供 Codex Desktop、Codex CLI 及其持续更新。

仓库适配代码沿用项目声明的 **MIT** 许可。提取的 OpenAI 应用资源及第三方依赖各自适用其原有许可与使用条款。

---

## English

### About this version

This is a self-hosted Codex Web fork maintained by [gloryhui](https://github.com/gloryhui/codex-web/tree/glory), built on [0xcaff/codex-web](https://github.com/0xcaff/codex-web). It extracts the official Codex Desktop frontend and connects it to Codex CLI through browser and server Electron compatibility layers, giving your browser access to projects, files, and tools on the host machine.

The browser is the control interface; tasks execute on the server. Client devices need neither Codex Desktop nor their own copy of each project. You can access the same host from a computer or phone. This is a community project, not an official OpenAI Web product.

This fork focuses on remote workflows, Chinese localization, mobile interaction, and preserving fixes through upstream updates.

### Features and advantages

| Feature | What this fork provides |
| --- | --- |
| Self-hosted remote work | The Web host and CLI run on your own machine, using its workspaces, Git, configuration, and tools. Validated on macOS and Ubuntu. |
| Official frontend reuse | Extracts the Codex Desktop UI and follows interface and model changes, updating and validating CLI compatibility when new behavior requires it. |
| Chinese by default | Enables localization and supplies a Chinese host locale while respecting explicit user language settings. |
| Server directory picker | Browse folders on the host from your browser, edit paths, press Enter to browse, navigate up, and add projects. Includes focus and scrolling fixes. |
| Mobile and H5 improvements | Adapts the viewport, bottom composer, touch activation, and sidebar scrolling for narrow screens and changing browser/keyboard layouts. |
| Multiple tabs and reconnection | Gives each tab its own IPC connection and message ports, fixes interference between tabs, and reconnects with page reinitialization after a disconnect. |
| Client clipboard | Copies code snippets to the browser client's clipboard, with a selection-based fallback when the Async Clipboard API is unavailable. |
| Image and file attachments | Supports browser file selection, uploads, and pasted images/files. Fixes binary transport errors that could clear the sidebar and disable sending. |
| Conversation navigation | Preserves sidebar actions, conversation deep links, browser history synchronization, and document titles. The share receiver can prefill a draft. |
| Web entry points | Includes icons, a PWA manifest, and a share receiver route. Availability depends on browser support; tasks do not run offline. |
| In-app browser | Host Chromium pages with manual interaction and official browser-use click, input, screenshots, and tab creation. Requires matching platform resources and a browser; see [setup and limits](docs/in-app-browser.md) and the [validation record](docs/upgrades/2026-10-06-in-app-browser.md). |
| Traceable upgrade fixes | Every adaptation has a behavior description, code index, and regression requirement. Patches are removed only after upstream behavior is confirmed and tested. |

### Validated baseline

As of **2026-10-06**, the most recently extracted and validated combination is:

| Component | Validated version / status |
| --- | --- |
| Desktop frontend assets | `26.930.51102` |
| Codex CLI | `0.159.2` |
| Node.js | `22.23.1` |
| Hosts | Local macOS and an Ubuntu server |
| Model list | Confirmed to include `gpt-6.1-sol`; actual availability depends on the account and CLI response |

These versions record reproducible validation results, not permanent version limits. Upstream upgrades include a review of frontend and CLI compatibility. Browser automation has covered pasted attachments, multiple tabs, reconnection, directory selection, clipboard fallback, and narrow-screen layouts. See the [upgrade and regression record](docs/upgrades/2026-10-06-desktop-26.930.51102.md). Real-device keyboards and touch behavior across browsers still require hands-on verification.

### Run from source

**Recommended deployment: run Codex CLI + Codex Web directly on the host machine.** This gives Codex access to the host's files, development tools, SSH configuration, and runtime environment, making it the preferred setup for daily development and long-term use.

The host needs Node.js 22, an installed and authenticated Codex CLI, plus `git`, `curl`, `unzip`, `patch`, Python 3, and native-module build tools. Preparation downloads Desktop resources and requires access to their download endpoints.

```bash
git clone --branch glory https://github.com/gloryhui/codex-web.git
cd codex-web

npm ci --ignore-scripts
npm rebuild better-sqlite3
npm run prepare

# Authenticate as the same user that will run the Web host
codex login --device-auth

CODEX_CLI_PATH="$(command -v codex)" \
  node src/server/main.js --host 127.0.0.1 --port 8214
```

Open [http://127.0.0.1:8214](http://127.0.0.1:8214). To use another CLI installation, set `CODEX_CLI_PATH` to its absolute executable path.

The server entry point binds to loopback by default; the repository's `npm run server` script binds to `0.0.0.0`. Choose the binding deliberately for remote access and use an SSH tunnel, private network, or authenticated reverse proxy. Reverse proxies must support WebSocket connections at `/__backend/ipc`.

### Docker / Compose

**Docker is recommended only for a quick trial.** Access to files, tools, credentials, and networking depends on mounts and container configuration, while host-system integrations require additional setup. To make fuller use of Codex with your existing toolchain and workspaces, use the direct host deployment described above.

The container uses `/workspace` as its working directory and persists Codex configuration and authentication under `/home/codex/.codex`. Prepare a writable configuration directory and authenticate or configure credentials with a CLI using that mounted directory.

```bash
mkdir -p "$HOME/.codex"

CODEX_WORKSPACE=/absolute/path/to/projects \
CODEX_CONFIG_DIR="$HOME/.codex" \
  docker compose up --build -d
```

Replace the project path with a real directory. Compose publishes port `8214` by default. The image runs as UID/GID `1000`, so mounted directories must have suitable permissions. Builds use the repository's current validated CLI version; upgrade the build configuration when compatibility requires it.

### Scope and maintenance

Anyone with access to the Web interface can use Codex to operate files and commands available to the server user. The host does not provide built-in multi-user authentication or permission isolation. Put access controls in a private network, tunnel, or authentication proxy, and protect credentials stored in `.codex`.

In the default deployment, restarting the Web host may interrupt running tasks. A [proxy script](scripts/codex_remote_proxy) is available for a separately running app-server, but that deployment needs its own configuration and validation. Not every native Desktop capability is connected to the browser; the presence of terminal, voice, or remote-control UI is not proof of complete support. In-app browsing and CDP control are connected; audio, annotations, and downloads still have [limitations](docs/in-app-browser.md).

This repository keeps two branches: `glory` for development, fixes, and releases; `main` for comparison with the source project. Every extraction checks existing adaptations against the customization index. Production switches require checking active tasks and retaining a rollback directory.

| Document | Purpose |
| --- | --- |
| [CUSTOMIZATIONS.md](CUSTOMIZATIONS.md) | Web features, bugfixes, code locations, and regression checklist |
| [UPGRADING.md](UPGRADING.md) | Desktop extraction and patch migration |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Extracted assets, Electron compatibility layers, and IPC |
| [Ubuntu operations](docs/ubuntu-codex-web-operations.md) | Service checks, CLI login, and troubleshooting |
| [AGENTS.md](AGENTS.md) | Branch policy, version updates, and maintenance conventions |

Report problems in [this repository's Issues](https://github.com/gloryhui/codex-web/issues), including versions, browser details, reproduction steps, and redacted errors.

### Acknowledgments and licensing

Thank you to **[0xcaff](https://github.com/0xcaff)** and the contributors to [the upstream codex-web project](https://github.com/0xcaff/codex-web) for establishing the foundation for using Codex Desktop in a browser. This fork continues its Web adaptation and maintenance work on that foundation. Thanks also to OpenAI for Codex Desktop, Codex CLI, and their ongoing development.

The repository's adaptation code retains the project's declared **MIT** license. Extracted OpenAI application assets and third-party dependencies remain subject to their respective licenses and terms.

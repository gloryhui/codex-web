# 2026-10-06 内置浏览器适配记录

本轮修改在 `glory`；本记录初次验证时尚未提交、推送或部署线上。后续线上部署见 [生产部署记录](2026-10-06-browser-production.md)。实现和安装说明见 [内置浏览器](../in-app-browser.md)，重新提取的维护索引为 [WEB-19 / WEB-20](../../CUSTOMIZATIONS.md)。

## 根因与改动

原前端依赖 Electron webview/browserHost 及 guest debugger，Web shim 没有实际页面或 CDP target。新增宿主 Chromium guest，保留官方 will/did-attach-webview 与 browser-use IAB 逻辑；通过独立 WebSocket 发送画面和输入。页面手动操作与官方 CDP 工具连接同一 target，不采用 iframe 嵌入。

原提取流程也未保留官方 cua_node/plugins，CLI 日志报 `node-repl-missing`。新增按宿主平台提取及 manifest 校验，CLI 工具列表实际暴露 node_repl。补丁唯一匹配 managed browser webview 创建点，未修改 workspace settings 的其他 webview。

同时处理标签关闭/renderer 关闭的清理、初始化中途销毁时的迟到 target、页面导航期间的画面重试、宿主启动失败后的有限重试及明确提示、畸形 Origin 拒绝、非激活页面的重新捕获。Chromium 默认保留沙箱。

## 验证组合

| 项目 | 值 |
| --- | --- |
| Mac 前端 | Desktop 26.930.51102 / build 13100 |
| CLI | 0.159.2 |
| Mac 平台工具 | 本机官方 Desktop 的 darwin-arm64 cua_node/plugins |
| Linux 平台工具来源 | 官方 deb 26.930.61225 的 linux-x64 cua_node/plugins，前端仍为 Mac 提取版本 |
| 两个平台工具 manifest | 0.0.27/20260927214556-b77d38801cca；Node 24.21.0-cua.1 |
| Linux deb SHA256 | b90a80f9353bc12a5a5b8469502a8e5794a3c54a371c8880e094d500de695bb8 |

Linux 包来自 OpenAI 官方 APT [Packages](https://persistent.oaistatic.com/codex-app-prod/linux/deb/dists/stable/main/binary-amd64/Packages)，下载包校验与其中 SHA256 一致。这里只借用匹配平台的工具资源，没有替换 Mac 前端。

## 测试与实际边界

- `npm run build:server`、`npm run build:browser` 通过；动态补丁匹配唯一创建点，重复执行幂等；`git diff --check` 通过。
- Mac 与 Ubuntu **隔离**宿主通过真实 Web UI + 官方 IAB socket：DENY 页面画面、CLI node_repl 工具、自动点击、中文输入、PNG 截图、面板手动点击/中文输入、自动新建并导航标签页；无 renderer pageerror。
- Mac 使用已持久化的合成测试 history fixture 验证 Web 刷新后重新打开面板。面板打开状态不会自动保留。Ubuntu 空测试会话没有 rollout，不能用它验收历史恢复，该项明确跳过。
- 既有回归：多 Web 标签刷新/关闭、会话深链/标题、侧栏菜单、目录 Enter/错误路径/滚动/Tab/Escape、复制 API 与降级、分享草稿、390px 窄屏与 844/450/844px 视口。图片及文本文件粘贴后侧栏保留、发送可用、model/list 正常，无 pageerror。
- 未发模型生成请求；真实浏览器工具通道与 CLI 工具暴露测试不能冒充模型自主选择工具的完整生成验收。真实手机软键盘/惯性滚动仍需人工使用确认。
- Ubuntu 没有已安装的系统 Chrome/Chromium。临时 headless shell 遇到 AppArmor `No usable sandbox`；仅在独立测试宿主显式设置 `CODEX_WEB_BROWSER_NO_SANDBOX=1` 通过。线上系统策略和环境未改，不表示正式服务已经具备浏览器依赖。
- npm/Nix/Docker 发布包的完整 browser runtime 依赖未验收；npm pack 的嵌套 node_modules 排除规则需按安装说明独立分发处理。音频、注释 preload、下载/文件选择器及原生窗口转移未接入。

## 线上保护与清理

线上 codex-web.service 本轮保持原 PID 2320165、NRestarts=0、active。测试使用独立目录、端口、CODEX_HOME 和 profile，没有覆盖线上运行目录、重启服务或修改 CLI。结束时停止测试宿主并删除测试 auth.json 副本及专用 profile；保留源码与运行说明供审查。

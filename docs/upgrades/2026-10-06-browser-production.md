# 2026-10-06 内置浏览器线上部署

用户明确要求更新线上后部署当时的 `glory` 工作区。发布时 Git 基线为 `d8b244e211d786dd9de140dfc0fdeea4a4936733` 加本轮尚未提交的浏览器适配；部署操作没有新增分支，也没有执行 Git 提交或推送。

部署路径 `/home/glory/app/codex_web_dist`；旧目录 `/home/glory/app/codex_web_dist_backup_20261006_browser`。更新前已确认待覆盖的服务端源码、浏览器 shim、package 文件和构建配置与 Git 基线一致；保留了服务器其他文件与运行状态。独立暂存目录验证后，再检查 thread/loaded/list 和各线程状态，3 个已加载线程均 idle、active 列表为空才切换。

## 运行组合及配置

- Desktop 前端与 CLI 基线不变：26.930.51102 + CLI 0.159.2。
- Linux 官方 cua_node/plugins：0.0.27/20260927214556-b77d38801cca，按 linux-x64 保留完整依赖。
- Chromium headless shell 153.0.8010.12（Playwright build 1243），从 Playwright 官方下载流程准备，root 管理 `/opt/codex-web/chromium_headless_shell-1243`。
- systemd 新增 `/etc/systemd/system/codex-web.service.d/browser-runtime.conf`，仅指定 CODEX_WEB_BROWSER_EXECUTABLE。
- `/etc/apparmor.d/codex-web-chromium` 对精确且 root 管理的二进制路径允许 user namespaces；沙箱保持开启，全局 AppArmor 限制保持原状。
- 安装官方 Google Chrome 154.0.8037.97 及 xdg-utils，无系统包升级或移除。完整 Chrome 首次 HTTP 导航在此主机上有阻塞，数据页正常，根因尚未完全确定；服务采用已经验证的 headless shell。

## 验证与修正

Ubuntu 的独立 CODEX_HOME、profile 和端口 8223 上，以生产同一浏览器及沙箱配置通过：DENY 网页显示、CLI 暴露 node_repl、官方自动点击/中文输入/PNG 截图、同页面的手动点击/中文输入、自动新建并导航标签页；无 pageerror。空测试会话没有 rollout，Web 刷新恢复项明确跳过，不伪装为真实历史验收。没有发模型生成请求。

补充保证 Electron 生命周期顺序：did-finish-load/did-stop-loading 前更新导航历史，避免官方 initialNavigationSync 读到负索引；初始化时激活真实 target。其他 Web 适配保留。实际服务的 preserver 构建也通过，源码和预构建 preload 同步，避免重启时被旧 shim 重新覆盖。

停止旧服务后复制最新动态文件到待发布目录，保留原 node_modules、用户附件和服务器其他文件；通过目录重命名切换。未覆盖或清除 `/home/glory/.codex`，测试 auth 副本单独清理。

新服务 PID 2562661，NRestarts=0，active；HTTP 与 WebSocket 模型查询正常，含 gpt-6.1-sol。正式前端加载与刷新、浏览器 factory 和无 pageerror 另行检查。发布后如用户新开任务，不再以“有活跃任务”为失败条件触发回滚。

## 回滚

先检查活跃任务，不能在任务运行时执行。停止服务后，把当前目录另存，再把 `codex_web_dist_backup_20261006_browser` 恢复为 `codex_web_dist`；移除本次新加的 `browser-runtime.conf`，执行 systemctl daemon-reload 后启动服务并核对 HTTP/WS。原服务文本配置保存在 `/home/glory/app/codex_web_stage_browser_20261006/service-before.txt`。浏览器和精确 AppArmor 配置独立于旧 Web 目录，可保留。

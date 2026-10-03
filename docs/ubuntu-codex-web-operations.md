# Ubuntu 上的 Codex Web 重启与 Codex CLI 登录

本文用于这台 Ubuntu 上以 systemd 运行的 `codex-web.service`。当前部署记录中的服务名是 `codex-web.service`，监听端口是 `8214`，Codex 用户数据位于 `/home/glory/.codex`。如果服务器或服务用户有调整，先按下面命令检查实际配置再操作。

## 重启 Codex Web

通过 SSH 登录 Ubuntu 后执行：

```bash
# 先确认服务用户、工作目录与状态
sudo systemctl show codex-web.service -p User -p WorkingDirectory
sudo systemctl status codex-web.service --no-pager

# 重启服务
sudo systemctl restart codex-web.service

# 确认服务恢复
sudo systemctl status codex-web.service --no-pager
curl -I --max-time 10 http://127.0.0.1:8214/
```

收到 HTTP 响应（通常为 `200`）且 systemd 显示 `active (running)`，表示服务进程和本机 HTTP 页面已恢复。若页面仍打不开，查看重启后的日志：

```bash
sudo journalctl -u codex-web.service -n 100 --no-pager
sudo journalctl -u codex-web.service -f
```

按 `Ctrl+C` 退出实时日志。若要从本地电脑直接通过 SSH 重启，可执行：

```bash
ssh glory@<Ubuntu服务器地址> 'sudo systemctl restart codex-web.service && sudo systemctl status codex-web.service --no-pager'
```

重启会中断正在通过该 Web 服务运行的前端会话/请求。项目 README 提到的独立 `codex app-server` 方案可以让 Codex 进程与 Web 服务分开运行，但当前是否配置了该方案需要在服务器上确认。

## Codex CLI 登录

登录必须在 Ubuntu 主机上、以运行 Codex Web 的同一个 Linux 用户执行。当前记录中的用户为 `glory`，其 Codex 配置和登录信息保存在 `/home/glory/.codex`。不要删除或覆盖这个目录，否则可能丢失 CLI 登录状态和 Codex Web 数据。

```bash
# 切换到服务用户的登录 shell
sudo -iu glory

# 确认 CLI 可用并查看当前登录状态
command -v codex
codex --version
codex login status

# Ubuntu 服务器没有桌面浏览器时，启动设备码登录
codex login --device-auth
```

按终端提示在另一台设备的浏览器打开登录页并输入一次性设备码，使用要给 Codex Web 使用的 ChatGPT 账户完成授权。不要把设备码发给他人。完成后验证：

```bash
codex login status
```

登录状态应显示已认证。之后 Codex Web 会使用同一 Linux 用户的 Codex 登录状态；通常不需要为了登录而重启服务。若 `codex` 命令找不到，先检查该用户的 PATH 以及服务单元：

```bash
echo "$PATH"
sudo systemctl cat codex-web.service
```

这台服务器此前使用过 nvm Node.js。非交互式 SSH 下如需手动运行依赖 Node 的管理命令，可先加上已安装 Node 的路径：

```bash
export PATH="/home/glory/.nvm/versions/node/v22.23.1/bin:$PATH"
```

如果当前服务器的 Node 版本或安装位置不同，以服务器实际安装路径为准。不要为了登录随意升级服务使用的 Codex CLI；当前项目有独立的 CLI 版本固定配置。

## 常见故障检查

### 服务启动后立刻退出

```bash
sudo journalctl -u codex-web.service -n 200 --no-pager
sudo systemctl show codex-web.service -p ExecStart -p Environment -p WorkingDirectory -p User
```

检查日志中的命令路径、工作目录、环境变量和依赖错误。若报 `Could not locate the bindings file` 或 `better_sqlite3.node`，先确认服务的 Node 运行时与原生模块是否匹配，再考虑在部署目录重建依赖；不要直接删除用户数据目录。

### Web 页面正常，但 Codex 操作提示未登录

确认 `codex login status` 是以 systemd `User` 指定的用户运行的。再检查该用户的 HOME 是否指向预期位置：

```bash
sudo systemctl show codex-web.service -p User -p Environment
sudo -iu glory sh -lc 'echo "$HOME"; codex login status'
```

登录状态按用户保存；在其他 Linux 用户下登录不会自动授权给服务用户。

## 参考

- 本项目的运行和登录说明：[README.md](../README.md)
- OpenAI 官方：[Codex CLI 快速入门](https://learn.chatgpt.com/docs/codex/cli)
- OpenAI 官方：[Codex 访问令牌和 CLI 认证](https://developers.openai.com/zh-Hans/docs/enterprise/access-tokens)

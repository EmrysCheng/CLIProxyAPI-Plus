# CLIProxyAPI Plus

在上游 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 基础上扩展的版本：**内置 Web 管理面板 + 页面认证 + 首次引导设置 + 内核自更新**，所有管理功能均可通过浏览器完成，无需命令行。

> 上游全部能力不变：`/v1/*`、`/v1beta/*`、`/v0/management`、`/v8/management`、`/management.html` 外部面板与 OAuth 回调等端点保持原样；本版本只做增量扩展。

## 新增能力

### 内置管理面板（`/panel`）
- **首次引导**：首次访问自动进入设置向导，创建管理员密码（bcrypt 哈希，独立存储于 `panel-auth.json`，配置替换不会锁死面板）。
- **页面认证**：登录页 + 会话 Cookie（HttpOnly/SameSite，24h 滑动过期），登录限速防暴力破解，默认仅本机访问（远程需 `management.allow-remote: true`）。
- **功能页面**（13 个）：仪表盘（版本/凭证/请求统计）、凭证管理（含详情抽屉：运行状态、最近请求分布图、配额实时查询与重置、Codex SIWC 远程绑定、脱敏原始数据，支持多选批量操作）、账号登录（8 个 Provider OAuth + Vertex 导入）、API 密钥（客户端 + 各上游 + OpenAI 兼容）、模型配置、路由与重试、服务器设置（含 API 调试器）、日志（级别着色/搜索/跟随滚动）、用量统计（全局与按 Provider 请求时序图）、配置编辑（YAML 校验 + Diff 预览 + v8 配置树）、插件、系统更新、面板设置。
- **中英双语**（首次跟随浏览器语言）、深浅主题（首次跟随系统偏好）。

### 系统更新（内核自升级）
面板内一键升级到上游最新 Release：自动匹配平台资产 → SHA-256 校验 → rename 替换运行中的二进制（旧文件保留 `.old`）→ 计划任务自动重启（脱离本进程生命周期，失败重试）。Docker 环境检测并提示改用镜像。

### 与上游管理 API 的关系
面板会话代理同一批管理 handler（`/panel/api/{v0,v8}/management/*`），无需配置管理密钥即可使用全部管理能力；上游新增管理路由只需在共享路由表补一行即可被面板继承。

## 快速开始

```bash
bash build.sh          # 或 Windows: powershell -File build.ps1
./cliproxyapi-plus --config config.yaml
# 浏览器访问 http://127.0.0.1:<port>/panel/
```

要求：Go 1.26+、Node.js 18+（构建前端产物）。

详细说明见 [docs/web-panel.md](docs/web-panel.md)。

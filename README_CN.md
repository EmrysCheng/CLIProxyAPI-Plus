# CLIProxyAPI Plus

<p align="center">
  <strong>现代化聚合 AI 代理网关与内置 Web 控制面板</strong><br>
  单二进制分发 · 零外部依赖 · 首次向导设置 · 安全页面认证 · 全平台自升级
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> •
  <a href="#web-控制面板使用指南">面板使用</a> •
  <a href="#客户端对接实战">客户端对接</a> •
  <a href="#配置文件详细说明">配置详解</a> •
  <a href="#全平台打包与构建指南">全平台打包</a> •
  <a href="#常见问题-faq">常见问题</a> •
  <a href="README.md">English Document</a>
</p>

---

## 项目简介

**CLIProxyAPI Plus** 是在 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 基础上深度扩展的增强版本。它不仅完整保留了上游高性能的 OpenAI / Claude / Gemini / Codex / Grok / Kimi 多协议兼容代理能力，更内嵌了基于 **React 18 + TypeScript + Ant Design 5** 构建的完整现代 Web 管理控制台，并通过 Go 静态资源嵌入（`go:embed`）技术打包为**纯单一可执行文件**，彻底告别复杂的命令行维护。

### 核心特性亮点

- 🚀 **开箱即用，单二进制交付**：前端单页应用（SPA）无缝嵌入 Go 二进制，运行时无需 Node.js、Nginx 或外部数据库。
- 🛡️ **安全首访引导与认证体系**：
  - 首次启动自动引导向导（Setup Wizard），图形化设置管理员密码；
  - 密码采用安全等级最高的 **bcrypt**（cost=10）单向哈希，独立持久化于 `panel-auth.json`，配置文件 `config.yaml` 覆写与热重载绝不导致管理员锁死；
  - 基于 HttpOnly + SameSite=Lax 安全 Cookie 的会话控制，集成 IP 失败速率限制（5 次失败自动锁定 15 分钟）与操作审计日志（`panel-audit.log`）。
- 🖥️ **全功能可视化 Web 控制台（`/panel`）**：
  - **13 大运维页面**：仪表盘、凭证管理、OAuth 账号登录、API Key 管理、模型配置、路由重试策略、服务器调试器、日志实时监控、用量统计图表、YAML/v8 可视化配置树编辑、插件市场、系统自更新、系统设置。
  - **凭证详情抽屉**：可视化展现账号请求时序分布（20 桶柱状图）、实时配额查询（Codex 5h/7d 窗口）、Codex SIWC 远程绑定以及脱敏原始 JSON 导出。
  - **远程部署友好**：内置手动 OAuth 回调中继接口，无公网回定向地址亦可轻松完成账号授权。
  - **国际化与主题**：中英双语（自动侦测浏览器偏好），支持浅色/深色模式（自动侦测系统主题）。
- 🔄 **内核在线自升级与平滑热重启**：
  - 在线检测 GitHub 最新 Release，流式下载平台资产并校验 SHA-256；
  - 原地原子重命名（Atomic Rename）替换可执行文件；
  - 跨平台脱壳进程自重启（Windows Task Scheduler / Unix 守护进程），解决父进程退出杀子进程的难题。
- 🌐 **多协议聚合中继**：向终端客户端无缝提供标准 OpenAI（`/v1/chat/completions`）、Claude Messages（`/v1/messages`）、Gemini、Codex、Grok 等格式接口，支持多账号智能负载均衡与故障重试。

---

## 快速开始

### 1. 下载或运行预编译二进制

从 [Releases 页面](https://github.com/router-for-me/CLIProxyAPI/releases) 获取适配您操作系统与 CPU 架构的最新版本包：

```bash
# 解压后直接运行服务（自动加载当前目录下的 config.yaml）
# Linux / macOS:
./cliproxyapi-plus

# Windows (PowerShell / CMD):
.\cliproxyapi-plus.exe
```

服务启动后，默认监听并在控制台输出：
```text
[GIN-debug] Listening and serving HTTP on :8317
```

### 2. 首次访问与向导初始化

1. 使用现代浏览器打开管理控制台：
   👉 **`http://127.0.0.1:8317/panel`**
2. 系统自动识别未初始化状态并重定向至 **`/panel/#/setup`** 初始化向导页面：
   - **步骤 1：欢迎与安全说明** —— 了解面板认证与会话安全规则；
   - **步骤 2：设置管理员密码** —— 输入并确认面板主控密码（至少 8 位，包含复杂度检测）；
   - **步骤 3（可选）：配置上游管理密钥** —— 可一键生成或填写原有 `management.secret-key`；
   - **步骤 4：完成并登录** —— 点击进入系统，系统自动签发 24 小时有效期的安全会话并进入控制台首页。

### 3. 命令行参数

`cliproxyapi-plus` 支持以下常用运行参数：

| 参数标志 | 简写 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `--config` | `-c` | 指定配置文件路径（默认：`config.yaml`） | `./cliproxyapi-plus -c /etc/cpa/config.yaml` |
| `--port` | `-p` | 覆盖配置文件中的监听端口 | `./cliproxyapi-plus -p 9000` |
| `--help` | `-h` | 查看所有支持的命令行参数与子命令 | `./cliproxyapi-plus --help` |
| `--login` | | 命令行交互式登录 OAuth 账号（支持 codex, claude 等） | `./cliproxyapi-plus --codex-login` |
| `discover` | | 启动局域网 mDNS/DNS-SD 节点发现功能 | `./cliproxyapi-plus discover` |

---

## Web 控制面板使用指南

### 1. 认证安全与会话保护

- **独立密码存储**：面板密码使用 bcrypt 强哈希算法（cost=10）计算后存入 `panel-auth.json`，权限为安全受限的 `0600`。它完全脱离 `config.yaml`，即使用户在面板内重载、编辑或覆盖配置文件，密码决不会被冲掉。
- **安全 Cookie 与会话保活**：认证成功后签发名为 `cpa_panel_session` 的 HttpOnly、SameSite=Lax Cookie（启用 HTTPS 时自动加 Secure 标头）。会话有效期为 24 小时滑动过期，面板打开期间后台每 5 分钟自动静默续期。当会话不足 1 小时且未续期时，页面顶栏将出现轻量提醒。
- **防暴力破解保护**：同一 IP 地址连续 5 次输错密码将触发防护，该 IP 会被系统就地冻结锁定 15 分钟。
- **访问控制限制**：为确保生产安全，面板与管理接口默认**仅允许从本机（127.0.0.1 / ::1）访问**。如需在局域网或公网远程管理，必须在 `config.yaml` 中显式配置 `management.allow-remote: true`。

### 2. 核心功能模块操作

#### 📊 仪表盘（Dashboard）
展示运行状态总览：系统内核版本、最新 Release 状态对比、活跃凭证分布（按 Provider 饼图）、服务代理监听端口、请求总数与近 24 小时调用量趋势。

#### 🔑 凭证管理（Auth Files）
- 统一管理所有已导入的 OAuth 认证会话文件与服务账号。
- 支持按 Provider、状态（正常/异常/已禁用）过滤、批量启用/禁用及删除。
- **凭证详情抽屉**：点击任意凭证右侧的“详情”按钮，展开深度抽屉：
  - **请求时序分布图**：展示近 20 个时间窗口内的请求吞吐分布；
  - **实时配额查询**：针对 OpenAI Codex 账号一键获取 5 小时与 7 天窗口剩余配额及重置倒计时；
  - **Codex SIWC 绑定**：在远程无桌面环境下输入凭证回调验证码完成二次绑定；
  - **数据检视**：安全脱敏展示原始认证 JSON 属性。

#### 🌐 账号登录（OAuth Login）
- 支持 8 大上游主流平台：Claude、OpenAI Codex、Google Gemini / AI Studio / Antigravity、Kimi、Qwen、xAI、Vertex AI 等。
- 点击 Provider 卡片后自动向服务端请求授权 URL，可直接点击打开或复制到其他设备；
- **远程部署回调 Relay**：服务器部署在云端无法接收 `http://localhost/callback` 时，只需在面板中粘贴浏览器授权后地址栏中的最终跳转 URL，面板即可自动提取 `code` 与 `state` 完成登录。

#### 🔐 API 密钥管理（API Keys）
- **客户端接入密钥（`access.api-keys`）**：在此添加发放给开发人员或下游客户端（如 NextChat）的访问 Key，支持生成随机强密钥、绑定名称与访问限额。
- **上游直接密钥**：管理各官方平台的原生 API Key（Gemini API Key、Claude API Key 等）。
- **OpenAI 兼容提供商**：配置第三方中转站或自建模型服务的 Base URL、API Key 列表、权重分流及模型映射。配备实时 JSON 格式校验防错。

#### 🧭 路由与重试策略（Routing & Retries）
- **负载策略（Routing Strategy）**：支持顺序优先、轮询（Round-Robin）、加权随机、以及依据重置时间优先调度（`soonest-reset`）；
- **容灾重试**：配置请求失败时的自动重试次数（`request-retry`）、退避重试时间间隔（`max-retry-interval`）以及强制模型前缀策略。

#### 🛠️ 服务器设置与 API 调试器（Server & Debugger）
- 可视化开关调试模式（Debug）、日志落盘、代理转发（Proxy URL）等底层参数。
- **内置 API 调试器（API Call Tester）**：支持在浏览器中直接构造发送 HTTP 请求测试上游或代理端点（选择 Method、URL、测试凭证并填写 JSON Body），实时回显响应状态码、Header 和 Body 内容。

#### 📜 实时日志（Logs）与用量统计（Usage）
- 自动流式读取并解析运行日志，支持按照 `DEBUG` / `INFO` / `WARN` / `ERROR` 语法高亮染色；
- 具备日志搜索过滤、自动跟随滚动（Follow Scroll）以及一键清空日志能力；
- 用量统计页面支持查看 Token 消耗排行、各模型请求分布，并提供 CSV 数据一键导出。

#### ⚙️ 配置编辑（Config Editor）
- 具备双重配置维护模式：
  1. **v8 结构化配置树**：表单化操作每一个配置分支；
  2. **原始 YAML 编辑器**：具备客户端实时 YAML 语法语法校验，点击“保存”前弹出可视化 **Line-by-Line Diff 差异对比窗口**，确认变动无误后再写入磁盘。支持配置快速导出备份与上传恢复。

#### 🔄 系统更新（System Update）
- 界面直观展示当前系统版本、编译 Commit、运行平台与架构信息；
- 点击“检查更新”实时与 GitHub Releases 同步；
- 点击“立即更新”，内核自动完成流式下载、SHA-256 完整性比对、原子文件替换及守护进程拉起重启，全程无感。

---

## 客户端对接实战

CLIProxyAPI Plus 在本地或服务器提供标准 HTTP/HTTPS 端口（默认 `8317`），各类下游客户端可直接将其视作标准大模型接口。

### 1. 协议端点映射

| 客户端协议类型 | 代理服务接收端点 | 适用模型示例 |
| :--- | :--- | :--- |
| **OpenAI 兼容** | `http://127.0.0.1:8317/v1/chat/completions` | `gpt-6-astra`, `gpt-6.1-sol`, `gpt-4o` |
| **OpenAI 模型列表** | `http://127.0.0.1:8317/v1/models` | 获取所有已接入 Provider 的聚合模型 |
| **Claude Messages** | `http://127.0.0.1:8317/v1/messages` | `claude-sonnet-5.5`, `claude-opus-5.5` |
| **Google Gemini** | `http://127.0.0.1:8317/v1beta/models/...` | `gemini-3.8-flash`, `gemini-4-argon` |

### 2. 主流客户端配置范例

#### ① NextChat (ChatGPT-Next-Web) / LobeChat
- **接口地址 (Base URL)**: `http://127.0.0.1:8317`
- **API Key**: 填入在面板【API 密钥 -> 客户端密钥】中生成的 Access Key（如 `sk-cpa-my-client-key`）
- **自定义模型**: 填入接入的模型名，例如 `gpt-6-astra,claude-sonnet-5.5,gemini-3.8-flash`

#### ② Cherry Studio
- 添加服务商选择 **OpenAI** 协议：
  - API 域名: `http://127.0.0.1:8317/v1`
  - API 密钥: 填写面板中生成的客户端 API Key
  - 点击“管理模型” -> “拉取模型列表”，系统将自动同步当前所有活跃账号支持的模型。

#### ③ Cursor / VSCode Continue 插件
以 Continue 为例，在 `config.json` 中配置：
```json
{
  "models": [
    {
      "title": "CLIProxy - GPT-6",
      "provider": "openai",
      "model": "gpt-6-astra",
      "apiBase": "http://127.0.0.1:8317/v1",
      "apiKey": "sk-cpa-my-client-key"
    },
    {
      "title": "CLIProxy - Claude 5.5",
      "provider": "anthropic",
      "model": "claude-sonnet-5.5",
      "apiBase": "http://127.0.0.1:8317",
      "apiKey": "sk-cpa-my-client-key"
    }
  ]
}
```

#### ④ cURL 命令行直接调用
```bash
curl http://127.0.0.1:8317/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-cpa-my-client-key" \
  -d '{
    "model": "gpt-6.1-sol",
    "messages": [{"role": "user", "content": "你好，请用一句话自我介绍！"}]
  }'
```

#### ⑤ Python SDK (OpenAI 官方包)
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8317/v1",
    api_key="sk-cpa-my-client-key"
)

response = client.chat.completions.create(
    model="claude-sonnet-5.5",
    messages=[{"role": "user", "content": "写一个 Python 快速排序算法"}],
    stream=True
)

for chunk in response:
    print(chunk.choices[0].delta.content or "", end="")
```

---

## 配置文件详细说明

服务的运行规则主要由主配置文件 `config.yaml` 决定，管理面板密码由独立的 `panel-auth.json` 维护。

### 1. `config.yaml` 核心结构详解

以下是一份标准注释完整的 `config.yaml` 结构参考：

```yaml
# ==============================================================================
# CLIProxyAPI Plus 核心配置文件说明
# ==============================================================================

# 1. 服务监听与通信设置
server:
  host: "0.0.0.0"               # 监听地址：0.0.0.0 允许全网访问，127.0.0.1 仅限本机
  port: 8317                    # HTTP 代理服务端口
  payload-limit: 104857600      # 请求体积上限 (字节，默认 100MB)
  proxy-url: ""                 # 全局前置上游代理（如: "http://127.0.0.1:7890"）

# 2. 访问控制（下游客户端）
access:
  api-keys:                     # 允许调用本代理 /v1/* 接口的客户端密钥列表
    - "sk-cpa-client-token-1"
    - "sk-cpa-client-token-2"
  white-list: []                # 客户端 IP 白名单（为空则不限制 IP）

# 3. 管理端点与控制面板设置
management:
  allow-remote: true            # 是否允许远程访问管理面板与 Management API (公网部署必开)
  disable-control-panel: false  # 是否彻底禁用面板（若为 true 则 /panel 返回 404）
  secret-key: ""                # 上游 /v0/management 与 /v8/management 接口密钥 (面板内置认证无需此项)

# 4. 路由、负载均衡与重试策略
routing:
  strategy: "round-robin"       # 账号调度策略: round-robin (轮询) | random (加权随机) | soonest-reset
  request-retry: 3              # 上游请求遇错误码时的自动故障切换重试次数
  max-retry-interval: 10        # 重试最大退避秒数
  force-model-prefix: false     # 是否强制模型加 provider 前缀

# 5. 模型配置与别名映射
models:
  oauth-model-alias:            # 模型重命名或别名映射表
    "gpt-4o": "gpt-6.1-sol"
    "claude-3-5-sonnet": "claude-sonnet-5.5"
  oauth-excluded-models: []     # 排除在 /v1/models 之外的模型名称

# 6. 日志与指标统计
logging:
  level: "info"                 # 日志输出级别: debug | info | warn | error
  file: "logs/cliproxy.log"     # 日志保存路径（留空则只输出至终端标准输出）
  max-size: 50                  # 单个日志文件上限大小 (MB)

usage-statistics-enabled: true  # 是否开启本地 API 调用用量统计

# 7. 上游直连 API Key 账号配置 (可选)
gemini-api-key:
  - "AIzaSyDxxxxxx"
claude-api-key:
  - "sk-ant-apixxxxx"

# 8. 第三方 OpenAI 兼容上游服务商接入
openai-compatibility:
  - name: "DeepSeek-Official"
    base-url: "https://api.deepseek.com/v1"
    api-keys:
      - "sk-xxxxxx"
    models:
      - name: "deepseek-chat"
        alias: "deepseek-v3"
      - name: "deepseek-reasoner"
        alias: "deepseek-r1"
```

### 2. `panel-auth.json` 存储原理

- **存储内容**：`{"password_hash": "$2a$10$...", "updated_at": "..."}`。
- **与 config.yaml 解耦的设计原因**：在 Web 管理界面中，管理员会频繁通过表单修改 `config.yaml` 或切换预设。如果将面板管理员密码混存在 YAML 文件中，配置格式解析错误、YAML 语法替换或误重置将导致管理员彻底丢失面板登录权限。因此，Plus 版将安全身份凭证单独放置于 `panel-auth.json`。
- **重置密码方式**：若管理员遗忘面板登录密码，只需删除配置文件所在目录下的 `panel-auth.json`，刷新面板页面即可重新进入引导设置流程。

### 3. 三种开箱即用的配置模板

#### 模板 A：个人本地极简开发配置（默认）
适合在个人电脑上运行，为本地编辑器提供代理：
```yaml
server:
  host: "127.0.0.1"
  port: 8317
access:
  api-keys:
    - "sk-local-dev-key"
management:
  allow-remote: false
usage-statistics-enabled: true
```

#### 模板 B：云服务器公网多用户安全配置
适合在 VPS 上托管，供团队成员远程共享使用：
```yaml
server:
  host: "0.0.0.0"
  port: 8317
access:
  api-keys:
    - "sk-user-alice-team"
    - "sk-user-bob-team"
management:
  allow-remote: true
routing:
  strategy: "round-robin"
  request-retry: 3
logging:
  level: "info"
  file: "cliproxy.log"
```

#### 模板 C：多提供商高可用调度配置
配置前置翻墙代理，并聚合 DeepSeek、Gemini 与 Claude：
```yaml
server:
  host: "0.0.0.0"
  port: 8317
  proxy-url: "http://127.0.0.1:7890"
access:
  api-keys:
    - "sk-prod-universal-key"
management:
  allow-remote: true
routing:
  strategy: "soonest-reset"
  request-retry: 5
  max-retry-interval: 8
openai-compatibility:
  - name: "DeepSeek"
    base-url: "https://api.deepseek.com/v1"
    api-keys: ["sk-ds-key-1", "sk-ds-key-2"]
```

---

## 全平台打包与构建指南

CLIProxyAPI Plus 采用 **Frontend SPA + Go Embedding** 架构：前端通过 Vite 编译生成静态文件并写入 `internal/webui/static/`，随后 Go 编译器利用 `//go:embed all:static` 指令将 HTML/JS/CSS 静态文件全部打包进宿主可执行程序，**生成无任何外部文件依赖的单个二进制发布物**。

### 1. 构建环境依赖

- **Go 语言环境**：`Go 1.22+`（推荐 Go 1.24+ 或 Go 1.26）
- **Node.js 环境**：`Node.js 18.0+` 以及 `npm`

---

### 2. 方式一：一键全平台自动化打包脚本（推荐）

项目在 `scripts/` 目录下提供了完善的全平台、多 CPU 架构一键编译打包脚本，可自动执行前端构建、Go 交叉编译矩阵，并输出为规范的 `.zip` / `.tar.gz` 归档及 SHA-256 校验文件 `checksums.txt`。

#### 在 Linux / macOS / WSL / Git Bash 下运行：
```bash
# 赋予执行权限并运行
chmod +x scripts/build-all.sh
./scripts/build-all.sh
```

#### 在 Windows PowerShell 下运行：
```powershell
# 执行全平台构建
.\scripts\build-all.ps1
```

执行完成后，`dist/` 目录将生成全部主流平台的发布归档包：
```text
dist/
├── CLIProxyAPI_Plus_8.0.47-plus_windows_amd64.zip    # Windows x86_64
├── CLIProxyAPI_Plus_8.0.47-plus_windows_arm64.zip    # Windows ARM64 (Surface / 骁龙 PC)
├── CLIProxyAPI_Plus_8.0.47-plus_linux_amd64.tar.gz   # Linux x86_64 (CentOS/Ubuntu/Debian)
├── CLIProxyAPI_Plus_8.0.47-plus_linux_arm64.tar.gz   # Linux aarch64 (树莓派 / 鲲鹏 / 飞腾)
├── CLIProxyAPI_Plus_8.0.47-plus_darwin_amd64.tar.gz  # macOS Intel 芯片
├── CLIProxyAPI_Plus_8.0.47-plus_darwin_arm64.tar.gz  # macOS Apple Silicon (M1/M2/M3/M4)
└── checksums.txt                                     # SHA-256 完整性校验文件
```

---

### 3. 方式二：手动单平台或交叉编译（技术细节）

#### 步骤 1：编译前端资源
进入前端工程目录进行安装与构建：
```bash
cd web
npm install
npm run build
cd ..
```
*构建产物将输出至 `internal/webui/static/` 目录中。*

#### 步骤 2：Go 交叉编译矩阵命令表
通过设置 Go 原生交叉编译环境变量 `GOOS` 与 `GOARCH`，配合 `CGO_ENABLED=0`，在任意开发机上即可直接产出目标系统的原生程序：

##### 🪟 Windows 系统构建
```bash
# Windows x86_64
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o dist/cliproxyapi-plus-windows-amd64.exe ./cmd/server

# Windows ARM64
CGO_ENABLED=0 GOOS=windows GOARCH=arm64 go build -ldflags="-s -w" -o dist/cliproxyapi-plus-windows-arm64.exe ./cmd/server
```

##### 🐧 Linux 系统构建
```bash
# Linux x86_64 (标准服务器通用)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/cliproxyapi-plus-linux-amd64 ./cmd/server

# Linux ARM64 (轻量云服务器、树莓派等)
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o dist/cliproxyapi-plus-linux-arm64 ./cmd/server
```

##### 🍏 macOS 系统构建
```bash
# macOS Apple Silicon (M 系列芯片)
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o dist/cliproxyapi-plus-darwin-arm64 ./cmd/server

# macOS Intel 芯片
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o dist/cliproxyapi-plus-darwin-amd64 ./cmd/server
```

> **提示**：`-ldflags="-s -w"` 能够剥离二进制文件的符号表与调试信息，使输出文件体积缩小约 30%~40%，大幅提升网络分发效率。

---

### 4. 方式三：Docker 容器与多架构打包

项目根目录下提供了多阶段构建的 `Dockerfile`，构建出的镜像体积小且运行安全：

```bash
# 1. 本地标准镜像构建
docker build -t cliproxyapi-plus:latest .

# 2. 运行容器
docker run -d \
  --name cliproxyapi-plus \
  -p 8317:8317 \
  -v $(pwd)/config.yaml:/app/config.yaml \
  -v $(pwd)/auths:/app/auths \
  cliproxyapi-plus:latest

# 3. 构建多架构镜像并发布 (amd64 + arm64)
docker buildx build --platform linux/amd64,linux/arm64 \
  -t your-registry/cliproxyapi-plus:latest --push .
```

---

## 系统自升级与平滑热重启机制

在 Web 控制台的【系统更新】页面中，支持一键热升级：

```text
[检查更新] -> 匹配操作系统/CPU 架构资产 -> 下载并校验 SHA-256 散列
             -> 原子 Rename: current.exe -> current.exe.old
             -> 写入新程序: current.exe.new -> current.exe
             -> 触发无父子依赖的脱壳重启 (Windows Task Scheduler / Unix 守护)
             -> 进程交接成功，旧进程平稳终止
```

1. **原子重命名原理**：Windows 操作系统禁止直接覆盖或删除正在运行的文件，但**允许重命名正在执行的文件**。升级模块首先将正在运行的二进制文件重命名为 `.old`，随后将下载好的新二进制移动为正式程序名。
2. **脱离父进程杀戮树（Job Object Escape）**：在 Windows 环境下，直接通过父进程启动子进程会导致父进程终止时子进程被操作系统连带清理。Plus 版在 Windows 上通过调用系统级计划任务服务（`schtasks.exe`）执行一次性独立拉起脚本，等待旧 PID 安全退出后完成新实例带参启动，重试自愈上限达 5 次。

---

## 常见问题 (FAQ)

### Q1: 部署到云服务器后，在本地电脑浏览器打不开管理面板显示 403 Forbidden？
**解答**：出于安全防护设计，控制面板默认限制仅本机（127.0.0.1）可访问。若要进行远程公网管理，请在 `config.yaml` 中添加或修改：
```yaml
management:
  allow-remote: true
```
修改后重启服务即可。

### Q2: 忘记了 Web 面板的登录密码怎么办？
**解答**：删除工作目录下的 `panel-auth.json` 文件（例如在 Linux 上执行 `rm panel-auth.json`），然后刷新浏览器页面，系统将重新呈现首次进入的引导向导（Setup Wizard），此时即可直接设置新的管理员密码。此操作不会丢失任何 `config.yaml` 或 OAuth 凭证数据。

### Q3: 频繁输错密码提示已被锁定（IP 限制），如何立刻解除？
**解答**：防爆破安全机制会对连续输错 5 次的 IP 锁定 15 分钟。如需立即解除，直接重启 `cliproxyapi-plus` 进程即可重置内存中的登录计数器，或者等待 15 分钟自动解除。

### Q4: 可以在没有外网回定向地址的内网服务器上完成 OAuth 登录吗？
**解答**：完全可以！在面板【账号登录】发起授权后，复制授权链接在任意可以访问该网站的电脑/手机浏览器中打开并同意；授权完成后浏览器地址栏会跳转至一个类似 `http://localhost:8317/callback?code=...&state=...` 的失败页面；直接将整个浏览器的**完整 URL 地址复制粘贴回控制面板的“手动提交回调”输入框**中，即可顺利完成登录绑定。

---

## 支持的 AI 模型平台

<table>
<tbody>
    <tr>
        <th align="center" width="100">Provider</th>
        <th align="center">平台支持与特性描述</th>
    </tr>
    <tr>
        <td align="center"><img src="./assets/logo/openai.svg" alt="OpenAI" width="28" height="28" /></td>
        <td><strong>OpenAI GPT-6 / GPT-4o / Codex</strong>：支持 GPT-6 Astra、GPT-6.1 Sol、GPT-6.1 Terra、GPT-6 Luna。支持多账号 Codex 凭证池、5h/7d 实时配额追踪及 SIWC 绑定。</td>
    </tr>
    <tr>
        <td align="center"><img src="./assets/logo/claude.svg" alt="Anthropic" width="28" height="28" /></td>
        <td><strong>Anthropic Claude</strong>：支持 Claude Sonnet 5.5、Claude Opus 5.5、Claude Fable 5.1。兼容 Anthropic 原生 Messages 协议与流式输出。</td>
    </tr>
    <tr>
        <td align="center"><img src="./assets/logo/antigravity.svg" alt="Google" width="28" height="28" /></td>
        <td><strong>Google Gemini & Antigravity</strong>：支持 Gemini 4 Argon、Gemini 3.8 Flash，支持 Vertex AI 服务账号 JSON 导入及 AI Studio 直连。</td>
    </tr>
    <tr>
        <td align="center"><img src="./assets/logo/kimi.svg" alt="Kimi" width="28" height="28" /></td>
        <td><strong>Moonshot Kimi</strong>：支持 Kimi K3.1 Pro、K3、K2.8 Preview，长文本代码与多模态解析支持。</td>
    </tr>
    <tr>
        <td align="center"><img src="./assets/logo/xai.svg" alt="xAI" width="28" height="28" /></td>
        <td><strong>xAI Grok</strong>：支持 Grok 4.7、Grok 4.7 Build Fast 等。</td>
    </tr>
    <tr>
        <td align="center"><img src="./assets/logo/meta.svg" alt="Meta" width="28" height="28" /></td>
        <td><strong>Meta Muse</strong>：支持 Muse Wonder Full、Muse Spark 1.3 等代码智能体模型。</td>
    </tr>
</tbody>
</table>

---

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。欢迎提交 Issue 与 Pull Request 共同完善！

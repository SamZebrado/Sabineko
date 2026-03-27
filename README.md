# sabineko

## 中文

### 简介
`sabineko` 是一个面向多论文场景的最小流水线，用来协调三类角色：
- `Codex`：本地编码、生成文件、整理结构化结果
- `NorthNo1`：通过任意 API 提供复杂文稿审阅、比较分析和 prompt 生成
- `DeepSea`：一种可以收发消息，并提供 LaTeX、PDF 和附件访问能力的文稿/工作区平台

项目把每篇论文的数据隔离在 `papers/<paper_id>/` 下，并通过本地 JSON API 暴露统一接口，让其它目录中的 agent 不需要直接依赖文件路径。

### 使用例子
一个典型用法是：
1. 从 `DeepSea` 获取某篇论文初稿相关的 LaTeX、PDF 和必要附件。
2. 把这些材料交给 `NorthNo1` 审核。
3. `NorthNo1` 分别给 `Codex` 和 `DeepSea` 生成 prompt。
4. `Codex` 执行自己的 prompt，并把结果交给 `DeepSea`，由 `DeepSea` 更新 paper。
5. 如果需要，可以加入额外循环：`NorthNo1` 核对 -> `Codex` 修改 -> `NorthNo1` 批准。
6. `DeepSea` 按 prompt 应用修改后，进入下一轮。

补充说明：
- 每轮开始前，人类可以先审查当前状态并提供初始意见。
- 流程中途可以随时暂停。
- 也可以只使用 pipeline 的某个部分，而不是整套流程。
- 如果需要，还可以把其中一个部分单独提纯成独立 skill。

### 作者说明
这个项目是我和 `Codex` 一起写的。

如果你愿意，完全可以继续使用 `Codex` 或其它 AI，把这个项目继续拆分、重写，或者转化成更细的 `Skills`。

我自己并不太会用 GitHub；这个仓库目前主要是为了分享。其它更复杂的交互、开源维护和社区化做法，我会以非常慢的速度学习。

### 项目范围
这个仓库是一个可发布的、平台中性的核心版本。

它刻意避免把某个特定聊天平台或特定文稿平台硬编码到项目对外描述中。如果你需要网页自动化，可以在你自己的部署里接入浏览器自动化插件，或者使用 Playwright 适配层；但在启用前，请先确认你的做法符合目标平台或目标服务的规则。

### 依赖
必需：
- Node.js 20+
- npm

可选：
- `playwright`
- 通过 `npx playwright install chromium` 安装的 Chromium

安装：
```bash
npm install
```

如果你计划在本地自动化一个 DeepSea 类网页平台：
```bash
npx playwright install chromium
```

### 目录结构
```text
scripts/
web/
papers/
  <paper_id>/
    config/
      deepsea.json
    state/
    captures/
      latest/
      history/
    prompts/
    downloads/
    handoff/
state/
  global/
run_capture.sh
run_web.sh
```

### 核心概念
- `NorthNo1`：面向 API 的审阅/生成角色。它可以读取文稿上下文，生成给 Codex 和 DeepSea 的 prompt，也可以输出结构化 pipeline 请求。
- `DeepSea`：通用文稿工作区。这里假定它支持消息交互，并能访问 LaTeX、PDF 和上传附件。
- pipeline 本身：只接收 JSON request，不直接承担 prompt 语义解释。

### 配置
每篇论文使用 `papers/<paper_id>/config/deepsea.json`。

最小示例：
```json
{
  "paperId": "paper_default",
  "paperLabel": "paper_default",
  "projectUrl": "https://deepsea.example.com/project",
  "baseUrl": "https://deepsea.example.com/",
  "stateMode": "global",
  "capture": {
    "headless": false,
    "waitUntil": "domcontentloaded",
    "timeoutMs": 45000,
    "settleMs": 4000,
    "networkLogMax": 400
  },
  "northno1Api": {
    "baseUrl": "https://api.example.com",
    "sendPath": "/v1/messages",
    "fetchPathTemplate": "/v1/messages/{requestId}",
    "apiKeyEnv": "NORTHNO1_API_KEY",
    "authHeader": "Authorization",
    "authScheme": "Bearer",
    "model": "advanced-reviewer"
  }
}
```

### 主要命令
校验论文配置：
```bash
node scripts/validate_paper_config.js --paper paper_default
```

抓取当前 DeepSea 状态：
```bash
./run_capture.sh --paper paper_default
```

根据最新抓取结果生成 NorthNo1 审阅消息：
```bash
node scripts/build_northno1_message.js --paper paper_default
```

解析保存下来的 NorthNo1 回复：
```bash
node scripts/parse_northno1_reply.js --paper paper_default --input papers/paper_default/prompts/northno1_reply.txt
```

启动本地 JSON API：
```bash
./run_web.sh
```

### 趣味模式（《潜伏》致敬）
项目支持一个趣味模式，让北方一号、行动队长和深海三个角色说出《潜伏》中的经典台词。

#### 开启/关闭趣味模式
- 通过 Web 界面上的「趣味模式」按钮切换
- 或通过 API 端点：
  ```bash
  # 查看状态
  curl http://localhost:8788/api/qvbing-mode/status
  
  # 开启
  curl -X POST http://localhost:8788/api/qvbing-mode/enable
  
  # 关闭
  curl -X POST http://localhost:8788/api/qvbing-mode/disable
  
  # 切换
  curl -X POST http://localhost:8788/api/qvbing-mode/toggle
  ```

#### 注意事项
- 为了节省 token，平时不建议开启此模式
- 台词会通过终端输出，不影响核心 pipeline 的运行
- 每个角色的台词都有相应的触发条件，确保台词与场景匹配

#### 角色与台词
- **北方一号**：站长角色，会在发现问题时说出经典台词
- **行动队长**：会在执行步骤中说出相应台词
- **深海**：余则成和翠萍角色，会在完成任务时说出经典台词

### 本地 JSON API
常见 action：
- `northno1.compose`
- `northno1.send`
- `northno1.new_chat`
- `northno1.fetch_parse`
- `deepsea.list_files`
- `deepsea.download`
- `deepsea.upload_files`
- `deepsea.inspect_chat`
- `deepsea.send`
- `deepsea.fetch_reply`
- `bundle.build`
- `deepsea.push_bundle`

示例：
```bash
curl -s -X POST http://127.0.0.1:8788/api/papers/paper_default/actions/execute-request \
  -H 'Content-Type: application/json' \
  -d '{
    "action":"northno1.send",
    "params":{
      "messagePath":"papers/paper_default/prompts/to_northno1.md"
    }
  }'
```

### 合法性与自动化说明
- 这个仓库采用的是中性接口和按论文隔离的数据组织方式。
- 如果你接入第三方 AI 提供方，你需要自己确认所使用的 API 或访问方式符合对方规则。
- 如果你接入浏览器自动化层，请把它视为可选组件，并确认目标平台允许这样做。
- 有些网页平台明确禁止自动化访问、脚本化交互、批量抓取或非人工操作；对于这类平台，不应使用本项目的自动化能力。
- 如果你需要审阅复杂文稿、做深度比较、生成高质量 prompt，请使用具备这类能力的高级 AI 系统，并通过合规的 API 或经允许的访问路径接入。

### 免责声明
- 本项目是一个通用框架示例，不针对任何特定商业 AI 平台或特定在线服务作出兼容性、授权性或合规性承诺。
- 任何人如果将本项目接入某个具体 AI 提供方、网页平台、API 或文稿平台，需要自行确认该接入方式符合适用的法律、合同、平台条款和使用规则。
- 仓库作者不对第三方用户基于本项目进行的具体部署、二次开发、自动化接入或平台使用行为提供法律保证，也不对其合规性作出背书。
- 如果某个平台禁止某类自动化、数据抓取、消息收发或脚本化访问，使用者不应使用本项目去规避这些限制。

### 发布卫生
不要提交：
- 真实论文内容
- storage state 文件
- cookies、sessions、tokens 或带平台敏感信息的日志
- 私有项目的原始抓取、PDF、截图、回复内容

仓库中的 `.gitignore` 已默认偏向保护运行态产物和论文私有输出。

---

## English

### Overview
`sabineko` is a minimal multi-paper pipeline for coordinating three roles:
- `Codex` for local coding, file generation, and structured outputs
- `NorthNo1` for complex manuscript review, comparison, and prompt generation through an arbitrary API
- `DeepSea` for a manuscript/workspace platform that can exchange messages and provide access to LaTeX, PDF, and attachments

The project isolates each paper under `papers/<paper_id>/` and exposes a local JSON API so agents in other directories do not need direct filesystem coupling.

### Example Workflow
A typical workflow looks like this:
1. Pull draft-related LaTeX, PDF, and needed attachments from `DeepSea`.
2. Send those materials to `NorthNo1` for review.
3. Let `NorthNo1` generate separate prompts for `Codex` and `DeepSea`.
4. `Codex` executes its prompt and passes the result back to `DeepSea`, which updates the paper.
5. If needed, add an extra loop: `NorthNo1` checks -> `Codex` revises -> `NorthNo1` approves.
6. After `DeepSea` applies the requested edits, the workflow can move into the next round.

Additional notes:
- A human can review the current state and provide initial comments at the start of each round.
- The workflow can be paused at any time.
- You can also use only one part of the pipeline instead of the whole loop.
- Any individual part can be extracted further into a standalone skill if needed.

### Author Note
This project was written by me together with `Codex`.

Anyone is free to keep using `Codex` or other AI systems to refactor it further, split it into smaller parts, or turn parts of it into reusable `Skills`.

I am not very experienced with GitHub. Right now I mainly use it as a sharing channel. I expect to learn more advanced collaboration and interaction patterns very slowly.

### Scope
This repository is the publishable, platform-neutral core.

It intentionally avoids hard-coding any specific chat platform or manuscript platform into the public framing of the project. If you need web automation, you can add a browser automation plugin or a Playwright-based adapter in your own deployment, but you should verify that your approach complies with the rules of the target platform or service before enabling it.

### Dependencies
Required:
- Node.js 20+
- npm

Optional:
- `playwright`
- a Chromium browser installed with `npx playwright install chromium`

Install:
```bash
npm install
```

If you plan to automate a DeepSea-like web platform locally:
```bash
npx playwright install chromium
```

### Repository Layout
```text
scripts/
web/
papers/
  <paper_id>/
    config/
      deepsea.json
    state/
    captures/
      latest/
      history/
    prompts/
    downloads/
    handoff/
state/
  global/
run_capture.sh
run_web.sh
```

### Core Concepts
- `NorthNo1` is an API-facing reviewer/generator role. It can inspect manuscript context, produce prompts for Codex and DeepSea, and optionally emit structured pipeline requests.
- `DeepSea` is a generic manuscript workspace. It is assumed to support message exchange plus access to LaTeX files, PDFs, and uploaded attachments.
- The pipeline itself accepts JSON requests only.

### Configuration
Each paper uses `papers/<paper_id>/config/deepsea.json`.

Minimal example:
```json
{
  "paperId": "paper_default",
  "paperLabel": "paper_default",
  "projectUrl": "https://deepsea.example.com/project",
  "baseUrl": "https://deepsea.example.com/",
  "stateMode": "global",
  "capture": {
    "headless": false,
    "waitUntil": "domcontentloaded",
    "timeoutMs": 45000,
    "settleMs": 4000,
    "networkLogMax": 400
  },
  "northno1Api": {
    "baseUrl": "https://api.example.com",
    "sendPath": "/v1/messages",
    "fetchPathTemplate": "/v1/messages/{requestId}",
    "apiKeyEnv": "NORTHNO1_API_KEY",
    "authHeader": "Authorization",
    "authScheme": "Bearer",
    "model": "advanced-reviewer"
  }
}
```

### Main Commands
Validate a paper config:
```bash
node scripts/validate_paper_config.js --paper paper_default
```

Capture current DeepSea state:
```bash
./run_capture.sh --paper paper_default
```

Build the NorthNo1 review message from the latest capture:
```bash
node scripts/build_northno1_message.js --paper paper_default
```

Parse a saved NorthNo1 reply:
```bash
node scripts/parse_northno1_reply.js --paper paper_default --input papers/paper_default/prompts/northno1_reply.txt
```

Start the local JSON API:
```bash
./run_web.sh
```

### Local JSON API
Common actions:
- `northno1.compose`
- `northno1.send`
- `northno1.new_chat`
- `northno1.fetch_parse`
- `deepsea.list_files`
- `deepsea.download`
- `deepsea.upload_files`
- `deepsea.inspect_chat`
- `deepsea.send`
- `deepsea.fetch_reply`
- `bundle.build`
- `deepsea.push_bundle`

Example:
```bash
curl -s -X POST http://127.0.0.1:8788/api/papers/paper_default/actions/execute-request \
  -H 'Content-Type: application/json' \
  -d '{
    "action":"northno1.send",
    "params":{
      "messagePath":"papers/paper_default/prompts/to_northno1.md"
    }
  }'
```

### Legality and Automation Notes
- This repository is framed around neutral interfaces and paper-local data handling.
- If you connect a third-party AI provider, you are responsible for using an access method that complies with that provider's rules.
- If you add a browser automation layer, keep it optional and verify that it is permitted by the target platform.
- Some web platforms explicitly prohibit automated access, scripted interaction, bulk extraction, or non-human operation; for those platforms, this project's automation features should not be used.
- If you need a system that can review complex manuscripts, compare alternatives, and generate strong prompts, use a sufficiently capable advanced AI system through a compliant API or another permitted access path.

### Disclaimer
- This project is a general framework example. It does not make any promise of compatibility, authorization, or compliance with any specific commercial AI platform or online service.
- Anyone who connects this project to a concrete AI provider, web platform, API, or manuscript platform must independently confirm that the chosen integration method complies with applicable law, contracts, platform terms, and usage rules.
- The repository author does not provide legal assurance for any third-party deployment, downstream modification, automation workflow, or platform-specific use built on top of this project, and does not endorse the compliance of such use.
- If a platform prohibits a category of automation, extraction, messaging, or scripted access, users should not use this project to bypass those restrictions.

### Publishing Hygiene
Do not commit:
- real paper contents
- storage state files
- cookies, sessions, tokens, or provider-specific logs
- raw captures, PDFs, screenshots, or replies from private projects

The provided `.gitignore` is already biased toward keeping runtime artifacts and paper-private outputs out of version control.

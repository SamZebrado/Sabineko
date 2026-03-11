# sabineko

`sabineko` is a minimal multi-paper pipeline for coordinating three roles:
- `Codex` for local coding and file generation
- `NorthNo1` for high-level review and prompt generation through an arbitrary API
- `DeepSea` for a manuscript/workspace platform that can exchange messages and provide LaTeX, PDF, and other attachments

The project keeps paper data isolated under `papers/<paper_id>/` and exposes a local JSON API so agents in other directories do not need direct filesystem coupling.

## Scope
This repository is the publishable, platform-neutral core.

It intentionally avoids hard-coding any vendor-specific chat or manuscript platform. If you need browser automation for your own deployment, you can add a browser automation plugin or Playwright-based adapter, but you should verify that your automation complies with the target AI platform's rules before enabling it.

## Dependencies
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

## Repository Layout
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

## Core Concepts
- `NorthNo1` is an API-facing reviewer/generator role. It can inspect manuscript context, produce prompts for Codex and DeepSea, and optionally request structured pipeline actions.
- `DeepSea` is a generic manuscript workspace. It is assumed to support message exchange plus access to artifacts such as LaTeX files, PDFs, and uploaded attachments.
- The pipeline itself accepts JSON requests only.

## Configuration
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

## Main Commands
Validate a paper config:
```bash
node scripts/validate_paper_config.js --paper paper_default
```

Capture current DeepSea state:
```bash
./run_capture.sh --paper paper_default
```

Build the NorthNo1 review prompt from the latest capture:
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

## Local JSON API
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

## Notes on Legality and Automation
- This repository is framed around neutral interfaces and paper-local data handling.
- If you connect a third-party AI provider, you are responsible for using an access method that complies with that provider's terms.
- If you connect a browser automation layer, keep it optional and verify that it is permitted by the target platform.
- For complex manuscript review and prompt generation, use a sufficiently capable advanced AI system through a compliant API or approved access path.

## Publishing Hygiene
Do not commit:
- real paper contents
- storage state files
- cookies, sessions, tokens, or provider-specific logs
- raw captures, PDFs, screenshots, or replies from private projects

The provided `.gitignore` is already biased toward keeping runtime artifacts and paper-private outputs out of version control.

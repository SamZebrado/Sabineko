---
name: sabineko-northno1-bridge
description: Drive NorthNo1 requests through sabineko's local API. Use this when an agent needs to send content to a review/generation API, start a new conversation by sending the first message, or fetch and parse a reply without depending on direct project paths.
---

# sabineko NorthNo1 Bridge

## Requirements
- Node.js 20+
- `sabineko` running locally via `./run_web.sh`
- a configured `northno1Api` block in `papers/<paper_id>/config/deepsea.json`
- any required API key exported through the environment variable named in `northno1Api.apiKeyEnv`

## Use This Skill For
- `northno1.compose`
- `northno1.send`
- `northno1.new_chat`
- `northno1.fetch_parse`

## Health Check
```bash
curl -s http://127.0.0.1:8788/api/papers
```

## Example
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

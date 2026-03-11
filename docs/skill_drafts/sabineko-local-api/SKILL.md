---
name: sabineko-local-api
description: Use the local HTTP API exposed by sabineko to fetch prompts, submit replies, trigger captures, build bundles, push bundles, and coordinate cross-directory agents without path coupling.
---

# sabineko Local API

## Requirements
- `sabineko` running locally via `./run_web.sh`

## Health Check
```bash
curl -s http://127.0.0.1:8788/api/papers
```

## Preferred Split
- use this skill for orchestration and paper-scoped state
- use `sabineko-northno1-bridge` for NorthNo1 traffic
- use `sabineko-deepsea-bridge` for DeepSea traffic

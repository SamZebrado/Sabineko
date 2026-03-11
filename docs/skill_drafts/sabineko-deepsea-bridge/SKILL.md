---
name: sabineko-deepsea-bridge
description: Drive DeepSea web actions through sabineko's local API. Use this when an agent needs to inspect a DeepSea conversation, send a message, fetch a reply, list files, download files, or upload a bundle without depending on project file paths.
---

# sabineko DeepSea Bridge

## Requirements
- Node.js 20+
- `sabineko` running locally via `./run_web.sh`
- optional Playwright + Chromium if your DeepSea deployment is browser-automated

## Use This Skill For
- `deepsea.list_files`
- `deepsea.download`
- `deepsea.upload_files`
- `deepsea.inspect_chat`
- `deepsea.send`
- `deepsea.fetch_reply`

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

PORT="${1:-8788}"
PIPELINE_WEB_PORT="$PORT" node scripts/web_console_server.js

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_DATA_DIR="${ROOT_DIR}/state/chrome_profiles/deepseabot"
PROFILE_NAME="${1:-Default}"
TARGET_URL="${2:-https://deepsea.example.com/}"
DEBUG_PORT="${3:-9222}"
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_APP="/Applications/Google Chrome.app"

mkdir -p "$USER_DATA_DIR"

echo "Opening dedicated Chrome profile..."
echo "- user_data_dir: $USER_DATA_DIR"
echo "- profile_name: $PROFILE_NAME"
echo "- url: $TARGET_URL"
echo "- remote_debugging_port: $DEBUG_PORT"

echo "Note: close existing Chrome windows first if profile lock appears."

if [[ ! -x "$CHROME_BIN" ]]; then
  echo "ERROR: Chrome binary not found at: $CHROME_BIN"
  echo "Install Google Chrome or update CHROME_BIN in this script."
  exit 1
fi

# Prefer direct binary launch, which is more reliable than open -na for custom profile args.
"$CHROME_BIN" \
  "--user-data-dir=${USER_DATA_DIR}" \
  "--profile-directory=${PROFILE_NAME}" \
  "--remote-debugging-port=${DEBUG_PORT}" \
  "$TARGET_URL" >/dev/null 2>&1 &

sleep 1
if ! pgrep -f "$USER_DATA_DIR" >/dev/null 2>&1; then
  echo "WARN: direct launch did not stay alive, trying fallback with open -na..."
  open -na "$CHROME_APP" --args \
    "--user-data-dir=${USER_DATA_DIR}" \
    "--profile-directory=${PROFILE_NAME}" \
    "--remote-debugging-port=${DEBUG_PORT}" \
    "$TARGET_URL"
fi

echo "Profile launch command sent."

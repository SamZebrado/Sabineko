#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

PAPER_ID="paper_default"
FORCE_LOGIN="false"
DRY_RUN="false"
VERBOSE="false"
LIST_PAPERS="false"

CHECK_FAILS=0
CHECK_PASSES=0
CHECK_WARNS=0
NEXT_STEPS=()

usage() {
  cat <<USAGE
Usage: ./run_capture.sh [options]

Options:
  --paper <paper_id>   Target paper id (default: paper_default)
  --force-login        Ignore existing storage state and ask manual login again
  --dry-run            Run self-check only, do not open DeepSea/browser
  --verbose            Print extra diagnostics
  --list-papers        List available paper ids and configured projectUrl
  -h, --help           Show this help
USAGE
}

log() {
  echo "$*"
}

vlog() {
  if [[ "$VERBOSE" == "true" ]]; then
    echo "[verbose] $*"
  fi
}

pass() {
  CHECK_PASSES=$((CHECK_PASSES + 1))
  echo "[PASS] $*"
}

warn() {
  CHECK_WARNS=$((CHECK_WARNS + 1))
  echo "[WARN] $*"
}

fail() {
  CHECK_FAILS=$((CHECK_FAILS + 1))
  echo "[FAIL] $*"
}

add_next_step() {
  NEXT_STEPS+=("$1")
}

sanitize_paper_id() {
  local raw="${1:-paper_default}"
  local safe
  safe="$(echo "$raw" | sed 's/[^a-zA-Z0-9_-]/_/g')"
  if [[ -z "$safe" ]]; then
    echo "paper_default"
  else
    echo "$safe"
  fi
}

list_papers() {
  node - <<'NODE'
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const papersRoot = path.join(root, 'papers');
if (!fs.existsSync(papersRoot)) {
  console.log('No papers directory found.');
  process.exit(0);
}

const dirs = fs.readdirSync(papersRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

if (dirs.length === 0) {
  console.log('No paper directories found.');
  process.exit(0);
}

console.log('Available papers:');
for (const id of dirs) {
  const cfgPath = path.join(papersRoot, id, 'config', 'deepsea.json');
  let projectUrl = '(missing config)';
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      projectUrl = cfg.projectUrl || '(empty projectUrl)';
    } catch (err) {
      projectUrl = `(invalid config JSON: ${err.message})`;
    }
  }
  console.log(`- ${id}`);
  console.log(`  projectUrl: ${projectUrl}`);
}
NODE
}

check_node_ready() {
  if command -v node >/dev/null 2>&1; then
    pass "node command found"
    vlog "node version: $(node -v)"
  else
    fail "node command not found"
    add_next_step "Install Node.js, then re-run ./run_capture.sh --dry-run"
  fi
}

check_scripts_exist() {
  local missing=0
  for f in scripts/init_paper.js scripts/capture_deepsea_state.js scripts/build_northno1_message.js scripts/validate_paper_config.js scripts/paper_paths.js; do
    if [[ -f "$f" ]]; then
      vlog "found script: $f"
    else
      missing=1
      fail "missing required script: $f"
    fi
  done

  if [[ "$missing" -eq 0 ]]; then
    pass "required scripts are present"
  else
    add_next_step "Restore missing script files listed above"
  fi
}

check_paper_structure() {
  local safe_paper_id="$1"
  local base="papers/${safe_paper_id}"

  if [[ -d "$base" ]]; then
    pass "paper directory exists: $base"
  else
    fail "paper directory does not exist: $base"
    add_next_step "Create it with: node scripts/init_paper.js --paper ${safe_paper_id}"
    return
  fi

  local required_dirs=(
    "$base/config"
    "$base/state"
    "$base/captures"
    "$base/captures/history"
    "$base/captures/latest"
    "$base/prompts"
  )

  local missing_any=0
  for d in "${required_dirs[@]}"; do
    if [[ -d "$d" ]]; then
      vlog "found dir: $d"
    else
      missing_any=1
      fail "missing directory: $d"
    fi
  done

  if [[ "$missing_any" -eq 0 ]]; then
    pass "paper directory layout is complete"
  else
    add_next_step "Repair paper layout with: node scripts/init_paper.js --paper ${safe_paper_id}"
  fi
}

check_config_file() {
  local safe_paper_id="$1"
  local cfg="papers/${safe_paper_id}/config/deepsea.json"

  if [[ -f "$cfg" ]]; then
    pass "config file exists: $cfg"
  else
    fail "config file missing: $cfg"
    add_next_step "Create config with: node scripts/init_paper.js --paper ${safe_paper_id}"
  fi
}

check_config_valid() {
  local safe_paper_id="$1"

  local out
  if out="$(node scripts/validate_paper_config.js --paper "$safe_paper_id" 2>&1)"; then
    pass "config validation passed for ${safe_paper_id}"
    vlog "$out"
  else
    fail "config validation failed for ${safe_paper_id}"
    echo "$out"
    add_next_step "Edit papers/${safe_paper_id}/config/deepsea.json and fix projectUrl"
  fi
}

check_storage_state_path() {
  local safe_paper_id="$1"
  local cfg_path="papers/${safe_paper_id}/config/deepsea.json"
  if [[ ! -f "$cfg_path" ]]; then
    fail "cannot compute storage state path because config is missing: $cfg_path"
    add_next_step "Create/fix ${cfg_path} first"
    return
  fi

  local state_path
  if ! state_path="$(node -e "const fs=require('fs'); const path=require('path'); const paper=process.argv[1]; const cfgPath=process.argv[2]; const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf8')); const mode=String(cfg.stateMode||'global').toLowerCase(); const p=(mode==='paper'||mode==='per_paper') ? path.join('papers',paper,'state','storage_state.json') : path.join('state','global','storage_state.json'); process.stdout.write(p);" "$safe_paper_id" "$cfg_path" 2>/dev/null)"; then
    fail "unable to compute storage state path (invalid config JSON?)"
    add_next_step "Fix JSON syntax in ${cfg_path}"
    return
  fi

  local state_dir
  state_dir="$(dirname "$state_path")"

  if [[ ! -d "$state_dir" ]]; then
    fail "storage state directory missing: $state_dir"
    add_next_step "Create storage directory or run init_paper again"
    return
  fi

  if [[ -w "$state_dir" ]]; then
    if [[ -f "$state_path" ]]; then
      pass "storage state file is available: $state_path"
    else
      warn "storage state file not found yet (first login will create it): $state_path"
      add_next_step "First real run may require manual DeepSea login to create storage state"
    fi
  else
    fail "storage state directory is not writable: $state_dir"
    add_next_step "Fix directory permissions for ${state_dir}"
  fi
}

check_playwright_installed() {
  local out
  if out="$(node -e "try { require('playwright'); console.log('ok'); } catch (e) { console.error(e.message); process.exit(1); }" 2>&1)"; then
    pass "playwright dependency is installed"
    vlog "$out"
  else
    fail "playwright dependency missing or broken"
    echo "$out"
    add_next_step "Run: npm install && npx playwright install chromium"
  fi
}

run_preflight_checks() {
  local safe_paper_id="$1"

  echo "=== Preflight checks for paper_id=${safe_paper_id} ==="
  CHECK_FAILS=0
  CHECK_PASSES=0
  CHECK_WARNS=0
  NEXT_STEPS=()

  check_node_ready
  check_scripts_exist
  check_paper_structure "$safe_paper_id"
  check_config_file "$safe_paper_id"
  check_config_valid "$safe_paper_id"
  check_storage_state_path "$safe_paper_id"
  check_playwright_installed

  echo ""
  echo "=== Check summary ==="
  echo "PASS: ${CHECK_PASSES}"
  echo "WARN: ${CHECK_WARNS}"
  echo "FAIL: ${CHECK_FAILS}"

  if [[ ${#NEXT_STEPS[@]} -gt 0 ]]; then
    echo ""
    echo "Next steps:" 
    local idx=1
    for step in "${NEXT_STEPS[@]}"; do
      echo "${idx}) ${step}"
      idx=$((idx + 1))
    done
  else
    echo ""
    echo "Next steps:"
    echo "1) Run ./run_capture.sh --paper ${safe_paper_id}"
    echo "2) Send papers/${safe_paper_id}/prompts/to_northno1.md to NorthNo1"
  fi

  [[ "$CHECK_FAILS" -eq 0 ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --paper)
      if [[ $# -lt 2 ]]; then
        echo "--paper requires a value"
        exit 1
      fi
      PAPER_ID="$2"
      shift 2
      ;;
    --force-login)
      FORCE_LOGIN="true"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --verbose)
      VERBOSE="true"
      shift
      ;;
    --list-papers)
      LIST_PAPERS="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ "$LIST_PAPERS" == "true" ]]; then
  list_papers
  exit 0
fi

SAFE_PAPER_ID="$(sanitize_paper_id "$PAPER_ID")"

if [[ "$DRY_RUN" == "true" ]]; then
  if run_preflight_checks "$SAFE_PAPER_ID"; then
    echo ""
    echo "Dry-run result: OK"
    exit 0
  else
    echo ""
    echo "Dry-run result: FAILED"
    exit 1
  fi
fi

# Normal run: initialize folder if needed, then strict preflight.
node scripts/init_paper.js --paper "$SAFE_PAPER_ID" >/dev/null

if ! run_preflight_checks "$SAFE_PAPER_ID"; then
  echo ""
  echo "Preflight failed, aborting capture run."
  exit 1
fi

STATE_PATH="$(node -e "const {paperPaths,loadPaperConfig,resolveStorageStatePath}=require('./scripts/paper_paths'); const p=paperPaths(process.argv[1]); const cfg=loadPaperConfig(p); process.stdout.write(resolveStorageStatePath(p,cfg));" "$SAFE_PAPER_ID")"
FIRST_RUN="false"
if [[ ! -f "$STATE_PATH" ]]; then
  FIRST_RUN="true"
fi

if [[ "$FORCE_LOGIN" == "true" ]]; then
  vlog "Running capture with force-login"
  node scripts/capture_deepsea_state.js --paper "$SAFE_PAPER_ID" --force-login
else
  node scripts/capture_deepsea_state.js --paper "$SAFE_PAPER_ID"
fi

node scripts/build_northno1_message.js --paper "$SAFE_PAPER_ID"

PROMPTS_DIR="papers/${SAFE_PAPER_ID}/prompts"
LATEST_DIR="papers/${SAFE_PAPER_ID}/captures/latest"

cat <<MSG

Capture pipeline done.

- paper_id: ${SAFE_PAPER_ID}
- latest capture: ${LATEST_DIR}
- northno1 draft: ${PROMPTS_DIR}/to_northno1.md

Next steps:
1) Send ${PROMPTS_DIR}/to_northno1.md to NorthNo1 web.
2) Save NorthNo1 reply to ${PROMPTS_DIR}/northno1_reply.txt
3) Parse blocks:
   node scripts/parse_northno1_reply.js --paper "${SAFE_PAPER_ID}" --input "${PROMPTS_DIR}/northno1_reply.txt"

MSG

if [[ "$FIRST_RUN" == "true" ]]; then
  echo "First run note: manual DeepSea login is expected once, then storage state will be reused from ${STATE_PATH}."
fi

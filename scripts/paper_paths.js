'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PAPER_ID = 'paper_default';

function sanitizePaperId(value) {
  const raw = String(value || DEFAULT_PAPER_ID).trim();
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  return safe || DEFAULT_PAPER_ID;
}

function paperPaths(paperIdInput) {
  const paperId = sanitizePaperId(paperIdInput);
  const paperRoot = path.join(ROOT, 'papers', paperId);

  return {
    ROOT,
    paperId,
    paperRoot,
    configDir: path.join(paperRoot, 'config'),
    configPath: path.join(paperRoot, 'config', 'deepsea.json'),
    paperStateDir: path.join(paperRoot, 'state'),
    capturesDir: path.join(paperRoot, 'captures'),
    captureHistoryDir: path.join(paperRoot, 'captures', 'history'),
    captureLatestDir: path.join(paperRoot, 'captures', 'latest'),
    promptsDir: path.join(paperRoot, 'prompts'),
    handoffDir: path.join(paperRoot, 'handoff'),
    downloadsDir: path.join(paperRoot, 'downloads'),
    globalStateDir: path.join(ROOT, 'state', 'global'),
    globalStatePath: path.join(ROOT, 'state', 'global', 'storage_state.json')
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensurePaperLayout(paths) {
  ensureDir(path.join(paths.ROOT, 'papers'));
  ensureDir(paths.configDir);
  ensureDir(paths.paperStateDir);
  ensureDir(paths.capturesDir);
  ensureDir(paths.captureHistoryDir);
  ensureDir(paths.captureLatestDir);
  ensureDir(paths.promptsDir);
  ensureDir(paths.handoffDir);
  ensureDir(paths.downloadsDir);
  ensureDir(paths.globalStateDir);
}

function defaultDeepSeaConfig(paperId) {
  return {
    paperId,
    paperLabel: paperId,
    projectUrl: 'https://deepsea.example.com/project',
    baseUrl: 'https://deepsea.example.com/',
    loginSuccessSelector: '',
    stateMode: 'global',
    capture: {
      headless: false,
      waitUntil: 'domcontentloaded',
      timeoutMs: 45000,
      settleMs: 4000,
      networkLogMax: 400
    }
  };
}

function ensurePaperConfig(paths) {
  if (!fs.existsSync(paths.configPath)) {
    fs.writeFileSync(paths.configPath, JSON.stringify(defaultDeepSeaConfig(paths.paperId), null, 2), 'utf8');
  }
}

function loadPaperConfig(paths) {
  ensurePaperLayout(paths);
  ensurePaperConfig(paths);
  return JSON.parse(fs.readFileSync(paths.configPath, 'utf8'));
}

function resolveStorageStatePath(paths, cfg) {
  const mode = String(cfg.stateMode || 'global').toLowerCase();
  if (mode === 'paper' || mode === 'per_paper') {
    return path.join(paths.paperStateDir, 'storage_state.json');
  }
  return paths.globalStatePath;
}

function timestampTag(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function relToRoot(absPath) {
  return path.relative(ROOT, absPath);
}

module.exports = {
  ROOT,
  DEFAULT_PAPER_ID,
  sanitizePaperId,
  paperPaths,
  ensurePaperLayout,
  ensurePaperConfig,
  loadPaperConfig,
  resolveStorageStatePath,
  timestampTag,
  relToRoot
};

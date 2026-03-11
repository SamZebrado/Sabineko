'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const {
  ROOT,
  DEFAULT_PAPER_ID,
  sanitizePaperId,
  paperPaths,
  ensurePaperLayout,
  ensurePaperConfig,
  loadPaperConfig,
  resolveStorageStatePath,
  relToRoot
} = require('./paper_paths');
const {
  readPipelineState,
  configurePipelineState,
  consumeDeepSeaRun,
  terminatePipeline
} = require('./pipeline_state');

const WEB_DIR = path.join(ROOT, 'web');
const PORT = Number(process.env.PIPELINE_WEB_PORT || 8788);
const MAX_LOG_LINES = 300;
const runningJobs = new Map();
const runningChatgptJobs = new Map();
const CHATGPT_SEND_GUARD_PATH = path.join(ROOT, 'state', 'northno1_send_guard.json');

function nowIso() {
  return new Date().toISOString();
}

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text)
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function ensurePaperReady(paperIdInput) {
  const paperId = sanitizePaperId(paperIdInput || DEFAULT_PAPER_ID);
  const paths = paperPaths(paperId);
  ensurePaperLayout(paths);
  ensurePaperConfig(paths);
  return paths;
}

function workflowStatusPath(paths) {
  return path.join(paths.paperStateDir, 'workflow_status.json');
}

function defaultStatus(paperId) {
  return {
    paperId,
    running: false,
    currentStep: 'idle',
    updatedAt: nowIso(),
    lastError: null,
    lastCaptureRunDir: null,
    lastCaptureAt: null,
    steps: {
      objectiveSaved: false,
      captureDone: false,
      toNorthNo1Ready: false,
      replySaved: false,
      parseDone: false
    },
    logs: []
  };
}

function readStatus(paths) {
  const p = workflowStatusPath(paths);
  if (!fs.existsSync(p)) {
    const initial = defaultStatus(paths.paperId);
    fs.writeFileSync(p, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!parsed.steps) {
      parsed.steps = defaultStatus(paths.paperId).steps;
    }
    if (!Array.isArray(parsed.logs)) {
      parsed.logs = [];
    }
    return parsed;
  } catch (err) {
    const reset = defaultStatus(paths.paperId);
    fs.writeFileSync(p, JSON.stringify(reset, null, 2), 'utf8');
    return reset;
  }
}

function writeStatus(paths, status) {
  status.updatedAt = nowIso();
  fs.writeFileSync(workflowStatusPath(paths), JSON.stringify(status, null, 2), 'utf8');
}

function updateStatus(paths, updater) {
  const status = readStatus(paths);
  updater(status);
  writeStatus(paths, status);
  return status;
}

function appendLog(paths, line) {
  updateStatus(paths, (s) => {
    s.logs.push(`[${nowIso()}] ${line}`);
    if (s.logs.length > MAX_LOG_LINES) {
      s.logs = s.logs.slice(s.logs.length - MAX_LOG_LINES);
    }
  });
}

function safeReadText(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function safeReadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return null;
  }
}

function readPaperContext(paths) {
  const cfg = loadPaperConfig(paths);
  const status = readStatus(paths);
  const captureMeta = safeReadJson(path.join(paths.captureLatestDir, 'capture_meta.json'));
  const pipelineState = readPipelineState(paths);
  const deepseaStatus = safeReadJson(path.join(paths.paperStateDir, 'deepsea_bridge_status.json'));
  const northno1Status = safeReadJson(path.join(paths.paperStateDir, 'northno1_bridge_status.json'));
  const manualObservations = safeReadJson(path.join(paths.paperStateDir, 'manual_observations.json'));

  return {
    paperId: paths.paperId,
    config: cfg,
    status,
    pipelineState,
    deepseaStatus,
    northno1Status,
    manualObservations,
    storageStatePath: relToRoot(resolveStorageStatePath(paths, cfg)),
    files: {
      objective: safeReadText(path.join(paths.promptsDir, 'objective.md')),
      toNorthNo1: safeReadText(path.join(paths.promptsDir, 'to_northno1.md')),
      northno1Reply: safeReadText(path.join(paths.promptsDir, 'northno1_reply.txt')),
      forCodex: safeReadText(path.join(paths.promptsDir, 'for_codex.md')),
      forDeepSea: safeReadText(path.join(paths.promptsDir, 'for_deepsea.md')),
      deepseaReply: safeReadText(path.join(paths.promptsDir, 'deepsea_reply.txt')),
      noteForUser: safeReadText(path.join(paths.promptsDir, 'note_for_user.md')),
      requestForPipeline: safeReadText(path.join(paths.promptsDir, 'request_for_pipeline.md')),
      requestForPipelineJson: safeReadJson(path.join(paths.promptsDir, 'request_for_pipeline.json')),
      pipelineApiRequestsJson: safeReadJson(path.join(paths.promptsDir, 'pipeline_api_requests.json')),
      domSummary: safeReadText(path.join(paths.captureLatestDir, 'dom_summary.md'))
    },
    captureMeta
  };
}

function writeManualObservations(paths, patch = {}) {
  const target = path.join(paths.paperStateDir, 'manual_observations.json');
  const prev = safeReadJson(target) || {};
  const next = {
    ...prev,
    ...patch,
    updatedAt: nowIso(),
    paperId: paths.paperId
  };
  fs.writeFileSync(target, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function setChatgptWorkflowStatus(paths, patch) {
  updateStatus(paths, (s) => {
    s.running = false;
    if (patch.currentStep) {
      s.currentStep = patch.currentStep;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'lastError')) {
      s.lastError = patch.lastError;
    }
    if (patch.steps) {
      s.steps = {
        ...s.steps,
        ...patch.steps
      };
    }
  });
}

function listPaperIds() {
  const papersRoot = path.join(ROOT, 'papers');
  if (!fs.existsSync(papersRoot)) {
    return [DEFAULT_PAPER_ID];
  }

  const ids = fs.readdirSync(papersRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => sanitizePaperId(d.name));

  if (!ids.includes(DEFAULT_PAPER_ID)) {
    ids.push(DEFAULT_PAPER_ID);
  }

  return Array.from(new Set(ids)).sort();
}

function startCapture(paths, forceLogin) {
  if (runningJobs.has(paths.paperId)) {
    throw new Error(`Capture already running for ${paths.paperId}`);
  }
  if (runningChatgptJobs.has(paths.paperId)) {
    throw new Error(`NorthNo1 fetch/parse already running for ${paths.paperId}`);
  }

  updateStatus(paths, (s) => {
    s.running = true;
    s.currentStep = 'capture_running';
    s.lastError = null;
    s.steps.captureDone = false;
    s.steps.toNorthNo1Ready = false;
    s.steps.parseDone = false;
    s.logs = [];
  });

  appendLog(paths, `Starting capture: paper_id=${paths.paperId} force_login=${Boolean(forceLogin)}`);

  const args = [path.join(ROOT, 'run_capture.sh'), '--paper', paths.paperId];
  if (forceLogin) {
    args.push('--force-login');
  }

  const child = spawn('bash', args, {
    cwd: ROOT,
    env: process.env
  });

  runningJobs.set(paths.paperId, child);

  child.stdout.on('data', (chunk) => {
    const lines = String(chunk).split('\n').map((x) => x.trim()).filter(Boolean);
    for (const line of lines) {
      appendLog(paths, `[stdout] ${line}`);
    }
  });

  child.stderr.on('data', (chunk) => {
    const lines = String(chunk).split('\n').map((x) => x.trim()).filter(Boolean);
    for (const line of lines) {
      appendLog(paths, `[stderr] ${line}`);
    }
  });

  child.on('close', (code) => {
    runningJobs.delete(paths.paperId);

    if (code === 0) {
      const latestMeta = safeReadJson(path.join(paths.captureLatestDir, 'capture_meta.json'));
      updateStatus(paths, (s) => {
        s.running = false;
        s.currentStep = 'waiting_northno1_reply';
        s.steps.captureDone = true;
        s.steps.toNorthNo1Ready = true;
        s.lastCaptureRunDir = latestMeta?.captureRunDir || null;
        s.lastCaptureAt = latestMeta?.timestamp || nowIso();
      });
      appendLog(paths, 'Capture finished successfully. to_northno1.md is ready.');
      return;
    }

    updateStatus(paths, (s) => {
      s.running = false;
      s.currentStep = 'error';
      s.lastError = `capture exited with code ${code}`;
    });
    appendLog(paths, `Capture failed with exit code ${code}.`);
  });
}

function runParseReply(paths) {
  const replyPath = path.join(paths.promptsDir, 'northno1_reply.txt');
  if (!fs.existsSync(replyPath)) {
    throw new Error(`Missing reply file: ${relToRoot(replyPath)}`);
  }

  updateStatus(paths, (s) => {
    s.currentStep = 'parsing_reply';
    s.lastError = null;
  });
  appendLog(paths, 'Parsing NorthNo1 reply blocks...');

  const result = spawnSync(
    'node',
    ['scripts/parse_northno1_reply.js', '--paper', paths.paperId, '--input', relToRoot(replyPath)],
    {
      cwd: ROOT,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    const errText = (result.stderr || result.stdout || `exit=${result.status}`).trim();
    updateStatus(paths, (s) => {
      s.currentStep = 'error';
      s.lastError = errText;
      s.steps.parseDone = false;
    });
    appendLog(paths, `Parse failed: ${errText}`);
    throw new Error(errText);
  }

  const parseResultPath = path.join(paths.promptsDir, 'parse_result.json');
  const parseResult = safeReadJson(parseResultPath);
  const parseOk = parseResult?.ok !== false;

  updateStatus(paths, (s) => {
    s.currentStep = parseOk ? 'done' : 'parse_partial';
    s.steps.parseDone = parseOk;
    s.lastError = parseOk ? null : 'parse_result indicates missing core blocks';
  });
  appendLog(paths, 'Reply parsed: parse_result.json updated.');
  if (parseResult?.warnings?.length) {
    for (const w of parseResult.warnings.slice(0, 8)) {
      appendLog(paths, `[parse warning] ${w}`);
    }
  }
}

function readPromptPayload(paths) {
  return {
    paperId: paths.paperId,
    prompts: {
      objective: safeReadText(path.join(paths.promptsDir, 'objective.md')),
      toNorthNo1: safeReadText(path.join(paths.promptsDir, 'to_northno1.md')),
      forCodex: safeReadText(path.join(paths.promptsDir, 'for_codex.md')),
      forDeepSea: safeReadText(path.join(paths.promptsDir, 'for_deepsea.md')),
      deepseaReply: safeReadText(path.join(paths.promptsDir, 'deepsea_reply.txt')),
      noteForUser: safeReadText(path.join(paths.promptsDir, 'note_for_user.md')),
      requestForPipeline: safeReadText(path.join(paths.promptsDir, 'request_for_pipeline.md')),
      requestForPipelineJson: safeReadJson(path.join(paths.promptsDir, 'request_for_pipeline.json')),
      pipelineApiRequestsJson: safeReadJson(path.join(paths.promptsDir, 'pipeline_api_requests.json')),
      northno1Reply: safeReadText(path.join(paths.promptsDir, 'northno1_reply.txt'))
    },
    parseResult: safeReadJson(path.join(paths.promptsDir, 'parse_result.json')),
    pipelineState: readPipelineState(paths)
  };
}

function runNodeScript(scriptArgs, errPrefix) {
  const result = spawnSync('node', scriptArgs, {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    const errText = (result.stderr || result.stdout || `exit=${result.status}`).trim();
    throw new Error(`${errPrefix}: ${errText}`);
  }
  return {
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

function runBuildBundle(paths) {
  return runNodeScript(
    ['scripts/build_deepsea_bundle.js', '--paper', paths.paperId],
    'build bundle failed'
  );
}

function runBuildPostTestSummary(paths) {
  return runNodeScript(
    ['scripts/build_post_test_summary_message.js', '--paper', paths.paperId],
    'build post-test summary message failed'
  );
}

function runPushBundle(paths, body = {}) {
  const bundlePath = body.bundlePath
    ? path.resolve(String(body.bundlePath))
    : path.join(paths.handoffDir, 'for_deepsea.zip');
  return runDeepSeaAutomation(paths, {
    forceLogin: body.forceLogin,
    files: [bundlePath]
  }, 'upload_files');
}

function runGenerateTestImage(paths, body = {}) {
  const args = ['scripts/generate_test_image.js', '--paper', paths.paperId];
  if (String(body.text || '').trim()) {
    args.push('--text', String(body.text).trim());
  }
  const round = Number(body.round);
  if (Number.isFinite(round) && round > 0) {
    args.push('--round', String(Math.floor(round)));
  }
  if (String(body.output || '').trim()) {
    args.push('--output', String(body.output).trim());
  }
  return runNodeScript(args, 'generate test image failed');
}

function runChatgptSend(paths, body = {}) {
  const args = ['scripts/northno1_automation.js', '--paper', paths.paperId, '--action', 'send'];
  if (body.newChat) {
    args.push('--new-chat');
  }
  if (String(body.conversationId || '').trim()) {
    args.push('--conversation-id', String(body.conversationId).trim());
  }
  const pauseAfterOpenSeconds = Number(body.pauseAfterOpenSeconds);
  if (Number.isFinite(pauseAfterOpenSeconds) && pauseAfterOpenSeconds > 0) {
    args.push('--pause-after-open-seconds', String(Math.floor(pauseAfterOpenSeconds)));
  }
  if (body.composeOnly) {
    args.push('--compose-only');
  }
  if (Array.isArray(body.attachments)) {
    for (const item of body.attachments) {
      const raw = String(item || '').trim();
      if (raw) {
        args.push('--attachment', raw);
      }
    }
  }
  if (body.messagePath) {
    args.push('--message-file', String(body.messagePath));
  } else if (String(body.messageText || '').trim()) {
    const overridePath = path.join(paths.paperStateDir, 'northno1_message_override.txt');
    fs.writeFileSync(overridePath, String(body.messageText), 'utf8');
    args.push('--message-file', relToRoot(overridePath));
  }
  return runNodeScript(args, 'northno1 send failed');
}

function runChatgptNewChat(paths, body = {}) {
  const args = ['scripts/northno1_automation.js', '--paper', paths.paperId, '--action', 'new_chat'];
  if (String(body.conversationId || '').trim()) {
    args.push('--conversation-id', String(body.conversationId).trim());
  }
  if (body.messagePath) {
    args.push('--message-file', String(body.messagePath));
  } else if (String(body.messageText || '').trim()) {
    const overridePath = path.join(paths.paperStateDir, 'northno1_message_override.txt');
    fs.writeFileSync(overridePath, String(body.messageText), 'utf8');
    args.push('--message-file', relToRoot(overridePath));
  } else {
    throw new Error('northno1.new_chat requires messageText or messagePath');
  }
  if (Array.isArray(body.attachments)) {
    for (const item of body.attachments) {
      const raw = String(item || '').trim();
      if (raw) {
        args.push('--attachment', raw);
      }
    }
  }
  return runNodeScript(args, 'northno1 new_chat failed');
}

function performChatgptSend(paths, body = {}) {
  if (runningChatgptJobs.has(paths.paperId)) {
    throw new Error(`NorthNo1 fetch/parse already running for ${paths.paperId}`);
  }

  const cfg = loadPaperConfig(paths);
  const force = Boolean(body.force);
  const dryRun = Boolean(body.dryRun);
  const composeOnly = Boolean(body.composeOnly);
  const shouldGuardSend = !dryRun && !composeOnly;

  const throttle = shouldGuardSend
    ? checkChatgptSendThrottle(paths, cfg, force)
    : { allowed: true, waitSeconds: 0 };
  if (!throttle.allowed) {
    const err = new Error(`northno1-send throttled for safety. wait ${throttle.waitSeconds}s or pass {"force":true}`);
    err.statusCode = 429;
    err.waitSeconds = throttle.waitSeconds;
    throw err;
  }

  const inFlight = shouldGuardSend
    ? checkGlobalInFlightGuard(paths.paperId, force)
    : { allowed: true, reason: null };
  if (!inFlight.allowed) {
    const err = new Error(inFlight.reason);
    err.statusCode = 409;
    throw err;
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      paperId: paths.paperId,
      message: 'northno1-send guard passed (no message sent)'
    };
  }

  if (shouldGuardSend) {
    const guardStart = readSendGuard();
    guardStart.inFlight = true;
    guardStart.currentPaperId = paths.paperId;
    writeSendGuard(guardStart);
  }

  let output;
  try {
    output = runChatgptSend(paths, body);
  } catch (err) {
    setChatgptWorkflowStatus(paths, {
      currentStep: 'error',
      lastError: err.message
    });
    if (shouldGuardSend) {
      const guardFail = readSendGuard();
      guardFail.inFlight = false;
      guardFail.currentPaperId = null;
      writeSendGuard(guardFail);
    }
    throw err;
  }

  if (shouldGuardSend) {
    const guardDone = readSendGuard();
    guardDone.inFlight = true;
    guardDone.currentPaperId = paths.paperId;
    guardDone.lastSentPaperId = paths.paperId;
    guardDone.lastSentAt = new Date().toISOString();
    writeSendGuard(guardDone);
  }

  appendLog(paths, `NorthNo1 send executed via scoped API for ${paths.paperId}.`);
  setChatgptWorkflowStatus(paths, body.composeOnly
    ? {
      currentStep: 'northno1_composed',
      lastError: null,
      steps: {
        toNorthNo1Ready: true
      }
    }
    : {
      currentStep: 'waiting_northno1_reply',
      lastError: null,
      steps: {
        toNorthNo1Ready: true,
        replySaved: false,
        parseDone: false
      }
    });
  return {
    ok: true,
    output,
    northno1StatusPath: relToRoot(path.join(paths.paperStateDir, 'northno1_bridge_status.json'))
  };
}

function runChatgptFetchParse(paths, body = {}) {
  const waitSeconds = Number.isFinite(Number(body.waitSeconds))
    ? Math.max(0, Number(body.waitSeconds))
    : 1200;
  const pollSeconds = Number.isFinite(Number(body.pollSeconds))
    ? Math.max(1, Number(body.pollSeconds))
    : 300;
  const settleSeconds = Number.isFinite(Number(body.settleSeconds))
    ? Math.max(1, Number(body.settleSeconds))
    : 300;
  const maxWaitSeconds = Number.isFinite(Number(body.maxWaitSeconds))
    ? Math.max(10, Number(body.maxWaitSeconds))
    : 7200;

  const args = [
    'scripts/northno1_automation.js',
    '--paper', paths.paperId,
    '--action', 'fetch_parse',
    '--wait-seconds', String(waitSeconds),
    '--poll-seconds', String(pollSeconds),
    '--settle-seconds', String(settleSeconds),
    '--max-wait-seconds', String(maxWaitSeconds)
  ];
  if (String(body.conversationId || '').trim()) {
    args.push('--conversation-id', String(body.conversationId).trim());
  }
  if (body.skipParse) {
    args.push('--skip-parse');
  }
  if (String(body.replyFile || '').trim()) {
    args.push('--reply-file', String(body.replyFile).trim());
  }
  return runNodeScript(args, 'northno1 fetch/parse failed');
}

function normalizeDeepSeaResources(params = {}) {
  const out = [];

  const directResources = Array.isArray(params.resources) ? params.resources : [];
  for (const item of directResources) {
    const raw = String(item || '').trim();
    if (raw) out.push(raw);
  }

  if (params.currentFile) {
    out.push('current_file');
  }

  if (params.pdf) {
    out.push('pdf');
  }

  if (Array.isArray(params.files)) {
    for (const item of params.files) {
      const raw = String(item || '').trim();
      if (raw) out.push(`file:${raw}`);
    }
  }

  const parsedRequests = params.requests || {};
  if (parsedRequests.pdf) {
    out.push('pdf');
  }
  if (Array.isArray(parsedRequests.files)) {
    for (const item of parsedRequests.files) {
      const raw = String(item || '').trim();
      if (raw) out.push(`file:${raw}`);
    }
  }

  return Array.from(new Set(out.filter(Boolean)));
}

function runDeepSeaAutomation(paths, body = {}, action) {
  const args = ['scripts/deepsea_automation.js', '--paper', paths.paperId, '--action', action];

  if (body.forceLogin) {
    args.push('--force-login');
  }
  if (body.dryRun) {
    args.push('--dry-run');
  }

  if (action === 'download') {
    const resources = normalizeDeepSeaResources(body);
    for (const item of resources) {
      args.push('--resource', item);
    }
  } else if (action === 'upload_files') {
    const files = Array.isArray(body.files) ? body.files : [];
    for (const item of files) {
      const raw = String(item || '').trim();
      if (raw) {
        args.push('--file', raw);
      }
    }
  } else if (action === 'send') {
    if (body.composeOnly) {
      args.push('--compose-only');
    }
    if (body.allowUnready) {
      args.push('--allow-unready');
    }
    if (body.retryOnConversationError === false) {
      args.push('--no-retry-on-conversation-error');
    }
    const maxConversationErrorRetries = Number(body.maxConversationErrorRetries);
    if (Number.isFinite(maxConversationErrorRetries) && maxConversationErrorRetries >= 0) {
      args.push('--max-conversation-error-retries', String(Math.floor(maxConversationErrorRetries)));
    }
    if (body.messagePath) {
      args.push('--message-file', String(body.messagePath));
    } else if (String(body.messageText || '').trim()) {
      const overridePath = path.join(paths.paperStateDir, 'deepsea_message_override.txt');
      fs.writeFileSync(overridePath, String(body.messageText), 'utf8');
      args.push('--message-file', relToRoot(overridePath));
    }
  } else if (action === 'fetch_reply') {
    const waitSeconds = Number(body.waitSeconds);
    const pollSeconds = Number(body.pollSeconds);
    const settleSeconds = Number(body.settleSeconds);
    const maxWaitSeconds = Number(body.maxWaitSeconds);
    if (Number.isFinite(waitSeconds) && waitSeconds >= 0) {
      args.push('--wait-seconds', String(Math.floor(waitSeconds)));
    }
    if (Number.isFinite(pollSeconds) && pollSeconds > 0) {
      args.push('--poll-seconds', String(Math.floor(pollSeconds)));
    }
    if (Number.isFinite(settleSeconds) && settleSeconds > 0) {
      args.push('--settle-seconds', String(Math.floor(settleSeconds)));
    }
    if (Number.isFinite(maxWaitSeconds) && maxWaitSeconds > 0) {
      args.push('--max-wait-seconds', String(Math.floor(maxWaitSeconds)));
    }
  }

  return runNodeScript(args, `deepsea ${action} failed`);
}

function executeRequest(paths, request = {}) {
  const action = String(request.action || '').trim();
  const params = request.params || {};

  if (!action) {
    throw new Error('Missing request.action');
  }

  if (action === 'session.configure') {
    const manualPatch = {};
    if (Object.prototype.hasOwnProperty.call(params, 'userConfirmedReady')) {
      manualPatch.userConfirmedReady = Boolean(params.userConfirmedReady);
    }
    if (Object.prototype.hasOwnProperty.call(params, 'userConfirmedErrorBanner')) {
      manualPatch.userConfirmedErrorBanner = Boolean(params.userConfirmedErrorBanner);
    }
    if (typeof params.errorBannerText === 'string') {
      manualPatch.errorBannerText = String(params.errorBannerText).trim();
    }
    if (typeof params.note === 'string' && params.note.trim()) {
      manualPatch.note = String(params.note).trim();
    }
    if (Object.prototype.hasOwnProperty.call(params, 'userConfirmedMessageDelivered')) {
      manualPatch.userConfirmedMessageDelivered = Boolean(params.userConfirmedMessageDelivered);
    }
    const manualObservations = Object.keys(manualPatch).length ? writeManualObservations(paths, manualPatch) : null;
    return {
      ok: true,
      action,
      pipelineState: configurePipelineState(paths, params),
      manualObservations
    };
  }

  if (action === 'session.terminate') {
    return {
      ok: true,
      action,
      pipelineState: terminatePipeline(paths, {
        reason: params.reason,
        by: params.by || 'api'
      })
    };
  }

  if (action === 'deepsea.run.consume') {
    return {
      ok: true,
      action,
      pipelineState: consumeDeepSeaRun(paths, params)
    };
  }

  if (action === 'capture.run') {
    if (runningJobs.has(paths.paperId) || runningChatgptJobs.has(paths.paperId)) {
      throw new Error(`Another job is already running for ${paths.paperId}`);
    }
    startCapture(paths, Boolean(params.forceLogin));
    return { ok: true, started: true, action, paperId: paths.paperId };
  }

  if (action === 'reply.parse') {
    runParseReply(paths);
    return { ok: true, action, ...readPromptPayload(paths) };
  }

  if (action === 'bundle.build') {
    return {
      ok: true,
      action,
      output: runBuildBundle(paths),
      bundlePath: relToRoot(path.join(paths.handoffDir, 'for_deepsea.zip')),
      manifestPath: relToRoot(path.join(paths.handoffDir, 'bundle_manifest.json'))
    };
  }

  if (action === 'review.build_after_deepsea') {
    return {
      ok: true,
      action,
      output: runNodeScript(
        ['scripts/build_deepsea_review_message.js', '--paper', paths.paperId],
        'build DeepSea review message failed'
      ),
      messagePath: relToRoot(path.join(paths.promptsDir, 'to_northno1_after_deepsea.md'))
    };
  }

  if (action === 'review.build_post_test') {
    return {
      ok: true,
      action,
      output: runBuildPostTestSummary(paths),
      messagePath: relToRoot(path.join(paths.promptsDir, 'to_northno1_post_test.md'))
    };
  }

  if (action === 'deepsea.push_bundle') {
    const consumeRun = Boolean(params.consumeRun);
    let pipelineState = null;
    if (consumeRun) {
      const current = readPipelineState(paths);
      if (current.remainingDeepSeaRuns <= 0) {
        throw new Error(`DeepSea run budget exhausted for ${paths.paperId}`);
      }
    }
    if (consumeRun) {
      pipelineState = consumeDeepSeaRun(paths, {
        source: params.source || 'deepsea.push_bundle',
        note: params.note || '',
        bundlePath: params.bundlePath || ''
      });
    }
    return {
      ok: true,
      action,
      output: runPushBundle(paths, params),
      pipelineState,
      pushResultPath: relToRoot(path.join(paths.paperStateDir, 'deepsea_push_result.json'))
    };
  }

  if (action === 'deepsea.download') {
    return {
      ok: true,
      action,
      output: runDeepSeaAutomation(paths, params, 'download'),
      deepseaStatusPath: relToRoot(path.join(paths.paperStateDir, 'deepsea_bridge_status.json'))
    };
  }

  if (action === 'deepsea.list_files') {
    return {
      ok: true,
      action,
      output: runDeepSeaAutomation(paths, params, 'list_files'),
      deepseaStatusPath: relToRoot(path.join(paths.paperStateDir, 'deepsea_bridge_status.json')),
      fileTreePath: relToRoot(path.join(paths.paperStateDir, 'deepsea_file_tree_latest.json'))
    };
  }

  if (action === 'deepsea.upload_files') {
    return {
      ok: true,
      action,
      output: runDeepSeaAutomation(paths, params, 'upload_files'),
      deepseaStatusPath: relToRoot(path.join(paths.paperStateDir, 'deepsea_bridge_status.json')),
      uploadResultPath: relToRoot(path.join(paths.paperStateDir, 'deepsea_upload_result.json'))
    };
  }

  if (action === 'deepsea.inspect_chat') {
    return {
      ok: true,
      action,
      output: runDeepSeaAutomation(paths, params, 'inspect_chat'),
      deepseaStatusPath: relToRoot(path.join(paths.paperStateDir, 'deepsea_bridge_status.json')),
      inspectPath: relToRoot(path.join(paths.paperStateDir, 'deepsea_chat_inspect.json'))
    };
  }

  if (action === 'deepsea.send') {
    const consumeRun = Boolean(params.consumeRun);
    if (consumeRun) {
      const current = readPipelineState(paths);
      if (current.remainingDeepSeaRuns <= 0) {
        throw new Error(`DeepSea run budget exhausted for ${paths.paperId}`);
      }
    }

    const output = runDeepSeaAutomation(paths, params, 'send');
    const pipelineState = consumeRun
      ? consumeDeepSeaRun(paths, {
        source: params.source || 'deepsea.send',
        note: params.note || '',
        bundlePath: params.bundlePath || ''
      })
      : null;

    return {
      ok: true,
      action,
      output,
      pipelineState,
      deepseaStatusPath: relToRoot(path.join(paths.paperStateDir, 'deepsea_bridge_status.json'))
    };
  }

  if (action === 'deepsea.fetch_reply') {
    return {
      ok: true,
      action,
      output: runDeepSeaAutomation(paths, params, 'fetch_reply'),
      deepseaReplyPath: relToRoot(path.join(paths.promptsDir, 'deepsea_reply.txt')),
      deepseaStatusPath: relToRoot(path.join(paths.paperStateDir, 'deepsea_bridge_status.json'))
    };
  }

  if (action === 'asset.generate_test_image') {
    const output = runGenerateTestImage(paths, params);
    let result = null;
    try {
      result = JSON.parse(output.stdout || '{}');
    } catch (err) {
      result = null;
    }
    return {
      ok: true,
      action,
      output,
      result
    };
  }

  if (action === 'northno1.new_chat') {
    return {
      ok: true,
      action,
      output: runChatgptNewChat(paths, params),
      northno1StatusPath: relToRoot(path.join(paths.paperStateDir, 'northno1_bridge_status.json'))
    };
  }

  if (action === 'northno1.send' || action === 'northno1.compose') {
    const body = {
      ...params,
      composeOnly: action === 'northno1.compose' ? true : Boolean(params.composeOnly)
    };
    return { action, composeOnly: Boolean(body.composeOnly), ...performChatgptSend(paths, body) };
  }

  if (action === 'northno1.fetch_parse') {
    if (runningChatgptJobs.has(paths.paperId)) {
      throw new Error(`NorthNo1 fetch/parse already running for ${paths.paperId}`);
    }
    if (runningJobs.has(paths.paperId)) {
      throw new Error(`Capture already running for ${paths.paperId}`);
    }
    startChatgptFetchParse(paths, params);
    return {
      ok: true,
      started: true,
      action,
      paperId: paths.paperId,
      northno1StatusPath: relToRoot(path.join(paths.paperStateDir, 'northno1_bridge_status.json'))
    };
  }

  if (action === 'file.list') {
    return {
      ok: true,
      action,
      result: listFilesViaScope(paths, params)
    };
  }

  if (action === 'file.read') {
    return {
      ok: true,
      action,
      result: readFileViaScope(paths, params)
    };
  }

  throw new Error(`Unsupported request.action: ${action}`);
}

function startChatgptFetchParse(paths, body = {}) {
  if (runningChatgptJobs.has(paths.paperId)) {
    throw new Error(`NorthNo1 fetch/parse already running for ${paths.paperId}`);
  }
  if (runningJobs.has(paths.paperId)) {
    throw new Error(`Capture already running for ${paths.paperId}`);
  }

  const waitSeconds = Number.isFinite(Number(body.waitSeconds))
    ? Math.max(0, Number(body.waitSeconds))
    : 1200;
  const pollSeconds = Number.isFinite(Number(body.pollSeconds))
    ? Math.max(1, Number(body.pollSeconds))
    : 300;
  const settleSeconds = Number.isFinite(Number(body.settleSeconds))
    ? Math.max(1, Number(body.settleSeconds))
    : 300;
  const maxWaitSeconds = Number.isFinite(Number(body.maxWaitSeconds))
    ? Math.max(10, Number(body.maxWaitSeconds))
    : 7200;

  updateStatus(paths, (s) => {
    s.running = true;
    s.currentStep = 'northno1_fetch_running';
    s.lastError = null;
  });
  appendLog(
    paths,
    `Starting northno1-fetch-parse: paper_id=${paths.paperId} wait=${waitSeconds}s poll=${pollSeconds}s settle=${settleSeconds}s max_wait=${maxWaitSeconds}s`
  );

  const args = [
    'scripts/northno1_automation.js',
    '--paper', paths.paperId,
    '--action', 'fetch_parse',
    '--wait-seconds', String(waitSeconds),
    '--poll-seconds', String(pollSeconds),
    '--settle-seconds', String(settleSeconds),
    '--max-wait-seconds', String(maxWaitSeconds)
  ];
  if (body.skipParse) {
    args.push('--skip-parse');
  }
  if (String(body.replyFile || '').trim()) {
    args.push('--reply-file', String(body.replyFile).trim());
  }

  const child = spawn('node', args, {
    cwd: ROOT,
    env: process.env
  });

  runningChatgptJobs.set(paths.paperId, child);

  child.stdout.on('data', (chunk) => {
    const lines = String(chunk).split('\n').map((x) => x.trim()).filter(Boolean);
    for (const line of lines) {
      appendLog(paths, `[northno1 stdout] ${line}`);
    }
  });

  child.stderr.on('data', (chunk) => {
    const lines = String(chunk).split('\n').map((x) => x.trim()).filter(Boolean);
    for (const line of lines) {
      appendLog(paths, `[northno1 stderr] ${line}`);
    }
  });

  child.on('close', (code) => {
    runningChatgptJobs.delete(paths.paperId);

    if (code === 0) {
      const parseResult = safeReadJson(path.join(paths.promptsDir, 'parse_result.json'));
      const parseOk = parseResult?.ok !== false;

      updateStatus(paths, (s) => {
        s.running = false;
        s.currentStep = parseOk ? 'done' : 'parse_partial';
        s.steps.replySaved = true;
        s.steps.parseDone = parseOk;
        s.lastError = parseOk ? null : 'parse_result indicates missing core blocks';
      });

      const guardDone = readSendGuard();
      guardDone.inFlight = false;
      guardDone.currentPaperId = null;
      guardDone.lastReplyPaperId = paths.paperId;
      guardDone.lastReplyAt = new Date().toISOString();
      writeSendGuard(guardDone);

      appendLog(paths, `NorthNo1 fetch+parse finished for ${paths.paperId}.`);
      return;
    }

    updateStatus(paths, (s) => {
      s.running = false;
      s.currentStep = 'error';
      s.lastError = `northno1-fetch-parse exited with code ${code}`;
      s.steps.parseDone = false;
    });
    appendLog(paths, `NorthNo1 fetch+parse failed with exit code ${code}.`);
  });
}

function checkChatgptSendThrottle(paths, cfg, force) {
  if (force) {
    return { allowed: true, waitSeconds: 0 };
  }

  const minInterval = Number(cfg.northno1Automation?.minSendIntervalSeconds || 600);
  if (!Number.isFinite(minInterval) || minInterval <= 0) {
    return { allowed: true, waitSeconds: 0 };
  }

  const statusPath = path.join(paths.paperStateDir, 'northno1_bridge_status.json');
  if (!fs.existsSync(statusPath)) {
    return { allowed: true, waitSeconds: 0 };
  }

  const status = safeReadJson(statusPath);
  const lastSentAt = status?.lastSentAt ? Date.parse(status.lastSentAt) : NaN;
  if (!Number.isFinite(lastSentAt)) {
    return { allowed: true, waitSeconds: 0 };
  }

  const elapsedSec = Math.floor((Date.now() - lastSentAt) / 1000);
  const remain = minInterval - elapsedSec;
  if (remain > 0) {
    return { allowed: false, waitSeconds: remain };
  }

  return { allowed: true, waitSeconds: 0 };
}

function readSendGuard() {
  if (!fs.existsSync(CHATGPT_SEND_GUARD_PATH)) {
    return {
      inFlight: false,
      currentPaperId: null,
      lastSentPaperId: null,
      lastSentAt: null
    };
  }
  return safeReadJson(CHATGPT_SEND_GUARD_PATH) || {
    inFlight: false,
    currentPaperId: null,
    lastSentPaperId: null,
    lastSentAt: null
  };
}

function writeSendGuard(guard) {
  fs.mkdirSync(path.dirname(CHATGPT_SEND_GUARD_PATH), { recursive: true });
  fs.writeFileSync(CHATGPT_SEND_GUARD_PATH, JSON.stringify(guard, null, 2), 'utf8');
}

function checkGlobalInFlightGuard(paperId, force) {
  if (force) {
    return { allowed: true, reason: null };
  }

  const guard = readSendGuard();
  if (guard.inFlight && guard.currentPaperId) {
    return {
      allowed: false,
      reason: `global in-flight guard: waiting for reply of ${guard.currentPaperId}; fetch+parse it before sending another message`
    };
  }

  return { allowed: true, reason: null };
}

function updateConfig(paths, patch) {
  const cfg = loadPaperConfig(paths);
  const next = {
    ...cfg,
    paperId: paths.paperId,
    projectUrl: String(patch.projectUrl || cfg.projectUrl || '').trim(),
    baseUrl: String(patch.baseUrl || cfg.baseUrl || '').trim(),
    loginSuccessSelector: String(patch.loginSuccessSelector ?? cfg.loginSuccessSelector ?? '').trim(),
    stateMode: String(patch.stateMode || cfg.stateMode || 'global').trim(),
    capture: {
      ...(cfg.capture || {}),
      ...(patch.capture || {})
    }
  };

  fs.writeFileSync(paths.configPath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function paperScopeRoots(paths) {
  return {
    paper_root: paths.paperRoot,
    prompts: paths.promptsDir,
    captures_latest: paths.captureLatestDir,
    captures_history: paths.captureHistoryDir,
    state: paths.paperStateDir,
    handoff: paths.handoffDir,
    downloads: paths.downloadsDir
  };
}

function resolveScopeRoot(paths, scopeInput) {
  const scope = String(scopeInput || 'paper_root').trim() || 'paper_root';
  const root = paperScopeRoots(paths)[scope];
  if (!root) {
    throw new Error(`Unknown scope: ${scope}`);
  }
  return { scope, root };
}

function resolvePathWithin(root, relPathInput) {
  const relPath = String(relPathInput || '').trim();
  const abs = relPath ? path.resolve(root, relPath) : root;
  const normalizedRoot = path.resolve(root);
  if (abs !== normalizedRoot && !abs.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Path escapes scope root: ${relPath}`);
  }
  return abs;
}

function listFilesUnder(absRoot, baseRoot, recursive, limit) {
  const entries = [];
  const stack = [absRoot];

  while (stack.length > 0 && entries.length < limit) {
    const current = stack.pop();
    const children = fs.readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (entries.length >= limit) {
        break;
      }
      const abs = path.join(current, child.name);
      const st = fs.statSync(abs);
      entries.push({
        path: path.relative(baseRoot, abs),
        type: child.isDirectory() ? 'dir' : 'file',
        size: child.isDirectory() ? null : st.size,
        mtime: st.mtime.toISOString()
      });
      if (recursive && child.isDirectory()) {
        stack.push(abs);
      }
    }
  }

  return entries;
}

function listFilesViaScope(paths, params = {}) {
  const { scope, root } = resolveScopeRoot(paths, params.scope);
  const abs = resolvePathWithin(root, params.path);
  if (!fs.existsSync(abs)) {
    throw new Error(`Directory not found: ${path.relative(paths.ROOT, abs)}`);
  }

  const st = fs.statSync(abs);
  if (!st.isDirectory()) {
    throw new Error(`Not a directory: ${path.relative(paths.ROOT, abs)}`);
  }

  const recursive = params.recursive !== false;
  const limitRaw = Number(params.limit || 200);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 200;

  return {
    scope,
    basePath: path.relative(root, abs) || '.',
    recursive,
    limit,
    entries: listFilesUnder(abs, root, recursive, limit)
  };
}

function readFileViaScope(paths, params = {}) {
  const { scope, root } = resolveScopeRoot(paths, params.scope);
  const abs = resolvePathWithin(root, params.path);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${path.relative(paths.ROOT, abs)}`);
  }

  const st = fs.statSync(abs);
  if (!st.isFile()) {
    throw new Error(`Not a file: ${path.relative(paths.ROOT, abs)}`);
  }

  const format = String(params.format || 'text').trim().toLowerCase();
  const payload = {
    scope,
    path: path.relative(root, abs),
    fullPath: relToRoot(abs),
    size: st.size,
    mtime: st.mtime.toISOString(),
    format
  };

  if (format === 'meta') {
    return payload;
  }
  if (format === 'json') {
    payload.content = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return payload;
  }
  if (format === 'base64') {
    payload.contentBase64 = fs.readFileSync(abs).toString('base64');
    return payload;
  }

  payload.content = fs.readFileSync(abs, 'utf8');
  return payload;
}

function serveStatic(req, res, pathname) {
  const map = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/app.js': 'app.js',
    '/styles.css': 'styles.css'
  };

  if (!map[pathname]) {
    sendText(res, 404, 'Not Found');
    return;
  }

  const filePath = path.join(WEB_DIR, map[pathname]);
  if (!fs.existsSync(filePath)) {
    sendText(res, 404, 'Missing static file');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const ctype = ext === '.html'
    ? 'text/html; charset=utf-8'
    : ext === '.js'
      ? 'application/javascript; charset=utf-8'
      : 'text/css; charset=utf-8';

  sendText(res, 200, fs.readFileSync(filePath, 'utf8'), ctype);
}

async function handleApi(req, res, pathname, query) {
  if (req.method === 'GET' && pathname === '/api/northno1-send-guard') {
    sendJson(res, 200, readSendGuard());
    return;
  }

  const scopedPaperMatch = pathname.match(/^\/api\/papers\/([^/]+)(?:\/(.*))?$/);
  if (scopedPaperMatch) {
    const paperId = sanitizePaperId(scopedPaperMatch[1]);
    const subPath = `/${scopedPaperMatch[2] || ''}`.replace(/\/+$/, '') || '/';
    const paths = ensurePaperReady(paperId);

    if (req.method === 'GET' && (subPath === '/' || subPath === '/context')) {
      sendJson(res, 200, readPaperContext(paths));
      return;
    }

    if (req.method === 'GET' && subPath === '/status') {
      sendJson(res, 200, {
        paperId: paths.paperId,
        status: readStatus(paths),
        deepseaStatus: safeReadJson(path.join(paths.paperStateDir, 'deepsea_bridge_status.json')),
        northno1Status: safeReadJson(path.join(paths.paperStateDir, 'northno1_bridge_status.json')),
        manualObservations: safeReadJson(path.join(paths.paperStateDir, 'manual_observations.json')),
        running: runningJobs.has(paths.paperId) || runningChatgptJobs.has(paths.paperId)
      });
      return;
    }

    if (req.method === 'GET' && subPath === '/config') {
      sendJson(res, 200, {
        paperId: paths.paperId,
        config: loadPaperConfig(paths)
      });
      return;
    }

    if (req.method === 'GET' && subPath === '/prompts') {
      sendJson(res, 200, readPromptPayload(paths));
      return;
    }

    if (req.method === 'GET' && subPath === '/pipeline-state') {
      sendJson(res, 200, {
        paperId: paths.paperId,
        pipelineState: readPipelineState(paths)
      });
      return;
    }

    if (req.method === 'GET' && subPath === '/capabilities') {
      sendJson(res, 200, {
        paperId: paths.paperId,
        pipelineOnlyAcceptsJson: true,
        statusFields: {
          deepsea: ['replyCaptureMode', 'uploadActionSucceeded', 'uploadTextuallyConfirmed', 'filesPanelReady', 'filesPanelTreeReady', 'filesPanelAddButtonEnabled', 'workspaceVisible', 'chatComposerReady', 'chatHistoryTraceable', 'expectedMessageTraceable', 'conversationProcessingError'],
          northno1: ['attachmentCount', 'attachmentsUploaded', 'attachmentsVerified', 'attachmentUploadMethod']
        },
        actions: [
          'session.configure',
          'session.terminate',
          'deepsea.run.consume',
          'capture.run',
          'reply.parse',
          'bundle.build',
          'review.build_after_deepsea',
          'review.build_post_test',
          'deepsea.push_bundle',
          'deepsea.list_files',
          'deepsea.download',
          'deepsea.upload_files',
          'deepsea.inspect_chat',
          'deepsea.send',
          'deepsea.fetch_reply',
          'asset.generate_test_image',
          'northno1.send',
          'northno1.new_chat',
          'northno1.compose',
          'northno1.fetch_parse',
          'file.list',
          'file.read'
        ],
        sessionConfigureFields: ['userConfirmedReady', 'userConfirmedErrorBanner', 'errorBannerText', 'userConfirmedMessageDelivered', 'note']
      });
      return;
    }

    if (req.method === 'GET' && subPath === '/files') {
      sendJson(res, 200, {
        paperId: paths.paperId,
        ...listFilesViaScope(paths, {
          scope: query.get('scope') || 'paper_root',
          path: query.get('path') || '',
          recursive: query.get('recursive') !== 'false',
          limit: query.get('limit') || 200
        })
      });
      return;
    }

    if (req.method === 'GET' && subPath === '/file') {
      sendJson(res, 200, {
        paperId: paths.paperId,
        ...readFileViaScope(paths, {
          scope: query.get('scope') || 'paper_root',
          path: query.get('path') || '',
          format: query.get('format') || 'text'
        })
      });
      return;
    }

    if (req.method === 'GET' && subPath === '/northno1-status') {
      sendJson(res, 200, {
        paperId: paths.paperId,
        northno1Status: safeReadJson(path.join(paths.paperStateDir, 'northno1_bridge_status.json'))
      });
      return;
    }

    if (req.method === 'GET' && subPath === '/deepsea-status') {
      sendJson(res, 200, {
        paperId: paths.paperId,
        deepseaStatus: safeReadJson(path.join(paths.paperStateDir, 'deepsea_bridge_status.json'))
      });
      return;
    }

    if (req.method === 'POST' && subPath === '/objective') {
      const body = await readBody(req);
      const objective = String(body.objective || '').trim();
      const objectivePath = path.join(paths.promptsDir, 'objective.md');
      fs.writeFileSync(objectivePath, `${objective}\n`, 'utf8');
      updateStatus(paths, (s) => {
        s.currentStep = 'objective_saved';
        s.steps.objectiveSaved = Boolean(objective);
        s.lastError = null;
      });
      appendLog(paths, 'Objective saved via scoped API.');
      sendJson(res, 200, { ok: true, objectivePath: relToRoot(objectivePath) });
      return;
    }

    if (req.method === 'POST' && subPath === '/pipeline-state') {
      const body = await readBody(req);
      sendJson(res, 200, {
        ok: true,
        paperId: paths.paperId,
        pipelineState: configurePipelineState(paths, body)
      });
      return;
    }

    if (req.method === 'POST' && subPath === '/reply') {
      const body = await readBody(req);
      const reply = String(body.reply || '');
      const parseNow = body.parseNow !== false;
      const replyPath = path.join(paths.promptsDir, 'northno1_reply.txt');
      fs.writeFileSync(replyPath, reply, 'utf8');
      updateStatus(paths, (s) => {
        s.currentStep = 'reply_saved';
        s.steps.replySaved = reply.trim().length > 0;
        s.lastError = null;
      });
      appendLog(paths, `Reply saved via scoped API: ${relToRoot(replyPath)}`);
      if (parseNow) {
        runParseReply(paths);
      }
      sendJson(res, 200, { ok: true, parsed: parseNow, ...readPromptPayload(paths) });
      return;
    }

    if (req.method === 'POST' && subPath === '/actions/run-capture') {
      const body = await readBody(req);
      if (runningJobs.has(paths.paperId) || runningChatgptJobs.has(paths.paperId)) {
        sendJson(res, 409, { ok: false, error: `Another job is already running for ${paths.paperId}` });
        return;
      }
      startCapture(paths, Boolean(body.forceLogin));
      sendJson(res, 200, { ok: true, started: true, paperId: paths.paperId });
      return;
    }

    if (req.method === 'POST' && subPath === '/actions/parse-reply') {
      runParseReply(paths);
      sendJson(res, 200, { ok: true, ...readPromptPayload(paths) });
      return;
    }

    if (req.method === 'POST' && subPath === '/actions/execute-request') {
      const body = await readBody(req);
      sendJson(res, 200, executeRequest(paths, body.request || body));
      return;
    }

    if (req.method === 'POST' && subPath === '/actions/execute-requests') {
      const body = await readBody(req);
      const requests = Array.isArray(body.requests) ? body.requests : [];
      const results = requests.map((request) => executeRequest(paths, request));
      sendJson(res, 200, {
        ok: true,
        paperId: paths.paperId,
        count: results.length,
        results
      });
      return;
    }

    if (req.method === 'POST' && subPath === '/actions/build-bundle') {
      const output = runBuildBundle(paths);
      appendLog(paths, `DeepSea bundle built via scoped API for ${paths.paperId}.`);
      sendJson(res, 200, {
        ok: true,
        output,
        bundlePath: relToRoot(path.join(paths.paperRoot, 'handoff', 'for_deepsea.zip')),
        manifestPath: relToRoot(path.join(paths.paperRoot, 'handoff', 'bundle_manifest.json'))
      });
      return;
    }

    if (req.method === 'POST' && subPath === '/actions/push-deepsea') {
      const body = await readBody(req);
      const output = runPushBundle(paths, body);
      appendLog(paths, `DeepSea push executed via scoped API for ${paths.paperId}.`);
      sendJson(res, 200, {
        ok: true,
        output,
        pushResultPath: relToRoot(path.join(paths.paperStateDir, 'deepsea_push_result.json'))
      });
      return;
    }

    if (req.method === 'POST' && subPath === '/actions/northno1-send') {
      const body = await readBody(req);
      try {
        sendJson(res, 200, performChatgptSend(paths, body));
      } catch (err) {
        sendJson(res, err.statusCode || 500, {
          ok: false,
          error: err.message,
          waitSeconds: err.waitSeconds
        });
      }
      return;
    }

    if (req.method === 'POST' && subPath === '/actions/northno1-fetch-parse') {
      const body = await readBody(req);
      if (runningChatgptJobs.has(paths.paperId)) {
        sendJson(res, 409, { ok: false, error: `NorthNo1 fetch/parse already running for ${paths.paperId}` });
        return;
      }
      if (runningJobs.has(paths.paperId)) {
        sendJson(res, 409, { ok: false, error: `Capture already running for ${paths.paperId}` });
        return;
      }
      const guard = readSendGuard();
      const force = Boolean(body.force);
      if (!force && guard.inFlight && guard.currentPaperId && guard.currentPaperId !== paths.paperId) {
        sendJson(res, 409, {
          ok: false,
          error: `in-flight message belongs to ${guard.currentPaperId}; fetch-parse that paper first`
        });
        return;
      }
      startChatgptFetchParse(paths, body);
      sendJson(res, 200, {
        ok: true,
        started: true,
        paperId: paths.paperId,
        northno1StatusPath: relToRoot(path.join(paths.paperStateDir, 'northno1_bridge_status.json'))
      });
      return;
    }

    sendJson(res, 404, { error: `Unknown paper-scoped endpoint: ${subPath}` });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/papers') {
    const papers = listPaperIds().map((paperId) => {
      const paths = ensurePaperReady(paperId);
      const ctx = readPaperContext(paths);
      return {
        paperId,
        projectUrl: ctx.config.projectUrl,
        stateMode: ctx.config.stateMode || 'global',
        currentStep: ctx.status.currentStep,
        running: ctx.status.running,
        hasToNorthNo1: Boolean(ctx.files.toNorthNo1),
        hasReply: Boolean(ctx.files.northno1Reply),
        hasParsed: Boolean(ctx.files.forCodex && ctx.files.forDeepSea)
      };
    });

    sendJson(res, 200, { papers, defaultPaperId: DEFAULT_PAPER_ID });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/context') {
    const paper = sanitizePaperId(query.get('paper') || DEFAULT_PAPER_ID);
    const paths = ensurePaperReady(paper);
    sendJson(res, 200, readPaperContext(paths));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/init-paper') {
    const body = await readBody(req);
    const paths = ensurePaperReady(body.paperId || DEFAULT_PAPER_ID);
    appendLog(paths, 'Paper initialized from web console.');
    sendJson(res, 200, { ok: true, paperId: paths.paperId, configPath: relToRoot(paths.configPath) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/save-config') {
    const body = await readBody(req);
    const paths = ensurePaperReady(body.paperId || DEFAULT_PAPER_ID);
    const cfg = updateConfig(paths, body);
    appendLog(paths, 'Paper config updated from web console.');
    sendJson(res, 200, { ok: true, config: cfg });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/save-objective') {
    const body = await readBody(req);
    const paths = ensurePaperReady(body.paperId || DEFAULT_PAPER_ID);
    const objective = String(body.objective || '').trim();

    const objectivePath = path.join(paths.promptsDir, 'objective.md');
    fs.writeFileSync(objectivePath, `${objective}\n`, 'utf8');

    updateStatus(paths, (s) => {
      s.currentStep = 'objective_saved';
      s.steps.objectiveSaved = Boolean(objective);
      s.lastError = null;
    });
    appendLog(paths, 'Objective saved to prompts/objective.md');

    sendJson(res, 200, { ok: true, objectivePath: relToRoot(objectivePath) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/run-capture') {
    const body = await readBody(req);
    const paths = ensurePaperReady(body.paperId || DEFAULT_PAPER_ID);

    if (runningJobs.has(paths.paperId) || runningChatgptJobs.has(paths.paperId)) {
      sendJson(res, 409, { ok: false, error: `Another job is already running for ${paths.paperId}` });
      return;
    }

    startCapture(paths, Boolean(body.forceLogin));
    sendJson(res, 200, { ok: true, started: true, paperId: paths.paperId });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/save-reply') {
    const body = await readBody(req);
    const paths = ensurePaperReady(body.paperId || DEFAULT_PAPER_ID);
    const reply = String(body.reply || '');

    const replyPath = path.join(paths.promptsDir, 'northno1_reply.txt');
    fs.writeFileSync(replyPath, reply, 'utf8');

    updateStatus(paths, (s) => {
      s.currentStep = 'reply_saved';
      s.steps.replySaved = reply.trim().length > 0;
      s.lastError = null;
    });
    appendLog(paths, `NorthNo1 reply saved: ${relToRoot(replyPath)}`);

    sendJson(res, 200, { ok: true, replyPath: relToRoot(replyPath) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/parse-reply') {
    const body = await readBody(req);
    const paths = ensurePaperReady(body.paperId || DEFAULT_PAPER_ID);
    runParseReply(paths);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'Unknown API endpoint' });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (parsed.pathname.startsWith('/api/')) {
      await handleApi(req, res, parsed.pathname, parsed.searchParams);
      return;
    }

    serveStatic(req, res, parsed.pathname);
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Web console running at http://127.0.0.1:${PORT}`);
});

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  DEFAULT_PAPER_ID,
  sanitizePaperId,
  paperPaths,
  ensurePaperLayout,
  loadPaperConfig,
  relToRoot
} = require('./paper_paths');

function parseArgs(argv) {
  const out = {
    paper: DEFAULT_PAPER_ID,
    action: 'send',
    composeOnly: false,
    conversationId: '',
    messageText: '',
    messageFile: '',
    attachments: [],
    replyFile: '',
    skipParse: false,
    waitSeconds: 0,
    pollSeconds: 30,
    settleSeconds: 45,
    maxWaitSeconds: 1800
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--paper' && argv[i + 1]) {
      out.paper = argv[i + 1]; i += 1;
    } else if (arg === '--action' && argv[i + 1]) {
      out.action = argv[i + 1]; i += 1;
    } else if (arg === '--compose-only') {
      out.composeOnly = true;
    } else if ((arg === '--conversation-id' || arg === '--thread-id') && argv[i + 1]) {
      out.conversationId = String(argv[i + 1]); i += 1;
    } else if (arg === '--message-text' && argv[i + 1]) {
      out.messageText = String(argv[i + 1]); i += 1;
    } else if (arg === '--message-file' && argv[i + 1]) {
      out.messageFile = String(argv[i + 1]); i += 1;
    } else if (arg === '--attachment' && argv[i + 1]) {
      out.attachments.push(String(argv[i + 1])); i += 1;
    } else if (arg === '--reply-file' && argv[i + 1]) {
      out.replyFile = String(argv[i + 1]); i += 1;
    } else if (arg === '--skip-parse') {
      out.skipParse = true;
    } else if (arg === '--wait-seconds' && argv[i + 1]) {
      out.waitSeconds = Number(argv[i + 1]); i += 1;
    } else if (arg === '--poll-seconds' && argv[i + 1]) {
      out.pollSeconds = Number(argv[i + 1]); i += 1;
    } else if (arg === '--settle-seconds' && argv[i + 1]) {
      out.settleSeconds = Number(argv[i + 1]); i += 1;
    } else if (arg === '--max-wait-seconds' && argv[i + 1]) {
      out.maxWaitSeconds = Number(argv[i + 1]); i += 1;
    }
  }

  out.paper = sanitizePaperId(out.paper);
  return out;
}

function writeStatus(paths, patch) {
  const target = path.join(paths.paperStateDir, 'northno1_bridge_status.json');
  const prev = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
  const next = {
    ...prev,
    ...patch,
    paperId: paths.paperId,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(target, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function resolvePathLike(paths, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return path.isAbsolute(raw) ? raw : path.resolve(paths.ROOT, raw);
}

function getByPath(obj, pathExpr) {
  if (!pathExpr) return undefined;
  return String(pathExpr).split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function ensureApiConfig(paths, cfg) {
  const api = cfg.northno1Api || {};
  if (!api.baseUrl || !api.sendPath) {
    throw new Error(`Missing northno1Api.baseUrl/sendPath in ${relToRoot(paths.configPath)}`);
  }
  return {
    baseUrl: String(api.baseUrl).replace(/\/$/, ''),
    sendPath: String(api.sendPath),
    fetchPathTemplate: String(api.fetchPathTemplate || '').trim(),
    method: String(api.method || 'POST').toUpperCase(),
    fetchMethod: String(api.fetchMethod || 'GET').toUpperCase(),
    apiKeyEnv: String(api.apiKeyEnv || 'NORTHNO1_API_KEY').trim(),
    authHeader: String(api.authHeader || 'Authorization').trim(),
    authScheme: String(api.authScheme || 'Bearer').trim(),
    model: String(api.model || '').trim(),
    requestIdField: String(api.requestIdField || 'requestId').trim(),
    conversationIdField: String(api.conversationIdField || 'conversationId').trim(),
    replyTextField: String(api.replyTextField || 'reply.text').trim(),
    statusField: String(api.statusField || 'status').trim(),
    completedStatuses: Array.isArray(api.completedStatuses) ? api.completedStatuses : ['completed', 'done', 'succeeded'],
    pendingStatuses: Array.isArray(api.pendingStatuses) ? api.pendingStatuses : ['queued', 'running', 'processing'],
    failedStatuses: Array.isArray(api.failedStatuses) ? api.failedStatuses : ['failed', 'error'],
    extraBody: api.extraBody && typeof api.extraBody === 'object' ? api.extraBody : {}
  };
}

function authHeaders(apiCfg) {
  const headers = { 'Content-Type': 'application/json' };
  const key = process.env[apiCfg.apiKeyEnv];
  if (key) {
    headers[apiCfg.authHeader] = apiCfg.authScheme ? `${apiCfg.authScheme} ${key}` : key;
  }
  return headers;
}

function attachmentPayload(paths, files) {
  return files.map((file) => {
    const abs = resolvePathLike(paths, file);
    const stat = fs.statSync(abs);
    return {
      path: relToRoot(abs),
      name: path.basename(abs),
      sizeBytes: stat.size
    };
  });
}

function resolveMessage(paths, args) {
  if (String(args.messageText || '').trim()) return String(args.messageText).trim();
  if (String(args.messageFile || '').trim()) {
    return readText(resolvePathLike(paths, args.messageFile)).trim();
  }
  const fallback = path.join(paths.promptsDir, 'to_northno1.md');
  if (fs.existsSync(fallback)) return readText(fallback).trim();
  throw new Error('Missing messageText/messageFile and prompts/to_northno1.md does not exist');
}

async function postJson(url, method, headers, body) {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (err) {
    parsed = { rawText: text };
  }
  if (!res.ok) {
    throw new Error(`NorthNo1 API ${method} ${url} failed: ${res.status} ${res.statusText}`);
  }
  return parsed || {};
}

function buildFetchUrl(apiCfg, state) {
  if (!apiCfg.fetchPathTemplate) {
    throw new Error('northno1Api.fetchPathTemplate is required for fetch_parse');
  }
  const template = apiCfg.fetchPathTemplate
    .replace('{conversationId}', encodeURIComponent(String(state.conversationId || '')))
    .replace('{requestId}', encodeURIComponent(String(state.requestId || '')));
  return `${apiCfg.baseUrl}${template}`;
}

async function actionCompose(paths, cfg, args) {
  const message = resolveMessage(paths, args);
  const attachments = attachmentPayload(paths, args.attachments || []);
  const preview = {
    action: 'compose',
    composeOnly: true,
    conversationId: args.conversationId || null,
    message,
    attachments,
    model: cfg.northno1Api?.model || null
  };
  writeStatus(paths, {
    status: 'composed',
    composeOnly: true,
    attachmentCount: attachments.length,
    attachmentsVerified: attachments.map((item) => item.name),
    lastPreview: preview
  });
  return preview;
}

async function actionSend(paths, cfg, args, forceNewConversation) {
  const apiCfg = ensureApiConfig(paths, cfg);
  const message = resolveMessage(paths, args);
  const attachments = attachmentPayload(paths, args.attachments || []);
  const body = {
    ...apiCfg.extraBody,
    paperId: paths.paperId,
    model: apiCfg.model || undefined,
    message,
    attachments,
    conversationId: forceNewConversation ? undefined : (args.conversationId || undefined),
    newConversation: Boolean(forceNewConversation)
  };
  const url = `${apiCfg.baseUrl}${apiCfg.sendPath}`;
  const response = await postJson(url, apiCfg.method, authHeaders(apiCfg), body);
  const conversationId = getByPath(response, apiCfg.conversationIdField) || args.conversationId || null;
  const requestId = getByPath(response, apiCfg.requestIdField) || null;
  const status = String(getByPath(response, apiCfg.statusField) || 'submitted');
  writeStatus(paths, {
    status: forceNewConversation ? 'new_conversation_sent' : 'sent',
    requestStatus: status,
    conversationId,
    requestId,
    composeOnly: false,
    attachmentCount: attachments.length,
    attachmentsVerified: attachments.map((item) => item.name),
    lastResponse: response
  });
  return { ok: true, status, conversationId, requestId, response };
}

async function actionFetchParse(paths, cfg, args) {
  const apiCfg = ensureApiConfig(paths, cfg);
  const current = JSON.parse(fs.readFileSync(path.join(paths.paperStateDir, 'northno1_bridge_status.json'), 'utf8'));
  const startedAt = Date.now();
  let lastPayload = null;
  let settledAt = 0;
  while ((Date.now() - startedAt) / 1000 < args.maxWaitSeconds) {
    if (args.waitSeconds > 0 && !lastPayload) {
      await new Promise((r) => setTimeout(r, args.waitSeconds * 1000));
    }
    const payload = await postJson(buildFetchUrl(apiCfg, current), apiCfg.fetchMethod, authHeaders(apiCfg));
    lastPayload = payload;
    const status = String(getByPath(payload, apiCfg.statusField) || '').toLowerCase();
    const replyText = String(getByPath(payload, apiCfg.replyTextField) || '').trim();
    const isDone = apiCfg.completedStatuses.includes(status) || (replyText && !apiCfg.pendingStatuses.includes(status));
    const isFailed = apiCfg.failedStatuses.includes(status);
    if (isFailed) {
      writeStatus(paths, { status: 'fetch_failed', requestStatus: status, lastResponse: payload });
      throw new Error(`NorthNo1 API returned failed status: ${status}`);
    }
    if (isDone) {
      if (!settledAt) {
        settledAt = Date.now();
      }
      if ((Date.now() - settledAt) / 1000 >= args.settleSeconds) {
        const replyPath = resolvePathLike(paths, args.replyFile || path.join(paths.promptsDir, 'northno1_reply.txt'));
        fs.writeFileSync(replyPath, replyText, 'utf8');
        writeStatus(paths, {
          status: 'reply_saved',
          requestStatus: status,
          replyFile: relToRoot(replyPath),
          lastResponse: payload
        });
        if (!args.skipParse) {
          const parsed = spawnSync(process.execPath, ['scripts/parse_northno1_reply.js', '--paper', paths.paperId, '--input', relToRoot(replyPath)], {
            cwd: paths.ROOT,
            encoding: 'utf8'
          });
          if (parsed.status !== 0) {
            throw new Error(parsed.stderr || parsed.stdout || 'parse_northno1_reply failed');
          }
        }
        return { ok: true, status, replyFile: relToRoot(replyPath), payload };
      }
    } else {
      settledAt = 0;
    }
    await new Promise((r) => setTimeout(r, args.pollSeconds * 1000));
  }
  throw new Error('NorthNo1 fetch_parse timed out');
}

async function main() {
  const args = parseArgs(process.argv);
  const paths = paperPaths(args.paper);
  ensurePaperLayout(paths);
  const cfg = loadPaperConfig(paths);

  let output;
  if (args.action === 'compose' || args.composeOnly) {
    output = await actionCompose(paths, cfg, args);
  } else if (args.action === 'send') {
    output = await actionSend(paths, cfg, args, false);
  } else if (args.action === 'new_chat') {
    if (!String(args.messageText || args.messageFile || '').trim()) {
      throw new Error('northno1.new_chat requires the first message. Pass messageText or messageFile.');
    }
    output = await actionSend(paths, cfg, args, true);
  } else if (args.action === 'fetch_parse') {
    output = await actionFetchParse(paths, cfg, args);
  } else {
    throw new Error(`Unsupported action: ${args.action}`);
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});

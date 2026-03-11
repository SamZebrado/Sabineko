'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  chromium = null;
}

function requirePlaywright() {
  if (!chromium) {
    throw new Error('Playwright is optional but required for browser automation actions. Run npm install and npx playwright install chromium.');
  }
  return chromium;
}
const {
  DEFAULT_PAPER_ID,
  sanitizePaperId,
  paperPaths,
  ensurePaperLayout,
  loadPaperConfig,
  resolveStorageStatePath,
  relToRoot,
  timestampTag
} = require('./paper_paths');

const DEFAULT_INPUT_SELECTORS = [
  'textarea[aria-label*="Enter prompt"]',
  'textarea[placeholder*="Enter prompt"]',
  'textarea[placeholder*="Message"]',
  '[contenteditable="true"][aria-label*="Enter prompt"]',
  '[contenteditable="true"][role="textbox"]',
  'textarea'
];

const DEFAULT_SEND_SELECTORS = [
  'role=button[name="Send"]',
  'button[aria-label="Send"]',
  'button:has-text("Send")'
];

const DEFAULT_ASSISTANT_SELECTORS = [
  '[data-message-author-role="assistant"]',
  '[data-testid*="assistant"]',
  '[aria-label*="Assistant"]',
  '[class*="assistant"]',
  'article'
];

const DEFAULT_STOP_SELECTORS = [
  'button[aria-label*="Stop"]',
  'button[data-testid*="stop"]',
  'button:has-text("Stop")'
];

const DEFAULT_INITIALIZING_SELECTORS = [
  'button:has-text("Initializing")',
  '[role="button"]:has-text("Initializing")'
];

const DEFAULT_READY_SELECTORS = [
  'main',
  '.monaco-editor',
  '[class*="monaco-editor"]',
  '[aria-label="Download PDF"]',
  '[aria-label="More options"]'
];

const DEFAULT_PDF_DOWNLOAD_SELECTORS = [
  'button[aria-label="Download PDF"]',
  '[aria-label="Download PDF"]',
  '[title="Download PDF"]',
  'button:has-text("Download PDF")'
];

const DEFAULT_CURRENT_FILE_DOWNLOAD_SELECTORS = [
  'button[aria-label="Download file"]',
  '[aria-label="Download file"]',
  '[title="Download file"]',
  '[role="menuitem"]:has-text("Download file")',
  'button:has-text("Download file")'
];

const DEFAULT_MORE_OPTIONS_SELECTORS = [
  'role=button[name="More options"]',
  'button[aria-label="More options"]',
  '[aria-label="More options"]',
  '[title="More options"]',
  'button:has-text("More options")'
];

const DEFAULT_FILES_TAB_SELECTORS = [
  'role=tab[name="Files"]',
  'role=button[name="Files"]',
  '[role="tab"]:has-text("Files")',
  'button:has-text("Files")',
  'text=Files'
];

const DEFAULT_CHATS_TAB_SELECTORS = [
  'role=tab[name="Chats"]',
  'role=button[name="Chats"]',
  '[role="tab"]:has-text("Chats")',
  'button:has-text("Chats")',
  'text=Chats'
];

const DEFAULT_CONTEXT_MENU_DOWNLOAD_SELECTORS = [
  'role=menuitem[name="Download file"]',
  '[role="menuitem"]:has-text("Download file")',
  'button:has-text("Download file")',
  'text=/^Download file$/i',
  'text=Download file'
];

const DEFAULT_EXPAND_FOLDER_SELECTORS = [
  '[aria-label="Expand folder"]',
  'button[aria-label="Expand folder"]',
  'text=Expand folder'
];

const DEFAULT_ADD_FILE_SELECTORS = [
  '[aria-label="Add file or folder"]',
  'button[aria-label="Add file or folder"]',
  'text=Add file or folder'
];

const DEFAULT_UPLOAD_MENU_SELECTORS = [
  '[role="menuitem"]:has-text("Upload file")',
  '[role="menuitem"]:has-text("Upload")',
  'button:has-text("Upload file")',
  'button:has-text("Upload")',
  'text=Upload file',
  'text=Import file',
  'text=From computer'
];

const DEFAULT_TREE_ITEM_SELECTORS = [
  '[role="treeitem"]',
  '.monaco-list-row',
  '[data-testid*="tree"] [role="button"]',
  '[data-testid*="file"]'
];

const DEFAULT_FILE_SEARCH_INPUT_SELECTORS = [
  'input[aria-label*="Search"]',
  'input[placeholder*="Search"]',
  'input[type="search"]'
];

const DEFAULT_NEW_CHAT_SELECTORS = [
  'button[aria-label="New chat tab"]',
  'button[aria-label="New chat"]',
  '[role="button"]:has-text("New chat")',
  'button:has-text("New chat")',
  'text=New chat'
];

const TEXT_DOWNLOAD_EXTENSIONS = new Set([
  '.tex', '.md', '.txt', '.bib', '.csv', '.tsv', '.json', '.yaml', '.yml',
  '.xml', '.html', '.js', '.ts', '.jsx', '.tsx', '.py', '.r', '.m',
  '.sh', '.css', '.svg'
]);

function parseArgs(argv) {
  const out = {
    paper: DEFAULT_PAPER_ID,
    action: 'download',
    resources: [],
    files: [],
    dryRun: false,
    forceLogin: false,
    composeOnly: false,
    waitSeconds: 0,
    pollSeconds: 300,
    settleSeconds: 300,
    maxWaitSeconds: 7200,
    messageText: '',
    messageFile: '',
    allowUnready: false,
    retryOnConversationError: true,
    maxConversationErrorRetries: 1
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--paper' && argv[i + 1]) {
      out.paper = argv[i + 1];
      i += 1;
    } else if (arg === '--action' && argv[i + 1]) {
      out.action = argv[i + 1];
      i += 1;
    } else if (arg === '--resource' && argv[i + 1]) {
      out.resources.push(String(argv[i + 1]));
      i += 1;
    } else if (arg === '--file' && argv[i + 1]) {
      out.files.push(String(argv[i + 1]));
      i += 1;
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    } else if (arg === '--force-login') {
      out.forceLogin = true;
    } else if (arg === '--compose-only') {
      out.composeOnly = true;
    } else if (arg === '--wait-seconds' && argv[i + 1]) {
      out.waitSeconds = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--poll-seconds' && argv[i + 1]) {
      out.pollSeconds = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--settle-seconds' && argv[i + 1]) {
      out.settleSeconds = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--max-wait-seconds' && argv[i + 1]) {
      out.maxWaitSeconds = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--message-text' && argv[i + 1]) {
      out.messageText = String(argv[i + 1]);
      i += 1;
    } else if (arg === '--message-file' && argv[i + 1]) {
      out.messageFile = String(argv[i + 1]);
      i += 1;
    } else if (arg === '--allow-unready') {
      out.allowUnready = true;
    } else if (arg === '--no-retry-on-conversation-error') {
      out.retryOnConversationError = false;
    } else if (arg === '--max-conversation-error-retries' && argv[i + 1]) {
      out.maxConversationErrorRetries = Number(argv[i + 1]);
      i += 1;
    }
  }

  out.paper = sanitizePaperId(out.paper);
  if (!Number.isFinite(out.waitSeconds) || out.waitSeconds < 0) out.waitSeconds = 0;
  if (!Number.isFinite(out.pollSeconds) || out.pollSeconds <= 0) out.pollSeconds = 300;
  if (!Number.isFinite(out.settleSeconds) || out.settleSeconds <= 0) out.settleSeconds = 300;
  if (!Number.isFinite(out.maxWaitSeconds) || out.maxWaitSeconds <= 0) out.maxWaitSeconds = 7200;
  if (!Number.isFinite(out.maxConversationErrorRetries) || out.maxConversationErrorRetries < 0) out.maxConversationErrorRetries = 1;
  return out;
}

function askEnter(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, () => {
      rl.close();
      resolve();
    });
  });
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function resolvePathLike(paths, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(paths.ROOT, raw);
}

function unique(list) {
  return Array.from(new Set((list || []).filter(Boolean)));
}

function normalizeInlineText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function referencedUploadedBasenames(content, uploadedFiles) {
  const text = String(content || '');
  const basenames = unique((uploadedFiles || []).map((item) => path.basename(String(item || ''))).filter(Boolean));
  return basenames.filter((name) => text.includes(name));
}

function randomIntBetween(min, max) {
  const lo = Math.ceil(Number(min));
  const hi = Math.floor(Number(max));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return Math.max(0, lo || 0);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function classifyDeepSeaSendStatus(acceptance) {
  if (!acceptance) {
    return {
      status: 'send_failed',
      sent: false,
      pageReadyAndTraceable: false,
      likelyDeliveredButUntraceable: false
    };
  }
  if (acceptance.conversationProcessingError?.detected) {
    return {
      status: 'conversation_processing_error',
      sent: false,
      pageReadyAndTraceable: false,
      likelyDeliveredButUntraceable: false
    };
  }
  if (acceptance.accepted) {
    return {
      status: acceptance.confirmedLate ? 'sent_confirmed_late' : 'sent',
      sent: true,
      pageReadyAndTraceable: true,
      likelyDeliveredButUntraceable: false
    };
  }
  if (acceptance.likelyDeliveredButUntraceable) {
    return {
      status: 'send_likely_delivered_but_untraceable',
      sent: true,
      pageReadyAndTraceable: false,
      likelyDeliveredButUntraceable: true
    };
  }
  return {
    status: 'send_unconfirmed',
    sent: false,
    pageReadyAndTraceable: false,
    likelyDeliveredButUntraceable: false
  };
}

function ensureStatusPath(paths) {
  ensurePaperLayout(paths);
  return path.join(paths.paperStateDir, 'deepsea_bridge_status.json');
}

function writeStatus(paths, patch) {
  const p = ensureStatusPath(paths);
  const prev = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  const next = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
    paperId: paths.paperId
  };
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function readStatus(paths) {
  const p = ensureStatusPath(paths);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    return {};
  }
}

async function pickLocator(page, selectors) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.count() > 0) {
        return { selector, locator };
      }
    } catch (err) {
      // continue
    }
  }
  return null;
}

async function locatorIsActionable(locator, requireEnabled = true) {
  try {
    const count = await locator.count();
    if (count === 0) return false;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) return false;
    const box = await locator.boundingBox().catch(() => null);
    if (!box || box.width < 2 || box.height < 2) return false;
    if (!requireEnabled) return true;
    return await locator.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const ariaHidden = (el.getAttribute('aria-hidden') || '').toLowerCase();
      const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
      return !disabled
        && ariaHidden !== 'true'
        && style.pointerEvents !== 'none'
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    }).catch(() => false);
  } catch (err) {
    return false;
  }
}

async function pickActionableLocator(page, selectors, options = {}) {
  const maxCount = Math.max(1, Number(options.maxCount || 12));
  const requireEnabled = options.requireEnabled !== false;
  for (const selector of selectors) {
    try {
      const items = page.locator(selector);
      const count = Math.min(await items.count(), maxCount);
      for (let i = 0; i < count; i += 1) {
        const locator = items.nth(i);
        if (await locatorIsActionable(locator, requireEnabled)) {
          return { selector, locator, index: i };
        }
      }
    } catch (err) {
      // continue
    }
  }
  return null;
}

function safeHost(urlLike) {
  try {
    return new URL(String(urlLike || '')).host.toLowerCase();
  } catch (err) {
    return '';
  }
}

function safeUrl(urlLike) {
  try {
    return new URL(String(urlLike || ''));
  } catch (err) {
    return null;
  }
}

function normalizedUrlNoHash(urlLike) {
  const parsed = safeUrl(urlLike);
  if (!parsed) return '';
  parsed.hash = '';
  return parsed.toString();
}

function deepseaProjectKey(urlLike) {
  const parsed = safeUrl(urlLike);
  if (!parsed) return '';
  return String(parsed.searchParams.get('u') || '').trim();
}

function deepseaPageScore(pageUrl, targetUrl) {
  const normalizedPage = normalizedUrlNoHash(pageUrl);
  const normalizedTarget = normalizedUrlNoHash(targetUrl);
  if (!normalizedPage) return -1;
  if (normalizedPage === normalizedTarget) return 100;

  const pageParsed = safeUrl(pageUrl);
  const targetParsed = safeUrl(targetUrl);
  if (!pageParsed || !targetParsed) return -1;

  const pageProjectKey = deepseaProjectKey(pageUrl);
  const targetProjectKey = deepseaProjectKey(targetUrl);
  if (pageProjectKey && targetProjectKey && pageProjectKey === targetProjectKey) {
    const sameFile = String(pageParsed.searchParams.get('m') || '') === String(targetParsed.searchParams.get('m') || '');
    return sameFile ? 90 : 80;
  }

  if (pageParsed.host === targetParsed.host && pageParsed.pathname === targetParsed.pathname) {
    return 60;
  }

  if (/deepsea\.openai\.com/i.test(pageParsed.host) && pageParsed.host === targetParsed.host) {
    return 40;
  }

  if (/deepsea\.openai\.com/i.test(pageParsed.host)) {
    return 20;
  }

  return -1;
}

async function pickPageForTarget(context, targetUrl) {
  const pages = context.pages();
  let best = null;
  let bestScore = -1;
  for (const candidate of pages) {
    const score = deepseaPageScore(candidate.url(), targetUrl);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best && bestScore >= 0) {
    return best;
  }

  const blankLike = pages.find((p) => {
    const u = String(p.url() || '');
    return u === '' || u === 'about:blank' || /^chrome:\/\/newtab\/?$/i.test(u);
  });
  if (blankLike) return blankLike;

  return context.newPage();
}

function nextRefreshDelayMs(minMs, maxMs, previousDelayMs) {
  const safeMin = Math.max(31000, Number(minMs) || 31000);
  const safeMax = Math.max(safeMin, Number(maxMs) || 35000);
  if (safeMax === safeMin) {
    return safeMin === previousDelayMs ? safeMin + 1000 : safeMin;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = safeMin + Math.floor(Math.random() * (safeMax - safeMin + 1));
    if (candidate !== previousDelayMs) {
      return candidate;
    }
  }
  return previousDelayMs === safeMin ? safeMax : safeMin;
}

async function waitForDeepSeaReady(page, opts) {
  const start = Date.now();
  let refreshCount = 0;
  let lastRefreshAt = null;
  let lastRefreshDelayMs = null;
  let currentRefreshDelayMs = nextRefreshDelayMs(opts.readyRefreshMinMs, opts.readyRefreshMaxMs, null);
  let nextRefreshDueAt = start + currentRefreshDelayMs;
  let last = {
    ready: false,
    challengeDetected: false,
    matchedSelector: null,
    title: '',
    url: '',
    waitedMs: 0
  };

  while (Date.now() - start <= opts.readyTimeoutMs) {
    const title = await page.title().catch(() => '');
    const url = page.url();
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const lowerTitle = String(title || '').toLowerCase();
    const lowerBody = String(bodyText || '').toLowerCase();
    const challengeDetected = [
      'just a moment',
      'checking your browser',
      'attention required'
    ].some((x) => lowerTitle.includes(x)) || [
      'cloudflare',
      'verify you are human',
      'captcha'
    ].some((x) => lowerBody.includes(x));
    const sandboxNotConnectedDetected = [
      'project sandbox is not connected yet',
      'sandbox is not connected'
    ].some((x) => lowerBody.includes(x));
    const gettingReadyDetected = lowerBody.includes('getting ready...');
    const loadingDetected = /\bloading\.\.\./i.test(bodyText);
    const askAnythingDetected = lowerBody.includes('ask anything');
    const sendAgainDetected = lowerBody.includes('send again');
    const redErrorDetected = [
      'something went wrong',
      'retry',
      'failed',
      'error'
    ].some((x) => lowerBody.includes(x));

    let matchedSelector = null;
    for (const selector of opts.readySelectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.count() > 0) {
          const visible = await locator.isVisible().catch(() => true);
          if (visible) {
            matchedSelector = selector;
            break;
          }
        }
      } catch (err) {
        // continue
      }
    }

    let initializingVisible = false;
    for (const selector of DEFAULT_INITIALIZING_SELECTORS) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.count() > 0) {
          const visible = await locator.isVisible().catch(() => true);
          if (visible) {
            initializingVisible = true;
            break;
          }
        }
      } catch (err) {
        // continue
      }
    }

    const ready = !challengeDetected
      && !initializingVisible
      && !gettingReadyDetected
      && !loadingDetected
      && /deepsea\.openai\.com/i.test(url)
      && Boolean(matchedSelector || /deepsea/i.test(title))
      && (askAnythingDetected || matchedSelector !== null);
    last = {
      ready,
      challengeDetected,
      initializingVisible,
      sandboxNotConnectedDetected,
      gettingReadyDetected,
      loadingDetected,
      askAnythingDetected,
      sendAgainDetected,
      redErrorDetected,
      matchedSelector,
      title,
      url,
      waitedMs: Date.now() - start,
      refreshCount,
      lastRefreshAt,
      lastRefreshDelayMs
    };
    if (ready) return last;

    const needsRecoveryRefresh = !challengeDetected && (initializingVisible || sandboxNotConnectedDetected || gettingReadyDetected);
    if (needsRecoveryRefresh && refreshCount < opts.readyRefreshMaxCount && Date.now() >= nextRefreshDueAt) {
      try {
        await page.reload({ waitUntil: opts.waitUntil, timeout: opts.timeoutMs });
      } catch (err) {
        await page.goto(opts.projectUrl, { waitUntil: opts.waitUntil, timeout: opts.timeoutMs }).catch(() => {});
      }
      refreshCount += 1;
      lastRefreshAt = new Date().toISOString();
      lastRefreshDelayMs = currentRefreshDelayMs;
      currentRefreshDelayMs = nextRefreshDelayMs(opts.readyRefreshMinMs, opts.readyRefreshMaxMs, lastRefreshDelayMs);
      nextRefreshDueAt = Date.now() + currentRefreshDelayMs;
      continue;
    }

    await page.waitForTimeout(opts.readyPollMs);
  }

  return last;
}

async function maybeManualLogin(page, context, opts, storageStatePath, forceLogin) {
  if (opts.authMode === 'persistent_profile') {
    if (!forceLogin) return false;
    await page.goto(opts.baseUrl || opts.projectUrl, { waitUntil: opts.waitUntil, timeout: opts.timeoutMs });
    if (process.stdin.isTTY) {
      await askEnter('Complete DeepSea login/challenge, then press Enter... ');
    } else {
      await page.waitForTimeout(15000);
    }
    return true;
  }

  if (forceLogin || !fs.existsSync(storageStatePath)) {
    await page.goto(opts.baseUrl || opts.projectUrl, { waitUntil: opts.waitUntil, timeout: opts.timeoutMs });
    if (process.stdin.isTTY) {
      await askEnter('Complete DeepSea login, then press Enter... ');
    } else {
      await page.waitForTimeout(15000);
    }
    await context.storageState({ path: storageStatePath });
    return true;
  }

  return false;
}

function parseConfig(paths) {
  const cfg = loadPaperConfig(paths);
  const deepsea = cfg.deepseaAutomation || {};
  const capture = cfg.capture || {};
  const authMode = String(cfg.authMode || 'storage_state').toLowerCase();

  const projectUrl = String(cfg.projectUrl || '').trim();
  if (!projectUrl || projectUrl.includes('https://deepsea.example.com/project')) {
    throw new Error(`Missing projectUrl in ${relToRoot(paths.configPath)}`);
  }

  return {
    cfg,
    deepsea,
    authMode,
    projectUrl,
    baseUrl: String(cfg.baseUrl || '').trim(),
    timeoutMs: Number(capture.timeoutMs || 45000),
    waitUntil: String(capture.waitUntil || 'domcontentloaded'),
    readyTimeoutMs: Number(capture.deepseaReadyTimeoutMs || 90000),
    readyPollMs: Number(capture.deepseaReadyPollMs || 2000),
    readyRefreshMinMs: Math.max(31000, Number(capture.deepseaReadyRefreshMinMs || deepsea.readyRefreshMinMs || 31000)),
    readyRefreshMaxMs: Math.max(31000, Number(capture.deepseaReadyRefreshMaxMs || deepsea.readyRefreshMaxMs || 35000)),
    readyRefreshMaxCount: Math.max(0, Number(capture.deepseaReadyRefreshMaxCount || deepsea.readyRefreshMaxCount || 2)),
    inputSelectors: unique([deepsea.chatInputSelector, ...DEFAULT_INPUT_SELECTORS].filter(Boolean).map(String)),
    sendSelectors: unique([deepsea.chatSendButtonSelector, ...DEFAULT_SEND_SELECTORS].filter(Boolean).map(String)),
    assistantSelectors: unique([deepsea.assistantMessageSelector, ...DEFAULT_ASSISTANT_SELECTORS].filter(Boolean).map(String)),
    stopSelectors: unique([deepsea.stopButtonSelector, ...DEFAULT_STOP_SELECTORS].filter(Boolean).map(String)),
    readySelectors: unique([deepsea.projectReadySelector, ...(Array.isArray(capture.deepseaReadySelectors) ? capture.deepseaReadySelectors : []), ...DEFAULT_READY_SELECTORS].filter(Boolean).map(String)),
    pdfDownloadSelectors: unique([...(Array.isArray(capture.pdfDownloadSelectors) ? capture.pdfDownloadSelectors : []), deepsea.pdfDownloadSelector, ...DEFAULT_PDF_DOWNLOAD_SELECTORS].filter(Boolean).map(String)),
    currentFileDownloadSelectors: unique([deepsea.currentFileDownloadSelector, deepsea.downloadFileMenuSelector, ...DEFAULT_CURRENT_FILE_DOWNLOAD_SELECTORS].filter(Boolean).map(String)),
    moreOptionsSelectors: unique([deepsea.moreOptionsSelector, ...DEFAULT_MORE_OPTIONS_SELECTORS].filter(Boolean).map(String)),
    filesTabSelectors: unique([deepsea.filesTabSelector, ...DEFAULT_FILES_TAB_SELECTORS].filter(Boolean).map(String)),
    chatsTabSelectors: unique([deepsea.chatsTabSelector, ...DEFAULT_CHATS_TAB_SELECTORS].filter(Boolean).map(String)),
    contextMenuDownloadSelectors: unique([deepsea.contextMenuDownloadSelector, ...DEFAULT_CONTEXT_MENU_DOWNLOAD_SELECTORS].filter(Boolean).map(String)),
    expandFolderSelectors: unique([deepsea.expandFolderSelector, ...DEFAULT_EXPAND_FOLDER_SELECTORS].filter(Boolean).map(String)),
    addFileSelectors: unique([deepsea.addFileSelector, ...DEFAULT_ADD_FILE_SELECTORS].filter(Boolean).map(String)),
    uploadInputSelectors: unique([deepsea.uploadInputSelector, 'input[type="file"]'].filter(Boolean).map(String)),
    uploadMenuSelectors: unique([deepsea.uploadMenuSelector, ...DEFAULT_UPLOAD_MENU_SELECTORS].filter(Boolean).map(String)),
    newChatSelectors: unique([deepsea.newChatSelector, ...DEFAULT_NEW_CHAT_SELECTORS].filter(Boolean).map(String)),
    treeItemSelectors: unique([...(Array.isArray(deepsea.fileTreeItemSelectors) ? deepsea.fileTreeItemSelectors : []), deepsea.fileTreeItemSelector, ...DEFAULT_TREE_ITEM_SELECTORS].filter(Boolean).map(String)),
    fileSearchInputSelectors: unique([...(Array.isArray(deepsea.fileSearchInputSelectors) ? deepsea.fileSearchInputSelectors : []), deepsea.fileSearchInputSelector, ...DEFAULT_FILE_SEARCH_INPUT_SELECTORS].filter(Boolean).map(String)),
    sidebarMaxX: Number(deepsea.sidebarMaxX || 460),
    maxTreeExpandPasses: Number(deepsea.maxTreeExpandPasses || 6),
    treeScanLimit: Number(deepsea.treeScanLimit || 400),
    cdpUrl: String(deepsea.cdpUrl || cfg.persistentProfile?.cdpUrl || capture.cdpUrl || cfg.northno1Automation?.cdpUrl || '').trim(),
    userDataDir: String(deepsea.userDataDir || cfg.persistentProfile?.userDataDir || '').trim(),
    profileName: String(deepsea.profileName || cfg.persistentProfile?.profileName || '').trim(),
    browserChannel: String(deepsea.browserChannel || cfg.persistentProfile?.browserChannel || 'chrome').trim()
  };
}

async function createSession(opts, storageStatePath) {
  if (opts.authMode === 'persistent_profile') {
    if (!opts.userDataDir) {
      throw new Error('Missing persistentProfile.userDataDir for DeepSea automation');
    }
    if (!opts.profileName) {
      throw new Error('Missing persistentProfile.profileName for DeepSea automation');
    }

    if (opts.cdpUrl) {
      const cdpBrowser = await requirePlaywright().connectOverCDP(opts.cdpUrl);
      const context = cdpBrowser.contexts()[0];
      if (!context) {
        await cdpBrowser.close().catch(() => {});
        throw new Error(`CDP connected but no browser context found at ${opts.cdpUrl}`);
      }
      return { browser: null, context, cdpBrowser, sessionKind: 'persistent_profile_cdp' };
    }

    const context = await requirePlaywright().launchPersistentContext(opts.userDataDir, {
      headless: false,
      acceptDownloads: true,
      channel: opts.browserChannel,
      ignoreDefaultArgs: ['--use-mock-keychain'],
      args: [`--profile-directory=${opts.profileName}`, '--new-window']
    });
    return { browser: null, context, cdpBrowser: null, sessionKind: 'persistent_profile_launch' };
  }

  const browser = await requirePlaywright().launch({ headless: false });
  const context = await browser.newContext({
    acceptDownloads: true,
    storageState: fs.existsSync(storageStatePath) ? storageStatePath : undefined
  });
  return { browser, context, cdpBrowser: null, sessionKind: 'storage_state' };
}

async function ensureProjectPage(page, context, opts, storageStatePath, forceLogin) {
  await maybeManualLogin(page, context, opts, storageStatePath, forceLogin);
  if (page.url() !== opts.projectUrl) {
    await page.goto(opts.projectUrl, { waitUntil: opts.waitUntil, timeout: opts.timeoutMs });
  }
  const readiness = await waitForDeepSeaReady(page, opts);
  return readiness;
}

function resolveMessageContent(paths, args) {
  if (String(args.messageText || '').trim()) {
    return String(args.messageText).trim();
  }
  if (String(args.messageFile || '').trim()) {
    const messageFile = resolvePathLike(paths, args.messageFile);
    if (!fs.existsSync(messageFile)) {
      throw new Error(`Message file not found: ${relToRoot(messageFile)}`);
    }
    const content = readText(messageFile).trim();
    if (!content) {
      throw new Error(`Message file is empty: ${relToRoot(messageFile)}`);
    }
    return content;
  }
  const forDeepSeaPath = path.join(paths.promptsDir, 'for_deepsea.md');
  if (!fs.existsSync(forDeepSeaPath)) {
    throw new Error(`Missing for_deepsea.md: ${relToRoot(forDeepSeaPath)}`);
  }
  const content = readText(forDeepSeaPath).trim();
  if (!content) {
    throw new Error('for_deepsea.md is empty');
  }
  return content;
}

function normalizeResourceSpec(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (/^pdf$/i.test(text)) return { kind: 'pdf', key: 'pdf' };
  if (/^current_file$/i.test(text)) return { kind: 'current_file', key: 'current_file' };
  const m = text.match(/^file\s*:\s*(.+)$/i);
  if (m) {
    const reqPath = m[1].trim().replace(/^\/+/, '');
    if (!reqPath) return null;
    return { kind: 'file', path: reqPath, key: `file:${reqPath}` };
  }
  return { kind: 'unknown', raw: text, key: `unknown:${text}` };
}

function parseResources(args) {
  const raw = args.resources.length > 0 ? args.resources : ['pdf'];
  return unique(raw.map(normalizeResourceSpec).filter(Boolean).map((item) => JSON.stringify(item))).map((item) => JSON.parse(item));
}

function resolveUploadFiles(paths, args) {
  const normalized = [];
  for (const item of args.files || []) {
    const abs = resolvePathLike(paths, item);
    if (!abs || !fs.existsSync(abs)) {
      throw new Error(`Upload file not found: ${item}`);
    }
    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
      throw new Error(`Upload path is not a file: ${item}`);
    }
    normalized.push(abs);
  }
  return unique(normalized);
}

function currentFileFromUrl(urlLike) {
  try {
    const url = new URL(String(urlLike || ''));
    return String(url.searchParams.get('m') || '').trim();
  } catch (err) {
    return '';
  }
}

function normalizeRequestedPath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

function requestedBasename(value) {
  return path.posix.basename(normalizeRequestedPath(value));
}

function sameRequestedFile(a, b) {
  const left = normalizeRequestedPath(a).toLowerCase();
  const right = normalizeRequestedPath(b).toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes('/') || right.includes('/')) {
    return right.endsWith(`/${left}`) || left.endsWith(`/${right}`);
  }
  return requestedBasename(left) === requestedBasename(right);
}

function shouldAcceptSuggestedFilename(expectedBasename, suggestedFilename) {
  if (!expectedBasename) return true;
  const expected = requestedBasename(expectedBasename).toLowerCase();
  const suggested = requestedBasename(suggestedFilename).toLowerCase();
  if (!expected || !suggested) return false;
  return expected === suggested;
}

async function ensureVisible(locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  return locator.isVisible().catch(() => true);
}

async function clickAndWaitForDownload(page, selector, savePath, timeoutMs, expectedBasename, notes) {
  const picked = await pickActionableLocator(page, [selector], { maxCount: 20 });
  if (!picked) return null;
  const locator = picked.locator;
  const visible = await ensureVisible(locator);
  if (!visible) return null;

  const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs }).catch(() => null);
  await locator.click({ timeout: Math.min(timeoutMs, 5000) });
  const download = await downloadPromise;
  if (!download) return null;

  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  await download.saveAs(savePath);
  const suggestedFilename = download.suggestedFilename();
  if (!shouldAcceptSuggestedFilename(expectedBasename, suggestedFilename)) {
    notes.push(`download filename mismatch via ${selector}: expected ${expectedBasename}, got ${suggestedFilename}`);
    fs.rmSync(savePath, { force: true });
    return null;
  }
  return {
    selector,
    suggestedFilename,
    savePath
  };
}

async function tryDownloadViaSelectors(page, selectors, savePath, timeoutMs, notes, expectedBasename) {
  for (const selector of selectors) {
    try {
      const result = await clickAndWaitForDownload(page, selector, savePath, timeoutMs, expectedBasename, notes);
      if (result) return result;
    } catch (err) {
      notes.push(`download selector failed (${selector}): ${err.message}`);
    }
  }
  return null;
}

async function openMoreOptionsAndDownload(page, opts, savePath, timeoutMs, notes, expectedBasename) {
  for (const moreSelector of opts.moreOptionsSelectors) {
    try {
      const picked = await pickActionableLocator(page, [moreSelector], { maxCount: 12 });
      if (!picked) continue;
      const button = picked.locator;
      const visible = await ensureVisible(button);
      if (!visible) continue;
      await button.click({ timeout: Math.min(timeoutMs, 5000) });
      const result = await tryDownloadViaSelectors(page, opts.currentFileDownloadSelectors, savePath, timeoutMs, notes, expectedBasename);
      if (result) {
        return {
          ...result,
          viaMoreOptions: moreSelector
        };
      }
      await page.keyboard.press('Escape').catch(() => {});
    } catch (err) {
      notes.push(`more options selector failed (${moreSelector}): ${err.message}`);
    }
  }
  return null;
}

function extractItemLabel(text) {
  return normalizeInlineText(text);
}

function isTextLikeDownloadPath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return TEXT_DOWNLOAD_EXTENSIONS.has(ext);
}

function inferTreeEntryKind(entry) {
  if (entry.expanded === 'true' || entry.expanded === 'false') return 'folder';
  if (entry.label.includes('.')) return 'file';
  return 'unknown';
}

function annotateTreePaths(entries) {
  const stack = [];
  return entries.map((entry) => {
    const kind = inferTreeEntryKind(entry);
    while (stack.length > entry.depth) {
      stack.pop();
    }
    const parentParts = stack.slice(0, entry.depth).filter(Boolean);
    const fullPath = [...parentParts, entry.label].filter(Boolean).join('/');
    if (kind === 'folder') {
      stack[entry.depth] = entry.label;
      stack.length = entry.depth + 1;
    }
    return {
      ...entry,
      kind,
      fullPath
    };
  });
}

function isLikelySidebarEntry(entry, opts) {
  if (!entry || !entry.label) return false;
  if (!Number.isFinite(entry.x) || entry.x > opts.sidebarMaxX) return false;
  const lower = entry.label.toLowerCase();
  if ([
    'files',
    'chats',
    'search',
    'editor content',
    'expand folder',
    'add file or folder',
    'new chat tab',
    'thinking: low'
  ].includes(lower)) {
    return false;
  }
  return true;
}

function mergeTreeEntries(lists) {
  const out = [];
  const seen = new Set();
  for (const entries of lists) {
    for (const entry of entries || []) {
      const key = [
        normalizeRequestedPath(entry.fullPath || entry.label || ''),
        entry.kind || entry.type || '',
        entry.depth
      ].join('@@');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  out.sort((a, b) => (a.depth - b.depth) || String(a.fullPath || a.label).localeCompare(String(b.fullPath || b.label)) || (a.y - b.y));
  return out;
}

async function ensureFilesTab(page, opts) {
  return ensureSidebarTab(page, opts, 'Files', opts.filesTabSelectors, async () => hasVisibleFilesTree(page, opts));
}

async function ensureChatsTab(page, opts) {
  return ensureSidebarTab(page, opts, 'Chats', opts.chatsTabSelectors, async () => hasVisibleChatsPanel(page, opts));
}

async function hasVisibleFilesTree(page, opts) {
  const tree = await pickSidebarScopedLocator(page, ['[role="tree"]'], opts, { maxCount: 4, maxY: 3400 });
  if (tree) {
    return true;
  }
  const items = await readVisibleTreeEntries(page, opts);
  return items.some((entry) => entry.kind === 'file' || entry.kind === 'unknown' || entry.kind === 'folder');
}

async function hasVisibleChatsPanel(page, opts) {
  const input = await pickDeepSeaInputLocator(page, opts.inputSelectors);
  if (!input) {
    return false;
  }
  const box = await input.locator.boundingBox().catch(() => null);
  return Boolean(box && box.x <= (opts.sidebarMaxX + 520));
}

async function waitForFilesPanelReady(page, opts) {
  const start = Date.now();
  let refreshCount = 0;
  let lastRefreshAt = null;
  let lastRefreshDelayMs = null;
  let currentRefreshDelayMs = nextRefreshDelayMs(opts.readyRefreshMinMs, opts.readyRefreshMaxMs, null);
  let nextRefreshDueAt = start + currentRefreshDelayMs;
  let last = { ready: false, waitedMs: 0 };

  while (Date.now() - start <= opts.readyTimeoutMs) {
    await ensureFilesTab(page, opts).catch(() => {});
    const treeReady = await hasVisibleFilesTree(page, opts).catch(() => false);
    const addButton = await pickLocator(page, opts.addFileSelectors);
    const addButtonEnabled = addButton ? await locatorIsActionable(addButton.locator, true) : false;
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const lowerBody = String(bodyText || '').toLowerCase();
    const gettingReadyDetected = lowerBody.includes('getting ready...');
    const connectingDetected = lowerBody.includes('connecting...');
    const compilingDetected = lowerBody.includes('compiling latex document');

    last = {
      ready: Boolean(treeReady || addButtonEnabled),
      treeReady: Boolean(treeReady),
      addButtonPresent: Boolean(addButton),
      addButtonEnabled: Boolean(addButtonEnabled),
      gettingReadyDetected,
      connectingDetected,
      compilingDetected,
      waitedMs: Date.now() - start,
      refreshCount,
      lastRefreshAt,
      lastRefreshDelayMs
    };
    if (last.ready) {
      return last;
    }

    const needsRecoveryRefresh = gettingReadyDetected || connectingDetected || compilingDetected;
    if (needsRecoveryRefresh && refreshCount < opts.readyRefreshMaxCount && Date.now() >= nextRefreshDueAt) {
      try {
        await page.reload({ waitUntil: opts.waitUntil, timeout: opts.timeoutMs });
      } catch (err) {
        await page.goto(opts.projectUrl, { waitUntil: opts.waitUntil, timeout: opts.timeoutMs }).catch(() => {});
      }
      refreshCount += 1;
      lastRefreshAt = new Date().toISOString();
      lastRefreshDelayMs = currentRefreshDelayMs;
      currentRefreshDelayMs = nextRefreshDelayMs(opts.readyRefreshMinMs, opts.readyRefreshMaxMs, lastRefreshDelayMs);
      nextRefreshDueAt = Date.now() + currentRefreshDelayMs;
      continue;
    }

    await page.waitForTimeout(opts.readyPollMs);
  }

  return last;
}

async function waitForUploadedFilesVisible(page, opts, basenames, timeoutMs) {
  const targets = unique((basenames || []).map((x) => String(x || '').trim()).filter(Boolean));
  if (!targets.length) {
    return {
      ready: true,
      targets: [],
      found: [],
      missing: [],
      waitedMs: 0
    };
  }

  const startedAt = Date.now();
  let lastFound = [];
  while (Date.now() - startedAt < timeoutMs) {
    await ensureFilesTab(page, opts).catch(() => {});
    const entries = await readTreeEntries(page, opts).catch(() => []);
    const labels = new Set(entries.map((entry) => String(entry.label || '').trim()));
    const found = targets.filter((name) => labels.has(name));
    const missing = targets.filter((name) => !labels.has(name));
    lastFound = found;
    if (missing.length === 0) {
      await ensureChatsTab(page, opts).catch(() => {});
      return {
        ready: true,
        targets,
        found,
        missing,
        waitedMs: Date.now() - startedAt
      };
    }
    await page.waitForTimeout(1000);
  }

  await ensureChatsTab(page, opts).catch(() => {});
  return {
    ready: false,
    targets,
    found: lastFound,
    missing: targets.filter((name) => !lastFound.includes(name)),
    waitedMs: Date.now() - startedAt
  };
}

async function pickSidebarScopedLocator(page, selectors, opts, options = {}) {
  const maxCount = Math.max(1, Number(options.maxCount || 12));
  const maxY = Number.isFinite(options.maxY) ? Number(options.maxY) : 260;
  const textEquals = normalizeInlineText(options.textEquals || '').toLowerCase();

  for (const selector of selectors) {
    try {
      const items = page.locator(selector);
      const count = Math.min(await items.count(), maxCount);
      for (let i = 0; i < count; i += 1) {
        const locator = items.nth(i);
        if (!await locatorIsActionable(locator, false)) continue;
        const box = await locator.boundingBox().catch(() => null);
        if (!box) continue;
        if (box.x > opts.sidebarMaxX || box.y > maxY) continue;
        if (textEquals) {
          const text = normalizeInlineText(await locator.innerText().catch(() => ''));
          if (text.toLowerCase() !== textEquals) continue;
        }
        return { selector, locator, index: i };
      }
    } catch (err) {
      // continue
    }
  }
  return null;
}

async function findVisibleTextTarget(page, labels, options = {}) {
  const normalizedLabels = unique((labels || []).map((label) => normalizeInlineText(label).toLowerCase()).filter(Boolean));
  if (!normalizedLabels.length) {
    return null;
  }
  return page.evaluate(({ normalizedLabels, options }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (el) => {
      if (!el || !(el instanceof Element)) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
      const rect = el.getBoundingClientRect();
      return rect.width >= 8 && rect.height >= 8;
    };
    const looksClickable = (el) => {
      if (!el || !(el instanceof Element)) return false;
      const role = (el.getAttribute('role') || '').toLowerCase();
      const tag = (el.tagName || '').toLowerCase();
      const style = window.getComputedStyle(el);
      return tag === 'button'
        || role === 'button'
        || role === 'menuitem'
        || Number(el.tabIndex || -1) >= 0
        || style.cursor === 'pointer'
        || el.hasAttribute('onclick');
    };
    let best = null;
    for (const node of Array.from(document.querySelectorAll('body *'))) {
      const text = normalize(node.innerText || node.textContent || '');
      if (!normalizedLabels.includes(text)) continue;
      if (!isVisible(node)) continue;
      let clickTarget = node;
      while (clickTarget && clickTarget !== document.body && !looksClickable(clickTarget)) {
        clickTarget = clickTarget.parentElement;
      }
      if (!clickTarget || clickTarget === document.body) {
        clickTarget = node;
      }
      if (!isVisible(clickTarget)) continue;
      const rect = clickTarget.getBoundingClientRect();
      if (options.maxX != null && rect.x > options.maxX) continue;
      if (options.minX != null && rect.right < options.minX) continue;
      if (options.maxY != null && rect.y > options.maxY) continue;
      if (options.minY != null && rect.bottom < options.minY) continue;
      if (options.maxWidth != null && rect.width > options.maxWidth) continue;
      if (options.maxHeight != null && rect.height > options.maxHeight) continue;
      const clusterText = normalize((clickTarget.parentElement && clickTarget.parentElement.innerText) || clickTarget.innerText || '');
      const requiredClusterTerms = Array.isArray(options.requireClusterTerms)
        ? options.requireClusterTerms.map((term) => normalize(term)).filter(Boolean)
        : [];
      if (requiredClusterTerms.length && !requiredClusterTerms.some((term) => clusterText.includes(term))) {
        continue;
      }
      const anchorX = Number.isFinite(options.anchorX) ? Number(options.anchorX) : null;
      const anchorY = Number.isFinite(options.anchorY) ? Number(options.anchorY) : null;
      const maxDx = Number.isFinite(options.maxDx) ? Number(options.maxDx) : null;
      const maxDy = Number.isFinite(options.maxDy) ? Number(options.maxDy) : null;
      if (anchorX != null && maxDx != null && Math.abs(rect.x - anchorX) > maxDx && Math.abs((rect.x + rect.width) - anchorX) > maxDx) {
        continue;
      }
      if (anchorY != null && maxDy != null && Math.abs(rect.y - anchorY) > maxDy && Math.abs((rect.y + rect.height) - anchorY) > maxDy) {
        continue;
      }
      let score = 0;
      if ((clickTarget.getAttribute('role') || '').toLowerCase() === 'menuitem') score += 50;
      if ((clickTarget.tagName || '').toLowerCase() === 'button') score += 40;
      if (clusterText.includes('rename file') || clusterText.includes('delete file')) score += 80;
      if (options.preferSidebar && rect.x <= (options.sidebarMaxX || 460)) score += 20;
      if (options.preferTop && rect.y <= (options.maxY || 260)) score += 10;
      if (anchorX != null) score -= Math.min(80, Math.abs(rect.x - anchorX) / 6);
      if (anchorY != null) score -= Math.min(80, Math.abs(rect.y - anchorY) / 6);
      if (!best || score > best.score) {
        best = {
          text,
          targetText: normalize(clickTarget.innerText || clickTarget.textContent || ''),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          score,
          role: clickTarget.getAttribute('role') || '',
          tag: (clickTarget.tagName || '').toLowerCase()
        };
      }
    }
    return best;
  }, { normalizedLabels, options }).catch(() => null);
}

async function clickTextTarget(page, target, button = 'left') {
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.width) || !Number.isFinite(target.height)) {
    return false;
  }
  const x = Math.round(target.x + Math.max(6, Math.min(target.width - 6, target.width / 2)));
  const y = Math.round(target.y + Math.max(6, Math.min(target.height - 6, target.height / 2)));
  await page.mouse.move(x, y).catch(() => {});
  await page.mouse.click(x, y, { button, delay: 80 });
  return true;
}

function targetHasBox(target) {
  return Boolean(target
    && Number.isFinite(target.x)
    && Number.isFinite(target.y)
    && Number.isFinite(target.width)
    && Number.isFinite(target.height));
}

async function interactWithBoxTarget(page, target, action = 'click', button = 'left') {
  if (!targetHasBox(target)) {
    return false;
  }
  const x = Math.round(target.x + Math.max(6, Math.min(target.width - 6, target.width / 2)));
  const y = Math.round(target.y + Math.max(6, Math.min(target.height - 6, target.height / 2)));
  await page.mouse.move(x, y).catch(() => {});
  if (action === 'double_click') {
    await page.mouse.dblclick(x, y, { button, delay: 80 });
    return true;
  }
  await page.mouse.click(x, y, { button, delay: 80 });
  return true;
}

async function ensureSidebarTab(page, opts, label, selectors, isReady) {
  if (await isReady()) {
    return true;
  }

  const scoped = await pickSidebarScopedLocator(page, selectors, opts, { maxCount: 10, maxY: 240, textEquals: label });
  if (scoped) {
    try {
      const selected = await scoped.locator.getAttribute('aria-selected').catch(() => null);
      if (selected !== 'true' || !await isReady()) {
        await scoped.locator.click({ timeout: Math.min(opts.timeoutMs, 5000) });
        await page.waitForTimeout(500);
      }
      if (await isReady()) {
        return true;
      }
    } catch (err) {
      // continue
    }
  }

  const fallback = await findVisibleTextTarget(page, [label], {
    preferSidebar: true,
    preferTop: true,
    sidebarMaxX: opts.sidebarMaxX,
    maxX: opts.sidebarMaxX,
    minY: 80,
    maxY: 240,
    maxWidth: 220,
    maxHeight: 64
  });
  if (fallback) {
    await clickTextTarget(page, fallback, 'left').catch(() => {});
    await page.waitForTimeout(500);
  }

  return isReady();
}

async function readVisibleTreeEntries(page, opts) {
  const entries = [];
  const seen = new Set();

  for (const selector of opts.treeItemSelectors) {
    try {
      const items = page.locator(selector);
      const count = Math.min(await items.count(), opts.treeScanLimit);
      for (let i = 0; i < count; i += 1) {
        const locator = items.nth(i);
        const box = await locator.boundingBox().catch(() => null);
        if (!box) continue;
        const rawText = await locator.innerText().catch(() => '');
        const aria = await locator.getAttribute('aria-label').catch(() => null);
        const expanded = await locator.getAttribute('aria-expanded').catch(() => null);
        const role = await locator.getAttribute('role').catch(() => null);
        const label = extractItemLabel(rawText || aria || '');
        const entry = {
          selector,
          index: i,
          label,
          rawText: extractItemLabel(rawText),
          ariaLabel: aria || '',
          expanded,
          role: role || '',
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
          depth: Math.max(0, Math.round((box.x - 8) / 16))
        };
        if (!isLikelySidebarEntry(entry, opts)) continue;
        const key = `${entry.label}@@${entry.depth}@@${entry.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(entry);
      }
    } catch (err) {
      // continue
    }
  }

  entries.sort((a, b) => (a.y - b.y) || (a.x - b.x) || a.label.localeCompare(b.label));
  return annotateTreePaths(entries);
}

async function findSidebarScrollTarget(page, opts) {
  const entries = await readVisibleTreeEntries(page, opts);
  const candidate = entries.find((entry) => entry.selector && entry.kind !== 'unknown') || entries.find((entry) => entry.selector);
  if (!candidate) return null;
  const locator = page.locator(candidate.selector).nth(candidate.index);
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return null;
  return {
    locator,
    x: Math.max(16, Math.min(opts.sidebarMaxX - 40, Math.round(box.x + Math.min(20, box.width / 2)))),
    y: Math.max(120, Math.round(box.y + Math.min(12, box.height / 2)))
  };
}

async function readTreeEntries(page, opts) {
  const snapshots = [];
  snapshots.push(await readVisibleTreeEntries(page, opts));

  const scrollTarget = await findSidebarScrollTarget(page, opts);
  if (!scrollTarget) {
    return mergeTreeEntries(snapshots);
  }

  const signatures = new Set();
  const signatureOf = (entries) => entries.map((entry) => `${entry.label}@@${entry.depth}@@${entry.y}`).join('|');
  signatures.add(signatureOf(snapshots[0]));

  await page.mouse.move(scrollTarget.x, scrollTarget.y).catch(() => {});

  for (let pass = 0; pass < 6; pass += 1) {
    await page.mouse.wheel(0, 640).catch(() => {});
    await page.waitForTimeout(250);
    const entries = await readVisibleTreeEntries(page, opts);
    const signature = signatureOf(entries);
    snapshots.push(entries);
    if (signatures.has(signature)) {
      break;
    }
    signatures.add(signature);
  }

  await page.mouse.move(scrollTarget.x, scrollTarget.y).catch(() => {});
  for (let pass = 0; pass < 6; pass += 1) {
    await page.mouse.wheel(0, -640).catch(() => {});
    await page.waitForTimeout(180);
  }

  return mergeTreeEntries(snapshots);
}

async function expandAllVisibleFolders(page, opts, notes) {
  let expandedAny = false;
  const expandedKeys = new Set();

  for (let pass = 0; pass < opts.maxTreeExpandPasses; pass += 1) {
    const entries = await readTreeEntries(page, opts);
    const collapsed = entries.filter((entry) => entry.expanded === 'false');
    if (collapsed.length === 0) {
      break;
    }

    let changedThisPass = false;
    for (const entry of collapsed) {
      const key = `${entry.selector}@@${entry.index}@@${entry.label}`;
      if (expandedKeys.has(key)) continue;
      expandedKeys.add(key);
      try {
        const locator = page.locator(entry.selector).nth(entry.index);
        await ensureVisible(locator);
        await locator.click({ timeout: Math.min(opts.timeoutMs, 3000) });
        await page.keyboard.press('ArrowRight').catch(() => {});
        await page.waitForTimeout(120);
        changedThisPass = true;
        expandedAny = true;
      } catch (err) {
        notes.push(`expand folder failed (${entry.label}): ${err.message}`);
      }
    }

    if (!changedThisPass) {
      break;
    }
  }

  return expandedAny;
}

function scoreTreeItemMatch(entry, requestedPath) {
  const requested = normalizeRequestedPath(requestedPath).toLowerCase();
  const requestedBase = requestedBasename(requested).toLowerCase();
  const entryPath = normalizeRequestedPath(entry.fullPath || entry.label).toLowerCase();
  const entryLabel = String(entry.label || '').trim().toLowerCase();
  const requestedHasPath = requested.includes('/');

  if (!requested || entry.kind !== 'file') return { score: -1, mode: 'none' };
  if (entryPath === requested) return { score: 100, mode: 'exact_full_path' };
  if (entryPath.endsWith(`/${requested}`)) return { score: 95, mode: 'suffix_full_path' };
  if (!requestedHasPath && entryLabel === requestedBase) return { score: 90, mode: 'exact_label' };
  if (!requestedHasPath && entryPath.endsWith(`/${requestedBase}`)) return { score: 70, mode: 'suffix_label' };
  return { score: -1, mode: 'none' };
}

async function findTreeItemByRequest(page, opts, requestedPath) {
  const requested = normalizeRequestedPath(requestedPath);
  if (!requested) return null;

  const entries = await readTreeEntries(page, opts);
  let best = null;
  for (const entry of entries) {
    const scored = scoreTreeItemMatch(entry, requested);
    if (scored.score < 0) continue;
    const candidate = {
      ...entry,
      matchMode: scored.mode,
      matchScore: scored.score,
      locator: page.locator(entry.selector).nth(entry.index)
    };
    if (!best || candidate.matchScore > best.matchScore) {
      best = candidate;
    }
  }

  return best;
}

async function findVisibleTreeItemByRequest(page, opts, requestedPath) {
  const requested = normalizeRequestedPath(requestedPath);
  if (!requested) return null;
  const entries = await readVisibleTreeEntries(page, opts);
  let best = null;
  for (const entry of entries) {
    const scored = scoreTreeItemMatch(entry, requested);
    if (scored.score < 0) continue;
    const candidate = {
      ...entry,
      matchMode: scored.mode,
      matchScore: scored.score,
      locator: page.locator(entry.selector).nth(entry.index)
    };
    if (!best || candidate.matchScore > best.matchScore) {
      best = candidate;
    }
  }
  return best;
}

async function scrollSidebarToStart(page, opts) {
  const scrollTarget = await findSidebarScrollTarget(page, opts);
  if (!scrollTarget) return false;
  await page.mouse.move(scrollTarget.x, scrollTarget.y).catch(() => {});
  for (let pass = 0; pass < 8; pass += 1) {
    await page.mouse.wheel(0, -720).catch(() => {});
    await page.waitForTimeout(140);
  }
  return true;
}

async function revealTreeItemByRequest(page, opts, requestedPath, notes) {
  let visible = await findVisibleTreeItemByRequest(page, opts, requestedPath);
  if (visible) {
    return visible;
  }

  const scrollTarget = await findSidebarScrollTarget(page, opts);
  if (!scrollTarget) {
    return null;
  }

  await scrollSidebarToStart(page, opts);
  visible = await findVisibleTreeItemByRequest(page, opts, requestedPath);
  if (visible) {
    return visible;
  }

  await page.mouse.move(scrollTarget.x, scrollTarget.y).catch(() => {});
  for (let pass = 0; pass < 20; pass += 1) {
    await page.mouse.wheel(0, 480).catch(() => {});
    await page.waitForTimeout(180);
    visible = await findVisibleTreeItemByRequest(page, opts, requestedPath);
    if (visible) {
      return visible;
    }
  }

  notes.push(`tree item could not be materialized in viewport: ${requestedPath}`);
  return null;
}

async function maybeSearchFile(page, opts, requestedPath, notes) {
  const searchInput = await pickSidebarSearchInput(page, opts);
  if (!searchInput) return false;
  const requested = normalizeRequestedPath(requestedPath);
  const basename = requestedBasename(requested);
  const attempts = unique([requested, basename].filter(Boolean));
  try {
    for (const term of attempts) {
      await searchInput.locator.click({ timeout: opts.timeoutMs });
      await searchInput.locator.fill(term, { timeout: opts.timeoutMs });
      await page.waitForTimeout(700);
      const match = await findTreeItemByRequest(page, opts, requested);
      if (match) {
        return true;
      }
    }
    return attempts.length > 0;
  } catch (err) {
    notes.push(`file search failed: ${err.message}`);
    return false;
  }
}

async function clearSearchIfAny(page, opts) {
  const searchInput = await pickSidebarSearchInput(page, opts);
  if (!searchInput) return;
  try {
    await searchInput.locator.fill('', { timeout: 2000 });
  } catch (err) {
    // ignore
  }
}

async function pickDeepSeaInputLocator(page, selectors) {
  for (const selector of selectors) {
    try {
      const items = page.locator(selector);
      const count = Math.min(await items.count(), 20);
      for (let i = 0; i < count; i += 1) {
        const locator = items.nth(i);
        const ok = await locator.evaluate((el) => {
          const style = window.getComputedStyle(el);
          const ariaHidden = (el.getAttribute('aria-hidden') || '').toLowerCase();
          const readonly = el.hasAttribute('readonly');
          const disabled = el.hasAttribute('disabled');
          const hiddenByStyle = style.display === 'none' || style.visibility === 'hidden';
          const rect = el.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0;
          const editable = el.isContentEditable || ['textarea', 'input'].includes((el.tagName || '').toLowerCase());
          return visible && editable && !readonly && !disabled && !hiddenByStyle && ariaHidden !== 'true';
        }).catch(() => false);
        if (ok) {
          return { selector, locator };
        }
      }
    } catch (err) {
      // continue
    }
  }
  return null;
}

async function pickSidebarSearchInput(page, opts) {
  for (const selector of opts.fileSearchInputSelectors) {
    try {
      const items = page.locator(selector);
      const count = Math.min(await items.count(), 10);
      for (let i = 0; i < count; i += 1) {
        const locator = items.nth(i);
        const visible = await locator.isVisible().catch(() => false);
        if (!visible) continue;
        const box = await locator.boundingBox().catch(() => null);
        if (!box) continue;
        if (box.x > opts.sidebarMaxX || box.width < 40) continue;
        return { selector, locator };
      }
    } catch (err) {
      // continue
    }
  }
  return null;
}

async function ensureDeepSeaChatInputReady(page, opts) {
  const startedAt = Date.now();
  let openedNewChat = false;

  while (Date.now() - startedAt < opts.timeoutMs) {
    const input = await pickDeepSeaInputLocator(page, opts.inputSelectors);
    if (input) {
      return input;
    }

    if (!openedNewChat) {
      const newChat = await pickActionableLocator(page, opts.newChatSelectors);
      if (newChat) {
        await newChat.locator.click({ timeout: Math.min(opts.timeoutMs, 5000) }).catch(() => {});
        openedNewChat = true;
        await page.waitForTimeout(1200);
        continue;
      }
    }

    await page.waitForTimeout(1000);
  }

  return null;
}

async function readDeepSeaChatUiState(page, opts) {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const lowerBody = String(bodyText || '').toLowerCase();
  const input = await pickDeepSeaInputLocator(page, opts.inputSelectors);
  let inputInfo = null;
  if (input) {
    inputInfo = await input.locator.evaluate((el) => {
      const tagName = (el.tagName || '').toLowerCase();
      const rawText = tagName === 'textarea' || tagName === 'input'
        ? (el.value || '')
        : (el.innerText || el.textContent || '');
      const placeholder = el.getAttribute('placeholder')
        || el.getAttribute('aria-label')
        || el.getAttribute('data-placeholder')
        || '';
      return {
        tagName,
        text: String(rawText || ''),
        normalizedText: String(rawText || '').replace(/\s+/g, ' ').trim(),
        placeholder: String(placeholder || '').replace(/\s+/g, ' ').trim(),
        isContentEditable: Boolean(el.isContentEditable)
      };
    }).catch(() => null);
  }

  const placeholderText = normalizeInlineText(inputInfo?.placeholder || '');
  const draftText = normalizeInlineText(inputInfo?.normalizedText || inputInfo?.text || '');
  const askAnythingDetected = /ask anything/i.test(lowerBody)
    || /ask anything/i.test(placeholderText);
  const gettingReadyDetected = lowerBody.includes('getting ready...');
  const loadingDetected = /\bloading\.\.\./i.test(bodyText);
  const stopVisible = await isStopButtonVisible(page, opts.stopSelectors);

  return {
    bodyText,
    askAnythingDetected,
    gettingReadyDetected,
    loadingDetected,
    inputVisible: Boolean(input),
    inputSelectorUsed: input ? input.selector : null,
    inputInfo,
    draftText,
    draftPresent: Boolean(draftText),
    stopVisible
  };
}

async function readDeepSeaConversationSignals(page, opts, expectedText = '') {
  const expectedNorm = normalizeInlineText(expectedText || '').toLowerCase();
  const payload = await page.evaluate(({ sidebarMaxX, expectedNorm }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const bodyText = normalize(document.body ? (document.body.innerText || document.body.textContent || '') : '');
    const root = document.querySelector('#project-page-main-panel') || document.querySelector('main') || document.body;
    const isVisible = (el) => {
      if (!el || !(el instanceof Element)) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
      const rect = el.getBoundingClientRect();
      return rect.width >= 8 && rect.height >= 8 && rect.bottom >= 0 && rect.right >= 0;
    };

    const centralMessageNodes = Array.from(root.querySelectorAll('[data-message-author-role], article, [role="article"], [data-testid*="conversation"], [data-testid*="chat"], [class*="chat"], [class*="message"]'))
      .filter((el) => {
        if (!isVisible(el)) return false;
        if (el.closest('.monaco-editor, .view-lines, [class*="monaco"]')) return false;
        if (el.closest('textarea, input, [contenteditable="true"]')) return false;
        const rect = el.getBoundingClientRect();
        if (rect.x <= sidebarMaxX) return false;
        const text = normalize(el.innerText || el.textContent || '');
        return text.length >= 4;
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          text: normalize(el.innerText || el.textContent || '').slice(0, 500),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          authorRole: el.getAttribute('data-message-author-role') || '',
          role: el.getAttribute('role') || '',
          testId: el.getAttribute('data-testid') || ''
        };
      });

    const expectedMessageTraceable = expectedNorm
      ? centralMessageNodes.some((node) => normalize(node.text).toLowerCase().includes(expectedNorm))
      : false;

    const errorNeedles = [
      'error while processing conversation, please submit prompt again.',
      'error while processing conversation',
      'please submit prompt again'
    ];
    const visibleTextLeaves = Array.from(root.querySelectorAll('*'))
      .filter((el) => {
        if (!isVisible(el)) return false;
        if (el.closest('.monaco-editor, .view-lines, [class*="monaco"]')) return false;
        const rect = el.getBoundingClientRect();
        if (rect.x <= sidebarMaxX) return false;
        const text = normalize(el.innerText || el.textContent || '');
        if (!text) return false;
        const childWithSameText = Array.from(el.children || []).some((child) => normalize(child.innerText || child.textContent || '') === text);
        return !childWithSameText;
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          text: normalize(el.innerText || el.textContent || '').slice(0, 500),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      });
    const errorLeaf = visibleTextLeaves.find((leaf) => errorNeedles.some((needle) => leaf.text.toLowerCase().includes(needle)));

    return {
      bodyText,
      workspaceVisible: /deepsea\.openai\.com/i.test(location.href) && document.body != null,
      centralMessageCount: centralMessageNodes.length,
      centralMessageNodes: centralMessageNodes.slice(0, 20),
      expectedMessageTraceable,
      conversationProcessingError: errorLeaf ? {
        detected: true,
        text: errorLeaf.text,
        url: location.href
      } : {
        detected: false,
        text: '',
        url: location.href
      }
    };
  }, { sidebarMaxX: opts.sidebarMaxX, expectedNorm }).catch(() => null);

  return payload || {
    bodyText: '',
    workspaceVisible: false,
    centralMessageCount: 0,
    centralMessageNodes: [],
    expectedMessageTraceable: false,
    conversationProcessingError: {
      detected: false,
      text: '',
      url: page.url()
    }
  };
}

async function dismissDeepSeaChatFocus(page) {
  try {
    await page.mouse.click(180, 180);
    await page.waitForTimeout(250);
  } catch (err) {
    // ignore
  }
}

async function clearDeepSeaChatDraft(page, input) {
  if (!input) return false;

  const info = await input.locator.evaluate((el) => ({
    tagName: (el.tagName || '').toLowerCase(),
    isContentEditable: Boolean(el.isContentEditable),
    text: ((el.tagName || '').toLowerCase() === 'textarea' || (el.tagName || '').toLowerCase() === 'input')
      ? String(el.value || '')
      : String(el.innerText || el.textContent || '')
  })).catch(() => ({ tagName: '', isContentEditable: false, text: '' }));

  if (!normalizeInlineText(info.text)) return false;

  await input.locator.click({ timeout: 5000 }).catch(() => {});
  if (info.tagName === 'textarea' || info.tagName === 'input' || info.isContentEditable) {
    await page.keyboard.press('Meta+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
  } else {
    await page.keyboard.press('Meta+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
  }
  await page.waitForTimeout(250);
  return true;
}

async function waitForInteractiveDeepSeaChat(page, opts, timeoutMs) {
  const startedAt = Date.now();
  let clearedDraft = false;
  let last = null;

  while (Date.now() - startedAt < timeoutMs) {
    const state = await readDeepSeaChatUiState(page, opts);
    const conversation = await readDeepSeaConversationSignals(page, opts);
    last = {
      workspaceVisible: Boolean(conversation.workspaceVisible),
      chatComposerReady: Boolean(state.inputVisible && state.askAnythingDetected && !state.gettingReadyDetected && !state.loadingDetected),
      chatHistoryTraceable: Boolean(conversation.centralMessageCount > 0),
      askAnythingDetected: state.askAnythingDetected,
      gettingReadyDetected: state.gettingReadyDetected,
      loadingDetected: state.loadingDetected,
      inputVisible: state.inputVisible,
      inputSelectorUsed: state.inputSelectorUsed,
      draftPresent: state.draftPresent,
      draftTextPreview: state.draftText ? state.draftText.slice(0, 120) : '',
      stopVisible: state.stopVisible,
      centralMessageCount: conversation.centralMessageCount,
      conversationProcessingError: conversation.conversationProcessingError,
      waitedMs: Date.now() - startedAt
    };

    if (state.draftPresent && !clearedDraft) {
      const input = await ensureDeepSeaChatInputReady(page, opts);
      if (input) {
        clearedDraft = await clearDeepSeaChatDraft(page, input);
        await dismissDeepSeaChatFocus(page);
        await page.waitForTimeout(400);
        continue;
      }
    }

    if (last.chatComposerReady) {
      return {
        ready: true,
        clearedDraft,
        ...last
      };
    }

    await page.waitForTimeout(800);
  }

  return {
    ready: false,
    clearedDraft,
    ...(last || {
      askAnythingDetected: false,
      gettingReadyDetected: false,
      loadingDetected: false,
      inputVisible: false,
      inputSelectorUsed: null,
      draftPresent: false,
      draftTextPreview: '',
      stopVisible: false,
      waitedMs: Date.now() - startedAt
    })
  };
}

async function verifyDeepSeaMessageAccepted(page, opts, expectedText) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < Math.min(opts.timeoutMs, 8000)) {
    const state = await readDeepSeaChatUiState(page, opts);
    const conversation = await readDeepSeaConversationSignals(page, opts, expectedText);
    const inputText = normalizeInlineText(state.draftText || '');
    const expectedNorm = normalizeInlineText(expectedText || '');
    const inputCleared = !inputText || inputText !== expectedNorm;
    last = {
      workspaceVisible: Boolean(conversation.workspaceVisible),
      chatComposerReady: Boolean(state.inputVisible && state.askAnythingDetected && !state.gettingReadyDetected && !state.loadingDetected),
      chatHistoryTraceable: Boolean(conversation.centralMessageCount > 0),
      expectedMessageTraceable: Boolean(conversation.expectedMessageTraceable),
      centralMessageCount: conversation.centralMessageCount,
      gettingReadyDetected: state.gettingReadyDetected,
      loadingDetected: state.loadingDetected,
      askAnythingDetected: state.askAnythingDetected,
      inputVisible: state.inputVisible,
      inputCleared,
      stopVisible: state.stopVisible,
      conversationProcessingError: conversation.conversationProcessingError
    };
    if (conversation.conversationProcessingError?.detected) {
      return {
        accepted: false,
        conversationProcessingError: conversation.conversationProcessingError,
        ...last
      };
    }
    if (!state.gettingReadyDetected
      && !state.loadingDetected
      && (state.stopVisible || inputCleared)
      && (conversation.expectedMessageTraceable || state.stopVisible)) {
      return {
        accepted: true,
        ...last
      };
    }
    await page.waitForTimeout(500);
  }
  return {
    accepted: false,
    ...(last || {})
  };
}

async function lateVerifyDeepSeaMessageAccepted(page, opts, expectedText, baseline = {}) {
  const scheduleSeconds = [2, 5, 10, 20];
  let last = null;
  for (const seconds of scheduleSeconds) {
    await page.waitForTimeout(seconds * 1000);
    await ensureChatsTab(page, opts).catch(() => {});
    const state = await readDeepSeaChatUiState(page, opts);
    const conversation = await readDeepSeaConversationSignals(page, opts, expectedText);
    const inputText = normalizeInlineText(state.draftText || '');
    const expectedNorm = normalizeInlineText(expectedText || '');
    const inputCleared = !inputText || inputText !== expectedNorm;
    const centralMessageCountIncreased = Number(conversation.centralMessageCount || 0) > Number(baseline.centralMessageCount || 0);
    last = {
      accepted: false,
      confirmedLate: false,
      verificationDelaySeconds: seconds,
      workspaceVisible: Boolean(conversation.workspaceVisible),
      chatComposerReady: Boolean(state.inputVisible && state.askAnythingDetected && !state.gettingReadyDetected && !state.loadingDetected),
      chatHistoryTraceable: Boolean(conversation.centralMessageCount > 0),
      expectedMessageTraceable: Boolean(conversation.expectedMessageTraceable),
      centralMessageCount: conversation.centralMessageCount,
      centralMessageCountIncreased,
      gettingReadyDetected: state.gettingReadyDetected,
      loadingDetected: state.loadingDetected,
      askAnythingDetected: state.askAnythingDetected,
      inputVisible: state.inputVisible,
      inputCleared,
      stopVisible: state.stopVisible,
      conversationProcessingError: conversation.conversationProcessingError,
      likelyDeliveredButUntraceable: false
    };
    if (conversation.conversationProcessingError?.detected) {
      return last;
    }
    if (!state.gettingReadyDetected
      && !state.loadingDetected
      && inputCleared
      && (conversation.expectedMessageTraceable || state.stopVisible || centralMessageCountIncreased)) {
      return {
        ...last,
        accepted: true,
        confirmedLate: true
      };
    }
    if (!state.gettingReadyDetected
      && !state.loadingDetected
      && inputCleared
      && (state.stopVisible || centralMessageCountIncreased)) {
      return {
        ...last,
        likelyDeliveredButUntraceable: true
      };
    }
  }
  return last || {
    accepted: false,
    confirmedLate: false,
    verificationDelaySeconds: 0,
    likelyDeliveredButUntraceable: false
  };
}

async function attemptDeepSeaSend(page, opts, content, args) {
  const baselineConversation = await readDeepSeaConversationSignals(page, opts, '');
  const input = await ensureDeepSeaChatInputReady(page, opts);
  if (!input) {
    throw new Error('Cannot find DeepSea chat input. Set deepseaAutomation.chatInputSelector in deepsea.json');
  }

  const info = await input.locator.evaluate((el) => ({
    tagName: (el.tagName || '').toLowerCase(),
    isContentEditable: Boolean(el.isContentEditable)
  })).catch(() => ({ tagName: '', isContentEditable: false }));

  await input.locator.click({ timeout: opts.timeoutMs });
  if (info.tagName === 'textarea' || info.tagName === 'input') {
    try {
      await input.locator.fill(content, { timeout: opts.timeoutMs });
    } catch (err) {
      await page.keyboard.press('Meta+A').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.keyboard.insertText(content);
    }
  } else if (info.isContentEditable) {
    await page.keyboard.press('Meta+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.insertText(content);
  } else {
    await page.keyboard.insertText(content);
  }

  if (args.composeOnly) {
    return {
      input,
      send: null,
      technicalSendOk: false,
      acceptance: null,
      composeOnly: true
    };
  }

  const send = await pickActionableLocator(page, opts.sendSelectors);
  let technicalSendOk = false;
  if (send) {
    await send.locator.click({ timeout: opts.timeoutMs });
    technicalSendOk = true;
  } else {
    await input.locator.press('Enter', { timeout: opts.timeoutMs });
    technicalSendOk = true;
  }
  const acceptance = await verifyDeepSeaMessageAccepted(page, opts, content);
  return {
    input,
    send,
    technicalSendOk,
    acceptance,
    baselineConversation,
    composeOnly: false
  };
}

async function recoverFromConversationProcessingError(paths, page, opts, attemptIndex, acceptance) {
  const delayMs = randomIntBetween(2000, 5000);
  writeStatus(paths, {
    status: 'recovering_after_conversation_processing_error',
    error: acceptance?.conversationProcessingError?.text || 'DeepSea conversation processing error detected.',
    lastAction: 'send',
    lastRecoveryAt: new Date().toISOString(),
    recoveryAttempt: attemptIndex,
    recoveryDelayMs: delayMs,
    recoveryStep: 'waiting_before_refresh',
    conversationProcessingError: acceptance?.conversationProcessingError || null
  });
  await page.waitForTimeout(delayMs);

  try {
    await page.reload({ waitUntil: opts.waitUntil, timeout: opts.timeoutMs });
  } catch (err) {
    await page.goto(opts.projectUrl, { waitUntil: opts.waitUntil, timeout: opts.timeoutMs }).catch(() => {});
  }

  const readiness = await waitForDeepSeaReady(page, opts);
  const chatReady = await waitForInteractiveDeepSeaChat(page, opts, Math.min(opts.timeoutMs, 12000));
  await ensureChatsTab(page, opts).catch(() => {});

  writeStatus(paths, {
    status: (!readiness.ready || !chatReady.ready) ? 'not_ready_after_recovery_refresh' : 'ready_after_recovery_refresh',
    error: (!readiness.ready || !chatReady.ready)
      ? `DeepSea not ready after recovery refresh (ready=${Boolean(readiness.ready)} chatReady=${Boolean(chatReady.ready)}).`
      : null,
    lastAction: 'send',
    lastRecoveryAt: new Date().toISOString(),
    recoveryAttempt: attemptIndex,
    recoveryStep: 'refreshed',
    readiness,
    chatReady
  });

  return { readiness, chatReady };
}

async function selectFileByRequest(page, opts, requestedPath, notes) {
  const normalizedRequested = normalizeRequestedPath(requestedPath);
  const basename = requestedBasename(normalizedRequested);
  if (!basename) {
    return { ok: false, reason: 'empty requested path' };
  }

  await ensureFilesTab(page, opts);
  await expandAllVisibleFolders(page, opts, notes);
  await maybeSearchFile(page, opts, normalizedRequested, notes);
  let match = await findTreeItemByRequest(page, opts, normalizedRequested);
  if (!match && !normalizedRequested.includes('/')) {
    match = await findTreeItemByRequest(page, opts, basename);
  }
  if (!match) {
    await clearSearchIfAny(page, opts);
    return {
      ok: false,
      reason: 'file_not_found_in_ui',
      basename,
      hint: 'Set deepseaAutomation.fileTreeItemSelector / fileSearchInputSelector if DeepSea file tree differs.'
    };
  }

  try {
    const visibleMatch = await revealTreeItemByRequest(page, opts, normalizedRequested, notes)
      || (!normalizedRequested.includes('/') ? await revealTreeItemByRequest(page, opts, basename, notes) : null);
    if (visibleMatch) {
      match = visibleMatch;
    }
    const clickLocator = await resolveTreeEntryClickTarget(match.locator, match.label);
    const pointTarget = await findVisibleTextTarget(page, [match.label], {
      preferSidebar: true,
      sidebarMaxX: opts.sidebarMaxX,
      maxX: opts.sidebarMaxX,
      minY: 150,
      maxY: 2200,
      maxWidth: 260,
      maxHeight: 64
    });
    if (pointTarget) {
      await clickTextTarget(page, pointTarget, 'left');
    } else {
      await ensureVisible(clickLocator);
      await clickLocator.click({ timeout: Math.min(opts.timeoutMs, 5000) });
    }
    await page.waitForTimeout(800);
    return {
      ok: true,
      basename,
      matchedLabel: match.label,
      matchedPath: match.fullPath || match.label,
      matchMode: match.matchMode || 'unknown',
      selectorUsed: match.selector,
      locator: match.locator,
      clickLocator,
      pointTarget: pointTarget || null
    };
  } catch (err) {
    await clearSearchIfAny(page, opts);
    return {
      ok: false,
      reason: `click_failed: ${err.message}`,
      basename,
      matchedPath: match.fullPath || match.label,
      matchMode: match.matchMode || 'unknown',
      selectorUsed: match.selector
    };
  }
}

async function waitForRequestedFileOpen(page, requestedPath, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = currentFileFromUrl(page.url());
    if (sameRequestedFile(requestedPath, current)) {
      return current;
    }
    await page.waitForTimeout(200);
  }
  return '';
}

async function ensureRequestedFileOpen(page, locator, requestedPath, timeoutMs, notes) {
  const current = currentFileFromUrl(page.url());
  if (sameRequestedFile(requestedPath, current)) {
    return { ok: true, currentFile: current, strategy: 'already_open' };
  }

  const attempts = [
    async () => {
      if (targetHasBox(locator)) {
        await interactWithBoxTarget(page, locator, 'double_click');
        return 'double_click_box';
      }
      await locator.dblclick({ timeout: Math.min(timeoutMs, 4000) });
      return 'double_click';
    },
    async () => {
      if (targetHasBox(locator)) {
        await interactWithBoxTarget(page, locator, 'click');
      } else {
        await locator.click({ timeout: Math.min(timeoutMs, 4000) });
      }
      await page.keyboard.press('Enter').catch(() => {});
      return targetHasBox(locator) ? 'click_enter_box' : 'click_enter';
    },
    async () => {
      if (targetHasBox(locator)) {
        await interactWithBoxTarget(page, locator, 'click');
        return 'single_click_box';
      }
      await locator.click({ timeout: Math.min(timeoutMs, 4000) });
      return 'single_click';
    }
  ];

  for (const attempt of attempts) {
    try {
      if (!targetHasBox(locator)) {
        await ensureVisible(locator);
      }
      const strategy = await attempt();
      const opened = await waitForRequestedFileOpen(page, requestedPath, Math.min(timeoutMs, 3000));
      if (opened) {
        return { ok: true, currentFile: opened, strategy };
      }
    } catch (err) {
      notes.push(`open requested file failed (${requestedPath}): ${err.message}`);
    }
  }

  return {
    ok: false,
    currentFile: currentFileFromUrl(page.url()),
    strategy: 'none'
  };
}

async function resolveTreeEntryClickTarget(entryLocator, expectedLabel = '') {
  const normalizedLabel = normalizeInlineText(expectedLabel);
  if (normalizedLabel) {
    try {
      const exact = entryLocator.getByText(normalizedLabel, { exact: true }).first();
      if (await locatorIsActionable(exact, false)) {
        return exact;
      }
    } catch (err) {
      // continue
    }
  }
  try {
    const button = entryLocator.locator('button').first();
    if (await locatorIsActionable(button, false)) {
      return button;
    }
  } catch (err) {
    // continue
  }
  return entryLocator;
}

async function openContextMenuForLocator(page, opts, locator, timeoutMs, notes) {
  const pointForBox = (box) => ({
    x: Math.round(box.x + Math.max(6, Math.min(box.width - 6, box.width / 2))),
    y: Math.round(box.y + Math.max(6, Math.min(box.height - 6, box.height / 2)))
  });
  const attempts = [
    async () => {
      if (targetHasBox(locator)) {
        const point = {
          x: Math.round(locator.x + Math.max(6, Math.min(locator.width - 6, locator.width / 2))),
          y: Math.round(locator.y + Math.max(6, Math.min(locator.height - 6, locator.height / 2)))
        };
        await page.mouse.move(point.x, point.y);
        await page.mouse.click(point.x, point.y, { button: 'right', delay: 80 });
        return { strategy: 'mouse_right_click_box', point };
      }
      await ensureVisible(locator);
      const box = await locator.boundingBox().catch(() => null);
      if (!box) {
        throw new Error('missing bounding box for context menu target');
      }
      const point = pointForBox(box);
      await page.mouse.move(point.x, point.y);
      await page.mouse.click(point.x, point.y, { button: 'right', delay: 80 });
      return { strategy: 'mouse_right_click', point };
    },
    async () => {
      if (targetHasBox(locator)) {
        const point = {
          x: Math.round(locator.x + Math.max(6, Math.min(locator.width - 6, locator.width / 2))),
          y: Math.round(locator.y + Math.max(6, Math.min(locator.height - 6, locator.height / 2)))
        };
        await page.mouse.move(point.x, point.y);
        await page.mouse.click(point.x, point.y, { button: 'right', delay: 80 });
        return { strategy: 'locator_right_click_box', point };
      }
      await ensureVisible(locator);
      const box = await locator.boundingBox().catch(() => null);
      const point = box ? pointForBox(box) : null;
      await locator.click({
        button: 'right',
        position: { x: 18, y: 12 },
        timeout: Math.min(timeoutMs, 5000)
      });
      return { strategy: 'locator_right_click', point };
    },
    async () => {
      await ensureVisible(locator);
      if (targetHasBox(locator)) {
        await interactWithBoxTarget(page, locator, 'click');
        await page.keyboard.press('Shift+F10');
        return { strategy: 'keyboard_shift_f10_box', point: locator };
      }
      const box = await locator.boundingBox().catch(() => null);
      const point = box ? pointForBox(box) : null;
      await locator.focus().catch(() => {});
      await locator.click({ timeout: Math.min(timeoutMs, 5000) });
      await page.keyboard.press('Shift+F10');
      return { strategy: 'keyboard_shift_f10', point };
    },
    async () => {
      await ensureVisible(locator);
      if (targetHasBox(locator)) {
        await interactWithBoxTarget(page, locator, 'click');
        await page.keyboard.press('ContextMenu');
        return { strategy: 'keyboard_context_menu_box', point: locator };
      }
      const box = await locator.boundingBox().catch(() => null);
      const point = box ? pointForBox(box) : null;
      await locator.focus().catch(() => {});
      await locator.click({ timeout: Math.min(timeoutMs, 5000) });
      await page.keyboard.press('ContextMenu');
      return { strategy: 'keyboard_context_menu', point };
    }
  ];

  for (const attempt of attempts) {
    try {
      await page.keyboard.press('Escape').catch(() => {});
      const opened = await attempt();
      const menuItem = await waitForContextMenuDownloadAction(page, opts, Math.min(timeoutMs, 1800), opened.point || null);
      if (menuItem) {
        return {
          strategy: opened.strategy,
          point: opened.point || null,
          menuItem
        };
      }
    } catch (err) {
      notes.push(`context menu open attempt failed: ${err.message}`);
    }
  }

  await page.keyboard.press('Escape').catch(() => {});
  return null;
}

async function waitForContextMenuDownloadAction(page, opts, timeoutMs, anchorPoint = null) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const textCandidate = await findVisibleTextTarget(page, ['Download file'], {
      minX: 0,
      maxX: Math.max(900, opts.sidebarMaxX + 520),
      minY: 100,
      maxY: 1200,
      maxWidth: 420,
      maxHeight: 120,
      anchorX: anchorPoint && Number.isFinite(anchorPoint.x) ? anchorPoint.x : null,
      anchorY: anchorPoint && Number.isFinite(anchorPoint.y) ? anchorPoint.y : null,
      maxDx: 520,
      maxDy: 320,
      requireClusterTerms: ['Rename file', 'Delete file']
    });
    if (textCandidate) {
      return {
        kind: 'text_target',
        selector: '__visible_text_download_file__',
        target: textCandidate
      };
    }
    await page.waitForTimeout(120);
  }
  return null;
}

async function openContextMenuAndDownload(page, opts, locator, savePath, timeoutMs, notes, expectedBasename) {
  try {
    const opened = await openContextMenuForLocator(page, opts, locator, timeoutMs, notes);
    if (!opened || !opened.menuItem) {
      return null;
    }
    const downloadPromise = page.waitForEvent('download', {
      timeout: Math.min(timeoutMs, 8000)
    }).catch(() => null);
    if (opened.menuItem.kind === 'locator') {
      await opened.menuItem.locator.click({ timeout: Math.min(timeoutMs, 5000) });
    } else if (opened.menuItem.kind === 'text_target') {
      await clickTextTarget(page, opened.menuItem.target, 'left');
    } else {
      throw new Error(`unsupported context menu item kind: ${opened.menuItem.kind}`);
    }
    const download = await downloadPromise;
    if (!download) {
      notes.push(`context menu opened via ${opened.strategy}, but no download event fired`);
      return null;
    }
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    await download.saveAs(savePath);
    const suggestedFilename = download.suggestedFilename();
    if (!shouldAcceptSuggestedFilename(expectedBasename, suggestedFilename)) {
      notes.push(`context menu filename mismatch: expected ${expectedBasename}, got ${suggestedFilename}`);
      await saveContextMenuDebugArtifacts(page, savePath, {
        expectedBasename,
        suggestedFilename,
        openStrategy: opened.strategy,
        selector: opened.menuItem.selector,
        targetKind: opened.menuItem.kind || 'unknown',
        anchorPoint: opened.point || null
      }, notes).catch((err) => {
        notes.push(`context menu debug capture failed: ${err.message}`);
      });
      fs.rmSync(savePath, { force: true });
      await page.keyboard.press('Escape').catch(() => {});
      return null;
    }
    return {
      selector: opened.menuItem.selector,
      openStrategy: opened.strategy,
      suggestedFilename,
      savePath
    };
  } catch (err) {
    notes.push(`context menu download failed: ${err.message}`);
    await page.keyboard.press('Escape').catch(() => {});
    return null;
  }
}

async function saveContextMenuDebugArtifacts(page, savePath, meta, notes) {
  const dir = path.dirname(savePath);
  fs.mkdirSync(dir, { recursive: true });
  const screenshotPath = path.join(dir, 'context_menu_debug.png');
  const jsonPath = path.join(dir, 'context_menu_debug.json');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const payload = await page.evaluate((extra) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const elements = Array.from(document.querySelectorAll('body *')).map((el) => {
      const rect = el.getBoundingClientRect();
      const text = normalize(el.innerText || el.textContent || '');
      return {
        tag: (el.tagName || '').toLowerCase(),
        role: el.getAttribute('role') || '',
        aria: el.getAttribute('aria-label') || '',
        cls: el.className || '',
        text: text.slice(0, 240),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      };
    }).filter((item) => item.w >= 12 && item.h >= 12 && item.text);

    const contextLike = elements.filter((item) => /download file|rename file|delete file/i.test(item.text));
    const treeLike = elements.filter((item) => item.role === 'treeitem' || /\\.tex$|\\.md$|\\.zip$/i.test(item.text));
    return {
      meta: extra,
      contextLike,
      treeLike: treeLike.slice(0, 200)
    };
  }, meta);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  notes.push(`context menu debug screenshot saved: ${relToRoot(screenshotPath)}`);
  notes.push(`context menu debug JSON saved: ${relToRoot(jsonPath)}`);
}

async function saveActiveEditorText(page, savePath, requestedPath, notes) {
  if (!isTextLikeDownloadPath(requestedPath)) {
    return null;
  }

  const extracted = await page.evaluate((requested) => {
    const monaco = globalThis.monaco;
    if (!monaco?.editor) {
      return { ok: false, reason: 'monaco_unavailable' };
    }
    const normalize = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();
    const requestedPath = normalize(requested);
    const requestedBase = requestedPath.split('/').pop() || '';
    const models = typeof monaco.editor.getModels === 'function' ? monaco.editor.getModels() : [];
    const describeModel = (model) => {
      if (!model) {
        return null;
      }
      const uri = model.uri
        ? (typeof model.uri.toString === 'function' ? model.uri.toString() : (model.uri.path || model.uri.fsPath || ''))
        : '';
      const normalizedUri = normalize(uri);
      const base = normalizedUri.split('/').pop() || '';
      return {
        model,
        uri,
        normalizedUri,
        base
      };
    };
    const described = models.map(describeModel).filter(Boolean);
    const exact = described.find((entry) => entry.normalizedUri.endsWith(`/${requestedPath}`))
      || described.find((entry) => entry.base === requestedBase);
    if (!exact) {
      return {
        ok: false,
        reason: 'requested_model_not_found',
        requestedPath,
        availableModels: described.map((entry) => entry.uri).filter(Boolean)
      };
    }
    const value = typeof exact.model.getValue === 'function' ? exact.model.getValue() : '';
    const languageId = typeof exact.model.getLanguageId === 'function' ? exact.model.getLanguageId() : '';
    return {
      ok: Boolean(value),
      value,
      languageId,
      modelUri: exact.uri || ''
    };
  }, requestedPath).catch((err) => ({
    ok: false,
    reason: err.message
  }));

  if (!extracted.ok || !String(extracted.value || '')) {
    notes.push(`editor text fallback unavailable for ${requestedPath}: ${extracted.reason || 'empty editor model'}`);
    return null;
  }

  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  const text = String(extracted.value);
  fs.writeFileSync(savePath, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  return {
    savePath,
    languageId: extracted.languageId || '',
    modelUri: extracted.modelUri || ''
  };
}

async function buildFileTreeSnapshot(page, opts, notes) {
  await ensureFilesTab(page, opts);
  await expandAllVisibleFolders(page, opts, notes);
  const entries = await readTreeEntries(page, opts);
  return entries.map((entry) => ({
    label: entry.label,
    fullPath: entry.fullPath || entry.label,
    type: entry.kind,
    expanded: entry.expanded,
    depth: entry.depth,
    selector: entry.selector,
    index: entry.index,
    x: entry.x,
    y: entry.y
  }));
}

async function setFilesViaChooserSequence(page, trigger, chooser, absFiles, opts) {
  let supportsMultiple = false;
  try {
    supportsMultiple = await Promise.resolve(
      typeof chooser.isMultiple === 'function' ? chooser.isMultiple() : false
    );
  } catch (err) {
    supportsMultiple = false;
  }
  if (supportsMultiple || absFiles.length <= 1) {
    await chooser.setFiles(supportsMultiple ? absFiles : absFiles[0]);
    return {
      method: supportsMultiple ? 'filechooser' : 'filechooser_single',
      triggerSelector: trigger.selector
    };
  }

  await chooser.setFiles(absFiles[0]);
  for (const filePath of absFiles.slice(1)) {
    await page.waitForTimeout(500);
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
    await trigger.locator.click({ timeout: Math.min(opts.timeoutMs, 5000) });
    const nextChooser = await chooserPromise;
    if (!nextChooser) {
      throw new Error(`additional chooser did not appear for ${path.basename(filePath)}`);
    }
    await nextChooser.setFiles(filePath);
  }

  return {
    method: 'filechooser_single_repeated',
    triggerSelector: trigger.selector
  };
}

async function uploadFilesToDeepSea(page, opts, absFiles, notes) {
  if (!absFiles.length) {
    throw new Error('No upload files provided');
  }

  let fileInput = await pickLocator(page, opts.uploadInputSelectors);
  if (!fileInput) {
    const addButton = await pickActionableLocator(page, opts.addFileSelectors);
    if (!addButton) {
      throw new Error('Cannot find DeepSea upload input or add-file button. Set deepseaAutomation.uploadInputSelector/addFileSelector.');
    }

    let chooser = null;
    try {
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
      await addButton.locator.click({ timeout: Math.min(opts.timeoutMs, 5000) });
      chooser = await chooserPromise;
    } catch (err) {
      notes.push(`add-file button click did not produce chooser: ${err.message}`);
    }

    if (chooser) {
      return setFilesViaChooserSequence(page, addButton, chooser, absFiles, opts);
    }

    const uploadMenu = await pickActionableLocator(page, opts.uploadMenuSelectors);
    if (uploadMenu) {
      try {
        const chooserPromise = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
        await uploadMenu.locator.click({ timeout: Math.min(opts.timeoutMs, 5000) });
        chooser = await chooserPromise;
      } catch (err) {
        notes.push(`upload menu click did not produce chooser: ${err.message}`);
      }
      if (chooser) {
        const upload = await setFilesViaChooserSequence(page, uploadMenu, chooser, absFiles, opts);
        return {
          ...upload,
          method: upload.method === 'filechooser' ? 'upload_menu_filechooser' : `upload_menu_${upload.method}`
        };
      }
    }

    fileInput = await pickLocator(page, opts.uploadInputSelectors);
    if (!fileInput) {
      throw new Error('Add-file UI opened, but no file input became available.');
    }
  }

  const isMultiple = await fileInput.locator.evaluate((el) => el.hasAttribute('multiple')).catch(() => false);
  if (!isMultiple && absFiles.length > 1) {
    for (const filePath of absFiles) {
      await fileInput.locator.setInputFiles(filePath, { timeout: opts.timeoutMs });
      await page.waitForTimeout(500);
    }
    return { method: 'input_single_repeated', triggerSelector: fileInput.selector };
  }

  await fileInput.locator.setInputFiles(absFiles, { timeout: opts.timeoutMs });
  return { method: 'input', triggerSelector: fileInput.selector };
}

function buildDownloadTargetPath(runDir, resource, fallbackName) {
  if (resource.kind === 'pdf') {
    return path.join(runDir, 'preview.pdf');
  }
  if (resource.kind === 'file' && resource.path) {
    const normalized = resource.path.replace(/\\/g, '/').replace(/^\/+/, '');
    return path.join(runDir, normalized);
  }
  const name = String(fallbackName || 'current_file.txt').replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(runDir, name);
}

async function handleDownloadResource(page, opts, runDir, resource, notes) {
  const timeoutMs = Math.max(8000, opts.timeoutMs);
  if (resource.kind === 'unknown') {
    return {
      request: resource.raw,
      kind: 'unknown',
      status: 'unsupported_request',
      error: 'unsupported resource request format'
    };
  }

  if (resource.kind === 'pdf') {
    const target = buildDownloadTargetPath(runDir, resource);
    const direct = await tryDownloadViaSelectors(page, opts.pdfDownloadSelectors, target, timeoutMs, notes, null);
    if (direct) {
      return {
        request: resource.key,
        kind: 'pdf',
        status: 'downloaded',
        selectorUsed: direct.selector,
        suggestedFilename: direct.suggestedFilename,
        savedPath: relToRoot(target)
      };
    }
    return {
      request: resource.key,
      kind: 'pdf',
      status: 'download_failed',
      error: 'no PDF download selector succeeded'
    };
  }

  const currentFile = currentFileFromUrl(page.url());
  const requestedFile = resource.kind === 'file' ? resource.path : currentFile;
  const expectedBasename = requestedBasename(requestedFile || '');
  const target = buildDownloadTargetPath(runDir, resource, requestedFile || 'current_file');

  if (!requestedFile) {
    return {
      request: resource.key,
      kind: resource.kind,
      requestedPath: null,
      status: 'download_failed',
      error: 'no current file inferred from DeepSea URL'
    };
  }

  const selected = await selectFileByRequest(page, opts, requestedFile, notes);
  if (!selected.ok) {
    return {
      request: resource.key,
      kind: resource.kind,
      requestedPath: requestedFile,
      status: selected.reason === 'file_not_found_in_ui' ? 'needs_selector_config' : 'download_failed',
      error: selected.reason,
      hint: selected.hint || null
    };
  }

  const prefersEditorText = resource.kind === 'file' && isTextLikeDownloadPath(requestedFile);

  const interactionTarget = selected.pointTarget || selected.clickLocator || selected.locator;
  const opened = await ensureRequestedFileOpen(page, interactionTarget, requestedFile, timeoutMs, notes);
  if (!opened.ok) {
    notes.push(`requested file did not become current after selection: ${requestedFile}`);
  }

  if (prefersEditorText) {
    const viaEditorText = await saveActiveEditorText(page, target, requestedFile, notes);
    if (viaEditorText) {
      await clearSearchIfAny(page, opts);
      return {
        request: resource.key,
        kind: resource.kind,
        requestedPath: requestedFile || null,
        status: 'downloaded',
        selectorUsed: '__editor_text_fallback__',
        openStrategy: opened.strategy,
        currentFileAfterOpen: opened.currentFile || currentFileFromUrl(page.url()) || null,
        selectedVia: selected.selectorUsed,
        selectedLabel: selected.matchedLabel,
        selectedPath: selected.matchedPath || null,
        matchMode: selected.matchMode || null,
        savedPath: relToRoot(target),
        fallback: 'editor_text',
        languageId: viaEditorText.languageId || null,
        modelUri: viaEditorText.modelUri || null
      };
    }
  }

  if (resource.kind === 'file') {
    let contextMenuTarget = interactionTarget;
    const refreshedMatch = await revealTreeItemByRequest(page, opts, requestedFile, notes)
      || (!requestedFile.includes('/') ? await revealTreeItemByRequest(page, opts, requestedBasename(requestedFile), notes) : null);
    if (refreshedMatch) {
      const refreshedPointTarget = await findVisibleTextTarget(page, [refreshedMatch.label], {
        preferSidebar: true,
        sidebarMaxX: opts.sidebarMaxX,
        maxX: opts.sidebarMaxX,
        minY: 120,
        maxY: 2200,
        maxWidth: 260,
        maxHeight: 64
      });
      contextMenuTarget = refreshedPointTarget
        || await resolveTreeEntryClickTarget(refreshedMatch.locator, refreshedMatch.label);
    }
    const viaContextMenu = await openContextMenuAndDownload(
      page,
      opts,
      contextMenuTarget,
        target,
        timeoutMs,
        notes,
      expectedBasename
    );
    if (viaContextMenu) {
      await clearSearchIfAny(page, opts);
      return {
        request: resource.key,
        kind: resource.kind,
        requestedPath: requestedFile || null,
        status: 'downloaded',
        selectorUsed: viaContextMenu.selector,
        openStrategy: 'context_menu_direct',
        currentFileAfterOpen: currentFileFromUrl(page.url()) || null,
        selectedVia: selected.selectorUsed,
        selectedLabel: selected.matchedLabel,
        selectedPath: selected.matchedPath || null,
        matchMode: selected.matchMode || null,
        suggestedFilename: viaContextMenu.suggestedFilename,
        savedPath: relToRoot(target)
      };
    }
  }

  const direct = await tryDownloadViaSelectors(page, opts.currentFileDownloadSelectors, target, timeoutMs, notes, expectedBasename);
  if (direct) {
    await clearSearchIfAny(page, opts);
    return {
      request: resource.key,
      kind: resource.kind,
      requestedPath: requestedFile || null,
      status: 'downloaded',
      selectorUsed: direct.selector,
      openStrategy: opened.strategy,
      currentFileAfterOpen: opened.currentFile || currentFileFromUrl(page.url()) || null,
      selectedVia: selected.selectorUsed,
      selectedLabel: selected.matchedLabel,
      selectedPath: selected.matchedPath || null,
      matchMode: selected.matchMode || null,
      suggestedFilename: direct.suggestedFilename,
      savedPath: relToRoot(target)
    };
  }

  const viaMenu = await openMoreOptionsAndDownload(page, opts, target, timeoutMs, notes, expectedBasename);
  if (viaMenu) {
    await clearSearchIfAny(page, opts);
    return {
      request: resource.key,
      kind: resource.kind,
      requestedPath: requestedFile || null,
      status: 'downloaded',
      selectorUsed: viaMenu.selector,
      viaMoreOptions: viaMenu.viaMoreOptions,
      openStrategy: opened.strategy,
      currentFileAfterOpen: opened.currentFile || currentFileFromUrl(page.url()) || null,
      selectedVia: selected.selectorUsed,
      selectedLabel: selected.matchedLabel,
      selectedPath: selected.matchedPath || null,
      matchMode: selected.matchMode || null,
      suggestedFilename: viaMenu.suggestedFilename,
      savedPath: relToRoot(target)
    };
  }

  await clearSearchIfAny(page, opts);

  return {
    request: resource.key,
    kind: resource.kind,
    requestedPath: requestedFile || null,
    status: resource.kind === 'file' ? 'manual_required' : 'download_failed',
    selectedVia: selected.selectorUsed,
    selectedLabel: selected.matchedLabel,
    error: 'no file download selector succeeded',
    manualAction: resource.kind === 'file'
      ? 'Locate the file in the DeepSea Files tree, right-click it, and choose Download file.'
      : null
  };
}

async function actionListFiles(paths, opts, context, page, args) {
  const notes = [];
  const readiness = await ensureProjectPage(page, context, opts, resolveStorageStatePath(paths, opts.cfg), args.forceLogin);
  const entries = await buildFileTreeSnapshot(page, opts, notes);
  const outPath = path.join(paths.paperStateDir, 'deepsea_file_tree_latest.json');
  const payload = {
    timestamp: new Date().toISOString(),
    paperId: paths.paperId,
    projectUrl: opts.projectUrl,
    readiness,
    entryCount: entries.length,
    entries,
    notes
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

  writeStatus(paths, {
    status: 'list_files_completed',
    error: null,
    lastAction: 'list_files',
    projectUrl: opts.projectUrl,
    lastListedAt: payload.timestamp,
    lastFileTreePath: relToRoot(outPath),
    lastFileTreeCount: entries.length
  });

  return {
    ok: true,
    entryCount: entries.length,
    fileTreePath: relToRoot(outPath),
    entries
  };
}

async function actionUploadFiles(paths, opts, context, page, args) {
  const notes = [];
  const readiness = await ensureProjectPage(page, context, opts, resolveStorageStatePath(paths, opts.cfg), args.forceLogin);
  const filesPanel = await waitForFilesPanelReady(page, opts);
  if (!filesPanel.ready) {
    const error = `DeepSea Files panel is not upload-ready after ${filesPanel.waitedMs}ms.`;
    writeStatus(paths, {
      status: 'upload_not_ready',
      error,
      lastAction: 'upload_files',
      projectUrl: opts.projectUrl,
      lastUploadAt: new Date().toISOString(),
      uploadConfirmed: false
    });
    throw new Error(`${error} treeReady=${Boolean(filesPanel.treeReady)} addButtonEnabled=${Boolean(filesPanel.addButtonEnabled)} connecting=${Boolean(filesPanel.connectingDetected)} compiling=${Boolean(filesPanel.compilingDetected)} gettingReady=${Boolean(filesPanel.gettingReadyDetected)}`);
  }

  const absFiles = resolveUploadFiles(paths, args);
  const upload = await uploadFilesToDeepSea(page, opts, absFiles, notes);
  await page.waitForTimeout(1500);

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const confirmed = absFiles.every((filePath) => bodyText.includes(path.basename(filePath)));
  const actionSucceeded = Boolean(upload && upload.method);

  const result = {
    timestamp: new Date().toISOString(),
    paperId: paths.paperId,
    projectUrl: opts.projectUrl,
    readiness,
    filesPanel,
    uploadedFiles: absFiles.map((filePath) => relToRoot(filePath)),
    method: upload.method,
    triggerSelector: upload.triggerSelector,
    uploadActionSucceeded: actionSucceeded,
    uploadTextuallyConfirmed: confirmed,
    notes
  };

  const outPath = path.join(paths.paperStateDir, 'deepsea_upload_result.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  writeStatus(paths, {
    status: confirmed ? 'upload_completed' : 'upload_unconfirmed',
    error: null,
    lastAction: 'upload_files',
    projectUrl: opts.projectUrl,
    lastUploadAt: result.timestamp,
    lastUploadResultPath: relToRoot(outPath),
    lastUploadedFiles: result.uploadedFiles,
    uploadConfirmed: confirmed,
    uploadActionSucceeded: actionSucceeded,
    uploadTextuallyConfirmed: confirmed,
    filesPanelReady: Boolean(filesPanel.ready),
    filesPanelTreeReady: Boolean(filesPanel.treeReady),
    filesPanelAddButtonEnabled: Boolean(filesPanel.addButtonEnabled)
  });

  return {
    ok: true,
    resultPath: relToRoot(outPath),
    ...result
  };
}

async function actionDownload(paths, opts, context, page, args) {
  const resources = parseResources(args);
  const notes = [];
  const readiness = await ensureProjectPage(page, context, opts, resolveStorageStatePath(paths, opts.cfg), args.forceLogin);
  const chatReady = await waitForInteractiveDeepSeaChat(page, opts, Math.min(opts.timeoutMs, 12000));
  if (!readiness.ready || !chatReady.ready) {
    writeStatus(paths, {
      status: 'not_ready',
      error: `DeepSea workspace is not ready for download (ready=${Boolean(readiness.ready)} chatReady=${Boolean(chatReady.ready)}).`,
      lastAction: 'download',
      projectUrl: opts.projectUrl,
      readiness,
      chatReady
    });
    throw new Error('DeepSea workspace is not ready for download.');
  }
  const runDir = path.join(paths.downloadsDir, timestampTag());
  fs.mkdirSync(runDir, { recursive: true });

  const results = [];
  for (const resource of resources) {
    try {
      results.push(await handleDownloadResource(page, opts, runDir, resource, notes));
    } catch (err) {
      results.push({
        request: resource.key,
        kind: resource.kind,
        status: 'download_failed',
        error: err.message
      });
    }
  }

  const manifest = {
    timestamp: new Date().toISOString(),
    paperId: paths.paperId,
    projectUrl: opts.projectUrl,
    readiness,
    downloadDir: relToRoot(runDir),
    requests: resources.map((x) => x.key || x.raw),
    results,
    notes
  };
  const manifestPath = path.join(runDir, 'download_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  writeStatus(paths, {
    status: 'download_completed',
    error: null,
    lastAction: 'download',
    projectUrl: opts.projectUrl,
    lastDownloadAt: manifest.timestamp,
    lastDownloadDir: relToRoot(runDir),
    lastDownloadManifestPath: relToRoot(manifestPath),
    lastDownloadSummary: results.map((r) => ({ request: r.request, status: r.status, savedPath: r.savedPath || null }))
  });

  return {
    ok: true,
    downloadDir: relToRoot(runDir),
    manifestPath: relToRoot(manifestPath),
    results
  };
}

async function actionSend(paths, opts, context, page, args) {
  const storageStatePath = resolveStorageStatePath(paths, opts.cfg);
  const readiness = await ensureProjectPage(page, context, opts, storageStatePath, args.forceLogin);
  const chatReady = await waitForInteractiveDeepSeaChat(page, opts, Math.min(opts.timeoutMs, 12000));
  if (!args.allowUnready && (!readiness.ready || !chatReady.ready)) {
    writeStatus(paths, {
      status: 'not_ready',
      error: `DeepSea workspace is not ready for chat after ${readiness.waitedMs}ms (initializingVisible=${Boolean(readiness.initializingVisible)} chatReady=${Boolean(chatReady.ready)}).`,
      lastAction: 'send',
      projectUrl: opts.projectUrl,
      readiness,
      chatReady
    });
    throw new Error(`DeepSea workspace is not ready for chat after ${readiness.waitedMs}ms. Try again later or pass --allow-unready.`);
  }
  await ensureChatsTab(page, opts);

  const content = resolveMessageContent(paths, args);
  const previousStatus = readStatus(paths);
  const referencedUploads = referencedUploadedBasenames(content, previousStatus.lastUploadedFiles || []);
  if (previousStatus.lastAction === 'upload_files'
    && previousStatus.uploadActionSucceeded
    && referencedUploads.length > 0) {
    const uploadVisibility = await waitForUploadedFilesVisible(page, opts, referencedUploads, Math.min(opts.timeoutMs, 30000));
    if (!uploadVisibility.ready) {
      writeStatus(paths, {
        status: 'upload_not_yet_visible_for_send',
        error: `Referenced uploaded files are not yet visible in DeepSea Files panel: ${uploadVisibility.missing.join(', ')}`,
        lastAction: 'send',
        projectUrl: opts.projectUrl,
        referencedUploadedFiles: referencedUploads,
        uploadVisibility
      });
      throw new Error(`Referenced uploaded files are not yet visible in DeepSea: ${uploadVisibility.missing.join(', ')}`);
    }
    writeStatus(paths, {
      lastAction: 'send',
      referencedUploadedFiles: referencedUploads,
      uploadVisibility
    });
  }
  let sendAttempt = 0;
  let recoveryCount = 0;
  let attempt;
  while (true) {
    sendAttempt += 1;
    attempt = await attemptDeepSeaSend(page, opts, content, args);
    if (attempt.composeOnly) {
      break;
    }
    if (!(args.retryOnConversationError && attempt.acceptance?.conversationProcessingError?.detected && recoveryCount < args.maxConversationErrorRetries)) {
      break;
    }
    recoveryCount += 1;
    const recovered = await recoverFromConversationProcessingError(paths, page, opts, recoveryCount, attempt.acceptance);
    if (!recovered.readiness.ready || !recovered.chatReady.ready) {
      break;
    }
  }

  if (attempt.composeOnly) {
    writeStatus(paths, {
      status: 'composed',
      error: null,
      lastAction: 'send',
      composeOnly: true,
      inputSelectorUsed: attempt.input.selector,
      projectUrl: opts.projectUrl,
      lastComposedAt: new Date().toISOString(),
      sendAttemptCount: sendAttempt,
      recoveryCount
    });
    return {
      ok: true,
      sent: false,
      composeOnly: true,
      inputSelectorUsed: attempt.input.selector,
      sendAttemptCount: sendAttempt,
      recoveryCount
    };
  }
  let { input, send, technicalSendOk, acceptance } = attempt;
  if (technicalSendOk && !acceptance.accepted && !acceptance.conversationProcessingError?.detected) {
    const lateAcceptance = await lateVerifyDeepSeaMessageAccepted(page, opts, content, {
      centralMessageCount: attempt.baselineConversation?.centralMessageCount || 0
    });
    if (lateAcceptance) {
      acceptance = {
        ...acceptance,
        ...lateAcceptance
      };
    }
  }
  const sendClassification = classifyDeepSeaSendStatus(acceptance);
  const sendStatus = sendClassification.status;
  const sendError = sendClassification.sent
    ? null
    : (acceptance.conversationProcessingError?.text || 'DeepSea send input action completed but page acceptance was not confirmed.');

  writeStatus(paths, {
    status: sendStatus,
    error: sendError,
    lastAction: 'send',
    composeOnly: false,
    inputSelectorUsed: input.selector,
    sendSelectorUsed: send ? send.selector : null,
    projectUrl: opts.projectUrl,
    lastSentAt: new Date().toISOString(),
    sendAttemptCount: sendAttempt,
    recoveryCount,
    technicalSendOk,
    pageReadyAndTraceable: sendClassification.pageReadyAndTraceable,
    likelyDeliveredButUntraceable: sendClassification.likelyDeliveredButUntraceable,
    workspaceVisible: acceptance.workspaceVisible,
    chatComposerReady: acceptance.chatComposerReady,
    chatHistoryTraceable: acceptance.chatHistoryTraceable,
    expectedMessageTraceable: acceptance.expectedMessageTraceable,
    sendAcceptance: acceptance,
    conversationProcessingError: acceptance.conversationProcessingError || null,
    chatReady
  });

  return {
    ok: true,
    sent: sendClassification.sent,
    technicalSendOk,
    pageReadyAndTraceable: sendClassification.pageReadyAndTraceable,
    sendAttemptCount: sendAttempt,
    recoveryCount,
    likelyDeliveredButUntraceable: sendClassification.likelyDeliveredButUntraceable,
    workspaceVisible: acceptance.workspaceVisible,
    chatComposerReady: acceptance.chatComposerReady,
    chatHistoryTraceable: acceptance.chatHistoryTraceable,
    expectedMessageTraceable: acceptance.expectedMessageTraceable,
    inputSelectorUsed: input.selector,
    sendSelectorUsed: send ? send.selector : null,
    sendAcceptance: acceptance,
    conversationProcessingError: acceptance.conversationProcessingError || null
  };
}

async function readLatestAssistantText(page, selectors) {
  for (const selector of selectors) {
    try {
      const blocks = page.locator(selector);
      const count = await blocks.count();
      if (count > 0) {
        const last = blocks.nth(count - 1);
        const text = String(await last.innerText().catch(() => '')).trim();
        if (text) {
          return { selectorUsed: selector, text };
        }
      }
    } catch (err) {
      // continue
    }
  }
  return null;
}

async function readLatestAssistantTextFallback(page) {
  const payload = await page.evaluate(() => {
    const root = document.querySelector('#project-page-main-panel') || document.querySelector('main') || document.body;
    const nodes = Array.from(root.querySelectorAll('*')).filter((el) => {
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript') return false;
      if (el.closest('.monaco-editor, .view-lines, [class*="monaco"]')) return false;
      if (el.closest('button, [role="button"], textarea, input, [contenteditable="true"]')) return false;

      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 8) return false;

      const rect = el.getBoundingClientRect();
      if (rect.y < 0 || rect.bottom > window.innerHeight + 20) return false;
      if (rect.x < 260 || rect.x > 760) return false;
      if (rect.width < 120 || rect.width > 520) return false;
      if (rect.height < 18 || rect.height > 260) return false;

      const childWithSameText = Array.from(el.children || []).some((child) => {
        const childText = (child.innerText || child.textContent || '').replace(/\s+/g, ' ').trim();
        return childText && childText === text;
      });
      return !childWithSameText;
    }).map((el) => {
      const rect = el.getBoundingClientRect();
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        text,
        tag: (el.tagName || '').toLowerCase(),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    }).sort((a, b) => (a.y - b.y) || (a.x - b.x));

    return {
      count: nodes.length,
      last: nodes.length >= 2 ? nodes[nodes.length - 1] : null
    };
  });

  if (!payload || !payload.last || payload.count < 2) {
    return null;
  }

  return {
    selectorUsed: '__fallback_visible_leaf__',
    text: String(payload.last.text || '').trim()
  };
}

async function isStopButtonVisible(page, selectors) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.count() > 0 && await locator.isVisible()) {
        return true;
      }
    } catch (err) {
      // continue
    }
  }
  return false;
}

async function waitUntilAssistantSettles(paths, page, opts, pollSeconds, settleSeconds, maxWaitSeconds) {
  const start = Date.now();
  let lastSig = '';
  let lastChangeAt = null;
  let seenAnyReply = false;
  let lastSample = null;

  while ((Date.now() - start) / 1000 < maxWaitSeconds) {
    const stopVisible = await isStopButtonVisible(page, opts.stopSelectors);
    let latest = await readLatestAssistantText(page, opts.assistantSelectors);
    if (!latest) {
      latest = await readLatestAssistantTextFallback(page);
    }

    if (latest && latest.text) {
      lastSample = latest;
      if (latest.text !== lastSig) {
        lastSig = latest.text;
        lastChangeAt = Date.now();
        seenAnyReply = true;
        writeStatus(paths, {
          status: 'waiting_reply',
          lastAction: 'fetch_reply',
          generating: stopVisible,
          seenAnyReply: true,
          observedReplyLength: latest.text.length,
          lastObservedReplyAt: new Date().toISOString()
        });
      } else if (!stopVisible && seenAnyReply && lastChangeAt && (Date.now() - lastChangeAt) / 1000 >= settleSeconds) {
        return latest;
      }
    }

    await page.waitForTimeout(pollSeconds * 1000);
  }

  return lastSample;
}

async function actionFetchReply(paths, opts, context, page, args) {
  const storageStatePath = resolveStorageStatePath(paths, opts.cfg);
  const readiness = await ensureProjectPage(page, context, opts, storageStatePath, args.forceLogin);
  const chatReady = await waitForInteractiveDeepSeaChat(page, opts, Math.min(opts.timeoutMs, 12000));
  if (!readiness.ready || !chatReady.ready) {
    writeStatus(paths, {
      status: 'not_ready',
      error: `DeepSea workspace is not ready for fetch_reply (ready=${Boolean(readiness.ready)} chatReady=${Boolean(chatReady.ready)}).`,
      lastAction: 'fetch_reply',
      projectUrl: opts.projectUrl,
      readiness,
      chatReady
    });
    throw new Error('DeepSea workspace is not ready for fetch_reply.');
  }
  await ensureChatsTab(page, opts);
  const preInspect = await readDeepSeaConversationSignals(page, opts);
  if (preInspect.conversationProcessingError?.detected) {
    writeStatus(paths, {
      status: 'conversation_processing_error',
      error: preInspect.conversationProcessingError.text,
      lastAction: 'fetch_reply',
      projectUrl: opts.projectUrl,
      conversationProcessingError: {
        ...preInspect.conversationProcessingError,
        detectedAt: new Date().toISOString(),
        suggestedRetry: true
      },
      workspaceVisible: preInspect.workspaceVisible,
      chatHistoryTraceable: preInspect.centralMessageCount > 0
    });
    throw new Error(preInspect.conversationProcessingError.text);
  }

  if (args.waitSeconds > 0) {
    writeStatus(paths, {
      status: 'waiting_reply',
      lastAction: 'fetch_reply',
      waitSeconds: args.waitSeconds,
      waitStartedAt: new Date().toISOString()
    });
    await page.waitForTimeout(args.waitSeconds * 1000);
  }

  const latest = await waitUntilAssistantSettles(paths, page, opts, args.pollSeconds, args.settleSeconds, args.maxWaitSeconds);
  if (!latest) {
    const inspect = await actionInspectChat(paths, opts, context, page, {
      ...args,
      _fromFetchFallback: true
    });
    const inspectPath = path.join(paths.paperStateDir, 'deepsea_chat_inspect.json');
    const inspectPayload = fs.existsSync(inspectPath) ? JSON.parse(fs.readFileSync(inspectPath, 'utf8')) : null;
    const visibleLeaves = Array.isArray(inspectPayload?.visibleTextLeaves) ? inspectPayload.visibleTextLeaves : [];
    const lastVisible = visibleLeaves.length ? visibleLeaves[visibleLeaves.length - 1] : null;
    const fallbackText = normalizeInlineText(lastVisible?.text || '');
    const chatHistoryTraceable = Boolean(inspectPayload?.chatHistoryTraceable);
    if (!fallbackText || !chatHistoryTraceable) {
      writeStatus(paths, {
        status: 'chat_not_traceable_after_send',
        error: !chatHistoryTraceable
          ? 'inspect_chat did not find traceable DeepSea chat history.'
          : 'Cannot find DeepSea assistant reply.',
        lastAction: 'fetch_reply',
        projectUrl: opts.projectUrl,
        replyCaptureMode: 'inspect_chat_visible_leaf',
        inspectPath: inspect.inspectPath || relToRoot(inspectPath),
        chatHistoryTraceable,
        conversationProcessingError: inspectPayload?.conversationProcessingError || null
      });
      throw new Error('Cannot find DeepSea assistant reply. Set deepseaAutomation.assistantMessageSelector in deepsea.json');
    }

    const replyPath = path.join(paths.promptsDir, 'deepsea_reply.txt');
    const rawVisiblePath = path.join(paths.paperStateDir, 'reply_raw_visible.txt');
    fs.writeFileSync(replyPath, `${fallbackText}\n`, 'utf8');
    fs.writeFileSync(rawVisiblePath, `${fallbackText}\n`, 'utf8');

    writeStatus(paths, {
      status: 'reply_saved',
      error: null,
      lastAction: 'fetch_reply',
      assistantSelectorUsed: '__inspect_chat_visible_leaf__',
      projectUrl: opts.projectUrl,
      lastReplySavedAt: new Date().toISOString(),
      replyPath: relToRoot(replyPath),
      replyCaptureMode: 'inspect_chat_visible_leaf',
      replyRawVisiblePath: relToRoot(rawVisiblePath),
      inspectPath: inspect.inspectPath || relToRoot(inspectPath),
      chatHistoryTraceable,
      conversationProcessingError: inspectPayload?.conversationProcessingError || null
    });

    return {
      ok: true,
      replyPath: relToRoot(replyPath),
      selectorUsed: '__inspect_chat_visible_leaf__',
      length: fallbackText.length,
      replyCaptureMode: 'inspect_chat_visible_leaf',
      inspectPath: inspect.inspectPath || relToRoot(inspectPath),
      chatHistoryTraceable,
      conversationProcessingError: inspectPayload?.conversationProcessingError || null
    };
  }

  const replyPath = path.join(paths.promptsDir, 'deepsea_reply.txt');
  const rawVisiblePath = path.join(paths.paperStateDir, 'reply_raw_visible.txt');
  fs.writeFileSync(replyPath, `${latest.text}\n`, 'utf8');
  fs.writeFileSync(rawVisiblePath, `${latest.text}\n`, 'utf8');

  writeStatus(paths, {
    status: 'reply_saved',
    error: null,
    lastAction: 'fetch_reply',
    assistantSelectorUsed: latest.selectorUsed,
    projectUrl: opts.projectUrl,
    lastReplySavedAt: new Date().toISOString(),
    replyPath: relToRoot(replyPath),
    replyCaptureMode: latest.selectorUsed === '__fallback_visible_leaf__' ? 'visible_leaf' : 'assistant_selector',
    replyRawVisiblePath: relToRoot(rawVisiblePath)
  });

  return {
    ok: true,
    replyPath: relToRoot(replyPath),
    selectorUsed: latest.selectorUsed,
    length: latest.text.length,
    replyCaptureMode: latest.selectorUsed === '__fallback_visible_leaf__' ? 'visible_leaf' : 'assistant_selector'
  };
}

async function actionInspectChat(paths, opts, context, page, args) {
  const storageStatePath = resolveStorageStatePath(paths, opts.cfg);
  const readiness = await ensureProjectPage(page, context, opts, storageStatePath, args.forceLogin);
  const chatReady = await waitForInteractiveDeepSeaChat(page, opts, Math.min(opts.timeoutMs, 12000));
  if (!readiness.ready || !chatReady.ready) {
    writeStatus(paths, {
      status: 'not_ready',
      error: `DeepSea workspace is not ready for inspect_chat (ready=${Boolean(readiness.ready)} chatReady=${Boolean(chatReady.ready)}).`,
      lastAction: 'inspect_chat',
      projectUrl: opts.projectUrl,
      readiness,
      chatReady
    });
    throw new Error('DeepSea workspace is not ready for inspect_chat.');
  }
  await ensureChatsTab(page, opts);
  await page.waitForTimeout(800);
  const conversation = await readDeepSeaConversationSignals(page, opts, args.expectedText || '');

  const payload = await page.evaluate((selectorGroups) => {
    function grab(list) {
      return list.slice(0, 80).map((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          tag: (el.tagName || '').toLowerCase(),
          role: el.getAttribute('role') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          dataTestId: el.getAttribute('data-testid') || '',
          authorRole: el.getAttribute('data-message-author-role') || '',
          text: text.slice(0, 500),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          outerHtml: String(el.outerHTML || '').slice(0, 800)
        };
      }).filter((item) => item.text || item.ariaLabel || item.dataTestId || item.authorRole);
    }

    function inspectSelectors(selectors) {
      return selectors.map((selector) => {
        let matches = [];
        try {
          matches = Array.from(document.querySelectorAll(selector));
        } catch (err) {
          return {
            selector,
            count: 0,
            error: String(err && err.message ? err.message : err)
          };
        }

        return {
          selector,
          count: matches.length,
          samples: grab(matches).slice(0, 5)
        };
      });
    }

    function visibleTextLeaves() {
      const root = document.querySelector('#project-page-main-panel') || document.querySelector('main') || document.body;
      const nodes = Array.from(root.querySelectorAll('*')).filter((el) => {
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript') return false;
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 16) return false;
        if (rect.bottom < 0 || rect.right < 0) return false;
        const childWithSameText = Array.from(el.children || []).some((child) => {
          const childText = (child.innerText || child.textContent || '').replace(/\s+/g, ' ').trim();
          return childText && childText === text;
        });
        return !childWithSameText;
      });

      return nodes.slice(0, 240).map((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          tag: (el.tagName || '').toLowerCase(),
          role: el.getAttribute('role') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          dataTestId: el.getAttribute('data-testid') || '',
          authorRole: el.getAttribute('data-message-author-role') || '',
          text: text.slice(0, 500),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          outerHtml: String(el.outerHTML || '').slice(0, 800)
        };
      });
    }

    const candidates = Array.from(document.querySelectorAll(
      '[data-message-author-role], article, [role="article"], [data-testid*="conversation"], [data-testid*="chat"], [class*="chat"], [class*="message"]'
    ));
    const buttons = Array.from(document.querySelectorAll('button,[role="button"]'));
    const probeTexts = [
      'Pipeline precheck only',
      'DEEPSEA_PRECHECK_OK',
      'Stop',
      'Regenerate',
      'Copy',
      'Thinking'
    ];

    return {
      url: location.href,
      title: document.title,
      textBlocks: grab(candidates),
      buttons: grab(buttons),
      visibleTextLeaves: visibleTextLeaves(),
      selectorDiagnostics: {
        assistant: inspectSelectors(selectorGroups.assistantSelectors || []),
        stop: inspectSelectors(selectorGroups.stopSelectors || []),
        input: inspectSelectors(selectorGroups.inputSelectors || []),
        send: inspectSelectors(selectorGroups.sendSelectors || [])
      },
      textHits: probeTexts.map((needle) => {
        const hits = Array.from(document.querySelectorAll('body *')).filter((el) => {
          const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          return text.includes(needle);
        });
        return {
          needle,
          count: hits.length,
          samples: grab(hits).slice(0, 5)
        };
      })
    };
  }, {
    assistantSelectors: opts.assistantSelectors,
    stopSelectors: opts.stopSelectors,
    inputSelectors: opts.inputSelectors,
    sendSelectors: opts.sendSelectors
  });

  const outPath = path.join(paths.paperStateDir, 'deepsea_chat_inspect.json');
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  const htmlPath = path.join(paths.paperStateDir, 'deepsea_chat_inspect.html');
  fs.writeFileSync(htmlPath, await page.content(), 'utf8');
  payload.workspaceVisible = Boolean(conversation.workspaceVisible);
  payload.chatHistoryTraceable = Boolean(conversation.centralMessageCount > 0);
  payload.centralMessageCount = Number(conversation.centralMessageCount || 0);
  payload.expectedMessageTraceable = Boolean(conversation.expectedMessageTraceable);
  payload.conversationProcessingError = conversation.conversationProcessingError || null;
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

  writeStatus(paths, {
    status: 'inspect_chat_completed',
    error: null,
    lastAction: 'inspect_chat',
    projectUrl: opts.projectUrl,
    lastChatInspectAt: new Date().toISOString(),
    lastChatInspectPath: relToRoot(outPath),
    lastChatInspectHtmlPath: relToRoot(htmlPath),
    replyCaptureMode: 'inspect_only',
    workspaceVisible: payload.workspaceVisible,
    chatComposerReady: Boolean(chatReady.ready),
    chatHistoryTraceable: payload.chatHistoryTraceable,
    expectedMessageTraceable: payload.expectedMessageTraceable,
    conversationProcessingError: payload.conversationProcessingError
  });

  return {
    ok: true,
    inspectPath: relToRoot(outPath),
    inspectHtmlPath: relToRoot(htmlPath),
    textBlockCount: payload.textBlocks.length,
    workspaceVisible: payload.workspaceVisible,
    chatHistoryTraceable: payload.chatHistoryTraceable,
    expectedMessageTraceable: payload.expectedMessageTraceable,
    conversationProcessingError: payload.conversationProcessingError,
    buttonCount: payload.buttons.length
  };
}

function buildDryRunPayload(paths, opts, args) {
  const payload = {
    ok: true,
    dryRun: true,
    paperId: paths.paperId,
    action: args.action,
    projectUrl: opts.projectUrl,
    authMode: opts.authMode,
    cdpUrl: opts.cdpUrl || null,
    selectors: {}
  };

  if (args.action === 'download') {
    payload.resources = parseResources(args).map((x) => x.key || x.raw);
    payload.selectors.pdfDownloadSelectors = opts.pdfDownloadSelectors;
    payload.selectors.currentFileDownloadSelectors = opts.currentFileDownloadSelectors;
    payload.selectors.moreOptionsSelectors = opts.moreOptionsSelectors;
    payload.selectors.contextMenuDownloadSelectors = opts.contextMenuDownloadSelectors;
    payload.selectors.filesTabSelectors = opts.filesTabSelectors;
    payload.selectors.treeItemSelectors = opts.treeItemSelectors;
  } else if (args.action === 'list_files') {
    payload.selectors.filesTabSelectors = opts.filesTabSelectors;
    payload.selectors.treeItemSelectors = opts.treeItemSelectors;
    payload.selectors.fileSearchInputSelectors = opts.fileSearchInputSelectors;
  } else if (args.action === 'upload_files') {
    payload.files = resolveUploadFiles(paths, args).map((filePath) => relToRoot(filePath));
    payload.selectors.addFileSelectors = opts.addFileSelectors;
    payload.selectors.uploadInputSelectors = opts.uploadInputSelectors;
  } else if (args.action === 'inspect_chat') {
    payload.selectors.chatsTabSelectors = opts.chatsTabSelectors;
    payload.selectors.assistantSelectors = opts.assistantSelectors;
    payload.selectors.stopSelectors = opts.stopSelectors;
  } else if (args.action === 'send') {
    payload.messagePreview = resolveMessageContent(paths, args).slice(0, 200);
    payload.composeOnly = args.composeOnly;
    payload.selectors.chatsTabSelectors = opts.chatsTabSelectors;
    payload.selectors.inputSelectors = opts.inputSelectors;
    payload.selectors.sendSelectors = opts.sendSelectors;
  } else if (args.action === 'fetch_reply') {
    payload.selectors.chatsTabSelectors = opts.chatsTabSelectors;
    payload.selectors.assistantSelectors = opts.assistantSelectors;
    payload.selectors.stopSelectors = opts.stopSelectors;
  }

  return payload;
}

async function main() {
  const args = parseArgs(process.argv);
  const paths = paperPaths(args.paper);
  ensurePaperLayout(paths);
  const opts = parseConfig(paths);

  if (args.dryRun) {
    console.log(JSON.stringify(buildDryRunPayload(paths, opts, args), null, 2));
    return;
  }

  writeStatus(paths, {
    status: 'running',
    lastAction: args.action,
    projectUrl: opts.projectUrl
  });

  const storageStatePath = resolveStorageStatePath(paths, opts.cfg);
  fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });

  let session;
  try {
    session = await createSession(opts, storageStatePath);
    const page = await pickPageForTarget(session.context, opts.projectUrl);

    let result;
    if (args.action === 'list_files') {
      result = await actionListFiles(paths, opts, session.context, page, args);
    } else if (args.action === 'upload_files') {
      result = await actionUploadFiles(paths, opts, session.context, page, args);
    } else if (args.action === 'inspect_chat') {
      result = await actionInspectChat(paths, opts, session.context, page, args);
    } else if (args.action === 'download') {
      result = await actionDownload(paths, opts, session.context, page, args);
    } else if (args.action === 'send') {
      result = await actionSend(paths, opts, session.context, page, args);
    } else if (args.action === 'fetch_reply') {
      result = await actionFetchReply(paths, opts, session.context, page, args);
    } else {
      throw new Error(`Unknown action: ${args.action}`);
    }

    if (session.sessionKind === 'storage_state') {
      await session.context.storageState({ path: storageStatePath }).catch(() => {});
    }

    console.log(JSON.stringify({ ok: true, paperId: paths.paperId, action: args.action, result }, null, 2));
  } catch (err) {
    writeStatus(paths, {
      status: 'failed',
      lastAction: args.action,
      error: err.message,
      projectUrl: opts.projectUrl
    });
    console.error(err.message);
    process.exit(1);
  } finally {
    if (session?.cdpBrowser) {
      await session.cdpBrowser.close().catch(() => {});
    } else if (session?.browser) {
      await session.browser.close().catch(() => {});
    } else if (session?.context) {
      await session.context.close().catch(() => {});
    }
  }
}

main();

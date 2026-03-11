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
  sanitizePaperId,
  paperPaths,
  loadPaperConfig,
  resolveStorageStatePath,
  timestampTag,
  relToRoot
} = require('./paper_paths');

const ALLOWED_WAIT_UNTIL = new Set(['load', 'domcontentloaded', 'networkidle']);

function parseArgs(argv) {
  const out = {
    paper: 'paper_default',
    forceLogin: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--paper' && argv[i + 1]) {
      out.paper = argv[i + 1];
      i += 1;
    } else if (arg === '--force-login') {
      out.forceLogin = true;
    }
  }

  out.paper = sanitizePaperId(out.paper);
  return out;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resetDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function clampLines(lines, max = 260) {
  if (lines.length <= max) {
    return lines;
  }
  const out = lines.slice(0, max);
  out.push('');
  out.push(`(summary truncated at ${max} lines)`);
  return out;
}

function trimText(text, max = 180) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function toStringArray(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

function askEnter(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, () => {
      rl.close();
      resolve();
    });
  });
}

function safeHost(urlLike) {
  try {
    return new URL(String(urlLike || '')).host.toLowerCase();
  } catch (err) {
    return '';
  }
}

async function pickPageForTarget(context, targetUrl) {
  const pages = context.pages();
  const targetHost = safeHost(targetUrl);

  if (targetHost) {
    const hostMatch = pages.find((p) => safeHost(p.url()) === targetHost);
    if (hostMatch) {
      return hostMatch;
    }
  }

  const deepseaMatch = pages.find((p) => /deepsea\.openai\.com/i.test(String(p.url() || '')));
  if (deepseaMatch) {
    return deepseaMatch;
  }

  const blankLike = pages.find((p) => {
    const u = String(p.url() || '');
    return u === '' || u === 'about:blank' || /^chrome:\/\/newtab\/?$/i.test(u);
  });
  if (blankLike) {
    return blankLike;
  }

  return context.newPage();
}

async function waitForDeepSeaReady(page, cfg, capture) {
  const readyTimeoutMsRaw = Number(cfg.capture?.deepseaReadyTimeoutMs || 90000);
  const readyPollMsRaw = Number(cfg.capture?.deepseaReadyPollMs || 2000);
  const readyTimeoutMs = Number.isFinite(readyTimeoutMsRaw) && readyTimeoutMsRaw > 0 ? readyTimeoutMsRaw : 90000;
  const readyPollMs = Number.isFinite(readyPollMsRaw) && readyPollMsRaw > 0 ? readyPollMsRaw : 2000;

  const readySelectors = toStringArray(cfg.capture?.deepseaReadySelectors);
  const selectors = readySelectors.length > 0
    ? readySelectors
    : [
      '.monaco-editor',
      '[class*="monaco-editor"]',
      '[data-testid*="editor"]',
      '[role="code"]',
      'main'
    ];

  const challengeTitleMarkers = toStringArray(cfg.capture?.challengeTitleMarkers).map((s) => s.toLowerCase());
  const titleMarkers = challengeTitleMarkers.length > 0
    ? challengeTitleMarkers
    : ['just a moment', 'checking your browser', 'attention required'];

  const challengeBodyMarkers = toStringArray(cfg.capture?.challengeBodyMarkers).map((s) => s.toLowerCase());
  const bodyMarkers = challengeBodyMarkers.length > 0
    ? challengeBodyMarkers
    : ['verify you are human', 'checking your browser', 'cloudflare', 'captcha'];

  const startMs = Date.now();
  let last = {
    ready: false,
    challengeDetected: false,
    gettingReadyDetected: false,
    loadingDetected: false,
    askAnythingDetected: false,
    inputVisible: false,
    title: '',
    url: '',
    matchedSelector: null,
    bodyTextLength: 0,
    waitedMs: 0
  };

  while (Date.now() - startMs <= readyTimeoutMs) {
    const title = await page.title().catch(() => '');
    const url = page.url();
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const lowerTitle = String(title || '').toLowerCase();
    const lowerBody = String(bodyText || '').toLowerCase();

    const challengeByTitle = titleMarkers.some((m) => lowerTitle.includes(m));
    const challengeByBody = bodyMarkers.some((m) => lowerBody.includes(m));
    const challengeDetected = challengeByTitle || challengeByBody;
    const gettingReadyDetected = lowerBody.includes('getting ready...');
    const loadingDetected = /\bloading\.\.\./i.test(bodyText);
    const inputLocator = page.locator('textarea, [contenteditable=\"true\"][role=\"textbox\"], [contenteditable=\"true\"]').first();
    const inputVisible = await inputLocator.count().then((count) => count > 0).catch(() => false)
      ? await inputLocator.isVisible().catch(() => false)
      : false;
    const inputPlaceholder = inputVisible
      ? await inputLocator.evaluate((el) => String(
          el.getAttribute('placeholder')
          || el.getAttribute('aria-label')
          || el.getAttribute('data-placeholder')
          || ''
        )).catch(() => '')
      : '';
    const askAnythingDetected = lowerBody.includes('ask anything') || /ask anything/i.test(String(inputPlaceholder || ''));

    let matchedSelector = null;
    for (const selector of selectors) {
      try {
        const loc = page.locator(selector).first();
        if (await loc.count() > 0) {
          const visible = await loc.isVisible().catch(() => true);
          if (visible) {
            matchedSelector = selector;
            break;
          }
        }
      } catch (err) {
        // Ignore selector probe failures
      }
    }

    const hostLooksDeepSea = /deepsea\.openai\.com/i.test(url);
    const titleLooksDeepSea = /deepsea/i.test(title) && !challengeDetected;
    const ready = !challengeDetected
      && !gettingReadyDetected
      && !loadingDetected
      && inputVisible
      && askAnythingDetected
      && hostLooksDeepSea
      && (Boolean(matchedSelector) || titleLooksDeepSea);
    last = {
      ready,
      challengeDetected,
      gettingReadyDetected,
      loadingDetected,
      askAnythingDetected,
      inputVisible,
      title,
      url,
      matchedSelector,
      bodyTextLength: bodyText.length,
      waitedMs: Date.now() - startMs
    };

    if (ready) {
      capture.notes.push(
        `DeepSea ready detected after ${Math.round(last.waitedMs / 1000)}s` +
        (matchedSelector ? ` (selector: ${matchedSelector})` : ' (title/url heuristic)')
      );
      return last;
    }

    await page.waitForTimeout(readyPollMs);
  }

  capture.notes.push(`DeepSea readiness not confirmed within ${readyTimeoutMs}ms; capture will stop.`);
  if (last.challengeDetected) {
    capture.notes.push('Challenge-like signals detected while waiting for readiness.');
  }
  return last;
}

async function tryUiPdfDownload(page, cfg, historyRunDir, capture) {
  const selectors = toStringArray(cfg.capture?.pdfDownloadSelectors);
  const pdfButtonSelectors = selectors.length > 0
    ? selectors
    : [
      'button:has-text("Download PDF")',
      '[aria-label="Download PDF"]',
      '[title="Download PDF"]',
      'button:has-text("Download file")',
      '[aria-label="Download file"]'
    ];

  const timeoutRaw = Number(cfg.capture?.pdfDownloadTimeoutMs || 12000);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 12000;

  for (const selector of pdfButtonSelectors) {
    try {
      const loc = page.locator(selector).first();
      if (await loc.count() === 0) {
        continue;
      }

      const isVisible = await loc.isVisible().catch(() => true);
      if (!isVisible) {
        continue;
      }

      const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs }).catch(() => null);
      await loc.click({ timeout: Math.min(timeoutMs, 5000) });
      const download = await downloadPromise;
      if (!download) {
        continue;
      }

      const savedPdfPath = path.join(historyRunDir, 'preview.pdf');
      await download.saveAs(savedPdfPath);
      return {
        ok: true,
        selector,
        savedPdfPath,
        suggestedFilename: download.suggestedFilename()
      };
    } catch (err) {
      capture.notes.push(`UI PDF download probe failed (${selector}): ${trimText(err.message, 180)}`);
    }
  }

  return { ok: false };
}

function createEmptyAssets() {
  return {
    anchors: [],
    scripts: [],
    stylesheets: [],
    images: [],
    iframes: [],
    objects: [],
    embeds: [],
    pdfCandidates: []
  };
}

function createEmptySignals() {
  return {
    headings: [],
    sections: [],
    figures: [],
    tables: [],
    codeBlocks: [],
    latexBlocks: [],
    comments: []
  };
}

function classifyFrameError(message) {
  const m = String(message || '').toLowerCase();
  if (!m) return 'inaccessible';
  if (m.includes('cross-origin') || m.includes('blocked a frame') || m.includes('permission denied')) {
    return 'cross_origin';
  }
  return 'inaccessible';
}

function toAbsUrl(urlLike, baseUrl) {
  if (!urlLike) return null;
  try {
    return new URL(urlLike, baseUrl).toString();
  } catch (err) {
    return null;
  }
}

function writeFileSafe(capture, filePath, content, key, encoding = 'utf8') {
  try {
    fs.writeFileSync(filePath, content, encoding);
    capture.outputs[key] = {
      ok: true,
      path: relToRoot(filePath)
    };
  } catch (err) {
    capture.outputs[key] = {
      ok: false,
      path: relToRoot(filePath),
      error: err.message
    };
    capture.errors.push({ step: `write:${key}`, message: err.message });
  }
}

async function safeStep(capture, step, fn, fallbackValue) {
  try {
    return await fn();
  } catch (err) {
    capture.errors.push({ step, message: err.message });
    capture.notes.push(`${step} failed: ${err.message}`);
    return fallbackValue;
  }
}

function buildDomSummary(data) {
  const {
    paperId,
    captureDir,
    pageUrl,
    title,
    signals,
    framesPayload,
    assets,
    capture,
    availableFiles
  } = data;

  const lines = [];
  lines.push('# DOM Summary');
  lines.push('');
  lines.push(`- paper_id: ${paperId}`);
  lines.push(`- capture_dir: ${captureDir}`);
  lines.push(`- url: ${pageUrl || '(unavailable)'}`);
  lines.push(`- title: ${title || '(unavailable)'}`);
  lines.push(`- capture_status: ${capture.status}`);
  lines.push(`- wait_until: ${capture.captureConfig.waitUntil}`);
  lines.push(`- timeout_ms: ${capture.captureConfig.timeoutMs}`);
  if (capture.captureConfig.deepseaReadyTimeoutMs) {
    lines.push(`- deepsea_ready_timeout_ms: ${capture.captureConfig.deepseaReadyTimeoutMs}`);
  }
  if (capture.captureConfig.deepseaReadyPollMs) {
    lines.push(`- deepsea_ready_poll_ms: ${capture.captureConfig.deepseaReadyPollMs}`);
  }
  lines.push('');

  lines.push('## DeepSea Readiness');
  if (capture.deepseaReadiness) {
    lines.push(`- ready: ${capture.deepseaReadiness.ready ? 'yes' : 'no'}`);
    lines.push(`- challenge_detected: ${capture.deepseaReadiness.challengeDetected ? 'yes' : 'no'}`);
    lines.push(`- waited_ms: ${capture.deepseaReadiness.waitedMs || 0}`);
    lines.push(`- matched_selector: ${capture.deepseaReadiness.matchedSelector || 'none'}`);
  } else {
    lines.push('- readiness probe: not executed');
  }
  lines.push('');

  lines.push('## PDF Status');
  lines.push(`- status: ${capture.pdf.status}`);
  lines.push(`- detected_candidates: ${capture.pdf.detectedCandidates.length}`);
  if (capture.pdf.downloadedFrom) {
    lines.push(`- downloaded_from: ${capture.pdf.downloadedFrom}`);
  }
  if (capture.pdf.savedPath) {
    lines.push(`- saved_path: ${capture.pdf.savedPath}`);
  }
  if (capture.pdf.failedCandidates.length > 0) {
    lines.push('- failed_candidates:');
    for (const item of capture.pdf.failedCandidates.slice(0, 8)) {
      lines.push(`  - ${item.url} :: ${trimText(item.error, 120)}`);
    }
  }
  if (capture.pdf.status === 'not_found') {
    lines.push('- note: 未发现疑似 PDF URL');
  }
  lines.push('');

  lines.push('## Frame Accessibility');
  const elements = framesPayload.embeddedElements || [];
  const counts = {
    accessible: elements.filter((f) => f.accessStatus === 'accessible').length,
    cross_origin: elements.filter((f) => f.accessStatus === 'cross_origin').length,
    inaccessible: elements.filter((f) => f.accessStatus === 'inaccessible').length
  };
  lines.push(`- accessible: ${counts.accessible}`);
  lines.push(`- cross_origin: ${counts.cross_origin}`);
  lines.push(`- inaccessible: ${counts.inaccessible}`);
  if (elements.length === 0) {
    lines.push('- 未检测到 iframe/object/embed');
  }
  lines.push('');

  const sections = [
    ['页面标题线索', signals.headings],
    ['章节标题线索', signals.sections],
    ['figure 线索', signals.figures],
    ['table 线索', signals.tables],
    ['comment/annotation 线索', signals.comments],
    ['code block 线索', signals.codeBlocks],
    ['latex block 线索', signals.latexBlocks]
  ];

  for (const [name, list] of sections) {
    lines.push(`## ${name}`);
    if (!list || list.length === 0) {
      lines.push('- 未检测到');
    } else {
      for (const item of list.slice(0, 12)) {
        lines.push(`- ${trimText(item, 200)}`);
      }
    }
    lines.push('');
  }

  lines.push('## Asset Counts');
  lines.push(`- anchors: ${assets.anchors.length}`);
  lines.push(`- scripts: ${assets.scripts.length}`);
  lines.push(`- stylesheets: ${assets.stylesheets.length}`);
  lines.push(`- images: ${assets.images.length}`);
  lines.push(`- iframes: ${assets.iframes.length}`);
  lines.push(`- objects: ${assets.objects.length}`);
  lines.push(`- embeds: ${assets.embeds.length}`);
  lines.push(`- pdf_candidates: ${assets.pdfCandidates.length}`);
  lines.push('');

  lines.push('## File Availability');
  for (const [name, ok] of Object.entries(availableFiles)) {
    lines.push(`- ${name}: ${ok ? 'yes' : 'no'}`);
  }
  lines.push('');

  lines.push('## Errors');
  if (!capture.errors.length) {
    lines.push('- none');
  } else {
    for (const err of capture.errors.slice(0, 20)) {
      lines.push(`- [${err.step}] ${trimText(err.message, 220)}`);
    }
  }
  lines.push('');

  return clampLines(lines, 260).join('\n');
}

async function maybeManualLogin(page, context, cfg, storageStatePath, forceLogin, navWaitUntil, timeoutMs) {
  const authMode = String(cfg.authMode || 'storage_state').toLowerCase();
  const selector = String(cfg.loginSuccessSelector || '').trim();

  if (authMode === 'persistent_profile') {
    if (forceLogin) {
      console.log('Persistent profile + force-login: please complete login manually if needed.');
      await page.goto(cfg.baseUrl || cfg.projectUrl, { waitUntil: navWaitUntil, timeout: timeoutMs });
      if (process.stdin.isTTY) {
        await askEnter('If login challenge appears, finish it, then press Enter... ');
      } else {
        console.log('Non-interactive mode detected; skip Enter prompt and continue after 15s.');
        await page.waitForTimeout(15000);
      }
      return true;
    }
    return false;
  }

  if (forceLogin) {
    console.log('Force-login mode on: manual login required.');
    await page.goto(cfg.baseUrl || cfg.projectUrl, { waitUntil: navWaitUntil, timeout: timeoutMs });
    await askEnter('Complete login in browser, then press Enter... ');
    await context.storageState({ path: storageStatePath });
    return true;
  }

  if (!fs.existsSync(storageStatePath)) {
    console.log('No storage state found. First-time manual login required.');
    await page.goto(cfg.baseUrl || cfg.projectUrl, { waitUntil: navWaitUntil, timeout: timeoutMs });
    await askEnter('Complete login in browser, then press Enter... ');
    await context.storageState({ path: storageStatePath });
    return true;
  }

  await page.goto(cfg.projectUrl, { waitUntil: navWaitUntil, timeout: timeoutMs });

  if (selector) {
    try {
      await page.waitForSelector(selector, { timeout: 6000 });
      return false;
    } catch (err) {
      console.log('Stored login state may be invalid; manual login fallback triggered.');
      await page.goto(cfg.baseUrl || cfg.projectUrl, { waitUntil: navWaitUntil, timeout: timeoutMs });
      await askEnter('Complete login in browser, then press Enter... ');
      await context.storageState({ path: storageStatePath });
      return true;
    }
  }

  return false;
}

function syncLatestFromHistory(historyDir, latestDir) {
  resetDir(latestDir);
  fs.cpSync(historyDir, latestDir, { recursive: true });
}

async function createSession(cfg, storageStatePath) {
  const authMode = String(cfg.authMode || 'storage_state').toLowerCase();
  if (authMode === 'persistent_profile') {
    const userDataDir = String(cfg.persistentProfile?.userDataDir || '').trim();
    const profileName = String(cfg.persistentProfile?.profileName || '').trim();
    const browserChannel = String(cfg.persistentProfile?.browserChannel || 'chrome').trim();
    const cdpUrl = String(
      cfg.persistentProfile?.cdpUrl
      || cfg.capture?.cdpUrl
      || cfg.northno1Automation?.cdpUrl
      || ''
    ).trim();
    if (!userDataDir) {
      throw new Error('authMode=persistent_profile requires persistentProfile.userDataDir in deepsea.json');
    }
    if (!profileName) {
      throw new Error('authMode=persistent_profile requires persistentProfile.profileName in deepsea.json');
    }

    if (cdpUrl) {
      let cdpBrowser;
      try {
        cdpBrowser = await requirePlaywright().connectOverCDP(cdpUrl);
      } catch (err) {
        throw new Error(
          `Failed to connect to persistent profile via CDP (${cdpUrl}). ` +
          `Start dedicated Chrome with remote debugging enabled, then retry. Root error: ${err.message}`
        );
      }

      const contexts = cdpBrowser.contexts();
      const context = contexts[0];
      if (!context) {
        try {
          await cdpBrowser.close();
        } catch (closeErr) {
          // Ignore close errors
        }
        throw new Error(`Connected to CDP (${cdpUrl}) but no browser context is available.`);
      }

      return {
        browser: null,
        context,
        cdpBrowser,
        authMode,
        sessionKind: 'persistent_profile_cdp',
        cdpUrl
      };
    }

    const context = await requirePlaywright().launchPersistentContext(userDataDir, {
      headless: Boolean(cfg.capture?.headless),
      acceptDownloads: true,
      channel: browserChannel,
      ignoreDefaultArgs: ['--use-mock-keychain'],
      args: [`--profile-directory=${profileName}`, '--new-window']
    });
    return {
      browser: null,
      context,
      cdpBrowser: null,
      authMode,
      sessionKind: 'persistent_profile_launch',
      cdpUrl: null
    };
  }

  const browser = await requirePlaywright().launch({ headless: Boolean(cfg.capture?.headless) });
  const context = await browser.newContext({
    acceptDownloads: true,
    storageState: fs.existsSync(storageStatePath) ? storageStatePath : undefined
  });
  return {
    browser,
    context,
    cdpBrowser: null,
    authMode,
    sessionKind: 'storage_state',
    cdpUrl: null
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const paths = paperPaths(args.paper);
  const cfg = loadPaperConfig(paths);

  if (!cfg.projectUrl || cfg.projectUrl.includes('https://deepsea.example.com/project')) {
    throw new Error(`Please set projectUrl in ${relToRoot(paths.configPath)} first.`);
  }

  const timeoutMsRaw = Number(cfg.capture?.timeoutMs || 45000);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 45000;

  const settleMsRaw = Number(cfg.capture?.settleMs || 4000);
  const settleMs = Number.isFinite(settleMsRaw) && settleMsRaw >= 0 ? settleMsRaw : 4000;

  const waitUntilRaw = String(cfg.capture?.waitUntil || 'domcontentloaded').toLowerCase();
  const navWaitUntil = ALLOWED_WAIT_UNTIL.has(waitUntilRaw) ? waitUntilRaw : 'domcontentloaded';
  const deepseaReadyTimeoutMsRaw = Number(cfg.capture?.deepseaReadyTimeoutMs || 90000);
  const deepseaReadyTimeoutMs = Number.isFinite(deepseaReadyTimeoutMsRaw) && deepseaReadyTimeoutMsRaw > 0
    ? deepseaReadyTimeoutMsRaw
    : 90000;
  const deepseaReadyPollMsRaw = Number(cfg.capture?.deepseaReadyPollMs || 2000);
  const deepseaReadyPollMs = Number.isFinite(deepseaReadyPollMsRaw) && deepseaReadyPollMsRaw > 0
    ? deepseaReadyPollMsRaw
    : 2000;

  const storageStatePath = resolveStorageStatePath(paths, cfg);
  ensureDir(path.dirname(storageStatePath));

  const stamp = timestampTag();
  const historyRunDir = path.join(paths.captureHistoryDir, stamp);
  resetDir(historyRunDir);

  const capture = {
    timestamp: new Date().toISOString(),
    paperId: paths.paperId,
    projectUrl: cfg.projectUrl,
    captureRunDir: relToRoot(historyRunDir),
    latestDir: relToRoot(paths.captureLatestDir),
    storageStatePath: relToRoot(storageStatePath),
    stateMode: String(cfg.stateMode || 'global'),
    authMode: String(cfg.authMode || 'storage_state'),
    status: 'started',
    notes: [],
    errors: [],
    error: null,
    captureConfig: {
      waitUntil: navWaitUntil,
      timeoutMs,
      settleMs,
      deepseaReadyTimeoutMs,
      deepseaReadyPollMs,
      networkLogMax: Number(cfg.capture?.networkLogMax || 400)
    },
    outputs: {},
    pdf: {
      status: 'not_found',
      detectedCandidates: [],
      saved: false,
      savedPath: null,
      downloadedFrom: null,
      failedCandidates: []
    }
  };

  if (waitUntilRaw !== navWaitUntil) {
    capture.notes.push(`Invalid capture.waitUntil=${waitUntilRaw}, fallback to ${navWaitUntil}`);
  }

  const networkLog = [];
  const pdfFromNetwork = new Set();
  let browser;
  let cdpBrowser;
  let context;
  let page;
  let sessionKind = 'unknown';

  let pageUrl = cfg.projectUrl;
  let title = '';
  let pageHtml = '';
  let assets = createEmptyAssets();
  let framesPayload = { embeddedElements: [], playwrightFrames: [] };
  let signals = createEmptySignals();
  let manualLoginHappened = false;

  try {
    const session = await createSession(cfg, storageStatePath);
    browser = session.browser;
    cdpBrowser = session.cdpBrowser;
    context = session.context;
    sessionKind = session.sessionKind || 'unknown';
    if (session.sessionKind) {
      capture.authMode = session.sessionKind;
    }
    if (session.cdpUrl) {
      capture.notes.push(`Using CDP attach: ${session.cdpUrl}`);
    }

    page = await pickPageForTarget(context, cfg.projectUrl);
    const pageBeforeUrl = String(page.url() || '');
    if (pageBeforeUrl && pageBeforeUrl !== 'about:blank') {
      capture.notes.push(`Reusing existing tab: ${trimText(pageBeforeUrl, 180)}`);
    }
    page.on('response', (response) => {
      const headers = response.headers();
      const contentType = headers['content-type'] || '';
      const item = {
        ts: new Date().toISOString(),
        url: response.url(),
        status: response.status(),
        contentType,
        resourceType: response.request().resourceType()
      };

      networkLog.push(item);
      const isPdf = /application\/pdf/i.test(contentType) || /\.pdf([?#]|$)/i.test(item.url);
      if (isPdf) {
        pdfFromNetwork.add(item.url);
      }
    });

    manualLoginHappened = await safeStep(
      capture,
      'manual-login',
      () => maybeManualLogin(page, context, cfg, storageStatePath, args.forceLogin, navWaitUntil, timeoutMs),
      false
    );

    await safeStep(capture, 'goto-project', async () => {
      await page.goto(cfg.projectUrl, { waitUntil: navWaitUntil, timeout: timeoutMs });
      await page.waitForTimeout(settleMs);
    }, null);

    capture.deepseaReadiness = await safeStep(
      capture,
      'wait-deepsea-ready',
      () => waitForDeepSeaReady(page, cfg, capture),
      {
        ready: false,
        challengeDetected: false,
        gettingReadyDetected: false,
        loadingDetected: false,
        askAnythingDetected: false,
        inputVisible: false,
        title: '',
        url: page.url(),
        matchedSelector: null,
        bodyTextLength: 0,
        waitedMs: 0
      }
    );

    if (!capture.deepseaReadiness.ready) {
      throw new Error(
        `DeepSea page not ready for capture: gettingReady=${Boolean(capture.deepseaReadiness.gettingReadyDetected)} ` +
        `loading=${Boolean(capture.deepseaReadiness.loadingDetected)} askAnything=${Boolean(capture.deepseaReadiness.askAnythingDetected)} ` +
        `inputVisible=${Boolean(capture.deepseaReadiness.inputVisible)}`
      );
    }

    pageUrl = await safeStep(capture, 'get-page-url', async () => page.url(), cfg.projectUrl);
    title = await safeStep(capture, 'get-title', async () => page.title(), '');
    pageHtml = await safeStep(capture, 'get-page-content', async () => page.content(), '');

    writeFileSafe(capture, path.join(historyRunDir, 'page.html'), pageHtml, 'page.html');
    writeFileSafe(capture, path.join(historyRunDir, 'page_url.txt'), `${pageUrl}\n`, 'page_url.txt');
    writeFileSafe(capture, path.join(historyRunDir, 'title.txt'), `${title}\n`, 'title.txt');

    assets = await safeStep(capture, 'extract-assets', async () => page.evaluate(() => {
      const abs = (u) => {
        try {
          return new URL(u, window.location.href).toString();
        } catch (err) {
          return null;
        }
      };

      const collect = (selector, attr) => {
        const out = [];
        for (const el of Array.from(document.querySelectorAll(selector))) {
          const raw = el.getAttribute(attr);
          if (raw) {
            const resolved = abs(raw);
            if (resolved) out.push(resolved);
          }
        }
        return Array.from(new Set(out));
      };

      const anchors = collect('a[href]', 'href');
      const scripts = collect('script[src]', 'src');
      const stylesheets = collect('link[rel="stylesheet"][href]', 'href');
      const images = collect('img[src]', 'src');
      const iframes = collect('iframe[src]', 'src');
      const objects = collect('object[data]', 'data');
      const embeds = collect('embed[src]', 'src');

      const pdfCandidates = Array.from(new Set([
        ...anchors,
        ...iframes,
        ...objects,
        ...embeds,
        ...scripts,
        ...stylesheets
      ].filter((u) => /\.pdf([?#]|$)/i.test(u) || /pdf/i.test(u))));

      return {
        anchors,
        scripts,
        stylesheets,
        images,
        iframes,
        objects,
        embeds,
        pdfCandidates
      };
    }), createEmptyAssets());

    const embeddedElements = await safeStep(capture, 'extract-frames', async () => page.evaluate(() => {
      const rectOf = (el) => {
        const r = el.getBoundingClientRect();
        return {
          x: Number(r.x.toFixed(2)),
          y: Number(r.y.toFixed(2)),
          width: Number(r.width.toFixed(2)),
          height: Number(r.height.toFixed(2))
        };
      };

      const out = [];
      const add = (tag, el, index) => {
        const item = {
          tag,
          index,
          src: el.getAttribute('src') || el.getAttribute('data') || '',
          title: el.getAttribute('title') || '',
          name: el.getAttribute('name') || '',
          id: el.getAttribute('id') || '',
          rect: rectOf(el),
          accessStatus: 'inaccessible'
        };

        if (tag === 'iframe') {
          try {
            const doc = el.contentDocument;
            if (doc && doc.documentElement) {
              item.accessStatus = 'accessible';
              item.accessibleUrl = doc.URL || '';
              item.accessibleTitle = doc.title || '';
              item.accessibleText = (doc.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
              item.accessibleHtmlSnippet = doc.documentElement.outerHTML.slice(0, 2500);
            } else {
              item.accessStatus = 'inaccessible';
              item.accessError = 'iframe contentDocument unavailable';
            }
          } catch (err) {
            const msg = String(err && err.message ? err.message : err);
            const lower = msg.toLowerCase();
            item.accessStatus = (lower.includes('cross-origin') || lower.includes('blocked a frame') || lower.includes('permission denied'))
              ? 'cross_origin'
              : 'inaccessible';
            item.accessError = msg;
          }
        }

        out.push(item);
      };

      Array.from(document.querySelectorAll('iframe')).forEach((el, i) => add('iframe', el, i));
      Array.from(document.querySelectorAll('object')).forEach((el, i) => add('object', el, i));
      Array.from(document.querySelectorAll('embed')).forEach((el, i) => add('embed', el, i));

      return out;
    }), []);

    const playwrightFrames = await safeStep(capture, 'extract-playwright-frames', async () => page.frames().map((f) => ({
      name: f.name(),
      url: f.url(),
      isMainFrame: f === page.mainFrame()
    })), []);

    for (const frame of embeddedElements) {
      if (!frame.accessStatus && frame.tag === 'iframe') {
        frame.accessStatus = classifyFrameError(frame.accessError);
      } else if (!frame.accessStatus) {
        frame.accessStatus = 'inaccessible';
      }
    }

    framesPayload = {
      embeddedElements,
      playwrightFrames
    };

    signals = await safeStep(capture, 'extract-dom-signals', async () => page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const pickText = (selector, maxItems, maxLen = 220) => Array
        .from(document.querySelectorAll(selector))
        .map((el) => clean(el.textContent || ''))
        .filter(Boolean)
        .map((t) => t.slice(0, maxLen))
        .slice(0, maxItems);

      const headings = Array.from(new Set(pickText('h1, h2, h3, h4, h5, h6, [role="heading"]', 60)));
      const sections = Array.from(new Set(pickText('section h1, section h2, section h3, [class*="section"], [id*="section"]', 60)));
      const figures = Array.from(new Set(pickText('figure figcaption, figcaption, [class*="figure"], [class*="caption"]', 50)));
      const tables = Array.from(new Set(pickText('table caption, table th, [class*="table"], [id*="table"]', 50)));
      const codeBlocks = Array.from(new Set(pickText('pre, code', 50, 400)));
      const latexBlocks = Array.from(new Set(pickText('math, .katex, .MathJax, [class*="equation"], [class*="latex"], script[type*="math/tex"]', 50, 300)));
      const comments = Array.from(new Set(pickText('[class*="comment"], [id*="comment"], [class*="annot"], [id*="annot"]', 50, 220)));

      return { headings, sections, figures, tables, codeBlocks, latexBlocks, comments };
    }), createEmptySignals());

    const pdfCandidates = unique([
      ...assets.pdfCandidates,
      ...Array.from(pdfFromNetwork),
      ...framesPayload.embeddedElements
        .map((f) => toAbsUrl(f.src, pageUrl))
        .filter((u) => u && (/\.pdf([?#]|$)/i.test(u) || /pdf/i.test(u))),
      /\.pdf([?#]|$)/i.test(pageUrl) ? pageUrl : null
    ]);

    capture.pdf.detectedCandidates = pdfCandidates;

    if (pdfCandidates.length === 0) {
      capture.pdf.status = 'not_found';
    } else {
      capture.pdf.status = 'candidate_found_download_failed';
      for (const candidate of pdfCandidates) {
        const result = await safeStep(capture, `download-pdf:${candidate}`, async () => {
          const resp = await context.request.get(candidate, { timeout: 30000 });
          if (!resp.ok()) {
            throw new Error(`HTTP ${resp.status()}`);
          }

          const ctype = String(resp.headers()['content-type'] || '');
          const body = await resp.body();
          const looksPdf = /application\/pdf/i.test(ctype)
            || /\.pdf([?#]|$)/i.test(candidate)
            || body.subarray(0, 4).toString('utf8') === '%PDF';

          if (!looksPdf) {
            throw new Error(`response is not PDF, content-type=${ctype || '(empty)'}`);
          }

          const savedPdfPath = path.join(historyRunDir, 'preview.pdf');
          fs.writeFileSync(savedPdfPath, body);
          return {
            ok: true,
            savedPdfPath
          };
        }, { ok: false, error: 'download step failed' });

        if (result.ok) {
          capture.pdf.status = 'downloaded';
          capture.pdf.saved = true;
          capture.pdf.savedPath = relToRoot(result.savedPdfPath);
          capture.pdf.downloadedFrom = candidate;
          capture.outputs['preview.pdf'] = {
            ok: true,
            path: relToRoot(result.savedPdfPath)
          };
          break;
        }

        capture.pdf.failedCandidates.push({
          url: candidate,
          error: result.error || 'unknown error'
        });
      }

      if (!capture.pdf.saved) {
        const uiPdf = await safeStep(
          capture,
          'ui-download-pdf',
          () => tryUiPdfDownload(page, cfg, historyRunDir, capture),
          { ok: false }
        );

        if (uiPdf.ok) {
          capture.pdf.status = 'downloaded_via_ui';
          capture.pdf.saved = true;
          capture.pdf.savedPath = relToRoot(uiPdf.savedPdfPath);
          capture.pdf.downloadedFrom = `ui:${uiPdf.selector}`;
          capture.outputs['preview.pdf'] = {
            ok: true,
            path: relToRoot(uiPdf.savedPdfPath)
          };
          capture.notes.push(`PDF downloaded via UI selector: ${uiPdf.selector}`);
          capture.errors = capture.errors.filter((e) => !String(e.step || '').startsWith('download-pdf:'));
        }
      }
    }

    const networkLogMax = Number(capture.captureConfig.networkLogMax || 400);
    writeFileSafe(
      capture,
      path.join(historyRunDir, 'network_log.json'),
      JSON.stringify(networkLog.slice(0, networkLogMax), null, 2),
      'network_log.json'
    );

    await safeStep(capture, 'screenshot', async () => {
      await page.screenshot({
        path: path.join(historyRunDir, 'fallback_fullpage.png'),
        fullPage: true
      });
      capture.outputs['fallback_fullpage.png'] = {
        ok: true,
        path: relToRoot(path.join(historyRunDir, 'fallback_fullpage.png'))
      };
    }, null);

    writeFileSafe(capture, path.join(historyRunDir, 'frames.json'), JSON.stringify(framesPayload, null, 2), 'frames.json');
    writeFileSafe(capture, path.join(historyRunDir, 'assets.json'), JSON.stringify(assets, null, 2), 'assets.json');
    writeFileSafe(capture, path.join(historyRunDir, 'dom_signals.json'), JSON.stringify(signals, null, 2), 'dom_signals.json');

    const availableFiles = {
      'page.html': Boolean(capture.outputs['page.html']?.ok),
      'frames.json': Boolean(capture.outputs['frames.json']?.ok),
      'assets.json': Boolean(capture.outputs['assets.json']?.ok),
      'network_log.json': Boolean(capture.outputs['network_log.json']?.ok),
      'preview.pdf': Boolean(capture.outputs['preview.pdf']?.ok),
      'fallback_fullpage.png': Boolean(capture.outputs['fallback_fullpage.png']?.ok)
    };

    const summary = buildDomSummary({
      paperId: paths.paperId,
      captureDir: relToRoot(historyRunDir),
      pageUrl,
      title,
      signals,
      framesPayload,
      assets,
      capture,
      availableFiles
    });
    writeFileSafe(capture, path.join(historyRunDir, 'dom_summary.md'), `${summary}\n`, 'dom_summary.md');

    capture.manualLoginHappened = manualLoginHappened;

    if (capture.errors.length === 0) {
      capture.status = 'success';
      capture.notes.push('Capture completed with full extraction.');
    } else {
      const hasAnyOutput = Object.values(capture.outputs).some((o) => o && o.ok);
      capture.status = hasAnyOutput ? 'partial_success' : 'failed';
      capture.error = capture.errors.map((e) => `[${e.step}] ${e.message}`).slice(0, 6).join(' | ');
      capture.notes.push(hasAnyOutput
        ? 'Capture completed with partial errors; usable outputs still generated.'
        : 'Capture failed before usable outputs were produced.');
    }
  } catch (err) {
    capture.status = 'failed';
    capture.error = err.message;
    capture.errors.push({ step: 'fatal', message: err.message });
    capture.notes.push('Fatal capture error.');
  } finally {
    writeFileSafe(capture, path.join(historyRunDir, 'capture_meta.json'), JSON.stringify(capture, null, 2), 'capture_meta.json');

    try {
      syncLatestFromHistory(historyRunDir, paths.captureLatestDir);
    } catch (err) {
      capture.notes.push(`Failed to sync latest directory: ${err.message}`);
      capture.error = capture.error || err.message;
      capture.status = capture.status === 'success' ? 'partial_success' : capture.status;
      fs.writeFileSync(path.join(historyRunDir, 'capture_meta.json'), JSON.stringify(capture, null, 2), 'utf8');
    }

    if (context && sessionKind !== 'persistent_profile_cdp') {
      try {
        await context.close();
      } catch (err) {
        // Ignore close errors
      }
    }

    if (cdpBrowser) {
      try {
        await cdpBrowser.close();
      } catch (err) {
        // Ignore close errors
      }
    }

    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        // Ignore close errors
      }
    }
  }

  if (capture.status === 'failed') {
    throw new Error(`Capture failed: ${capture.error || 'unknown error'}`);
  }

  if (capture.status === 'partial_success') {
    console.log('Capture completed with partial errors.');
    console.log(`- error summary: ${capture.error || 'see capture_meta.json'}`);
  } else {
    console.log('Capture completed successfully.');
  }

  console.log(`- paper_id: ${paths.paperId}`);
  console.log(`- history run: ${relToRoot(historyRunDir)}`);
  console.log(`- latest: ${relToRoot(paths.captureLatestDir)}`);
  if (sessionKind === 'persistent_profile_cdp') {
    console.log(`- auth: persistent profile via CDP (${cfg.persistentProfile?.profileName || 'unknown'})`);
    console.log(`- cdp: ${String(cfg.persistentProfile?.cdpUrl || cfg.capture?.cdpUrl || cfg.northno1Automation?.cdpUrl || '')}`);
  } else if (String(cfg.authMode || 'storage_state').toLowerCase() === 'persistent_profile') {
    console.log(`- auth: persistent profile launch (${cfg.persistentProfile?.profileName || 'unknown'})`);
  } else {
    console.log(`- state: ${relToRoot(storageStatePath)} (${String(cfg.stateMode || 'global')})`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

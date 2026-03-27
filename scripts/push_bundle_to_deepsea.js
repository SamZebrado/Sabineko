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
  relToRoot
} = require('./paper_paths');

function parseArgs(argv) {
  const out = {
    paper: DEFAULT_PAPER_ID,
    bundlePath: null,
    forceLogin: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--paper' && argv[i + 1]) {
      out.paper = argv[i + 1];
      i += 1;
    } else if (arg === '--bundle' && argv[i + 1]) {
      out.bundlePath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--force-login') {
      out.forceLogin = true;
    }
  }

  out.paper = sanitizePaperId(out.paper);
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

async function main() {
  const args = parseArgs(process.argv);
  const paths = paperPaths(args.paper);
  ensurePaperLayout(paths);
  const cfg = loadPaperConfig(paths);

  if (!cfg.projectUrl || String(cfg.projectUrl).includes('https://deepsea.example.com/project')) {
    throw new Error(`projectUrl is not configured: ${relToRoot(paths.configPath)}`);
  }

  const selectors = cfg.deepseaAutomation || {};
  const uploadInputSelector = String(selectors.uploadInputSelector || '').trim();
  if (!uploadInputSelector) {
    throw new Error('Missing deepseaAutomation.uploadInputSelector in config/deepsea.json');
  }

  const bundlePath = args.bundlePath || path.join(paths.paperRoot, 'handoff', 'for_deepsea.zip');
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`Bundle not found: ${relToRoot(bundlePath)}`);
  }

  const authMode = String(cfg.authMode || 'storage_state').toLowerCase();
  const statePath = resolveStorageStatePath(paths, cfg);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  const timeoutMs = Number(cfg.capture?.timeoutMs || 45000);
  const waitUntil = String(cfg.capture?.waitUntil || 'domcontentloaded');

  const pushResult = {
    timestamp: new Date().toISOString(),
    paperId: paths.paperId,
    projectUrl: cfg.projectUrl,
    bundlePath: relToRoot(bundlePath),
    status: 'started',
    error: null
  };

  let browser;

  try {
    let context;
    if (authMode === 'persistent_profile') {
      const userDataDir = String(cfg.persistentProfile?.userDataDir || '').trim();
      const profileName = String(cfg.persistentProfile?.profileName || '').trim();
      const browserChannel = String(cfg.persistentProfile?.browserChannel || 'chrome').trim();
      if (!userDataDir || !profileName) {
        throw new Error('authMode=persistent_profile requires persistentProfile.userDataDir + profileName');
      }
      context = await requirePlaywright().launchPersistentContext(userDataDir, {
        headless: false,
        acceptDownloads: true,
        channel: browserChannel,
        ignoreDefaultArgs: ['--use-mock-keychain'],
        args: [`--profile-directory=${profileName}`, '--new-window']
      });
    } else {
      browser = await requirePlaywright().launch({ headless: false });
      context = await browser.newContext({
        acceptDownloads: true,
        storageState: fs.existsSync(statePath) ? statePath : undefined
      });
    }

    const page = context.pages()[0] || await context.newPage();

    if (authMode === 'persistent_profile') {
      if (args.forceLogin) {
        await page.goto(cfg.baseUrl || cfg.projectUrl, { waitUntil, timeout: timeoutMs });
        await askEnter('If login challenge appears, finish it, then press Enter... ');
      }
    } else if (args.forceLogin || !fs.existsSync(statePath)) {
      await page.goto(cfg.baseUrl || cfg.projectUrl, { waitUntil, timeout: timeoutMs });
      await askEnter('Complete DeepSea login in browser, then press Enter... ');
      await context.storageState({ path: statePath });
    }

    await page.goto(cfg.projectUrl, { waitUntil, timeout: timeoutMs });

    if (selectors.projectReadySelector) {
      await page.waitForSelector(selectors.projectReadySelector, { timeout: timeoutMs });
    }

    await page.setInputFiles(uploadInputSelector, bundlePath);

    if (selectors.uploadConfirmSelector) {
      await page.click(selectors.uploadConfirmSelector);
    }

    if (selectors.uploadDoneSelector) {
      await page.waitForSelector(selectors.uploadDoneSelector, { timeout: timeoutMs });
    } else {
      await page.waitForTimeout(2000);
    }

    if (authMode !== 'persistent_profile') {
      await context.storageState({ path: statePath });
    }

    pushResult.status = 'success';
    console.log('Bundle uploaded to DeepSea.');
  } catch (err) {
    pushResult.status = 'failed';
    pushResult.error = err.message;
    throw err;
  } finally {
    const resultPath = path.join(paths.paperStateDir, 'deepsea_push_result.json');
    fs.writeFileSync(resultPath, JSON.stringify(pushResult, null, 2), 'utf8');

    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        // ignore
      }
    } else {
      try {
        await context.close();
      } catch (err) {
        // ignore
      }
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

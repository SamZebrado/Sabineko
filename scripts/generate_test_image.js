'use strict';

const fs = require('fs');
const path = require('path');
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
const { DEFAULT_PAPER_ID, sanitizePaperId, paperPaths, ensurePaperLayout, loadPaperConfig, relToRoot } = require('./paper_paths');

function parseArgs(argv) {
  const out = {
    paper: DEFAULT_PAPER_ID,
    text: 'Text',
    round: 1,
    output: '',
    width: 1200,
    height: 630
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--paper' && argv[i + 1]) {
      out.paper = argv[i + 1];
      i += 1;
    } else if (arg === '--text' && argv[i + 1]) {
      out.text = String(argv[i + 1]);
      i += 1;
    } else if (arg === '--round' && argv[i + 1]) {
      out.round = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--output' && argv[i + 1]) {
      out.output = String(argv[i + 1]);
      i += 1;
    }
  }

  out.paper = sanitizePaperId(out.paper);
  if (!Number.isFinite(out.round) || out.round <= 0) out.round = 1;
  return out;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml(label) {
  const safe = escapeHtml(label);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html, body {
    margin: 0;
    width: 100%;
    height: 100%;
    font-family: Georgia, 'Times New Roman', serif;
    background: linear-gradient(135deg, #f5efe2 0%, #d9e7f5 45%, #f0d8cc 100%);
  }
  .frame {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px;
    position: relative;
    overflow: hidden;
  }
  .frame::before, .frame::after {
    content: '';
    position: absolute;
    border-radius: 999px;
    opacity: 0.18;
    filter: blur(8px);
  }
  .frame::before {
    width: 360px;
    height: 360px;
    background: #214b7a;
    top: -60px;
    left: -80px;
  }
  .frame::after {
    width: 300px;
    height: 300px;
    background: #b3543a;
    bottom: -40px;
    right: -20px;
  }
  .card {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 920px;
    border: 2px solid rgba(17, 24, 39, 0.18);
    background: rgba(255,255,255,0.72);
    backdrop-filter: blur(6px);
    padding: 60px 70px;
    box-shadow: 0 30px 80px rgba(17, 24, 39, 0.16);
  }
  .eyebrow {
    font-size: 22px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #214b7a;
    margin-bottom: 20px;
  }
  .title {
    font-size: 86px;
    line-height: 0.95;
    color: #16181d;
    margin: 0;
    word-break: break-word;
  }
  .rule {
    width: 180px;
    height: 6px;
    background: linear-gradient(90deg, #214b7a, #b3543a);
    margin-top: 28px;
  }
</style>
</head>
<body>
  <div class="frame">
    <div class="card">
      <div class="eyebrow">Pipeline Test Image</div>
      <h1 class="title">${safe}</h1>
      <div class="rule"></div>
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv);
  const paths = paperPaths(args.paper);
  ensurePaperLayout(paths);
  const cfg = loadPaperConfig(paths);

  const defaultDir = path.join(paths.paperStateDir, 'generated_assets');
  fs.mkdirSync(defaultDir, { recursive: true });
  const baseName = `${String(args.text).replace(/[^a-zA-Z0-9_-]+/g, '_') || 'Text'}_round_${args.round}.png`;
  const outputPath = args.output
    ? path.resolve(args.output)
    : path.join(defaultDir, baseName);

  const cdpUrl = String(cfg.persistentProfile?.cdpUrl || cfg.northno1Automation?.cdpUrl || '').trim();
  let browser = null;
  let context = null;
  let page = null;
  try {
    if (cdpUrl) {
      try {
        browser = await requirePlaywright().connectOverCDP(cdpUrl);
        context = browser.contexts()[0];
        if (!context) {
          throw new Error(`CDP connected but no browser context found at ${cdpUrl}`);
        }
        page = await context.newPage();
        await page.setViewportSize({ width: args.width, height: args.height });
      } catch (err) {
        if (browser) {
          await browser.close().catch(() => {});
          browser = null;
        }
        context = null;
        page = null;
      }
    }

    if (!page) {
      browser = await requirePlaywright().launch({ headless: true });
      page = await browser.newPage({ viewport: { width: args.width, height: args.height }, deviceScaleFactor: 2 });
    }
    const label = `${args.text}${args.round}`;
    await page.setContent(buildHtml(label), { waitUntil: 'load' });
    await page.screenshot({ path: outputPath, type: 'png' });

    console.log(JSON.stringify({
      ok: true,
      paperId: paths.paperId,
      text: args.text,
      round: args.round,
      label,
      outputPath: relToRoot(outputPath)
    }, null, 2));
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

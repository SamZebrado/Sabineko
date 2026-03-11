'use strict';

const fs = require('fs');
const path = require('path');
const {
  ROOT,
  DEFAULT_PAPER_ID,
  sanitizePaperId,
  paperPaths
} = require('./paper_paths');

function parseArgs(argv) {
  const out = {
    paper: null,
    all: false,
    json: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--paper' && argv[i + 1]) {
      out.paper = argv[i + 1];
      i += 1;
    } else if (arg === '--all') {
      out.all = true;
    } else if (arg === '--json') {
      out.json = true;
    }
  }

  return out;
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

function validateProjectUrl(urlValue) {
  const errors = [];
  const warnings = [];
  const value = String(urlValue || '').trim();

  if (!value) {
    errors.push('projectUrl is empty');
    return { errors, warnings };
  }

  const placeholders = [
    'deepsea.example.com/project',
    'example.com/deepsea',
    'https://deepsea.example.com/project'
  ];

  if (placeholders.some((p) => value.includes(p))) {
    errors.push('projectUrl is still a placeholder value');
    return { errors, warnings };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (err) {
    errors.push(`projectUrl is not a valid URL: ${err.message}`);
    return { errors, warnings };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    errors.push(`projectUrl protocol must be http/https, got: ${parsed.protocol}`);
  }

  if (!parsed.hostname) {
    errors.push('projectUrl missing hostname');
  }

  if (!/deepsea/i.test(parsed.hostname + parsed.pathname)) {
    warnings.push('projectUrl does not look like a DeepSea URL (continuing)');
  }

  return { errors, warnings };
}

function validateOnePaper(paperId) {
  const paths = paperPaths(paperId);
  const report = {
    paperId: paths.paperId,
    configPath: path.relative(ROOT, paths.configPath),
    ok: true,
    errors: [],
    warnings: []
  };

  if (!fs.existsSync(paths.configPath)) {
    report.ok = false;
    report.errors.push('config/deepsea.json does not exist');
    return report;
  }

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(paths.configPath, 'utf8'));
  } catch (err) {
    report.ok = false;
    report.errors.push(`invalid JSON in deepsea.json: ${err.message}`);
    return report;
  }

  const urlCheck = validateProjectUrl(cfg.projectUrl);
  report.errors.push(...urlCheck.errors);
  report.warnings.push(...urlCheck.warnings);

  if (!cfg.paperLabel || !String(cfg.paperLabel).trim()) {
    report.warnings.push('paperLabel is missing (recommended)');
  }

  if (cfg.paperId && sanitizePaperId(cfg.paperId) !== paths.paperId) {
    report.warnings.push(`paperId in config (${cfg.paperId}) differs from folder (${paths.paperId})`);
  }

  const authMode = String(cfg.authMode || 'storage_state').toLowerCase();
  if (!['storage_state', 'persistent_profile'].includes(authMode)) {
    report.errors.push(`authMode must be storage_state or persistent_profile, got: ${cfg.authMode}`);
  }

  if (authMode === 'persistent_profile') {
    const userDataDir = String(cfg.persistentProfile?.userDataDir || '').trim();
    const profileName = String(cfg.persistentProfile?.profileName || '').trim();
    if (!userDataDir) {
      report.errors.push('persistentProfile.userDataDir is required when authMode=persistent_profile');
    }
    if (!profileName) {
      report.errors.push('persistentProfile.profileName is required when authMode=persistent_profile');
    }
  }

  report.ok = report.errors.length === 0;
  return report;
}

function printHuman(reports) {
  let hasErrors = false;
  for (const r of reports) {
    const status = r.ok ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${r.paperId} (${r.configPath})`);

    for (const e of r.errors) {
      hasErrors = true;
      console.log(`  - error: ${e}`);
    }

    for (const w of r.warnings) {
      console.log(`  - warning: ${w}`);
    }
  }

  if (!hasErrors) {
    console.log('All checked config files passed required validation.');
  }
}

function main() {
  const args = parseArgs(process.argv);

  let targets;
  if (args.all) {
    targets = listPaperIds();
  } else if (args.paper) {
    targets = [sanitizePaperId(args.paper)];
  } else {
    targets = [DEFAULT_PAPER_ID];
  }

  const reports = targets.map(validateOnePaper);
  const hasErrors = reports.some((r) => !r.ok);

  if (args.json) {
    console.log(JSON.stringify({ ok: !hasErrors, reports }, null, 2));
  } else {
    printHuman(reports);
  }

  process.exit(hasErrors ? 1 : 0);
}

main();

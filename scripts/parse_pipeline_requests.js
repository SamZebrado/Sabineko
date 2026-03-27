'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_PAPER_ID,
  sanitizePaperId,
  paperPaths,
  relToRoot
} = require('./paper_paths');

function parseArgs(argv) {
  const out = {
    paper: DEFAULT_PAPER_ID,
    inputPath: null
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--paper' && argv[i + 1]) {
      out.paper = argv[i + 1];
      i += 1;
    } else if (arg === '--input' && argv[i + 1]) {
      out.inputPath = path.resolve(argv[i + 1]);
      i += 1;
    }
  }

  out.paper = sanitizePaperId(out.paper);
  return out;
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function main() {
  const args = parseArgs(process.argv);
  const paths = paperPaths(args.paper);
  const inputPath = args.inputPath || path.join(paths.promptsDir, 'request_for_pipeline.md');

  if (!fs.existsSync(inputPath)) {
    console.error(`Request file not found: ${relToRoot(inputPath)}`);
    process.exit(1);
  }

  const text = fs.readFileSync(inputPath, 'utf8');
  const lines = text.split(/\r?\n/);

  const files = [];
  let pdf = false;
  let currentFile = false;
  const unknown = [];
  let none = false;

  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line || line.startsWith('#')) continue;
    const clean = line.replace(/^-+\s*/, '').trim();
    if (!clean) continue;

    if (/^none$/i.test(clean)) {
      none = true;
      continue;
    }
    if (/^pdf$/i.test(clean) || /^type\s*:\s*pdf$/i.test(clean)) {
      pdf = true;
      continue;
    }
    if (/^current_file$/i.test(clean) || /^type\s*:\s*current_file$/i.test(clean)) {
      currentFile = true;
      continue;
    }

    const m = clean.match(/^(file|path)\s*:\s*(.+)$/i);
    if (m) {
      files.push(m[2].trim());
      continue;
    }

    unknown.push(clean);
  }

  const result = {
    timestamp: new Date().toISOString(),
    paperId: paths.paperId,
    sourcePath: relToRoot(inputPath),
    none,
    requests: {
      pdf,
      currentFile,
      files: unique(files)
    },
    resources: [],
    unknownLines: unique(unknown),
    warnings: []
  };

  if (result.requests.pdf) {
    result.resources.push('pdf');
  }
  if (result.requests.currentFile) {
    result.resources.push('current_file');
  }
  for (const filePath of result.requests.files) {
    result.resources.push(`file:${filePath}`);
  }

  if (none && (result.requests.pdf || result.requests.currentFile || result.requests.files.length > 0)) {
    result.warnings.push('Found "none" together with concrete requests; keeping concrete requests.');
  }
  if (result.unknownLines.length > 0) {
    result.warnings.push(`Unknown request lines: ${result.unknownLines.length}`);
  }

  const outPath = path.join(paths.promptsDir, 'request_for_pipeline.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  console.log('Pipeline request parse finished.');
  console.log(`- paper_id: ${paths.paperId}`);
  console.log(`- source: ${relToRoot(inputPath)}`);
  console.log(`- output: ${relToRoot(outPath)}`);
  console.log(`- request_pdf: ${result.requests.pdf}`);
  console.log(`- request_current_file: ${result.requests.currentFile}`);
  console.log(`- request_files: ${result.requests.files.length}`);
  if (result.warnings.length > 0) {
    console.log('- warnings:');
    for (const w of result.warnings) {
      console.log(`  - ${w}`);
    }
  }
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

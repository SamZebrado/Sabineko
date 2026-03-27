'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  ROOT,
  DEFAULT_PAPER_ID,
  sanitizePaperId,
  paperPaths,
  relToRoot
} = require('./paper_paths');
const qvbingMode = require('./qvbing_mode');

const REQUIRED_BLOCK_KEYS = ['PROMPT_FOR_CODEX', 'PROMPT_FOR_DEEPSEA'];
const OPTIONAL_BLOCK_KEYS = ['NOTE_FOR_USER', 'REQUEST_FOR_PIPELINE', 'PIPELINE_API_REQUESTS_JSON'];
const BLOCK_KEYS = [...REQUIRED_BLOCK_KEYS, ...OPTIONAL_BLOCK_KEYS];
const OUTPUT_MAP = {
  PROMPT_FOR_CODEX: 'for_codex.md',
  PROMPT_FOR_DEEPSEA: 'for_deepsea.md',
  NOTE_FOR_USER: 'note_for_user.md',
  REQUEST_FOR_PIPELINE: 'request_for_pipeline.md',
  PIPELINE_API_REQUESTS_JSON: 'pipeline_api_requests.json'
};

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

function findBlocks(text) {
  const markerRegex = /^\s*=+\s*(PROMPT_FOR_CODEX|PROMPT_FOR_DEEPSEA|NOTE_FOR_USER|REQUEST_FOR_PIPELINE|PIPELINE_API_REQUESTS_JSON)\s*=+\s*$/gim;
  const markers = [];
  let match;

  while ((match = markerRegex.exec(text)) !== null) {
    markers.push({
      key: String(match[1] || '').toUpperCase(),
      start: match.index,
      end: markerRegex.lastIndex,
      raw: match[0]
    });
  }

  markers.sort((a, b) => a.start - b.start);

  const blocks = {};
  const duplicates = [];
  for (let i = 0; i < markers.length; i += 1) {
    const current = markers[i];
    const next = markers[i + 1];
    const content = text.slice(current.end, next ? next.start : text.length).trim();

    if (blocks[current.key] !== undefined) {
      duplicates.push(current.key);
      continue;
    }
    blocks[current.key] = content;
  }

  return { markers, blocks, duplicates };
}

function writeOrRemove(filePath, content) {
  if (typeof content === 'string') {
    fs.writeFileSync(filePath, `${content}\n`, 'utf8');
    return true;
  }

  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
  }
  return false;
}

function normalizeJsonBlockContent(content) {
  const raw = String(content || '').trim();
  if (!raw) {
    return '';
  }

  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    return String(fenced[1] || '').trim();
  }

  if (/^```/i.test(raw)) {
    const withoutOpen = raw.replace(/^```(?:json)?\s*/i, '');
    return withoutOpen.replace(/\s*```$/i, '').trim();
  }

  return raw;
}

function writeJsonBlock(filePath, content) {
  if (typeof content !== 'string' || !content.trim()) {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
    }
    return { written: false, jsonValid: true };
  }

  const parsed = JSON.parse(normalizeJsonBlockContent(content));
  fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), 'utf8');
  return { written: true, jsonValid: true };
}

function main() {
  const args = parseArgs(process.argv);
  const paths = paperPaths(args.paper);

  const defaultInput = path.join(paths.promptsDir, 'northno1_reply.txt');
  const inputPath = args.inputPath || defaultInput;

  if (!fs.existsSync(inputPath)) {
    console.error(`Reply file not found: ${relToRoot(inputPath)}`);
    process.exit(1);
  }

  const text = fs.readFileSync(inputPath, 'utf8');
  const { markers, blocks, duplicates } = findBlocks(text);

  const parseResult = {
    timestamp: new Date().toISOString(),
    paperId: paths.paperId,
    inputPath: relToRoot(inputPath),
    markerCount: markers.length,
    parsedBlocks: {},
    missingBlocks: [],
    warnings: [],
    ok: true
  };

  if (markers.length === 0) {
    parseResult.warnings.push('No block markers found. Expected markers like ===PROMPT_FOR_CODEX===');
  }

  if (duplicates.length > 0) {
    parseResult.warnings.push(`Duplicate markers ignored for: ${Array.from(new Set(duplicates)).join(', ')}`);
  }

  for (const key of BLOCK_KEYS) {
    const value = typeof blocks[key] === 'string' && blocks[key].length > 0 ? blocks[key] : null;
    const outName = OUTPUT_MAP[key];
    const outPath = path.join(paths.promptsDir, outName);
    let written = false;
    let jsonValid = true;
    try {
      if (key === 'PIPELINE_API_REQUESTS_JSON') {
        const result = writeJsonBlock(outPath, value);
        written = result.written;
        jsonValid = result.jsonValid;
      } else {
        written = writeOrRemove(outPath, value);
      }
    } catch (err) {
      jsonValid = false;
      parseResult.warnings.push(`Invalid JSON in ${key}: ${err.message}`);
      if (fs.existsSync(outPath)) {
        fs.rmSync(outPath);
      }
    }

    parseResult.parsedBlocks[key] = {
      found: Boolean(value),
      length: value ? value.length : 0,
      outputPath: relToRoot(outPath),
      written,
      jsonValid
    };

    if (!value && !OPTIONAL_BLOCK_KEYS.includes(key)) {
      parseResult.missingBlocks.push(key);
    }
  }

  if (parseResult.missingBlocks.length > 0) {
    parseResult.warnings.push(`Missing blocks: ${parseResult.missingBlocks.join(', ')}`);
  }

  // Core pair required for routing work to Codex + DeepSea.
  const coreMissing = REQUIRED_BLOCK_KEYS.filter((k) => parseResult.missingBlocks.includes(k));
  if (coreMissing.length > 0) {
    parseResult.ok = false;
    parseResult.warnings.push(`Core blocks missing: ${coreMissing.join(', ')}`);
  }

  const parseResultPath = path.join(paths.promptsDir, 'parse_result.json');

  const requestMdPath = path.join(paths.promptsDir, 'request_for_pipeline.md');
  if (fs.existsSync(requestMdPath)) {
    const req = spawnSync(
      'node',
      ['scripts/parse_pipeline_requests.js', '--paper', paths.paperId, '--input', relToRoot(requestMdPath)],
      { cwd: ROOT, encoding: 'utf8' }
    );
    parseResult.requestForPipeline = {
      found: true,
      parseOk: req.status === 0,
      outputPath: relToRoot(path.join(paths.promptsDir, 'request_for_pipeline.json'))
    };
    if (req.status !== 0) {
      parseResult.warnings.push(`REQUEST_FOR_PIPELINE parse failed: ${(req.stderr || req.stdout || '').trim()}`);
    }
  } else {
    parseResult.requestForPipeline = {
      found: false,
      parseOk: true,
      outputPath: relToRoot(path.join(paths.promptsDir, 'request_for_pipeline.json'))
    };
  }

  fs.writeFileSync(parseResultPath, JSON.stringify(parseResult, null, 2), 'utf8');

  console.log('Reply parse finished.');
  console.log(`- paper_id: ${paths.paperId}`);
  console.log(`- parse_result: ${relToRoot(parseResultPath)}`);

  if (!parseResult.ok || parseResult.warnings.length > 0) {
    console.log('- warnings:');
    for (const w of parseResult.warnings) {
      console.log(`  - ${w}`);
    }
  }

  // 趣味模式触发逻辑
  if (parseResult.warnings.length > 0) {
    // 发现问题时触发北方一号的台词
    qvbingMode.checkAndEmit('北方一号', '发现bug');
  }

  if (!parseResult.ok) {
    // 解析失败时触发行动队长的台词
    qvbingMode.checkAndEmit('行动队长', '找不到问题');
  } else {
    // 解析成功时触发深海的台词
    qvbingMode.checkAndEmit('深海', '确认文章已经改好了');
  }

  if (parseResult.ok) {
    console.log('Parse status: OK');
  } else {
    console.log('Parse status: PARTIAL (core block missing)');
  }

  // Do not hard-fail on missing optional/partial blocks.
  process.exit(0);
}

main();

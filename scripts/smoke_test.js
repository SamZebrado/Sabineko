'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { paperPaths } = require('./paper_paths');
const {
  configurePipelineState,
  readPipelineState,
  consumeDeepSeaRun,
  terminatePipeline
} = require('./pipeline_state');

const ROOT = path.resolve(__dirname, '..');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    ...opts
  });
  return result;
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fileExists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function writeJson(rel, obj) {
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(obj, null, 2), 'utf8');
}

function parseArgs(argv) {
  return {
    keep: argv.includes('--keep')
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const paperId = `smoke_${stamp}`;
  const paperRoot = `papers/${paperId}`;

  console.log(`[smoke] temp paper_id=${paperId}`);

  const steps = [];
  let failed = false;

  try {
    // 1) init_paper.js creates paper layout
    let r = run('node', ['scripts/init_paper.js', '--paper', paperId]);
    ensure(r.status === 0, `init_paper failed: ${r.stderr || r.stdout}`);
    const requiredDirs = [
      `${paperRoot}/config`,
      `${paperRoot}/state`,
      `${paperRoot}/captures/history`,
      `${paperRoot}/captures/latest`,
      `${paperRoot}/prompts`,
      `${paperRoot}/handoff`,
      `${paperRoot}/downloads`
    ];
    for (const d of requiredDirs) {
      ensure(fileExists(d), `missing dir after init: ${d}`);
    }
    steps.push('init_paper:PASS');

    // 2) validate_paper_config catches invalid projectUrl
    writeJson(`${paperRoot}/config/deepsea.json`, {
      paperId,
      paperLabel: 'Smoke Invalid',
      projectUrl: 'https://https://deepsea.example.com/project',
      baseUrl: 'https://deepsea.example.com/',
      stateMode: 'global',
      capture: {
        waitUntil: 'domcontentloaded',
        timeoutMs: 45000,
        settleMs: 2000,
        networkLogMax: 200
      }
    });

    r = run('node', ['scripts/validate_paper_config.js', '--paper', paperId]);
    ensure(r.status !== 0, 'validate_paper_config should fail for placeholder projectUrl');
    steps.push('validate_invalid_config:PASS');

    // 3) valid config passes
    writeJson(`${paperRoot}/config/deepsea.json`, {
      paperId,
      paperLabel: 'Smoke Valid',
      projectUrl: 'https://deepsea.example.com/?u=test-smoke-project&pg=1',
      baseUrl: 'https://deepsea.example.com/',
      stateMode: 'global',
      capture: {
        waitUntil: 'domcontentloaded',
        timeoutMs: 45000,
        settleMs: 2000,
        networkLogMax: 200
      }
    });

    r = run('node', ['scripts/validate_paper_config.js', '--paper', paperId]);
    ensure(r.status === 0, `validate_paper_config should pass: ${r.stderr || r.stdout}`);
    steps.push('validate_valid_config:PASS');

    // 4) pipeline_state config / consume / terminate
    const paths = paperPaths(paperId);
    let pipelineState = configurePipelineState(paths, { maxDeepSeaRuns: 2, reviewMode: 'fixed_after_deepsea' });
    ensure(pipelineState.maxDeepSeaRuns === 2, 'maxDeepSeaRuns should be 2');
    ensure(pipelineState.remainingDeepSeaRuns === 2, 'remainingDeepSeaRuns should start at 2');

    pipelineState = consumeDeepSeaRun(paths, { source: 'smoke_test', note: 'first run' });
    ensure(pipelineState.remainingDeepSeaRuns === 1, 'remainingDeepSeaRuns should decrement to 1');
    ensure(pipelineState.completedDeepSeaRuns === 1, 'completedDeepSeaRuns should increment to 1');

    pipelineState = readPipelineState(paths);
    ensure(pipelineState.reviewMode === 'fixed_after_deepsea', 'reviewMode should persist');
    steps.push('pipeline_state_budget:PASS');

    // 5) parse_northno1_reply parses sample reply (case/space tolerant)
    const sample = fs.readFileSync(path.join(ROOT, 'examples', 'sample_northno1_reply.txt'), 'utf8');
    fs.writeFileSync(path.join(ROOT, paperRoot, 'prompts', 'northno1_reply.txt'), sample, 'utf8');

    r = run('node', ['scripts/parse_northno1_reply.js', '--paper', paperId, '--input', `${paperRoot}/prompts/northno1_reply.txt`]);
    ensure(r.status === 0, `parse_northno1_reply failed: ${r.stderr || r.stdout}`);

    ensure(fileExists(`${paperRoot}/prompts/for_codex.md`), 'for_codex.md missing');
    ensure(fileExists(`${paperRoot}/prompts/for_deepsea.md`), 'for_deepsea.md missing');
    ensure(fileExists(`${paperRoot}/prompts/note_for_user.md`), 'note_for_user.md missing');
    ensure(fileExists(`${paperRoot}/prompts/parse_result.json`), 'parse_result.json missing');

    const parseResult = JSON.parse(fs.readFileSync(path.join(ROOT, paperRoot, 'prompts', 'parse_result.json'), 'utf8'));
    ensure(parseResult.parsedBlocks?.PROMPT_FOR_CODEX?.found, 'PROMPT_FOR_CODEX should be found');
    ensure(parseResult.parsedBlocks?.PROMPT_FOR_DEEPSEA?.found, 'PROMPT_FOR_DEEPSEA should be found');
    steps.push('parse_sample_reply:PASS');

    // 6) parse supports pipeline JSON block
    fs.writeFileSync(path.join(ROOT, paperRoot, 'prompts', 'northno1_reply.txt'), [
      '===PROMPT_FOR_CODEX===',
      'codex prompt',
      '',
      '===PROMPT_FOR_DEEPSEA===',
      'deepsea prompt',
      '',
      '===PIPELINE_API_REQUESTS_JSON===',
      '{',
      '  "version": 1,',
      '  "requests": [',
      '    { "action": "session.terminate", "params": { "reason": "done", "by": "gpt" } }',
      '  ]',
      '}'
    ].join('\n'), 'utf8');

    r = run('node', ['scripts/parse_northno1_reply.js', '--paper', paperId, '--input', `${paperRoot}/prompts/northno1_reply.txt`]);
    ensure(r.status === 0, `parse should accept PIPELINE_API_REQUESTS_JSON: ${r.stderr || r.stdout}`);
    ensure(fileExists(`${paperRoot}/prompts/pipeline_api_requests.json`), 'pipeline_api_requests.json missing');
    const pipelineRequests = JSON.parse(fs.readFileSync(path.join(ROOT, paperRoot, 'prompts', 'pipeline_api_requests.json'), 'utf8'));
    ensure(Array.isArray(pipelineRequests.requests), 'pipeline_api_requests.json should contain requests[]');
    steps.push('parse_pipeline_api_json:PASS');

    // 7) parse_pipeline_requests supports current_file + file list
    fs.writeFileSync(path.join(ROOT, paperRoot, 'prompts', 'request_for_pipeline.md'), [
      '- pdf',
      '- current_file',
      '- file: sections/methods.tex'
    ].join('\n'), 'utf8');
    r = run('node', ['scripts/parse_pipeline_requests.js', '--paper', paperId, '--input', `${paperRoot}/prompts/request_for_pipeline.md`]);
    ensure(r.status === 0, `parse_pipeline_requests failed: ${r.stderr || r.stdout}`);
    const requestJson = JSON.parse(fs.readFileSync(path.join(ROOT, paperRoot, 'prompts', 'request_for_pipeline.json'), 'utf8'));
    ensure(Array.isArray(requestJson.resources), 'request_for_pipeline.json should contain resources[]');
    ensure(requestJson.resources.includes('current_file'), 'request_for_pipeline.json should include current_file');
    steps.push('parse_pipeline_requests_current_file:PASS');

    // 8) build fixed DeepSea review message
    r = run('node', ['scripts/build_deepsea_review_message.js', '--paper', paperId]);
    ensure(r.status === 0, `build_deepsea_review_message failed: ${r.stderr || r.stdout}`);
    ensure(fileExists(`${paperRoot}/prompts/to_northno1_after_deepsea.md`), 'to_northno1_after_deepsea.md missing');
    steps.push('build_deepsea_review_prompt:PASS');

    // 9) deepsea automation dry-run covers download/send paths
    r = run('node', ['scripts/deepsea_automation.js', '--paper', paperId, '--action', 'download', '--dry-run', '--resource', 'pdf', '--resource', 'current_file']);
    ensure(r.status === 0, `deepsea_automation download dry-run failed: ${r.stderr || r.stdout}`);
    const deepseaDownloadDryRun = JSON.parse(r.stdout);
    ensure(deepseaDownloadDryRun.dryRun === true, 'deepsea download dry-run should report dryRun=true');
    ensure(Array.isArray(deepseaDownloadDryRun.resources), 'deepsea download dry-run should include resources');
    r = run('node', ['scripts/deepsea_automation.js', '--paper', paperId, '--action', 'send', '--dry-run', '--message-text', 'smoke deepsea message']);
    ensure(r.status === 0, `deepsea_automation send dry-run failed: ${r.stderr || r.stdout}`);
    const deepseaSendDryRun = JSON.parse(r.stdout);
    ensure(deepseaSendDryRun.messagePreview === 'smoke deepsea message', 'deepsea send dry-run should preserve message preview');
    steps.push('deepsea_automation_dry_run:PASS');

    // 10) parse supports missing NOTE_FOR_USER without crashing
    fs.writeFileSync(path.join(ROOT, paperRoot, 'prompts', 'northno1_reply.txt'), [
      '=== prompt_for_codex ===',
      'only codex block',
      '',
      '===   PROMPT_FOR_DEEPSEA   ===',
      'only deepsea block'
    ].join('\n'), 'utf8');

    r = run('node', ['scripts/parse_northno1_reply.js', '--paper', paperId, '--input', `${paperRoot}/prompts/northno1_reply.txt`]);
    ensure(r.status === 0, `parse should not crash on missing NOTE_FOR_USER: ${r.stderr || r.stdout}`);

    const parseResult2 = JSON.parse(fs.readFileSync(path.join(ROOT, paperRoot, 'prompts', 'parse_result.json'), 'utf8'));
    ensure(parseResult2.parsedBlocks?.NOTE_FOR_USER?.found === false, 'NOTE_FOR_USER should be marked absent');
    ensure(parseResult2.ok === true, 'core blocks exist, parse_result.ok should remain true');
    steps.push('parse_missing_note_tolerant:PASS');

    // 11) explicit termination persists
    pipelineState = terminatePipeline(paths, { reason: 'smoke_done', by: 'smoke_test' });
    ensure(pipelineState.terminated === true, 'pipeline should terminate');
    ensure(pipelineState.terminationReason === 'smoke_done', 'termination reason should persist');
    steps.push('pipeline_state_terminate:PASS');

    console.log('[smoke] PASS');
    for (const s of steps) {
      console.log(`- ${s}`);
    }
    console.log(`[smoke] temp paper: ${paperRoot}`);
  } catch (err) {
    failed = true;
    console.error('[smoke] FAIL');
    for (const s of steps) {
      console.error(`- ${s}`);
    }
    console.error(`- error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (!args.keep) {
      try {
        fs.rmSync(path.join(ROOT, paperRoot), { recursive: true, force: true });
        if (!failed) {
          console.log('[smoke] cleaned temp paper directory');
        }
      } catch (err) {
        console.error(`[smoke] cleanup warning: ${err.message}`);
      }
    } else {
      console.log('[smoke] keep mode enabled, temp paper directory retained');
    }
  }
}

main();

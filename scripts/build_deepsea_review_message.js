'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_PAPER_ID,
  sanitizePaperId,
  paperPaths,
  relToRoot
} = require('./paper_paths');
const { readPipelineState } = require('./pipeline_state');

function parseArgs(argv) {
  let paper = DEFAULT_PAPER_ID;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--paper' && argv[i + 1]) {
      paper = argv[i + 1];
      i += 1;
    }
  }
  return { paper: sanitizePaperId(paper) };
}

function maybeReadText(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function maybeReadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return null;
  }
}

function main() {
  const { paper } = parseArgs(process.argv);
  const paths = paperPaths(paper);
  const pipelineState = readPipelineState(paths);
  const captureMeta = maybeReadJson(path.join(paths.captureLatestDir, 'capture_meta.json'));
  const domSummary = maybeReadText(path.join(paths.captureLatestDir, 'dom_summary.md'));
  const objectiveText = maybeReadText(path.join(paths.promptsDir, 'objective.md'));

  const lines = [];
  lines.push('# Fixed DeepSea Review Message For NorthNo1');
  lines.push('');
  lines.push('请基于下面的当前论文状态，判断 DeepSea 处理之后是否还需要继续修改。');
  lines.push('注意：pipeline 只能接收 JSON request，不能接收自由文本控制命令。');
  lines.push('');
  lines.push('## Paper');
  lines.push(`- paper_id: ${paths.paperId}`);
  lines.push(`- project_url: ${captureMeta?.projectUrl || '(unknown)'}`);
  lines.push(`- max_deepsea_runs: ${pipelineState.maxDeepSeaRuns}`);
  lines.push(`- remaining_deepsea_runs: ${pipelineState.remainingDeepSeaRuns}`);
  lines.push(`- completed_deepsea_runs: ${pipelineState.completedDeepSeaRuns}`);
  lines.push(`- terminated: ${pipelineState.terminated ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Objective');
  lines.push('```markdown');
  lines.push((objectiveText || '(missing objective)').split('\n').slice(0, 80).join('\n'));
  lines.push('```');
  lines.push('');
  lines.push('## DOM Summary');
  lines.push('```markdown');
  lines.push((domSummary || '(missing dom summary)').split('\n').slice(0, 180).join('\n'));
  lines.push('```');
  lines.push('');
  lines.push('输出要求：');
  lines.push('- 若还需要继续改，给出 `PROMPT_FOR_CODEX` / `PROMPT_FOR_DEEPSEA`，并在 `PIPELINE_API_REQUESTS_JSON` 中给出下一步 JSON request。');
  lines.push('- 若已经达到论文发表要求、没有必要继续迭代，请在 `PIPELINE_API_REQUESTS_JSON` 中输出 `session.terminate`。');
  lines.push('- 不要让 pipeline 自行解释你的自然语言。所有 pipeline 动作必须放进 JSON。');
  lines.push('- 若需要把 Codex 产物重新交给 DeepSea，优先要求 pipeline 走 `bundle.build` + `deepsea.push_bundle`；只有单个轻量文件才使用 `deepsea.upload_files`。');
  lines.push('');
  lines.push('===PROMPT_FOR_CODEX===');
  lines.push('（若不需要 Codex 继续做事，可写 no further codex work）');
  lines.push('');
  lines.push('===PROMPT_FOR_DEEPSEA===');
  lines.push('（若不需要 DeepSea 继续做事，可写 no further deepsea work）');
  lines.push('');
  lines.push('===NOTE_FOR_USER===');
  lines.push('（简短说明当前是否建议终止循环）');
  lines.push('');
  lines.push('===PIPELINE_API_REQUESTS_JSON===');
  lines.push('```json');
  lines.push('{');
  lines.push('  "version": 1,');
  lines.push('  "requests": [');
  lines.push('    { "action": "deepsea.download", "params": { "resources": ["pdf"] } },');
  lines.push('    { "action": "session.terminate", "params": { "reason": "paper_ready_for_submission", "by": "gpt" } }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');

  const outPath = path.join(paths.promptsDir, 'to_northno1_after_deepsea.md');
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');

  console.log('Fixed DeepSea review message generated.');
  console.log(`- paper_id: ${paths.paperId}`);
  console.log(`- output: ${relToRoot(outPath)}`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

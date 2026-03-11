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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function maybeReadText(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function toBullet(list) {
  if (!list || list.length === 0) return '- 未检测到';
  return list.map((x) => `- ${String(x).replace(/\s+/g, ' ').trim()}`).join('\n');
}

function capList(list, max = 12) {
  return (list || []).slice(0, max);
}

function fileStateLine(ok) {
  return ok ? 'yes' : 'no';
}

function main() {
  const { paper } = parseArgs(process.argv);
  const paths = paperPaths(paper);

  const captureDir = paths.captureLatestDir;
  const pipelineState = readPipelineState(paths);
  const metaPath = path.join(captureDir, 'capture_meta.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Missing capture_meta.json, run capture first: ${relToRoot(metaPath)}`);
  }

  const meta = readJson(metaPath);
  const domSummary = maybeReadText(path.join(captureDir, 'dom_summary.md')) || '(dom_summary.md missing)';
  const objectiveText = maybeReadText(path.join(paths.promptsDir, 'objective.md'))
    || maybeReadText(path.join(paths.promptsDir, 'objective.txt'))
    || '(未提供 objective；可在网页控制台或本地写入 papers/<paper_id>/prompts/objective.md)';

  const signalsPath = path.join(captureDir, 'dom_signals.json');
  const signals = fs.existsSync(signalsPath)
    ? readJson(signalsPath)
    : { headings: [], sections: [], figures: [], tables: [], codeBlocks: [], latexBlocks: [], comments: [] };

  const frameInfoPath = path.join(captureDir, 'frames.json');
  const frameInfo = fs.existsSync(frameInfoPath)
    ? readJson(frameInfoPath)
    : { embeddedElements: [] };

  const assetsPath = path.join(captureDir, 'assets.json');
  const assets = fs.existsSync(assetsPath)
    ? readJson(assetsPath)
    : { pdfCandidates: [] };

  const files = {
    pageHtml: fs.existsSync(path.join(captureDir, 'page.html')),
    pageUrl: fs.existsSync(path.join(captureDir, 'page_url.txt')),
    title: fs.existsSync(path.join(captureDir, 'title.txt')),
    frames: fs.existsSync(path.join(captureDir, 'frames.json')),
    assets: fs.existsSync(path.join(captureDir, 'assets.json')),
    domSummary: fs.existsSync(path.join(captureDir, 'dom_summary.md')),
    screenshot: fs.existsSync(path.join(captureDir, 'fallback_fullpage.png')),
    network: fs.existsSync(path.join(captureDir, 'network_log.json')),
    previewPdf: fs.existsSync(path.join(captureDir, 'preview.pdf'))
  };

  const accessibleFrames = (frameInfo.embeddedElements || []).filter((f) => f.accessStatus === 'accessible');
  const crossOriginFrames = (frameInfo.embeddedElements || []).filter((f) => f.accessStatus === 'cross_origin');
  const inaccessibleFrames = (frameInfo.embeddedElements || []).filter((f) => f.accessStatus === 'inaccessible');

  const lines = [];
  lines.push('# Message Draft For NorthNo1 (Web)');
  lines.push('');
  lines.push('请基于以下 DeepSea 页面抓取结果，生成给 Codex 和 DeepSea 的下一步执行 prompt。');
  lines.push('');

  lines.push('## Paper Identity');
  lines.push(`- paper_id: ${paths.paperId}`);
  lines.push(`- deepsea_project_url: ${meta.projectUrl}`);
  lines.push(`- capture_time: ${meta.timestamp}`);
  lines.push(`- capture_run_dir: ${meta.captureRunDir || relToRoot(captureDir)}`);
  lines.push(`- latest_dir: ${relToRoot(captureDir)}`);
  lines.push(`- max_deepsea_runs: ${pipelineState.maxDeepSeaRuns}`);
  lines.push(`- remaining_deepsea_runs: ${pipelineState.remainingDeepSeaRuns}`);
  lines.push(`- pipeline_terminated: ${pipelineState.terminated ? 'yes' : 'no'}`);
  lines.push('');

  lines.push('## User Objective');
  lines.push('```markdown');
  lines.push(objectiveText.split('\n').slice(0, 80).join('\n'));
  lines.push('```');
  lines.push('');

  lines.push('## 文件清单摘要');
  lines.push(`- page.html: ${fileStateLine(files.pageHtml)}`);
  lines.push(`- frames.json: ${fileStateLine(files.frames)}`);
  lines.push(`- assets.json: ${fileStateLine(files.assets)}`);
  lines.push(`- network_log.json: ${fileStateLine(files.network)}`);
  lines.push(`- preview.pdf: ${fileStateLine(files.previewPdf)}`);
  lines.push(`- fallback_fullpage.png: ${fileStateLine(files.screenshot)}`);
  lines.push('');

  lines.push('## 当前 DeepSea 页面总体情况');
  lines.push(`- capture_status: ${meta.status}`);
  lines.push(`- capture_error_summary: ${meta.error || '(none)'}`);
  lines.push(`- html_first_capture(page.content): ${files.pageHtml ? 'yes' : 'no'}`);
  lines.push(`- iframe_accessible: ${accessibleFrames.length}`);
  lines.push(`- iframe_cross_origin: ${crossOriginFrames.length}`);
  lines.push(`- iframe_inaccessible: ${inaccessibleFrames.length}`);
  lines.push(`- pdf_status: ${meta.pdf?.status || '(unknown)'}`);
  lines.push('');

  lines.push('## 关键内容提取');
  lines.push('### 页面标题/章节线索');
  lines.push(toBullet(capList([...(signals.headings || []), ...(signals.sections || [])], 20)));
  lines.push('');
  lines.push('### Figure / Table 线索');
  lines.push(toBullet(capList([...(signals.figures || []), ...(signals.tables || [])], 20)));
  lines.push('');
  lines.push('### 代码块线索');
  lines.push(toBullet(capList(signals.codeBlocks, 12)));
  lines.push('');
  lines.push('### LaTeX/公式线索');
  lines.push(toBullet(capList(signals.latexBlocks, 12)));
  lines.push('');
  lines.push('### 注释/批注线索');
  lines.push(toBullet(capList(signals.comments, 12)));
  lines.push('');

  lines.push('## PDF 预览状态');
  lines.push(`- preview_pdf_exists: ${files.previewPdf ? 'yes' : 'no'}`);
  lines.push(`- preview_pdf_path: ${files.previewPdf ? relToRoot(path.join(captureDir, 'preview.pdf')) : '(not found)'}`);
  lines.push(`- detected_pdf_candidates: ${(meta.pdf?.detectedCandidates || assets.pdfCandidates || []).length}`);
  lines.push(`- pdf_status: ${meta.pdf?.status || '(unknown)'}`);
  lines.push('');

  lines.push('## DOM 摘要（节选）');
  lines.push('```markdown');
  lines.push(domSummary.split('\n').slice(0, 180).join('\n'));
  lines.push('```');
  lines.push('');

  lines.push('请按以下格式输出，保持三个区块都存在：');
  lines.push('');
  lines.push('===PROMPT_FOR_CODEX===');
  lines.push('（给 Codex 的可执行 prompt，包含输入/输出/验收标准。必须明确要求 Codex：所有需要 pipeline 执行的事情只能通过 JSON API request 提出，不能给 pipeline 发自由文本 prompt。涉及文件获取、上传、向 GPT Plus 请求二次意见、向 DeepSea 推送结果、终止循环，全部都要列成 JSON 请求。若要把多文件或带目录结构的结果交给 DeepSea，优先要求 pipeline 走 `bundle.build` + `deepsea.push_bundle`，即先打 zip 再让 DeepSea 导入/解压；`deepsea.upload_files` 只用于单个轻量文件，例如一张图片或单个说明文件。）');
  lines.push('');
  lines.push('===PROMPT_FOR_DEEPSEA===');
  lines.push('（给 DeepSea 的可执行 prompt，突出页面内操作步骤）');
  lines.push('');
  lines.push('===NOTE_FOR_USER===');
  lines.push('（给用户的简短说明：下一步 + 风险）');
  lines.push('');
  lines.push('===REQUEST_FOR_PIPELINE===');
  lines.push('（可选。若你判断 Codex 需要某些 DeepSea 单文件或 PDF，请列出下载请求；没有则写 none）');
  lines.push('建议格式：');
  lines.push('- pdf');
  lines.push('- current_file');
  lines.push('- file: main.tex');
  lines.push('- file: sections/methods.tex');
  lines.push('');
  lines.push('===PIPELINE_API_REQUESTS_JSON===');
  lines.push('（可选。仅当你要让 pipeline 立即执行动作时填写。必须是合法 JSON；若没有立即动作，写 {}。）');
  lines.push('示例：');
  lines.push('```json');
  lines.push('{');
  lines.push('  "version": 1,');
  lines.push('  "requests": [');
  lines.push('    { "action": "file.list", "params": { "scope": "captures_latest" } },');
  lines.push('    { "action": "file.read", "params": { "scope": "captures_latest", "path": "dom_summary.md", "format": "text" } },');
  lines.push('    { "action": "deepsea.download", "params": { "resources": ["pdf", "current_file"] } },');
  lines.push('    { "action": "session.terminate", "params": { "reason": "paper_ready_for_submission", "by": "gpt" } }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('补充要求：');
  lines.push('- 如果 DeepSea 运行结束后你判断还需要继续修改，不要让 pipeline 自由推理；请用 JSON request 明确说明下一步动作。');
  lines.push('- 如果你认为论文已经达到发表要求、没有必要继续迭代，请显式输出 `session.terminate` JSON 请求来终结 pipeline。');
  lines.push('- 若需要把 Codex 产物交给 DeepSea，默认优先输出 zip-bundle 方案对应的 JSON request，而不是逐文件上传。');
  lines.push('');

  const outPath = path.join(paths.promptsDir, 'to_northno1.md');
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');

  console.log('NorthNo1 draft generated.');
  console.log(`- paper_id: ${paths.paperId}`);
  console.log(`- output: ${relToRoot(outPath)}`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

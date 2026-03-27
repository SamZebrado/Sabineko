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

function walkFiles(dirPath, predicate, out = []) {
  if (!fs.existsSync(dirPath)) return out;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(abs, predicate, out);
    } else if (predicate(abs, entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

function excerpt(text, maxLines = 80) {
  const lines = String(text || '').split('\n');
  return lines.slice(0, maxLines).join('\n');
}

function quoteBlock(title, filePath, text, maxLines = 80) {
  const lines = [];
  lines.push(`### ${title}`);
  lines.push(`- source: ${relToRoot(filePath)}`);
  lines.push('```text');
  lines.push(excerpt(text, maxLines) || '(empty)');
  lines.push('```');
  lines.push('');
  return lines;
}

function main() {
  const { paper } = parseArgs(process.argv);
  const paths = paperPaths(paper);

  const objectivePath = path.join(paths.promptsDir, 'objective.md');
  const northno1ReplyPath = path.join(paths.promptsDir, 'northno1_reply.txt');
  const noteForUserPath = path.join(paths.promptsDir, 'note_for_user.md');
  const forDeepSeaPath = path.join(paths.promptsDir, 'for_deepsea.md');
  const deepseaReplyPath = path.join(paths.promptsDir, 'deepsea_reply.txt');

  const deepseaReviewFiles = walkFiles(
    paths.paperRoot,
    (abs, name) => /^ROUND\d+_DEEPSEA_REVIEW\.md$/i.test(name)
  ).sort();

  const lines = [];
  lines.push('# Post-Test Consolidation Message For NorthNo1');
  lines.push('');
  lines.push('请基于下面的测试期材料，提炼“测试之外仍然有价值的真实论文修改意见”，并输出最终交给 DeepSea 的整合 prompt。');
  lines.push('');
  lines.push('严格要求：');
  lines.push('- 只保留与论文质量、JoV 标准、论证、结构、统计报告、图表、表达清晰度相关的真实意见。');
  lines.push('- 明确忽略测试流程本身：例如 Text1/Text2、测试图片、隐藏嵌图、上传/下载、zip、pipeline API、agent 协调、Cloudflare、登录、浏览器自动化。');
  lines.push('- `PROMPT_FOR_CODEX` 必须严格只写一行：`no further codex work`');
  lines.push('- `PROMPT_FOR_DEEPSEA` 必须只包含可直接应用到论文项目的真实修改要求，不得包含测试文件操作。');
  lines.push('- 如果你认为已经没有需要修改的真实论文意见，可以让 `PROMPT_FOR_DEEPSEA` 写 `no further deepsea work`。');
  lines.push('- `PIPELINE_API_REQUESTS_JSON` 默认写 `{}`；只有在你判断应直接终止循环时，才输出 `session.terminate`。');
  lines.push('');
  lines.push('## Paper');
  lines.push(`- paper_id: ${paths.paperId}`);
  lines.push(`- generated_at: ${new Date().toISOString()}`);
  lines.push('');

  if (fs.existsSync(objectivePath)) {
    lines.push(...quoteBlock('Objective', objectivePath, maybeReadText(objectivePath), 80));
  }
  if (fs.existsSync(northno1ReplyPath)) {
    lines.push(...quoteBlock('Latest GPT Reply', northno1ReplyPath, maybeReadText(northno1ReplyPath), 140));
  }
  if (fs.existsSync(noteForUserPath)) {
    lines.push(...quoteBlock('Latest NOTE_FOR_USER', noteForUserPath, maybeReadText(noteForUserPath), 80));
  }
  if (fs.existsSync(forDeepSeaPath)) {
    lines.push(...quoteBlock('Latest PROMPT_FOR_DEEPSEA', forDeepSeaPath, maybeReadText(forDeepSeaPath), 120));
  }
  if (fs.existsSync(deepseaReplyPath)) {
    lines.push(...quoteBlock('Latest DeepSea Reply', deepseaReplyPath, maybeReadText(deepseaReplyPath), 40));
  }
  for (const deepseaReviewPath of deepseaReviewFiles) {
    lines.push(...quoteBlock(`DeepSea Review ${path.basename(deepseaReviewPath)}`, deepseaReviewPath, maybeReadText(deepseaReviewPath), 120));
  }

  lines.push('请按以下固定格式输出：');
  lines.push('');
  lines.push('===PROMPT_FOR_CODEX===');
  lines.push('no further codex work');
  lines.push('');
  lines.push('===PROMPT_FOR_DEEPSEA===');
  lines.push('（这里只写测试之外仍然有价值的真实论文修改要求）');
  lines.push('');
  lines.push('===NOTE_FOR_USER===');
  lines.push('（简短说明保留了哪些真实意见、忽略了哪些测试意见）');
  lines.push('');
  lines.push('===PIPELINE_API_REQUESTS_JSON===');
  lines.push('```json');
  lines.push('{}');
  lines.push('```');
  lines.push('');

  const outPath = path.join(paths.promptsDir, 'to_northno1_post_test.md');
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');

  console.log('Post-test consolidation message generated.');
  console.log(`- paper_id: ${paths.paperId}`);
  console.log(`- output: ${relToRoot(outPath)}`);
  console.log(`- deepsea_review_count: ${deepseaReviewFiles.length}`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

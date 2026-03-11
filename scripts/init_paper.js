'use strict';

const {
  DEFAULT_PAPER_ID,
  sanitizePaperId,
  paperPaths,
  ensurePaperLayout,
  ensurePaperConfig,
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

function main() {
  const { paper } = parseArgs(process.argv);
  const paths = paperPaths(paper);

  ensurePaperLayout(paths);
  ensurePaperConfig(paths);

  console.log('Paper workspace ready.');
  console.log(`- paper_id: ${paper}`);
  console.log(`- config: ${relToRoot(paths.configPath)}`);
  console.log(`- captures latest: ${relToRoot(paths.captureLatestDir)}`);
  console.log(`- captures history: ${relToRoot(paths.captureHistoryDir)}`);
  console.log(`- prompts: ${relToRoot(paths.promptsDir)}`);
}

main();

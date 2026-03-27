'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  DEFAULT_PAPER_ID,
  sanitizePaperId,
  paperPaths,
  ensurePaperLayout,
  relToRoot
} = require('./paper_paths');

function parseArgs(argv) {
  const out = {
    paper: DEFAULT_PAPER_ID
  };

  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--paper' && argv[i + 1]) {
      out.paper = argv[i + 1];
      i += 1;
    }
  }

  out.paper = sanitizePaperId(out.paper);
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const paths = paperPaths(args.paper);
  ensurePaperLayout(paths);

  const handoffDir = path.join(paths.paperRoot, 'handoff');
  fs.mkdirSync(handoffDir, { recursive: true });

  const bundlePath = path.join(handoffDir, 'for_deepsea.zip');
  const manifestPath = path.join(handoffDir, 'bundle_manifest.json');

  const candidates = [
    path.join(paths.promptsDir, 'for_deepsea.md'),
    path.join(paths.promptsDir, 'for_codex.md'),
    path.join(paths.promptsDir, 'note_for_user.md'),
    path.join(paths.promptsDir, 'to_northno1.md'),
    path.join(paths.promptsDir, 'parse_result.json'),
    path.join(paths.promptsDir, 'objective.md'),
    path.join(paths.captureLatestDir, 'capture_meta.json'),
    path.join(paths.captureLatestDir, 'dom_summary.md'),
    path.join(paths.captureLatestDir, 'frames.json'),
    path.join(paths.captureLatestDir, 'assets.json'),
    path.join(paths.captureLatestDir, 'network_log.json')
  ];

  const include = candidates
    .filter((abs) => fs.existsSync(abs))
    .map((abs) => path.relative(paths.ROOT, abs));

  if (include.length === 0) {
    throw new Error(`No files available to bundle under ${relToRoot(paths.paperRoot)}`);
  }

  if (fs.existsSync(bundlePath)) {
    fs.rmSync(bundlePath);
  }

  const result = spawnSync(
    'zip',
    ['-r', bundlePath, ...include, '-x', '*.DS_Store'],
    {
      cwd: paths.ROOT,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`zip failed: ${result.stderr || result.stdout}`);
  }

  const manifest = {
    timestamp: new Date().toISOString(),
    paperId: paths.paperId,
    bundlePath: relToRoot(bundlePath),
    files: include
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log('DeepSea bundle built.');
  console.log(`- paper_id: ${paths.paperId}`);
  console.log(`- bundle: ${manifest.bundlePath}`);
  console.log(`- file_count: ${include.length}`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

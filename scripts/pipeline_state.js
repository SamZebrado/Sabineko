'use strict';

const fs = require('fs');
const path = require('path');

function nowIso() {
  return new Date().toISOString();
}

function statePath(paths) {
  return path.join(paths.paperStateDir, 'pipeline_state.json');
}

function defaultState(paperId) {
  return {
    version: 1,
    paperId,
    status: 'idle',
    terminated: false,
    terminationReason: null,
    maxDeepSeaRuns: 0,
    remainingDeepSeaRuns: 0,
    completedDeepSeaRuns: 0,
    deepseaRuns: [],
    reviewMode: 'fixed_after_deepsea',
    updatedAt: nowIso()
  };
}

function readPipelineState(paths) {
  const p = statePath(paths);
  if (!fs.existsSync(p)) {
    const initial = defaultState(paths.paperId);
    fs.writeFileSync(p, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      ...defaultState(paths.paperId),
      ...parsed,
      paperId: paths.paperId,
      deepseaRuns: Array.isArray(parsed.deepseaRuns) ? parsed.deepseaRuns : []
    };
  } catch (err) {
    const reset = defaultState(paths.paperId);
    fs.writeFileSync(p, JSON.stringify(reset, null, 2), 'utf8');
    return reset;
  }
}

function writePipelineState(paths, state) {
  state.updatedAt = nowIso();
  fs.writeFileSync(statePath(paths), JSON.stringify(state, null, 2), 'utf8');
  return state;
}

function updatePipelineState(paths, updater) {
  const state = readPipelineState(paths);
  updater(state);
  return writePipelineState(paths, state);
}

function configurePipelineState(paths, patch = {}) {
  const maxRaw = Number(patch.maxDeepSeaRuns);
  const maxDeepSeaRuns = Number.isFinite(maxRaw) ? Math.max(0, Math.floor(maxRaw)) : null;

  return updatePipelineState(paths, (state) => {
    if (maxDeepSeaRuns !== null) {
      const consumed = Math.max(0, Number(state.completedDeepSeaRuns || 0));
      state.maxDeepSeaRuns = maxDeepSeaRuns;
      state.remainingDeepSeaRuns = Math.max(0, maxDeepSeaRuns - consumed);
    }

    if (patch.reviewMode) {
      state.reviewMode = String(patch.reviewMode).trim() || state.reviewMode;
    }

    if (!state.terminated) {
      state.status = 'configured';
    }
  });
}

function consumeDeepSeaRun(paths, meta = {}) {
  return updatePipelineState(paths, (state) => {
    if (state.terminated) {
      throw new Error(`Pipeline already terminated: ${state.terminationReason || 'no reason provided'}`);
    }
    if (state.remainingDeepSeaRuns <= 0) {
      throw new Error(`DeepSea run budget exhausted for ${paths.paperId}`);
    }

    state.remainingDeepSeaRuns -= 1;
    state.completedDeepSeaRuns += 1;
    state.status = state.remainingDeepSeaRuns > 0 ? 'deepsea_run_consumed' : 'budget_exhausted';
    state.deepseaRuns.push({
      at: nowIso(),
      source: String(meta.source || 'api'),
      note: String(meta.note || '').trim(),
      bundlePath: String(meta.bundlePath || '').trim() || null,
      remainingAfter: state.remainingDeepSeaRuns
    });
  });
}

function terminatePipeline(paths, meta = {}) {
  return updatePipelineState(paths, (state) => {
    state.terminated = true;
    state.status = 'terminated';
    state.terminationReason = String(meta.reason || 'terminated_by_request').trim();
    state.terminatedBy = String(meta.by || 'api').trim();
    state.terminatedAt = nowIso();
  });
}

module.exports = {
  statePath,
  defaultState,
  readPipelineState,
  writePipelineState,
  updatePipelineState,
  configurePipelineState,
  consumeDeepSeaRun,
  terminatePipeline
};


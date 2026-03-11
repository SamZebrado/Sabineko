'use strict';

const el = (id) => document.getElementById(id);

const state = {
  currentPaper: 'paper_default',
  pollingTimer: null
};

async function api(path, method = 'GET', body = null) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await res.json();
  if (!res.ok) {
    throw new Error(payload.error || `HTTP ${res.status}`);
  }
  return payload;
}

function renderProgress(status) {
  const list = el('progressList');
  const done = status.steps || {};

  const rows = [
    ['objective_saved', done.objectiveSaved],
    ['capture_done', done.captureDone],
    ['to_northno1_ready', done.toChatgptReady],
    ['reply_saved', done.replySaved],
    ['parse_done', done.parseDone]
  ];

  list.innerHTML = rows
    .map(([name, ok]) => `<li>${ok ? '✓' : '·'} ${name}</li>`)
    .join('');

  el('currentStep').textContent = `当前步骤：${status.currentStep || 'idle'}`;
}

function fillText(id, value) {
  const node = el(id);
  if (node) {
    node.value = value || '';
  }
}

async function refreshPapers() {
  const data = await api('/api/papers');
  const select = el('paperSelect');

  select.innerHTML = data.papers
    .map((p) => `<option value="${p.paperId}">${p.paperId}</option>`)
    .join('');

  if (!data.papers.find((p) => p.paperId === state.currentPaper)) {
    state.currentPaper = data.defaultPaperId || (data.papers[0] && data.papers[0].paperId) || 'paper_default';
  }

  select.value = state.currentPaper;
  const selected = data.papers.find((p) => p.paperId === state.currentPaper);
  el('paperHint').textContent = selected
    ? `projectUrl: ${selected.projectUrl || '(empty)'} | step: ${selected.currentStep}`
    : '';
}

async function refreshContext() {
  const ctx = await api(`/api/context?paper=${encodeURIComponent(state.currentPaper)}`);

  fillText('projectUrl', ctx.config.projectUrl);
  fillText('baseUrl', ctx.config.baseUrl);
  fillText('loginSelector', ctx.config.loginSuccessSelector || '');
  el('stateMode').value = ctx.config.stateMode || 'global';

  fillText('objective', ctx.files.objective);
  fillText('toChatgpt', ctx.files.toChatgpt);
  fillText('northno1Reply', ctx.files.northno1Reply);
  fillText('forCodex', ctx.files.forCodex);
  fillText('forDeepSea', ctx.files.forDeepSea);
  fillText('noteForUser', ctx.files.noteForUser);

  const logs = (ctx.status.logs || []).slice(-120).join('\n');
  el('logBox').textContent = logs;

  renderProgress(ctx.status);
}

async function createPaper() {
  const newPaperId = el('newPaperId').value.trim();
  if (!newPaperId) {
    return;
  }

  await api('/api/init-paper', 'POST', { paperId: newPaperId });
  state.currentPaper = newPaperId.replace(/[^a-zA-Z0-9_-]/g, '_');
  el('newPaperId').value = '';
  await refreshPapers();
  await refreshContext();
}

async function saveConfig() {
  await api('/api/save-config', 'POST', {
    paperId: state.currentPaper,
    projectUrl: el('projectUrl').value,
    baseUrl: el('baseUrl').value,
    loginSuccessSelector: el('loginSelector').value,
    stateMode: el('stateMode').value
  });
  await refreshPapers();
  await refreshContext();
}

async function saveObjective() {
  await api('/api/save-objective', 'POST', {
    paperId: state.currentPaper,
    objective: el('objective').value
  });
  await refreshContext();
}

async function runCapture() {
  await api('/api/run-capture', 'POST', {
    paperId: state.currentPaper,
    forceLogin: el('forceLogin').checked
  });
  await refreshContext();
}

async function saveReply() {
  await api('/api/save-reply', 'POST', {
    paperId: state.currentPaper,
    reply: el('northno1Reply').value
  });
  await refreshContext();
}

async function parseReply() {
  await api('/api/parse-reply', 'POST', {
    paperId: state.currentPaper
  });
  await refreshContext();
}

function bindEvents() {
  el('refreshPapersBtn').addEventListener('click', async () => {
    await refreshPapers();
    await refreshContext();
  });

  el('paperSelect').addEventListener('change', async (e) => {
    state.currentPaper = e.target.value;
    await refreshPapers();
    await refreshContext();
  });

  el('createPaperBtn').addEventListener('click', async () => {
    try {
      await createPaper();
    } catch (err) {
      alert(err.message);
    }
  });

  el('saveConfigBtn').addEventListener('click', async () => {
    try {
      await saveConfig();
    } catch (err) {
      alert(err.message);
    }
  });

  el('saveObjectiveBtn').addEventListener('click', async () => {
    try {
      await saveObjective();
    } catch (err) {
      alert(err.message);
    }
  });

  el('runCaptureBtn').addEventListener('click', async () => {
    try {
      await runCapture();
    } catch (err) {
      alert(err.message);
    }
  });

  el('saveReplyBtn').addEventListener('click', async () => {
    try {
      await saveReply();
    } catch (err) {
      alert(err.message);
    }
  });

  el('parseReplyBtn').addEventListener('click', async () => {
    try {
      await parseReply();
    } catch (err) {
      alert(err.message);
    }
  });
}

async function init() {
  bindEvents();
  await refreshPapers();
  await refreshContext();

  if (state.pollingTimer) {
    clearInterval(state.pollingTimer);
  }

  state.pollingTimer = setInterval(async () => {
    try {
      await refreshPapers();
      await refreshContext();
    } catch (err) {
      // keep polling loop alive
    }
  }, 2500);
}

init().catch((err) => {
  alert(err.message);
});

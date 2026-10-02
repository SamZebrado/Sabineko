'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PassThrough } = require('node:stream');
const { createRequire } = require('node:module');

// Run the production HTTP callback and parser without a socket, filesystem
// writes, child processes, or provider/browser adapters.
function fixture() {
  const filename = path.join(__dirname, '../scripts/web_console_server.js');
  const localRequire = createRequire(filename);
  const captures = [];
  let handler;
  const forbidden = () => { throw new Error('Unexpected external action in fixture'); };
  const context = vm.createContext({
    URL, Buffer, console,
    process: { env: { PIPELINE_WEB_PORT: '8788' } },
    capture: (paperId, forceLogin) => captures.push({ paperId, forceLogin }),
    require(name) {
      if (name === 'http') {
        return { createServer(callback) { handler = callback; return { listen() {} }; } };
      }
      if (name === 'fs') return new Proxy({}, { get: () => forbidden });
      if (name === 'child_process') return { spawn: forbidden, spawnSync: forbidden };
      if (name === './qvbing_mode') return {};
      return localRequire(name);
    }
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8') + `
    ensurePaperReady = (paperId) => ({ paperId });
    startCapture = (paths, forceLogin) => capture(paths.paperId, forceLogin);
  `, context, { filename });

  function incoming(headers) {
    const req = new PassThrough();
    req.method = 'POST';
    req.url = '/api/papers/paper_default/actions/run-capture';
    req.headers = { host: '127.0.0.1:8788', ...headers };
    return req;
  }
  function finish(req, chunks) {
    for (const chunk of chunks) req.write(chunk);
    req.end();
  }
  return {
    captures,
    async request(headers = {}, chunks = []) {
      const req = incoming(headers);
      let status;
      let text;
      const pending = handler(req, {
        writeHead(code) { status = code; },
        end(payload) { text = payload; }
      });
      finish(req, chunks);
      await pending;
      return { status, body: JSON.parse(text) };
    },
    async parse(headers, chunks) {
      const req = incoming(headers);
      const pending = context.readBody(req);
      finish(req, chunks);
      return pending;
    }
  };
}

test('bodyless local CLI capture uses default parameters', async () => {
  const f = fixture();
  const result = await f.request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, started: true, paperId: 'paper_default' });
  assert.deepEqual(f.captures, [{ paperId: 'paper_default', forceLogin: false }]);
});

test('zero-length bodies permit missing or irrelevant content types', async () => {
  for (const contentType of [undefined, 'text/plain', 'application/json']) {
    const f = fixture();
    const headers = { 'content-length': '0' };
    if (contentType !== undefined) headers['content-type'] = contentType;
    assert.equal((await f.request(headers)).status, 200);
    assert.deepEqual(f.captures, [{ paperId: 'paper_default', forceLogin: false }]);
  }
});

test('valid JSON, empty JSON, whitespace JSON and chunked JSON retain behavior', async () => {
  for (const [headers, chunks, forceLogin] of [
    [{ 'content-type': 'application/json', 'content-length': '2' }, ['{}'], false],
    [{ 'content-type': 'Application/JSON; charset=utf-8', 'content-length': '19' }, ['{"forceLogin":true}'], true],
    [{ 'content-type': 'application/json', 'content-length': '3' }, [' \n '], false],
    [{ 'content-type': 'application/json', 'transfer-encoding': 'chunked' }, [], false],
    [{ 'content-type': 'application/json', 'transfer-encoding': 'chunked' }, ['{"force', 'Login":true}'], true]
  ]) {
    const f = fixture();
    assert.equal((await f.request(headers, chunks)).status, 200);
    assert.deepEqual(f.captures, [{ paperId: 'paper_default', forceLogin }]);
  }
});

test('present bodies require JSON media type before capture', async () => {
  for (const contentType of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'application/jsonp']) {
    for (const framing of [{ 'content-length': '2' }, { 'transfer-encoding': 'chunked' }]) {
      const f = fixture();
      const headers = { ...framing };
      if (contentType !== undefined) headers['content-type'] = contentType;
      const result = await f.request(headers, ['{}']);
      assert.equal(result.status, 415);
      assert.match(result.body.error, /application\/json/);
      assert.equal(f.captures.length, 0);
    }
  }
});

test('parser independently validates every present body, including whitespace', async () => {
  for (const chunks of [['{}'], [' \n ']]) {
    for (const headers of [{}, { 'content-type': 'text/plain' }]) {
      await assert.rejects(fixture().parse(headers, chunks), (err) => err.statusCode === 415);
    }
  }
});

test('malformed JSON and oversized JSON never invoke capture', async () => {
  for (const [chunks, error] of [
    [['{'], 'Invalid JSON body'],
    [['"' + 'x'.repeat(2 * 1024 * 1024) + '"'], 'Request body too large']
  ]) {
    const f = fixture();
    const result = await f.request({ 'content-type': 'application/json', 'transfer-encoding': 'chunked' }, chunks);
    assert.equal(result.status, 500); // Existing error status is preserved.
    assert.equal(result.body.error, error);
    assert.equal(f.captures.length, 0);
  }
});

test('Host and Origin checks still protect bodyless capture', async () => {
  for (const headers of [
    { host: '' }, { host: 'attacker.example:8788' },
    { origin: 'https://attacker.example' }, { origin: 'null' },
    { origin: 'http://localhost:8788' }
  ]) {
    const f = fixture();
    assert.equal((await f.request(headers)).status, 403);
    assert.equal(f.captures.length, 0);
  }
  const f = fixture();
  assert.equal((await f.request({ origin: 'http://127.0.0.1:8788' })).status, 200);
  assert.equal(f.captures.length, 1);
});

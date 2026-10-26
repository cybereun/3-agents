import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

let server;
let base;

before(async () => {
  server = createAppServer({ env: { MOCK: '1' } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, headers = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function ndjson(res) {
  return (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
}

test('GET /api/config 는 모크 여부와 제공자 정보를 돌려준다', async () => {
  const j = await (await fetch(base + '/api/config')).json();
  assert.equal(j.mock, true);
  assert.deepEqual(Object.keys(j.providers).sort(), ['anthropic', 'antigravity', 'gemini', 'openai']);
  assert.equal(j.providers.openai.serverKey, false);
});

test('POST /api/chat 은 delta 스트림 뒤에 done 을 보낸다', async () => {
  const events = await ndjson(await post('/api/chat', { provider: 'anthropic', prompt: '안녕', role: 'answer' }));
  assert.equal(events.at(-1).t, 'done');
  const text = events.filter((e) => e.t === 'delta').map((e) => e.text).join('');
  assert.match(text, /안녕/);
});

test('mock gemini 는 ERR_TEST 에서 error 이벤트를 보낸다', async () => {
  const events = await ndjson(await post('/api/chat', { provider: 'gemini', prompt: 'ERR_TEST' }));
  assert.equal(events.at(-1).t, 'error');
  assert.match(events.at(-1).message, /429/);
});

test('잘못된 입력은 400', async () => {
  assert.equal((await post('/api/chat', { provider: 'nope', prompt: 'x' })).status, 400);
  assert.equal((await post('/api/chat', { provider: 'openai', prompt: '  ' })).status, 400);
});

test('다른 사이트의 Origin 은 403 (키 소모 방지)', async () => {
  const res = await post('/api/chat', { provider: 'openai', prompt: 'x' }, { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
});

test('Host 위조(DNS rebinding)는 403', async () => {
  // fetch 는 Host 헤더를 덮어쓸 수 없으므로 http.request 로 직접 보낸다
  const { request } = await import('node:http');
  const status = await new Promise((resolve, reject) => {
    const req = request(base + '/api/config', { headers: { host: 'evil.example' } }, (r) => (r.resume(), resolve(r.statusCode)));
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('정적 파일 서빙과 경로 탈출 차단', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /3 Agents/);
  assert.equal((await fetch(base + '/icons/icon.svg')).headers.get('content-type'), 'image/svg+xml');
  for (const p of ['/../server.js', '/%2e%2e/server.js', '/..%2fserver.js', '/.env']) {
    const res = await fetch(base + p);
    assert.ok([403, 404].includes(res.status), `${p} → ${res.status}`);
    assert.ok(!(await res.text()).includes('createAppServer'));
  }
});

test('실제 모드에서 키가 없으면 400 을 돌려준다', async () => {
  const real = createAppServer({ env: {} });
  await new Promise((r) => real.listen(0, '127.0.0.1', r));
  try {
    const r2 = await fetch(`http://127.0.0.1:${real.address().port}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', prompt: 'x' }),
    });
    assert.equal(r2.status, 400);
    assert.match((await r2.json()).error, /API 키/);
  } finally {
    real.close();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppServer, APP_VERSION } from '../server.js';
import { createTokenStore, isValidToken } from '../desktop/token-store.js';

const GOOD = 'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz_0123456789';

// 실제 safeStorage 는 Electron 에서만 쓸 수 있으므로, 평문이 파일에 남지 않는지 보려고 가역 변환을 쓰는 가짜를 쓴다
const fakeSafeStorage = (available = true) => ({
  isAsyncEncryptionAvailable: async () => available,
  encryptString: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
  decryptString: (buf) => Buffer.from([...buf].map((b) => b ^ 0x5a)).toString(),
});
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), '3a-token-'));

test('토큰 형식 검사: 토큰 문자만 허용하고 공백/따옴표/짧은 값은 거부', () => {
  assert.ok(isValidToken(GOOD));
  for (const bad of ['', 'short', `${GOOD} `, `"${GOOD}"`, 'a b'.repeat(10), `${GOOD}\n`, null, undefined, 42]) assert.ok(!isValidToken(bad), String(bad));
});

test('토큰 저장소: 암호화되어 저장되고(평문 없음) 다시 읽을 수 있다', async () => {
  const dir = tmp();
  const store = createTokenStore({ dir, safeStorage: fakeSafeStorage() });
  assert.equal(store.has(), false);
  await store.set(GOOD);
  assert.equal(store.has(), true);
  assert.equal(store.get(), GOOD);
  const raw = fs.readFileSync(path.join(dir, 'update-token.bin'));
  assert.ok(!raw.includes(Buffer.from(GOOD)), '파일에 토큰 평문이 있으면 안 된다');
  store.clear();
  assert.equal(store.has(), false);
  assert.equal(store.get(), '');
});

test('토큰 저장소: 암호화를 쓸 수 없으면 평문으로라도 저장하지 않고 거부한다', async () => {
  const dir = tmp();
  const store = createTokenStore({ dir, safeStorage: fakeSafeStorage(false) });
  await assert.rejects(store.set(GOOD), /안전하게 암호화/);
  assert.equal(store.has(), false);
  assert.equal(fs.readdirSync(dir).length, 0);
});

test('토큰 저장소: 잘못된 형식은 저장 전에 거부, 복호화 실패는 빈 문자열', async () => {
  const dir = tmp();
  const store = createTokenStore({ dir, safeStorage: fakeSafeStorage() });
  await assert.rejects(store.set('bad token'), /형식/);
  assert.equal(store.has(), false);
  fs.writeFileSync(path.join(dir, 'update-token.bin'), 'x');
  const broken = createTokenStore({ dir, safeStorage: { ...fakeSafeStorage(), decryptString: () => { throw new Error('fail'); } } });
  assert.equal(broken.get(), '', '다른 PC에서 복사된 파일처럼 복호화할 수 없으면 빈 값');
});

test('서버: /api/config 에 앱 버전이 있고 package.json 과 같다, 정적 응답에 CSP 가 붙는다', async () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(APP_VERSION, pkg.version);
  const server = createAppServer({ env: { MOCK: '1' } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await (await fetch(`${base}/api/config`)).json()).version, pkg.version);
    const csp = (await fetch(`${base}/`)).headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.ok(!/unsafe-eval|script-src[^;]*unsafe-inline/.test(csp), '스크립트에는 unsafe-* 를 허용하지 않는다');
  } finally {
    server.close();
  }
});

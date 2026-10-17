import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

function run(port, stateDir, extra = []) {
  const child = spawn(process.execPath, [SERVER, '--mock', ...extra], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', APP_STATE_DIR: stateDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  return { child, exited, output: () => out };
}

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(50);
  }
  return false;
}

test('실행 중에는 PID/포트 파일을 남기고, 종료하면 지운다', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), '3a-state-'));
  const port = await freePort();
  const a = run(port, dir);
  try {
    assert.ok(await waitFor(() => existsSync(path.join(dir, '.server.port'))), '시작되지 않음: ' + a.output());
    assert.equal(readFileSync(path.join(dir, '.server.pid'), 'utf8'), String(a.child.pid));
    assert.equal(readFileSync(path.join(dir, '.server.port'), 'utf8'), String(port));
    if (process.platform !== 'win32') {
      a.child.kill('SIGTERM');
      await a.exited;
      assert.ok(!existsSync(path.join(dir, '.server.pid')), '종료 시 PID 파일을 지워야 한다');
    }
  } finally {
    a.child.kill();
  }
});

test('이미 이 앱이 떠 있으면 두 번째 실행은 조용히 성공 종료하고 기존 서버를 건드리지 않는다', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), '3a-state-'));
  const port = await freePort();
  const a = run(port, dir);
  try {
    assert.ok(await waitFor(() => existsSync(path.join(dir, '.server.port'))));
    const b = run(port, dir);
    assert.equal(await b.exited, 0);
    assert.match(b.output(), /이미 실행 중/);
    assert.equal(readFileSync(path.join(dir, '.server.pid'), 'utf8'), String(a.child.pid), '기존 PID 파일이 유지되어야 한다');
    const res = await fetch(`http://127.0.0.1:${port}/api/config`);
    assert.equal(res.status, 200, '기존 서버가 계속 살아 있어야 한다');
  } finally {
    a.child.kill();
  }
});

test('포트를 다른 프로그램이 쓰고 있으면 실패(종료 코드 1)하고 PORT 안내를 한다', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), '3a-state-'));
  const other = http.createServer((_, res) => res.end('not 3 agents')).listen(0, '127.0.0.1');
  await new Promise((r) => other.once('listening', r));
  try {
    const b = run(other.address().port, dir);
    assert.equal(await b.exited, 1);
    assert.match(b.output(), /다른 프로그램이 사용 중/);
    assert.ok(!existsSync(path.join(dir, '.server.pid')), '실패한 실행은 상태 파일을 만들지 않는다');
  } finally {
    other.close();
  }
});

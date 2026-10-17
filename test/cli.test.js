import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectCli, streamCli } from '../lib/cli.js';
import { createAppServer } from '../server.js';

const fx = (n) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n);
const ENV = { CLAUDE_CMD: fx('fake-claude.mjs'), CODEX_CMD: fx('fake-codex.mjs'), GEMINI_CMD: fx('fake-gemini.mjs') };
const opts = { skip: process.platform === 'win32' && '가짜 CLI 는 shebang 실행이라 Windows 에서 건너뜀' };

async function collect(gen) {
  const parts = [];
  for await (const t of gen) parts.push(t);
  return parts;
}
const ask = (provider, prompt, extra = {}) => collect(streamCli({ provider, prompt, env: ENV, ...extra }));

test('claude: text_delta 를 조각 단위로 스트리밍한다 (assistant/result 와 중복되지 않음)', opts, async () => {
  const parts = await ask('anthropic', '안녕하세요 테스트');
  assert.ok(parts.length > 2, '여러 조각으로 도착해야 한다');
  assert.equal(parts.join(''), '응답:안녕하세요 테스트');
});

test('claude: 도구 비활성/설정 격리/시스템 프롬프트/모델 옵션이 전달된다', opts, async () => {
  const text = (await ask('anthropic', 'ARGS', { system: 'SYS 지시', model: 'claude-x' })).join('');
  const args = JSON.parse(text.replace(/^ARGS=/, ''));
  const after = (flag) => args[args.indexOf(flag) + 1];
  assert.ok(args.includes('-p'));
  assert.equal(after('--output-format'), 'stream-json');
  assert.equal(after('--tools'), '', "--tools '' 로 모든 도구를 꺼야 한다");
  assert.equal(after('--setting-sources'), '');
  assert.ok(args.includes('--strict-mcp-config') && args.includes('--no-session-persistence'));
  assert.equal(after('--system-prompt'), 'SYS 지시');
  assert.equal(after('--model'), 'claude-x');
});

test('API 키 환경변수는 자식 프로세스에 전달되지 않는다 (구독 로그인 경로 보장)', opts, async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
  try {
    assert.equal((await ask('anthropic', 'ENV')).join(''), 'ENV=unset');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('claude: 미로그인은 친절한 한국어 에러', opts, async () => {
  await assert.rejects(ask('anthropic', 'NOT_LOGGED_IN'), (e) => /로그인이 필요합니다/.test(e.message) && /\/login/.test(e.message));
});

test('codex: 로그 잡음 대신 -o 파일의 최종 답변을 쓰고, 시스템 프롬프트는 본문 앞에 붙는다', opts, async () => {
  const text = (await ask('openai', '질문입니다', { system: '규칙' })).join('');
  assert.equal(text, '최종:[지시]\n규칙\n\n[요청]\n질문입니다');
  assert.ok(!text.includes('OpenAI Codex'));
});

test('codex: 읽기 전용 샌드박스와 사용자 설정 무시 옵션', opts, async () => {
  const args = JSON.parse((await ask('openai', 'ARGS', { model: 'gpt-x' })).join('').replace(/^ARGS=/, ''));
  const after = (f) => args[args.indexOf(f) + 1];
  assert.equal(after('--sandbox'), 'read-only');
  assert.ok(args.includes('--ephemeral') && args.includes('--ignore-user-config') && args.includes('--skip-git-repo-check'));
  assert.equal(after('-m'), 'gpt-x');
  assert.equal(args.at(-1), '-', '프롬프트는 stdin 으로 읽는다');
});

test('codex: 401 은 로그인 안내로 바뀐다', opts, async () => {
  await assert.rejects(ask('openai', 'FAIL'), (e) => /로그인이 필요합니다/.test(e.message) && /codex login/.test(e.message));
});

test('gemini: 시작 배너를 제거하고 본문만 스트리밍한다', opts, async () => {
  const parts = await ask('gemini', '질문');
  assert.equal(parts.join(''), '제미니:질문');
  assert.ok(!parts.join('').includes('Loaded cached'));
});

test('gemini: 인증 안 됨(종료 코드 41)은 로그인 안내', opts, async () => {
  await assert.rejects(ask('gemini', 'FAIL'), (e) => /로그인이 필요합니다/.test(e.message) && /Login with Google/.test(e.message));
});

test('설치되지 않은 명령은 설치/로그인 안내를 돌려준다', async () => {
  await assert.rejects(
    collect(streamCli({ provider: 'anthropic', prompt: 'x', env: { CLAUDE_CMD: '/nonexistent/claude-cmd' } })),
    (e) => /명령을 찾을 수 없습니다/.test(e.message) && /npm i -g @anthropic-ai\/claude-code/.test(e.message),
  );
});

test('중단 신호를 주면 자식 프로세스를 정리하고 즉시 끝난다', opts, async () => {
  const ac = new AbortController();
  const started = Date.now();
  setTimeout(() => ac.abort(), 300);
  await assert.rejects(ask('anthropic', 'HANG', { signal: ac.signal }), /aborted/);
  assert.ok(Date.now() - started < 3000, '3초 안에 끝나야 한다');
});

test('시간 초과는 CLI_TIMEOUT_MS 안내와 함께 실패한다', opts, async () => {
  await assert.rejects(
    collect(streamCli({ provider: 'anthropic', prompt: 'HANG', env: { ...ENV, CLI_TIMEOUT_MS: '400' } })),
    /시간 초과/,
  );
});

test('모델 이름에 셸 메타문자가 있으면 거부한다', async () => {
  await assert.rejects(ask('anthropic', 'x', { model: 'a; rm -rf /' }), /허용되지 않는 문자/);
  await assert.rejects(ask('openai', 'x', { model: '$(whoami)' }), /허용되지 않는 문자/);
});

test('detectCli: 설치/버전 감지, 없는 명령은 installed=false', opts, async () => {
  const ok = await detectCli('anthropic', ENV);
  assert.equal(ok.installed, true);
  assert.match(ok.version, /9\.9\.9/);
  const bad = await detectCli('gemini', { GEMINI_CMD: '/nonexistent/gemini' });
  assert.equal(bad.installed, false);
});

test('서버: auth=cli 로 /api/chat 이 CLI 를 거치고, /api/config 가 CLI 상태를 알려준다', opts, async () => {
  const server = createAppServer({ env: ENV });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cfg = await (await fetch(base + '/api/config')).json();
    assert.equal(cfg.cli.anthropic.installed, true);
    assert.equal(cfg.cli.openai.installed, true);

    // API 키가 없어도 CLI 방식은 통과해야 한다
    const res = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', auth: 'cli', prompt: '서버 경유', system: 'S' }),
    });
    assert.equal(res.status, 200);
    const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(events.at(-1).t, 'done');
    assert.equal(events.filter((e) => e.t === 'delta').map((e) => e.text).join(''), '응답:서버 경유');

    const fail = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', auth: 'cli', prompt: 'FAIL' }),
    });
    const last = (await fail.text()).trim().split('\n').map((l) => JSON.parse(l)).at(-1);
    assert.equal(last.t, 'error');
    assert.match(last.message, /로그인이 필요합니다/);
  } finally {
    server.close();
  }
});

test('winQuote: 안전한 토큰은 그대로, 빈 문자열/공백/따옴표는 안전하게 감싼다 (Windows 셸 실행용)', async () => {
  const { winQuote } = await import('../lib/cli.js');
  assert.equal(winQuote('--output-format'), '--output-format');
  assert.equal(winQuote('C:\\Users\\me\\out.txt'), 'C:\\Users\\me\\out.txt');
  assert.equal(winQuote(''), '""', '빈 인자는 "" 로 유지되어야 --tools "" 가 깨지지 않는다');
  assert.equal(winQuote('C:\\Users\\Foo Bar\\x'), '"C:\\Users\\Foo Bar\\x"');
  assert.equal(winQuote('a"b'), '"a\\"b"');
  assert.equal(winQuote('Answer the request above.'), '"Answer the request above."');
});

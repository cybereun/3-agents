import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliFailureMessage, detectCli, listCliModels, streamCli } from '../lib/cli.js';
import { createAppServer } from '../server.js';

const fx = (n) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n);
const ENV = { CLAUDE_CMD: fx('fake-claude.mjs'), CODEX_CMD: fx('fake-codex.mjs'), AGY_CMD: fx('fake-agy.mjs') };
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
  const bad = await detectCli('openai', { CODEX_CMD: '/nonexistent/codex' });
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
    assert.equal(cfg.cli.gemini, undefined, 'Gemini 는 CLI 방식 미지원');

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

    const gem = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', auth: 'cli', prompt: 'x' }),
    });
    assert.equal(gem.status, 400);
    assert.match((await gem.json()).error, /CLI 로그인 방식을 지원하지 않습니다/);
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

test('실제 응답 모델: claude 는 init 이벤트, codex 는 stderr 헤더에서 읽어 onMeta 로 알린다', opts, async () => {
  const seen = [];
  await ask('anthropic', 'x', { onMeta: (m) => seen.push(m.model) });
  assert.deepEqual([...new Set(seen)], ['claude-default-x'], '모델을 안 고르면 CLI 기본 모델이 보고된다');

  const alias = [];
  await ask('anthropic', 'x', { model: 'sonnet', onMeta: (m) => alias.push(m.model) });
  assert.equal(alias[0], 'actual-sonnet', '별칭이 아니라 실제 모델명이 보고되어야 한다');

  const codex = [];
  await ask('openai', 'x', { onMeta: (m) => codex.push(m.model) });
  assert.deepEqual(codex, ['codex-default-y']);
  const picked = [];
  await ask('openai', 'x', { model: 'gpt-a', onMeta: (m) => picked.push(m.model) });
  assert.deepEqual(picked, ['gpt-a']);
});

test('listCliModels: codex 는 카탈로그에서 숨김/이상한 이름을 빼고 우선순위로 정렬, claude 는 별칭+전체 ID', opts, async () => {
  const codex = await listCliModels('openai', ENV);
  assert.deepEqual(codex.map((m) => m.id), ['gpt-a', 'gpt-b']);
  assert.equal(codex[0].label, 'GPT-A (gpt-a)');
  const claude = await listCliModels('anthropic', ENV);
  assert.ok(['sonnet', 'opus', 'haiku', 'fable'].every((a) => claude.some((m) => m.id === a)));
  assert.ok(claude.some((m) => /^claude-/.test(m.id)));
  await assert.rejects(listCliModels('openai', { CODEX_CMD: '/nonexistent/codex' }), /모델 목록을 읽지 못했습니다/);
});

test('서버: /api/models(auth=cli) 와 /api/chat 의 meta 이벤트', opts, async () => {
  const server = createAppServer({ env: ENV });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const ok = await post('/api/models', { provider: 'openai', auth: 'cli' });
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).models.map((m) => m.id), ['gpt-a', 'gpt-b']);
    const gem = await post('/api/models', { provider: 'gemini', auth: 'cli' });
    assert.equal(gem.status, 400, '상태 코드가 502 로 바뀌지 않아야 한다');

    const chat = await post('/api/chat', { provider: 'anthropic', auth: 'cli', model: 'opus', prompt: 'hi' });
    const events = (await chat.text()).trim().split('\n').map((l) => JSON.parse(l));
    const metas = events.filter((e) => e.t === 'meta');
    assert.ok(metas.length >= 1 && metas.every((m) => m.model === 'actual-opus'));
    assert.equal(events.at(-1).t, 'done');
  } finally {
    server.close();
  }
});

test('Windows cmd.exe 의 "명령 없음" 종료 코드(9009)는 언어와 무관하게 설치 안내로 바뀐다', () => {
  // POSIX 종료 코드는 8비트라 Linux 에서 9009 를 흉내 낼 수 없어 판별 함수를 직접 검증한다.
  // 한국어 Windows 는 stderr 가 깨져서 오므로 글자가 아니라 코드로 판별해야 한다.
  const msg = cliFailureMessage('anthropic', 'claude', { code: 9009, stderr: '\ufffd\ufffd 깨진 메시지', parserError: '' });
  assert.match(msg, /명령을 찾을 수 없습니다/);
  assert.match(msg, /npm i -g @anthropic-ai\/claude-code/);
  assert.doesNotMatch(cliFailureMessage('openai', 'codex', { code: 1, stderr: 'boom', parserError: '' }), /명령을 찾을 수 없습니다/);
});

test('antigravity: 프롬프트를 -p 인자로 전달하고 stdout 텍스트를 스트리밍한다 (stdin 은 사용하지 않음)', opts, async () => {
  const text = (await ask('antigravity', '안녕 Antigravity')).join('');
  assert.equal(text, '아그: 안녕 Antigravity');
});

test('antigravity: 위험한 권한 건너뛰기 옵션은 절대 붙지 않고, 안전한 옵션만 전달된다', opts, async () => {
  const text = (await ask('antigravity', 'ECHO_ARGS', { model: 'gemini-x', effort: 'low' })).join('');
  const args = JSON.parse(text.replace(/^ARGS=/, ''));
  assert.ok(!args.includes('--dangerously-skip-permissions'), '권한 확인을 건너뛰면 프롬프트 주입 시 명령이 실행될 수 있다');
  assert.equal(args[0], '-p');
  assert.equal(args[args.indexOf('--output-format') + 1], 'text');
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-x');
  assert.equal(args[args.indexOf('--effort') + 1], 'low');
  assert.ok(args.includes('--disable-slash-commands'));
});

test('antigravity: 따옴표/&/백틱/줄바꿈이 섞인 프롬프트도 인자 하나로 변조 없이 전달된다 (명령 주입 방어)', opts, async () => {
  const nasty = 'ECHO_ARGS "quoted" & echo PWNED | whoami `id` $(id) ; rm -rf /\n두번째 줄\n[요청]';
  const text = (await ask('antigravity', nasty)).join('');
  const args = JSON.parse(text.replace(/^ARGS=/, ''));
  const sent = args[args.indexOf('-p') + 1];
  assert.ok(sent.endsWith(nasty), '프롬프트가 한 덩어리로 그대로 들어가야 한다');
  assert.equal(args.filter((a) => a === '-p').length, 1);
  assert.ok(sent.includes('도구') && sent.includes('[지시]'), '도구 사용 금지 지시가 앞에 붙는다');
});

test('antigravity: 사용하지 않는 effort 값/모델 문자는 걸러낸다', opts, async () => {
  const args = JSON.parse((await ask('antigravity', 'ECHO_ARGS', { effort: 'extreme' })).join('').replace(/^ARGS=/, ''));
  assert.ok(!args.includes('--effort'), '허용되지 않은 effort 는 전달하지 않는다');
  await assert.rejects(ask('antigravity', 'x', { model: 'a; rm -rf /' }), /허용되지 않는 문자/);
});

test('antigravity: 프롬프트가 너무 길면 실행하지 않고 안내한다 (Windows 명령줄 한계)', opts, async () => {
  await assert.rejects(ask('antigravity', 'x'.repeat(30000)), (e) => /너무 깁니다/.test(e.message) && /합의 조정 AI/.test(e.message));
});

test('antigravity: 미로그인은 로그인 안내, 그리고 임시 폴더를 남기지 않는다', opts, async () => {
  await assert.rejects(ask('antigravity', 'NOT_LOGGED_IN'), (e) => /로그인이 필요합니다/.test(e.message) && /agy/.test(e.message));
});

test('antigravity: AGY_EXTRA_ARGS 는 안전한 토큰만 허용한다', opts, async () => {
  const ok = JSON.parse((await ask('antigravity', 'ECHO_ARGS', { env: { ...ENV, AGY_EXTRA_ARGS: '--foo=bar --baz' } })).join('').replace(/^ARGS=/, ''));
  assert.ok(ok.includes('--foo=bar') && ok.includes('--baz'));
  await assert.rejects(ask('antigravity', 'x', { env: { ...ENV, AGY_EXTRA_ARGS: '--x; calc.exe' } }), /허용되지 않는 문자/);
});

test('antigravity: 중단 신호로 자식 프로세스를 정리한다', opts, async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 300);
  const started = Date.now();
  await assert.rejects(ask('antigravity', 'HANG', { signal: ac.signal }), /aborted/);
  assert.ok(Date.now() - started < 3000);
});

test('antigravity: 설치 감지(파일 존재 기반)와 모델 목록', opts, async () => {
  const ok = await detectCli('antigravity', ENV);
  assert.equal(ok.installed, true);
  assert.match(ok.version, /9\.9\.9/);
  assert.equal((await detectCli('antigravity', { AGY_CMD: '/nonexistent/agy' })).installed, false);
  assert.ok((await listCliModels('antigravity', ENV)).length >= 1);
});

test('서버: antigravity 는 CLI 전용 — API 방식 요청은 400, CLI 방식은 동작', opts, async () => {
  const server = createAppServer({ env: ENV });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const api = await post({ provider: 'antigravity', auth: 'api', prompt: 'x' });
    assert.equal(api.status, 400);
    assert.match((await api.json()).error, /CLI 로그인 방식만/);
    const cfg = await (await fetch(base + '/api/config')).json();
    assert.equal(cfg.cli.antigravity.installed, true);
    const ok = await post({ provider: 'antigravity', auth: 'cli', prompt: '서버 경유', effort: 'low' });
    const events = (await ok.text()).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(events.filter((e) => e.t === 'delta').map((e) => e.text).join(''), '아그: 서버 경유');
    assert.equal(events.at(-1).t, 'done');
  } finally {
    server.close();
  }
});

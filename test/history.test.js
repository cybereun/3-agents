import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppServer } from '../server.js';
import { HistoryError, HistoryStore, demoteHeadings, normalizeEntry, parseData, parseHead, renderNote, sanitizeTitle, validateDir } from '../lib/history.js';

const tmp = (p = 'h') => fs.mkdtempSync(path.join(os.tmpdir(), `3a-${p}-`));

const NASTY = '## 제목\n--> 주석 닫기 시도 <!-- 열기\n---\n"따옴표" & <b>태그</b>\n```md\n# 코드 안 제목\n```\n이모지 🚀';
const sample = (over = {}) => ({
  question: '아파트 입지 분석 방법은?\n두 번째 줄',
  mode: 'fast',
  createdAt: '2026-10-27T04:05:06Z',
  agents: [
    { id: 'openai', name: 'ChatGPT', letter: 'A', model: 'gpt-x', text: NASTY },
    { id: 'gemini', name: 'Gemini', letter: 'B', model: 'gem-y', text: '# 큰 제목\n본문', revised: '수정 입장' },
    { id: 'anthropic', name: 'Claude', letter: 'C', model: '', text: '', error: '쿼터 초과' },
  ],
  consensus: {
    by: { id: 'anthropic', name: 'Claude', model: 'claude-z' },
    markdown: '## 최종 답변\n결론입니다.\n\n## 신뢰도\n**보통**',
    summary: {
      source: 'model',
      headline: '결론 한 줄',
      points: [{ title: '핵심', detail: '설명' }],
      agree: ['일치 항목'],
      conflict: [{ issue: '쟁점', views: 'A는 …' }],
      single: [],
      confidence: { level: '보통', reason: '근거 부족' },
      actions: ['직접 확인하기'],
    },
  },
  ...over,
});

test('sanitizeTitle: Windows 금지 문자/옵시디언 링크 문자를 제거하고 길이를 제한한다', () => {
  assert.equal(sanitizeTitle('a/b\\c:d*e?f"g<h>i|j#k^l[m]n'), 'a b c d e f g h i j k l m n');
  assert.equal(sanitizeTitle('끝에 점...  '), '끝에 점');
  assert.equal(sanitizeTitle('   \n  '), '질문');
  assert.equal(Array.from(sanitizeTitle('가'.repeat(200))).length, 60);
  assert.equal(sanitizeTitle('\n\n첫 줄만\n둘째'), '첫 줄만');
});

test('demoteHeadings: 코드 블록 안은 건드리지 않고 최대 6단계로 제한한다', () => {
  const out = demoteHeadings('# A\n```\n# 코드\n```\n###### F\ntext', 2);
  assert.equal(out, '### A\n```\n# 코드\n```\n###### F\ntext');
});

test('노트 왕복: 모델 출력에 -->, <!--, ---, 따옴표, 제목이 섞여도 데이터가 그대로 복원된다', () => {
  const entry = normalizeEntry(sample());
  const note = renderNote(entry, '20261027-130506-abc123');
  assert.ok(note.startsWith('---\nsource: 3-agents\nid: 20261027-130506-abc123\n'));
  const head = parseHead(note);
  assert.equal(head.id, '20261027-130506-abc123');
  assert.equal(head.question, '아파트 입지 분석 방법은?');
  assert.equal(head.conclusion, '결론 한 줄');
  assert.equal(head.confidence, '보통');
  assert.deepEqual(head.models, ['ChatGPT: gpt-x', 'Gemini: gem-y', 'Claude: ']  .filter((m) => !m.endsWith(': ')));
  assert.deepEqual(head.tags, ['3-agents']);
  const data = parseData(note);
  assert.equal(data.agents[0].text, NASTY, '원문이 한 글자도 바뀌지 않아야 한다');
  assert.equal(data.consensus.summary.headline, '결론 한 줄');
  // 본문 노트 표시용 텍스트는 우리 데이터 주석을 가리지 못하게 처리된다
  const visible = note.slice(0, note.indexOf('<!-- 3agents:data'));
  assert.ok(!visible.includes('<!--'), '모델이 쓴 <!-- 는 무력화되어야 한다');
  assert.ok(note.trimEnd().endsWith('-->') && (note.match(/-->/g) ?? []).length >= 1);
  assert.ok(!/<!-- 3agents:data [^\n]*-->[^\n]*-->/.test(note), '데이터 안에 --> 가 들어가면 안 된다');
});

test('노트 본문: 합의/한눈에 보기/개별 답변 섹션과 옵시디언 체크박스, 제목 수준 조정', () => {
  const note = renderNote(normalizeEntry(sample()), '20261027-130506-abc123');
  for (const h of ['## 합의 답변', '## 한눈에 보기', '## 개별 답변', '### A · ChatGPT', '#### 토론 후 수정 입장', '- [ ] 직접 확인하기']) assert.ok(note.includes(h), h);
  assert.ok(note.includes('### 최종 답변'), '합의 본문의 ## 은 ### 로 내려간다');
  assert.ok(note.includes('#### 큰 제목'), '개별 답변 안의 # 은 #### 로 내려간다');
  assert.ok(note.includes('[!failure] 오류: 쿼터 초과'));
});

test('parseHead: 표식이 없거나 id 가 이상하면 거부하고, 옵시디언이 바꾼 따옴표/줄바꿈도 읽는다', () => {
  assert.equal(parseHead('# 그냥 노트'), null);
  assert.equal(parseHead('---\ntitle: x\n---\n본문'), null);
  assert.equal(parseHead('---\nsource: 3-agents\nid: ../../etc\n---\n'), null, '경로처럼 보이는 id 는 거부');
  assert.equal(parseHead('---\nsource: 3-agents\n---\n'), null, 'id 없음');
  const obsidian = "---\r\nsource: 3-agents\r\nid: 20261027-130506-abc123\r\nquestion: 'it''s ok'\r\ntags:\r\n  - 3-agents\r\n  - mine\r\n---\r\n본문";
  const m = parseHead(obsidian);
  assert.equal(m.question, "it's ok");
  assert.deepEqual(m.tags, ['3-agents', 'mine']);
  assert.equal(parseHead('본문 중간에 source: 3-agents\nid: 20261027-130506-abc123'), null, 'frontmatter 밖의 표식은 무시');
});

test('normalizeEntry: 잘못된 입력을 거부하고 길이/종류를 제한한다', () => {
  assert.throws(() => normalizeEntry(null), HistoryError);
  assert.throws(() => normalizeEntry({ question: '  ', agents: [] }), /비어/);
  assert.throws(() => normalizeEntry({ question: 'q', agents: [{ id: 'evil', text: 'x' }] }), /답변이 없습니다/);
  const e = normalizeEntry({ question: 'q', agents: [{ id: 'openai', name: 'x'.repeat(500), text: 'a'.repeat(300_000) }], mode: 'weird', consensus: { markdown: 'm', summary: { headline: 5 } } });
  assert.equal(e.agents[0].name.length, 40);
  assert.equal(e.agents[0].text.length, 200_000);
  assert.equal(e.mode, 'fast');
  assert.equal(e.consensus.summary, null, '검증을 통과하지 못한 요약은 버린다');
  assert.equal(e.status, 'complete');
  assert.equal(normalizeEntry({ question: 'q', agents: [{ id: 'openai', text: 't' }] }).status, 'partial');
});

test('validateDir: 상대경로/루트/시스템 폴더/파일 경로를 거부하고, 없는 폴더는 만들어 준다', async () => {
  assert.equal((await validateDir('relative/path')).ok, false);
  assert.equal((await validateDir('')).ok, false);
  assert.equal((await validateDir(path.parse(os.tmpdir()).root)).ok, false);
  if (process.platform !== 'win32') assert.equal((await validateDir('/etc/3agents')).ok, false);
  const base = tmp('dir');
  const made = await validateDir(path.join(base, 'a', 'b'));
  assert.equal(made.ok, true);
  assert.ok(fs.statSync(made.dir).isDirectory());
  assert.equal((await validateDir(`"${made.dir}"`)).ok, true, '탐색기에서 복사한 따옴표 경로 허용');
  const file = path.join(base, 'f.txt');
  fs.writeFileSync(file, 'x');
  assert.equal((await validateDir(file)).ok, false);
  assert.deepEqual(fs.readdirSync(made.dir), [], '쓰기 테스트 파일을 남기지 않는다');
});

test('저장소: 저장 → 목록 → 읽기 → 삭제, 파일명 규칙과 이름 충돌 처리', async () => {
  const data = tmp('data');
  const dir = tmp('vault');
  const store = new HistoryStore({ dataDir: data });
  await store.setConfig({ dir });
  const a = await store.save(sample());
  const b = await store.save(sample()); // 같은 분, 같은 제목
  assert.notEqual(a.file, b.file, '이름이 겹치면 (2) 를 붙인다');
  assert.match(path.basename(a.file), /^\d{4}-\d{2}-\d{2} \d{4} 아파트 입지 분석 방법은\.md$/);
  assert.match(path.basename(b.file), /\(2\)\.md$/);
  const list = await store.list();
  assert.equal(list.length, 2);
  const got = await store.get(a.id);
  assert.equal(got.entry.agents[0].text, NASTY);
  assert.equal(got.entry.consensus.summary.headline, '결론 한 줄');
  await store.remove(a.id);
  assert.equal(fs.existsSync(a.file), false);
  assert.equal((await store.list()).length, 1);
});

test('저장소: 볼트의 다른 노트는 목록/읽기/삭제/전체삭제 어디에서도 건드리지 않는다', async () => {
  const dir = tmp('vault');
  const store = new HistoryStore({ dataDir: tmp('data') });
  await store.setConfig({ dir });
  const mine = path.join(dir, '내 노트.md');
  const fake = path.join(dir, '가짜.md');
  fs.writeFileSync(mine, '# 내 소중한 노트\n본문');
  fs.writeFileSync(fake, '본문 중간에\nsource: 3-agents\nid: 20261027-130506-abc123\n');
  fs.writeFileSync(path.join(dir, 'photo.png'), 'x');
  const saved = await store.save(sample());
  assert.deepEqual((await store.list()).map((m) => m.id), [saved.id]);
  await assert.rejects(store.get('20261027-130506-abc123'), /찾을 수 없습니다/);
  await assert.rejects(store.remove('20261027-130506-abc123'), HistoryError);
  assert.deepEqual(await store.clear(), { deleted: 1 });
  assert.equal(fs.readFileSync(mine, 'utf8'), '# 내 소중한 노트\n본문');
  assert.ok(fs.existsSync(fake) && fs.existsSync(path.join(dir, 'photo.png')));
});

test('저장소: 경로 조작 id 와 삭제 직전 표식 변조를 막는다', async () => {
  const dir = tmp('vault');
  const store = new HistoryStore({ dataDir: tmp('data') });
  await store.setConfig({ dir });
  for (const bad of ['../../etc/passwd', '..\\..\\x', 'a/b', '', 'x'.repeat(100)]) await assert.rejects(store.get(bad), HistoryError, bad);
  const saved = await store.save(sample());
  // 스캔 뒤 사용자가 표식을 지워 일반 노트로 바꿨다면 삭제하지 않는다
  await store.list();
  fs.writeFileSync(saved.file, '# 이제 내가 쓰는 노트');
  await assert.rejects(store.remove(saved.id), HistoryError);
  assert.ok(fs.existsSync(saved.file));
});

test('저장소: 검색은 질문과 본문 모두에서 하고, id 로 덮어쓰면 같은 파일을 갱신한다', async () => {
  const store = new HistoryStore({ dataDir: tmp('data') });
  await store.setConfig({ dir: tmp('vault') });
  const first = await store.save(sample());
  await store.save(sample({ question: '전혀 다른 주제', agents: [{ id: 'openai', name: 'ChatGPT', letter: 'A', text: '본문에만 있는 희귀단어쿼카' }], consensus: null }));
  assert.equal((await store.list({ q: '입지' })).length, 1);
  assert.equal((await store.list({ q: '쿼카' })).length, 1, '본문 검색');
  assert.equal((await store.list({ q: '입지 쿼카' })).length, 0, '여러 단어는 모두 있어야 한다');
  assert.equal((await store.list({ q: '없는단어' })).length, 0);
  const updated = await store.save(sample({ question: '아파트 입지 분석 방법은?\n두 번째 줄', agents: [{ id: 'openai', name: 'ChatGPT', text: '갱신된 답' }] }), first.id);
  assert.equal(updated.file, first.file, '같은 파일에 덮어쓴다');
  assert.equal((await store.get(first.id)).entry.agents[0].text, '갱신된 답');
});

test('저장소: 저장 끄기, 설정 보존, 폴더 변경', async () => {
  const data = tmp('data');
  const dirA = tmp('vaultA');
  const dirB = tmp('vaultB');
  const s1 = new HistoryStore({ dataDir: data });
  await s1.setConfig({ dir: dirA, enabled: false });
  assert.deepEqual(await s1.save(sample()), { skipped: true });
  assert.equal(fs.readdirSync(dirA).length, 0);
  const s2 = new HistoryStore({ dataDir: data }); // 재시작 후에도 설정 유지
  assert.deepEqual(await s2.config(), { dir: dirA, enabled: false });
  await s2.setConfig({ enabled: true, dir: dirB });
  const r = await s2.save(sample());
  assert.ok(r.file.startsWith(dirB));
  await assert.rejects(s2.setConfig({ dir: 'relative' }), HistoryError);
});

/* ---------- HTTP API ---------- */

async function withServer(fn, env = {}) {
  const dataDir = tmp('api');
  const server = createAppServer({ env: { MOCK: '1', APP_DATA_DIR: dataDir, ...env } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, p, body, headers = {}) =>
    fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    await fn({ call, dataDir });
  } finally {
    server.close();
  }
}

test('API: 설정 → 저장 → 목록 → 열기 → 삭제 전체 흐름', async () => {
  await withServer(async ({ call, dataDir }) => {
    const vault = tmp('vault');
    const cfg0 = await (await call('GET', '/api/history/config')).json();
    assert.equal(cfg0.dir, path.join(dataDir, 'history'));
    assert.equal(cfg0.enabled, true);

    const cfg = await (await call('POST', '/api/history/config', { dir: vault })).json();
    assert.equal(cfg.dir, vault);

    const saved = await (await call('POST', '/api/history', { entry: sample() })).json();
    assert.ok(saved.id && saved.file.startsWith(vault));
    const list = await (await call('GET', '/api/history?q=%EC%95%84%ED%8C%8C%ED%8A%B8')).json();
    assert.equal(list.entries.length, 1);
    assert.equal(list.entries[0].question, '아파트 입지 분석 방법은?');
    assert.equal(list.entries[0].file, saved.file);
    const open = await (await call('GET', `/api/history/${saved.id}`)).json();
    assert.equal(open.entry.question.startsWith('아파트'), true);
    assert.equal((await (await call('GET', '/api/history/config')).json()).count, 1);

    assert.equal((await call('DELETE', `/api/history/${saved.id}`)).status, 200);
    assert.equal((await (await call('GET', '/api/history')).json()).entries.length, 0);
    assert.equal(fs.readdirSync(vault).length, 0);
  });
});

test('API: 잘못된 입력은 400, 확인 없는 전체 삭제는 거부, 저장 끄면 skipped', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('POST', '/api/history/config', { dir: 'relative' })).status, 400);
    assert.equal((await call('POST', '/api/history', { entry: { question: '' } })).status, 400);
    assert.equal((await call('GET', '/api/history/..%2F..%2Fetc')).status, 400);
    assert.equal((await call('GET', '/api/history/%E0%A4%A')).status, 400, '잘못된 퍼센트 인코딩');
    assert.equal((await call('POST', '/api/history/clear', {})).status, 400);
    await call('POST', '/api/history/config', { dir: tmp('vault'), enabled: false });
    const r = await (await call('POST', '/api/history', { entry: sample() })).json();
    assert.deepEqual(r, { skipped: true });
    assert.equal((await call('PUT', '/api/history')).status, 405);
  });
});

test('API: 다른 사이트(Origin)에서 오는 저장/삭제/설정 변경은 403 (CSRF 방어)', async () => {
  await withServer(async ({ call }) => {
    const evil = { origin: 'https://evil.example' };
    assert.equal((await call('POST', '/api/history/config', { dir: tmp('x') }, evil)).status, 403);
    assert.equal((await call('POST', '/api/history', { entry: sample() }, evil)).status, 403);
    assert.equal((await call('DELETE', '/api/history/20261027-130506-abc123', undefined, evil)).status, 403);
    assert.equal((await call('POST', '/api/history/clear', { confirm: true }, evil)).status, 403);
    assert.equal((await call('GET', '/api/history', undefined, evil)).status, 403);
  });
});

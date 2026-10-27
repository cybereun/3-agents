import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSummary } from '../public/summary.js';

/**
 * 질문/답변 기록 저장소. 질문 하나당 마크다운 노트 하나를 사용자가 고른 폴더(예: 옵시디언 볼트)에 저장한다.
 *
 * 보안 원칙
 * - 이 모듈은 frontmatter 에 `source: 3-agents` 표식이 있는 파일만 목록/읽기/삭제 대상으로 삼는다.
 *   볼트에 있는 다른 노트는 읽지도, 지우지도 못한다.
 * - 클라이언트가 보내는 것은 id 뿐이고, 파일 경로는 항상 스캔 결과에서 찾는다 (경로 조작 불가).
 * - 자동 삭제는 하지 않는다. 사용자의 노트를 앱이 임의로 정리하면 안 된다.
 */

export const SOURCE = '3-agents';
export class HistoryError extends Error {}

const MAX_TEXT = 200_000;
const HEAD_BYTES = 16 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_SCAN = 5000;
const DATA_RE = /<!-- 3agents:data (\{[\s\S]*\}) -->\s*$/;
const ID_RE = /^[\w-]{8,64}$/;
const AGENT_IDS = ['openai', 'gemini', 'anthropic', 'antigravity'];
const MODE_LABEL = { fast: '빠른 합의', debate: '토론 합의' };

/* ---------- 작은 유틸 ---------- */

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 로컬 시간대(오프셋 포함) ISO 문자열. 옵시디언 date 속성으로 인식된다 */
export function toLocalIso(d) {
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

const makeId = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${randomBytes(3).toString('hex')}`;

const j = (v) => JSON.stringify(v); // YAML 의 큰따옴표 문자열과 호환된다
const safeText = (s) => String(s ?? '').replaceAll('<!--', '&lt;!--'); // 모델 출력이 우리 데이터 주석을 가리지 못하게

/** 파일 이름으로 쓸 수 있는 짧은 제목 (Windows 금지 문자, 옵시디언 링크 문자 제거) */
export function sanitizeTitle(text, max = 60) {
  let t = String(text ?? '').split(/\r?\n/).find((l) => l.trim()) ?? '';
  t = t
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  t = Array.from(t).slice(0, max).join('').replace(/[. ]+$/, '').trim();
  return t || '질문';
}

/** 코드 블록 밖의 마크다운 제목 수준을 낮춘다 (노트의 목차가 모델 답변 제목으로 어지러워지지 않게) */
export function demoteHeadings(md, by) {
  let fence = null;
  return String(md)
    .split('\n')
    .map((line) => {
      const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (f) {
        if (!fence) fence = f[1][0];
        else if (f[1][0] === fence) fence = null;
        return line;
      }
      if (fence) return line;
      const m = /^(#{1,6})(\s+.*)$/.exec(line);
      return m ? '#'.repeat(Math.min(6, m[1].length + by)) + m[2] : line;
    })
    .join('\n');
}

/* ---------- 기록 데이터 검증 ---------- */

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** 클라이언트가 보낸(또는 노트에서 읽은) 기록을 검증하고 정규화한다 */
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') throw new HistoryError('잘못된 기록입니다.');
  const question = str(raw.question, 20_000).trim();
  if (!question) throw new HistoryError('질문이 비어 있습니다.');
  const agents = (Array.isArray(raw.agents) ? raw.agents : [])
    .slice(0, 4)
    .map((a) => ({
      id: AGENT_IDS.includes(a?.id) ? a.id : null,
      name: str(a?.name, 40),
      letter: /^[A-D]$/.test(a?.letter) ? a.letter : '',
      model: str(a?.model, 80),
      text: str(a?.text, MAX_TEXT),
      revised: str(a?.revised, MAX_TEXT),
      error: str(a?.error, 2000),
    }))
    .filter((a) => a.id && (a.text || a.error));
  if (!agents.length) throw new HistoryError('저장할 답변이 없습니다.');

  let consensus = null;
  const c = raw.consensus;
  if (c && typeof c === 'object' && str(c.markdown, MAX_TEXT).trim()) {
    let summary = null;
    if (c.summary && typeof c.summary === 'object') {
      summary = parseSummary(JSON.stringify(c.summary)); // 요약은 화면과 같은 검증기를 거친다
      if (summary) summary.source = c.summary.source === 'markdown' ? 'markdown' : 'model';
    }
    consensus = {
      by: { id: AGENT_IDS.includes(c.by?.id) ? c.by.id : null, name: str(c.by?.name, 40), model: str(c.by?.model, 80) },
      markdown: str(c.markdown, MAX_TEXT),
      summary,
    };
  }
  const when = new Date(raw.createdAt);
  return {
    v: 1,
    createdAt: toLocalIso(Number.isNaN(when.getTime()) ? new Date() : when),
    question,
    mode: raw.mode === 'debate' ? 'debate' : 'fast',
    status: consensus ? 'complete' : 'partial',
    agents,
    consensus,
  };
}

/* ---------- 노트 만들기 / 읽기 ---------- */

function summarySection(s) {
  const out = [];
  if (s.headline) out.push(`**결론:** ${s.headline}`, '');
  if (s.confidence?.level) out.push(`**신뢰도:** ${s.confidence.level}${s.confidence.reason ? ` — ${s.confidence.reason}` : ''}`, '');
  if (s.points?.length) {
    out.push('### 핵심 포인트', ...s.points.map((p, i) => `${i + 1}. ${p.title ? `**${p.title}**` : ''}${p.title && p.detail ? ' — ' : ''}${p.detail ?? ''}`), '');
  }
  if (s.agree?.length) out.push('### 일치한 내용', ...s.agree.map((t) => `- ${t}`), '');
  if (s.conflict?.length) out.push('### 충돌한 내용', ...s.conflict.map((c) => `- ${c.issue ? `**${c.issue}**` : ''}${c.issue && c.views ? ' — ' : ''}${c.views ?? ''}`), '');
  if (s.single?.length) out.push('### 단일 출처', ...s.single.map((t) => `- ${t}`), '');
  if (s.actions?.length) out.push('### 직접 확인할 일', ...s.actions.map((t) => `- [ ] ${t}`), '');
  return out;
}

/** 기록 → 옵시디언 노트(마크다운). 끝에 복원용 데이터 주석을 붙인다 */
export function renderNote(entry, id) {
  const e = entry;
  const firstLine = e.question.split(/\r?\n/).find((l) => l.trim())?.trim() ?? '';
  const comboLabel = e.agents.map((a) => a.name).join(' + ');
  const s = e.consensus?.summary;
  const fm = [
    '---',
    `source: ${SOURCE}`,
    `id: ${id}`,
    `date: ${e.createdAt}`,
    `question: ${j(firstLine.slice(0, 200))}`,
    `mode: ${j(MODE_LABEL[e.mode])}`,
    `combo: ${j(comboLabel)}`,
    `status: ${e.status}`,
  ];
  if (s?.confidence?.level) fm.push(`confidence: ${j(s.confidence.level)}`);
  if (s?.headline) fm.push(`conclusion: ${j(s.headline)}`);
  const models = e.agents.filter((a) => a.model).map((a) => `${a.name}: ${a.model}`);
  if (models.length) fm.push('models:', ...models.map((m) => `  - ${j(m)}`));
  fm.push('tags:', '  - 3-agents', '---', '');

  const body = [`# ${firstLine.replace(/^#+\s*/, '').slice(0, 120)}`, '', ...e.question.split(/\r?\n/).map((l) => `> ${safeText(l)}`), ''];
  if (e.status === 'partial') body.push('> [!warning] 미완료 기록', '> 합의까지 끝나지 못하고 중지되거나 실패한 질문입니다.', '');

  if (e.consensus) {
    const by = e.consensus.by;
    body.push('## 합의 답변', '', `*${by.name}${by.model ? `(${by.model})` : ''}가 ${e.agents.length}개 답변을 종합 · ${MODE_LABEL[e.mode]}*`, '', safeText(demoteHeadings(e.consensus.markdown, 1)), '');
    if (s) body.push('## 한눈에 보기', '', ...summarySection(s).map(safeText));
  }
  body.push('## 개별 답변', '');
  for (const a of e.agents) {
    body.push(`### ${a.letter ? `${a.letter} · ` : ''}${a.name}${a.model ? ` — \`${a.model}\`` : ''}`, '');
    if (a.text) body.push(safeText(demoteHeadings(a.text, 3)), '');
    if (a.revised) body.push('#### 토론 후 수정 입장', '', safeText(demoteHeadings(a.revised, 4)), '');
    if (a.error) body.push(`> [!failure] 오류: ${safeText(a.error).replace(/\n/g, ' ')}`, '');
  }
  // `<`/`>` 를 이스케이프해서 데이터가 HTML 주석(-->)을 닫지 못하게 한다. JSON 으로는 동일하게 복원된다.
  const data = JSON.stringify({ ...e, id }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `${fm.join('\n')}\n${body.join('\n')}\n<!-- 3agents:data ${data} -->\n`;
}

const unwrap = (v) => {
  const t = v.trim();
  if (t.startsWith('"')) {
    try {
      return JSON.parse(t);
    } catch {
      /* 옵시디언이 따옴표를 바꿔 쓴 경우 */
    }
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1).replace(/''/g, "'");
  return t;
};

/** 노트 앞부분의 frontmatter 를 읽는다. 우리 표식(source: 3-agents)이 없으면 null */
export function parseHead(text) {
  const t = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!t.startsWith('---\n')) return null;
  const end = t.indexOf('\n---', 4);
  if (end < 0) return null;
  const meta = {};
  let listKey = null;
  for (const line of t.slice(4, end).split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      meta[listKey].push(unwrap(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) {
      listKey = null;
      continue;
    }
    if (kv[2] === '') {
      listKey = kv[1];
      meta[listKey] = [];
    } else {
      listKey = null;
      meta[kv[1]] = unwrap(kv[2]);
    }
  }
  return meta.source === SOURCE && ID_RE.test(String(meta.id ?? '')) ? meta : null;
}

/** 노트 끝의 복원용 데이터를 읽는다. 없거나 깨졌으면 null */
export function parseData(text) {
  const m = DATA_RE.exec(String(text).replace(/\r\n/g, '\n'));
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/* ---------- 폴더 검증 ---------- */

const POSIX_BLOCKED = ['/etc', '/usr', '/bin', '/sbin', '/boot', '/sys', '/proc', '/dev', '/lib', '/var/lib'];

/** 저장 폴더로 쓸 수 있는지 검사하고(없으면 만들고, 쓰기 테스트까지) 정규화된 경로를 돌려준다 */
export async function validateDir(dir) {
  if (typeof dir !== 'string' || !dir.trim() || dir.length > 500 || dir.includes('\0')) return { ok: false, error: '폴더 경로가 올바르지 않습니다.' };
  const trimmed = dir.trim().replace(/^"(.*)"$/, '$1'); // 탐색기에서 복사한 "경로" 형태 허용
  if (!path.isAbsolute(trimmed)) return { ok: false, error: '전체 경로(예: D:\\Vault\\3-Agents)를 입력하세요.' };
  const resolved = path.resolve(trimmed);
  if (path.parse(resolved).root === resolved) return { ok: false, error: '드라이브 루트에는 저장할 수 없습니다. 하위 폴더를 지정하세요.' };
  const lower = resolved.toLowerCase();
  const blocked = [process.env.WINDIR, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map((p) => path.resolve(p).toLowerCase());
  if (blocked.some((b) => lower === b || lower.startsWith(b + path.sep)) || (process.platform !== 'win32' && POSIX_BLOCKED.some((b) => resolved === b || resolved.startsWith(`${b}/`)))) {
    return { ok: false, error: '시스템 폴더에는 저장할 수 없습니다.' };
  }
  try {
    await mkdir(resolved, { recursive: true });
    const probe = path.join(resolved, `.3agents-write-test-${randomBytes(4).toString('hex')}`);
    await writeFile(probe, 'ok');
    await unlink(probe);
  } catch (err) {
    return { ok: false, error: `이 폴더에 쓸 수 없습니다: ${err.code || err.message}` };
  }
  return { ok: true, dir: resolved };
}

/* ---------- 저장소 ---------- */

async function atomicWrite(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(4).toString('hex')}.tmp`);
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file); // 옵시디언이 쓰다 만 파일을 보지 않도록
}

async function readHead(file) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

export class HistoryStore {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.cfgFile = path.join(dataDir, 'history-config.json');
    this._cfg = null;
    this.cache = new Map();
    this.lock = Promise.resolve();
  }

  /** 쓰기 작업은 한 번에 하나씩 (같은 이름 충돌 방지) */
  exclusive(fn) {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => {});
    return run;
  }

  async config() {
    if (this._cfg) return this._cfg;
    let saved = {};
    try {
      saved = JSON.parse(await readFile(this.cfgFile, 'utf8'));
    } catch {
      /* 처음 실행 */
    }
    this._cfg = { dir: typeof saved.dir === 'string' && saved.dir ? saved.dir : path.join(this.dataDir, 'history'), enabled: saved.enabled !== false };
    return this._cfg;
  }

  async setConfig({ dir, enabled }) {
    const next = { ...(await this.config()) };
    if (dir !== undefined) {
      const v = await validateDir(dir);
      if (!v.ok) throw new HistoryError(v.error);
      next.dir = v.dir;
    }
    if (enabled !== undefined) next.enabled = Boolean(enabled);
    await mkdir(this.dataDir, { recursive: true });
    await atomicWrite(this.cfgFile, JSON.stringify(next, null, 2));
    this._cfg = next;
    this.cache.clear();
    return next;
  }

  /** 폴더의 앱 노트 목록(최신순). 표식이 있는 파일만 포함한다 */
  async scan() {
    const { dir } = await this.config();
    let names;
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const metas = [];
    let seen = 0;
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.md') || name.startsWith('.')) continue;
      if (++seen > MAX_SCAN) break;
      const file = path.join(dir, name);
      let st;
      try {
        st = await stat(file);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size > MAX_FILE) continue;
      const cached = this.cache.get(file);
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        if (cached.meta) metas.push({ ...cached.meta, file });
        continue;
      }
      const meta = parseHead(await readHead(file).catch(() => ''));
      this.cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, meta });
      if (meta) metas.push({ ...meta, file });
    }
    return metas.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  }

  async count() {
    return (await this.scan()).length;
  }

  async list({ q = '' } = {}) {
    let metas = await this.scan();
    const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
    if (terms.length) {
      const hits = [];
      for (const m of metas) {
        const head = `${m.question ?? ''} ${m.conclusion ?? ''} ${m.combo ?? ''}`.toLowerCase();
        if (terms.every((t) => head.includes(t))) {
          hits.push(m);
          continue;
        }
        const text = (await readFile(m.file, 'utf8').catch(() => '')).toLowerCase(); // 본문까지 검색
        if (terms.every((t) => head.includes(t) || text.includes(t))) hits.push(m);
      }
      metas = hits;
    }
    return metas.slice(0, 2000);
  }

  async find(id) {
    if (!ID_RE.test(String(id))) throw new HistoryError('잘못된 기록 번호입니다.');
    const meta = (await this.scan()).find((m) => m.id === id);
    if (!meta) throw new HistoryError('기록을 찾을 수 없습니다. (노트가 이동되거나 삭제되었을 수 있습니다)');
    return meta;
  }

  async get(id) {
    const meta = await this.find(id);
    const data = parseData(await readFile(meta.file, 'utf8'));
    if (!data) throw new HistoryError('이 노트에는 복원용 데이터가 없습니다. 옵시디언에서 직접 열어 보세요.');
    return { entry: normalizeEntry(data), file: meta.file, id };
  }

  /** 저장(또는 id 가 있으면 같은 파일에 덮어쓰기). 저장이 꺼져 있으면 { skipped: true } */
  save(rawEntry, existingId) {
    return this.exclusive(async () => {
      const cfg = await this.config();
      if (!cfg.enabled) return { skipped: true };
      const entry = normalizeEntry(rawEntry);
      await mkdir(cfg.dir, { recursive: true });
      const created = new Date(entry.createdAt);
      let id;
      let file;
      if (existingId) {
        const meta = await this.find(existingId);
        id = meta.id;
        file = meta.file;
      } else {
        id = makeId(created);
        const base = `${toLocalIso(created).slice(0, 10)} ${pad(created.getHours())}${pad(created.getMinutes())} ${sanitizeTitle(entry.question)}`;
        file = path.join(cfg.dir, `${base}.md`);
        for (let n = 2; existsSync(file); n++) file = path.join(cfg.dir, `${base} (${n}).md`);
      }
      await atomicWrite(file, renderNote(entry, id));
      this.cache.delete(file);
      return { id, file };
    });
  }

  remove(id) {
    return this.exclusive(async () => {
      const meta = await this.find(id);
      // 지우기 직전에 표식을 한 번 더 확인한다 (그 사이 사용자가 파일을 바꿨을 수 있다)
      const head = parseHead(await readHead(meta.file).catch(() => ''));
      if (!head || head.id !== id) throw new HistoryError('앱이 만든 노트가 아니어서 삭제하지 않았습니다.');
      await unlink(meta.file);
      this.cache.delete(meta.file);
      return { ok: true };
    });
  }

  clear() {
    return this.exclusive(async () => {
      let deleted = 0;
      for (const meta of await this.scan()) {
        const head = parseHead(await readHead(meta.file).catch(() => ''));
        if (!head) continue;
        await unlink(meta.file).catch(() => {});
        this.cache.delete(meta.file);
        deleted++;
      }
      return { deleted };
    });
  }
}

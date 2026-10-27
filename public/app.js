import { renderInfographic } from './infographic.js';
import { renderMarkdown } from './markdown.js';
import { interpretConsensus, splitConsensus } from './summary.js';

const AGENTS = [
  { id: 'openai', name: 'ChatGPT', vendor: 'OpenAI', letter: 'A', keyHint: 'sk-…' },
  { id: 'gemini', name: 'Gemini', vendor: 'Google', letter: 'B', keyHint: 'AIza…' },
  // 세 번째 자리(B)는 Gemini(API) 또는 Antigravity(CLI) 중 조합 선택에 따라 하나만 쓰인다
  { id: 'antigravity', name: 'Antigravity', vendor: 'Google', letter: 'B', cliOnly: true },
  { id: 'anthropic', name: 'Claude', vendor: 'Anthropic', letter: 'C', keyHint: 'sk-ant-…' },
];
const BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

const EXAMPLES = [
  '“사람은 뇌의 10%만 쓴다”는 말, 근거가 있어?',
  '1인 개발 SaaS라면 Python과 TypeScript 중 뭐가 더 나아?',
  '전기차 vs 하이브리드, 5년 보유 기준 총비용은 어느 쪽이 유리해?',
];

const SYSTEM_ANSWER =
  '당신은 정확하고 간결하게 답하는 어시스턴트입니다. 질문과 같은 언어로 답하세요. 확실한 것과 불확실한 것을 구분하고, 모르면 모른다고 말하세요. 근거 없는 수치나 출처를 지어내지 마세요.';
const SYSTEM_JUDGE =
  '당신은 편향 없는 합의 조정자입니다. 여러 답변을 비교해 사실에 가장 가깝고 유용한 하나의 답을 만듭니다. 답변에 없는 사실을 새로 지어내지 마세요.';

const STORE_KEY = 'three-agents.settings.v1';
const $ = (sel) => document.querySelector(sel);

/* ---------- 상태 ---------- */
let serverCfg = { mock: false, providers: {} };
let settings = loadSettings();
let run = null; // 진행 중인 실행 { abort, question, answers, ... }
let lastRound = null; // 합의 재시도를 위한 직전 라운드

function loadSettings() {
  const base = {
    keys: {},
    models: {}, // API 방식 모델
    cliModels: {}, // CLI 방식 모델 (비우면 로그인한 계정의 기본 모델)
    lastModel: {}, // 제공자별로 실제 응답한 모델명 (마지막으로 확인된 값)
    auth: {}, // 제공자별 연결 방식: 'cli' | 'api' (미설정이면 CLI 설치 시 cli)
    enabled: { openai: true, gemini: true, antigravity: true, anthropic: true },
    combo: 'gemini', // 'gemini' | 'antigravity' — 세 번째 AI
    agyAck: false, // Antigravity 약관 경고를 확인했는지
    effort: {}, // Antigravity 추론 노력(low/medium/high), 비우면 agy 기본
    mode: 'fast',
    synth: 'anthropic',
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { ...base, ...saved, enabled: { ...base.enabled, ...saved.enabled } };
  } catch {
    return base;
  }
}
function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    /* 저장소 차단 환경: 세션 동안만 유지 */
  }
}

const cliInfo = (id) => serverCfg.cli?.[id];
const supportsCli = (id) => Boolean(serverCfg.cli?.[id]); // Gemini 는 CLI 로그인 종료로 API 키 전용
const isCliOnly = (id) => Boolean(BY_ID[id]?.cliOnly);
const authOf = (id) => (isCliOnly(id) ? 'cli' : !supportsCli(id) ? 'api' : settings.auth[id] || (cliInfo(id)?.installed ? 'cli' : 'api'));

// 조합: ChatGPT + (Gemini | Antigravity) + Claude
const slotB = () => (settings.combo === 'antigravity' ? 'antigravity' : 'gemini');
const inCombo = (a) => a.id === 'openai' || a.id === 'anthropic' || a.id === slotB();
const comboAgents = () => AGENTS.filter(inCombo);
const hasKey = (id) =>
  authOf(id) === 'cli'
    ? Boolean(cliInfo(id)?.installed)
    : Boolean(settings.keys[id]?.trim() || serverCfg.providers[id]?.serverKey || serverCfg.mock);
const modelOf = (id) =>
  authOf(id) === 'cli'
    ? settings.cliModels[id]?.trim() || ''
    : settings.models[id]?.trim() || serverCfg.providers[id]?.model || '';
const modelLabel = (id) => modelOf(id) || (authOf(id) === 'cli' ? `CLI 기본 모델${settings.lastModel[id] ? ` (최근: ${settings.lastModel[id]})` : ''}` : '');
function rememberModel(id, model) {
  if (settings.lastModel[id] === model) return;
  settings.lastModel[id] = model;
  saveSettings();
}
const notReadyMessage = (id) =>
  authOf(id) === 'cli'
    ? `'${cliInfo(id)?.cmd ?? 'CLI'}' 가 감지되지 않았습니다. 설치: ${cliInfo(id)?.install} — 그리고 ${cliInfo(id)?.login}. 설정(⚙)에서 API 키 방식으로 바꿀 수도 있습니다.`
    : 'API 키가 없습니다. 설정(⚙)에서 키를 입력하거나 .env 에 추가하세요.';

/* ---------- 유틸 ---------- */
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2200);
}

function makeRenderer(el) {
  let pending = '';
  let raf = 0;
  const paint = () => {
    raf = 0;
    el.innerHTML = renderMarkdown(pending);
  };
  const fn = (text) => {
    pending = text;
    if (!raf) raf = requestAnimationFrame(paint);
  };
  fn.flush = (text = pending) => {
    pending = text;
    cancelAnimationFrame(raf);
    paint();
  };
  return fn;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('복사했습니다');
  } catch {
    toast('복사에 실패했습니다');
  }
}

const svgUse = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

/* ---------- 서버 호출 (NDJSON 스트림) ---------- */
async function callAgent(provider, { system, prompt, role, signal, onText, onModel }) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider,
      auth: authOf(provider),
      model: authOf(provider) === 'cli' ? settings.cliModels[provider] || '' : settings.models[provider] || '',
      apiKey: authOf(provider) === 'api' ? settings.keys[provider] || '' : '',
      system,
      prompt,
      role,
      effort: provider === 'antigravity' ? settings.effort.antigravity || '' : '',
    }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.t === 'delta') {
        text += ev.text;
        onText(text);
      } else if (ev.t === 'meta') {
        onModel?.(ev.model);
      } else if (ev.t === 'error') {
        throw new Error(ev.message);
      }
    }
  }
  if (!text.trim()) throw new Error('빈 응답을 받았습니다.');
  return text;
}

/* ---------- 카드 UI ---------- */
const cards = {};

function buildCard(agent) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.agent = agent.id;
  el.innerHTML = `
    <div class="card-head">
      <span class="card-icon">${svgUse('g-' + agent.id)}</span>
      <div class="card-title">${agent.name}<small></small></div>
      <span class="letter" title="합의 답변에서 이 AI를 가리키는 기호">${agent.letter}</span>
    </div>
    <div class="card-head" style="padding-top:0"><span class="status" data-s="idle">대기</span></div>
    <div class="card-body">
      <div class="md main"></div>
      <div class="rev" hidden><div class="rev-label">토론 후 수정 입장</div><div class="md revbody"></div></div>
    </div>
    <div class="card-foot"><button type="button" class="ghost copy" hidden>복사</button></div>`;
  const api = {
    el,
    status: el.querySelector('.status'),
    mainEl: el.querySelector('.main'),
    revWrap: el.querySelector('.rev'),
    revEl: el.querySelector('.revbody'),
    copyBtn: el.querySelector('.copy'),
    model: el.querySelector('small'),
    text: '',
    revised: '',
    errorText: '',
    started: 0,
  };
  api.renderMain = makeRenderer(api.mainEl);
  api.renderRev = makeRenderer(api.revEl);
  api.copyBtn.addEventListener('click', () => copy(api.revised || api.text));
  api.model.textContent = modelLabel(agent.id);
  return api;
}

function setStatus(card, state, label) {
  card.status.dataset.s = state;
  card.status.textContent = label;
}

function showError(card, target, message) {
  if (target !== 'rev') card.errorText = message; // 기록에 함께 저장한다
  const el = target === 'rev' ? card.revEl : card.mainEl;
  el.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = message;
  el.append(p);
}

/* ---------- 프롬프트 ---------- */
function revisePrompt(question, own, others) {
  const rest = others.map((o) => `[${o.letter}] ${o.name}의 답변:\n${o.text}`).join('\n\n');
  return `질문:\n${question}\n\n당신의 1차 답변:\n${own}\n\n다른 AI들의 답변:\n${rest}\n\n다른 답변을 비판적으로 검토하세요. 근거가 더 강한 주장은 받아들여 수정하고, 틀렸다고 판단하면 이유와 함께 입장을 유지하세요. 수정된 최종 답변을 간결하게 쓰고, 마지막 줄에 "변경점:"으로 무엇이 바뀌었는지 한 줄로 요약하세요.`;
}

function consensusPrompt(question, answers, debated) {
  const body = answers.map((a) => `### 답변 ${a.letter}\n${a.text}`).join('\n\n');
  return `아래 질문에 대해 ${answers.length}개의 AI가 ${debated ? '서로의 답변을 검토한 뒤 수정한 최종 입장을' : '각각'} 답했습니다. 이를 비교해 하나의 최종 답변을 만드세요.

규칙:
- 답변들이 공통으로 말하는 내용은 확정적으로 씁니다.
- 서로 충돌하는 내용은 숨기지 말고 명시하세요. 누가 무엇을 주장했는지 쓰고, 근거가 더 강한 쪽을 이유와 함께 고르세요. 판단할 수 없으면 불확실하다고 쓰세요.
- 한 답변에만 있는 유용한 정보는 포함하되 '단일 출처'라고 표시하세요.
- 답변을 가리킬 때는 A, B, C 기호만 쓰세요.
- 질문과 같은 언어로 쓰세요.

출력 형식 (마크다운):
## 최종 답변
(독자가 바로 쓸 수 있는 하나의 답)

## 합의 현황
- **일치:** ...
- **충돌:** ... (없으면 "없음")
- **단일 출처:** ... (없으면 "없음")

## 신뢰도
높음/보통/낮음 중 하나와 한 줄 이유

마지막에, 위 내용을 요약한 JSON 을 \`\`\`json 코드펜스 하나로 덧붙이세요. 화면의 인포그래픽에 쓰이며, 코드펜스 뒤에는 아무것도 쓰지 마세요.
- 아래 키만 사용하고, 모든 값은 문자열입니다. 숫자·퍼센트·통계를 만들어내지 마세요.
- 답변에 없는 내용을 넣지 마세요. 해당 내용이 없으면 빈 배열 [] 을 쓰세요.
{
  "headline": "결론 한 문장 (60자 이내)",
  "points": [{"title": "짧은 제목 (20자 이내)", "detail": "한 문장 설명 (80자 이내)"}],
  "agree": ["모든 답변이 일치한 내용"],
  "conflict": [{"issue": "쟁점", "views": "A는 …, B는 …. 판단: …"}],
  "single": ["한 답변에만 있던 내용 (출처 기호 포함)"],
  "confidence": {"level": "높음 또는 보통 또는 낮음", "reason": "한 줄 이유"},
  "actions": ["독자가 직접 확인하거나 할 일 (0~4개)"]
}
points 는 3~5개로 쓰세요.

질문:
${question}

${body}`;
}

/* ---------- 탭 ---------- */
const TAB_PANELS = { answers: '#grid', consensus: '#consensus', infographic: '#infographic' };

function showTab(name) {
  if ($(`#tab-${name}`).disabled) return;
  for (const t of Object.keys(TAB_PANELS)) {
    const on = t === name;
    $(TAB_PANELS[t]).hidden = !on;
    const b = $(`#tab-${t}`);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
}

const setTabState = (name, state) => ($(`#tab-${name} .tab-state`).dataset.s = state);

function resetInfographic() {
  showTab('answers'); // 인포그래픽 탭에 있었다면 비활성화 전에 벗어난다
  $('#infographic').replaceChildren();
  $('#tab-infographic').disabled = true;
  setTabState('infographic', 'idle');
}

/* ---------- 실행 흐름 ---------- */
function enabledAgents() {
  return comboAgents().filter((a) => settings.enabled[a.id]);
}

let currentSession = null; // 가장 최근 질문의 저장용 스냅샷 (합의 재시도 시 같은 노트를 갱신한다)

/** 질문 하나를 실행하고, 끝나면(성공/중지/오류 모두) 기록으로 저장한다 */
async function ask(question) {
  const session = { question, startedAt: new Date().toISOString(), mode: settings.mode, agents: null, cards: {}, round: null, savedId: null };
  try {
    await runAsk(question, session);
  } finally {
    await persistRun(session);
  }
}

async function runAsk(question, session) {
  const agents = enabledAgents();
  if (agents.length < 2) return toast('AI를 2개 이상 선택하세요');
  session.agents = agents;
  currentSession = session;
  hideHistoryBanner();

  run?.abort.abort();
  const ctl = new AbortController();
  run = { abort: ctl };
  setRunning(true);
  lastRound = null;

  const grid = $('#grid');
  grid.replaceChildren();
  for (const a of agents) {
    cards[a.id] = buildCard(a);
    session.cards[a.id] = cards[a.id]; // 새 질문이 cards 를 바꿔도 이 실행의 카드를 계속 참조한다
    grid.append(cards[a.id].el);
  }
  $('#tabs').hidden = false;
  resetInfographic();
  setTabState('answers', 'run');
  setTabState('consensus', 'idle');
  setConsensus('placeholder', '각 AI의 답변을 기다리는 중…');
  $('#retryConsensus').hidden = true;
  $('#legend').textContent = agents.map((a) => `${a.letter} = ${a.name}`).join('  ·  ');
  $('#examples').hidden = true;
  $('#tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });

  /* 1라운드: 병렬 질의 */
  await Promise.all(
    agents.map(async (a) => {
      const c = cards[a.id];
      c.started = performance.now();
      c.mainEl.classList.add('streaming');
      setStatus(c, 'run', '작성 중');
      if (!hasKey(a.id)) {
        c.mainEl.classList.remove('streaming');
        setStatus(c, 'err', authOf(a.id) === 'cli' ? 'CLI 없음' : '키 없음');
        return showError(c, 'main', notReadyMessage(a.id));
      }
      c.mainEl.innerHTML = '<p class="placeholder">응답을 기다리는 중…</p>';
      try {
        c.text = await callAgent(a.id, {
          system: SYSTEM_ANSWER,
          prompt: question,
          role: 'answer',
          signal: ctl.signal,
          onText: c.renderMain,
          onModel: (m) => showActualModel(a.id, m),
        });
        c.renderMain.flush(c.text);
        setStatus(c, 'done', `${((performance.now() - c.started) / 1000).toFixed(1)}초`);
        c.copyBtn.hidden = false;
      } catch (err) {
        if (ctl.signal.aborted) return setStatus(c, 'idle', '중지됨');
        c.text = '';
        setStatus(c, 'err', '오류');
        showError(c, 'main', err.message);
      } finally {
        c.mainEl.classList.remove('streaming');
      }
    }),
  );
  if (ctl.signal.aborted) return finish(ctl);

  let ok = agents.filter((a) => cards[a.id].text);
  setTabState('answers', ok.length >= 2 ? 'done' : 'err');
  if (ok.length < 2) {
    setTabState('consensus', 'err');
    setConsensus('placeholder', `합의에는 최소 2개의 답변이 필요합니다. (성공 ${ok.length}개) 오류 난 카드의 메시지를 확인하세요.`);
    return finish(ctl);
  }

  /* 2라운드(선택): 서로의 답변을 검토하고 수정 */
  const debated = settings.mode === 'debate';
  if (debated) {
    setTabState('answers', 'run');
    setConsensus('placeholder', '서로의 답변을 검토하는 중…');
    await Promise.all(
      ok.map(async (a) => {
        const c = cards[a.id];
        c.revWrap.hidden = false;
        c.revEl.classList.add('streaming');
        setStatus(c, 'run', '검토 중');
        const others = ok.filter((o) => o.id !== a.id).map((o) => ({ ...o, text: cards[o.id].text }));
        try {
          c.revised = await callAgent(a.id, {
            system: SYSTEM_ANSWER,
            prompt: revisePrompt(question, c.text, others),
            role: 'revise',
            signal: ctl.signal,
            onText: c.renderRev,
            onModel: (m) => showActualModel(a.id, m),
          });
          c.renderRev.flush(c.revised);
          setStatus(c, 'done', '검토 완료');
        } catch (err) {
          if (ctl.signal.aborted) return setStatus(c, 'idle', '중지됨');
          setStatus(c, 'done', '검토 실패 · 1차 유지');
          showError(c, 'rev', `검토 실패: ${err.message}`);
        } finally {
          c.revEl.classList.remove('streaming');
        }
      }),
    );
    setTabState('answers', 'done');
    if (ctl.signal.aborted) return finish(ctl);
  }

  lastRound = {
    question,
    debated,
    answers: ok.map((a) => ({ ...a, text: cards[a.id].revised || cards[a.id].text })),
  };
  session.round = lastRound;
  await runConsensus(ctl);
  finish(ctl);
}

async function runConsensus(ctl) {
  const round = lastRound; // 새 질문이 lastRound 를 바꿔도 이 합의의 결과가 섞이지 않게 지역 변수로 잡는다
  const { question, debated, answers } = round;
  const ids = answers.map((a) => a.id);
  const synthId = ids.includes(settings.synth) && hasKey(settings.synth) ? settings.synth : ids.find(hasKey) || ids[0];
  const synth = BY_ID[synthId];
  round.by = { id: synthId, name: synth.name, model: '' };
  let synthModel = '';
  const showMeta = () => {
    const who = synthModel ? `${synth.name}(${synthModel})` : synth.name;
    $('#consensusMeta').textContent = `${who}가 ${answers.length}개 답변을 종합 · ${debated ? '토론 합의' : '빠른 합의'}`;
  };
  showMeta();
  $('#retryConsensus').hidden = true;
  round.result = '';
  round.summary = null;
  resetInfographic();
  setTabState('consensus', 'run');
  setConsensus('placeholder', '합의안을 작성하는 중…');
  const body = $('#consensusBody');
  const render = makeRenderer(body);
  body.classList.add('streaming');
  try {
    const text = await callAgent(synthId, {
      system: SYSTEM_JUDGE,
      prompt: consensusPrompt(question, answers, debated),
      role: 'consensus',
      signal: ctl.signal,
      onModel: (m) => {
        synthModel = m;
        round.by.model = m;
        rememberModel(synthId, m);
        showMeta();
      },
      onText: (t) => {
        body.classList.add('md');
        render(splitConsensus(t).markdown); // 요약 JSON 블록은 본문에 보이지 않게 한다
      },
    });
    const { markdown, summary } = interpretConsensus(text);
    render.flush(markdown);
    round.result = markdown;
    round.summary = summary;
    renderInfographic($('#infographic'), summary, { legend: $('#legend').textContent, meta: $('#consensusMeta').textContent });
    $('#tab-infographic').disabled = false;
    setTabState('consensus', 'done');
    setTabState('infographic', 'done');
  } catch (err) {
    if (ctl.signal.aborted) {
      setTabState('consensus', 'idle');
      return setConsensus('placeholder', '중지했습니다.');
    }
    setTabState('consensus', 'err');
    setConsensus('error', `합의 실패: ${err.message}`);
    $('#retryConsensus').hidden = false;
  } finally {
    body.classList.remove('streaming');
  }
}

/* ---------- 기록 (저장 · 열람) ---------- */
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const obsidianUrl = (file) => `obsidian://open?path=${encodeURIComponent(file)}`; // 볼트에 등록된 노트면 옵시디언이 바로 연다
const baseName = (p) => String(p).split(/[\\/]/).pop();

async function api(path, options) {
  const res = await fetch(path, options);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** 실행 스냅샷 → 저장할 기록. 답이 하나도 없으면 null */
function buildEntry(session) {
  const agents = session.agents
    .filter((a) => session.cards[a.id])
    .map((a) => {
      const c = session.cards[a.id];
      return {
        id: a.id,
        name: a.name,
        letter: a.letter,
        model: c.model.dataset.actual ? c.model.textContent : modelOf(a.id),
        text: c.text || '',
        revised: c.revised || '',
        error: c.text ? '' : c.errorText || '',
      };
    });
  if (!agents.some((a) => a.text)) return null;
  const round = session.round;
  return {
    question: session.question,
    mode: session.mode,
    createdAt: session.startedAt,
    agents,
    consensus: round?.result ? { by: round.by, markdown: round.result, summary: round.summary } : null,
  };
}

async function persistRun(session) {
  if (!session?.agents) return;
  const entry = buildEntry(session); // await 전에 동기적으로 만든다 (그 사이 화면이 바뀌어도 이 실행의 값)
  if (!entry) return;
  try {
    const res = await post('/api/history', { entry, id: session.savedId || undefined });
    if (res.skipped) return;
    session.savedId = res.id;
    toast(`기록에 저장했습니다 · ${baseName(res.file)}`);
  } catch (err) {
    toast(`기록 저장 실패: ${err.message}`.slice(0, 140));
  }
}

function hideHistoryBanner() {
  $('#historyBanner').hidden = true;
}

/** 결과 영역(탭, 카드, 합의, 인포그래픽)을 비운다. 입력창은 건드리지 않는다 */
function clearResults() {
  for (const sel of ['#grid', '#consensus', '#infographic']) $(sel).hidden = true;
  $('#grid').replaceChildren();
  $('#infographic').replaceChildren();
  $('#consensusBody').replaceChildren();
  $('#consensusMeta').textContent = '';
  $('#legend').textContent = '';
  $('#tabs').hidden = true;
  for (const t of ['answers', 'consensus', 'infographic']) setTabState(t, 'idle');
  $('#tab-infographic').disabled = true;
  $('#retryConsensus').hidden = true;
  for (const k of Object.keys(cards)) delete cards[k];
  lastRound = null;
  currentSession = null;
  hideHistoryBanner();
}

/** 진행 중이면 사용자 확인을 받고 중지한다. 계속해도 되면 true */
function stopRunIfAny(message) {
  if (!run) return true;
  if (!confirm(message)) return false;
  const ctl = run.abort;
  ctl.abort();
  finish(ctl);
  return true;
}

function resetAll() {
  if (!stopRunIfAny('진행 중인 질문을 중지하고 초기화할까요?\n(지금까지의 답변은 기록에 저장됩니다)')) return;
  clearResults();
  const ta = $('#question');
  ta.value = '';
  autosize();
  $('#examples').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  ta.focus();
}

/** 저장된 기록을 화면에 복원한다 (탭 3개 그대로) */
function restoreEntry(entry, file) {
  if (!stopRunIfAny('진행 중인 질문이 있습니다. 중지하고 기록을 열까요?')) return false;
  clearResults();
  const grid = $('#grid');
  for (const a of entry.agents) {
    const base = BY_ID[a.id];
    if (!base) continue;
    const c = buildCard({ ...base, name: a.name || base.name, letter: a.letter || base.letter });
    cards[a.id] = c;
    c.model.textContent = a.model || '';
    if (a.model) {
      c.model.dataset.actual = '1';
      c.model.title = '실제로 응답한 모델';
    }
    c.text = a.text;
    c.revised = a.revised;
    if (a.text) {
      c.renderMain.flush(a.text);
      setStatus(c, 'done', '저장됨');
      c.copyBtn.hidden = false;
    } else {
      setStatus(c, 'err', '오류');
      showError(c, 'main', a.error || '답변이 없습니다.');
    }
    if (a.revised) {
      c.revWrap.hidden = false;
      c.renderRev.flush(a.revised);
    }
    grid.append(c.el);
  }
  $('#legend').textContent = entry.agents.map((a) => `${a.letter} = ${a.name}`).join('  ·  ');
  const cons = entry.consensus;
  if (cons) {
    const body = $('#consensusBody');
    body.className = 'md';
    body.innerHTML = renderMarkdown(cons.markdown); // renderMarkdown 은 모든 텍스트를 먼저 이스케이프한다
    $('#consensusMeta').textContent = `${cons.by.name}${cons.by.model ? `(${cons.by.model})` : ''}가 ${entry.agents.length}개 답변을 종합 · ${entry.mode === 'debate' ? '토론 합의' : '빠른 합의'}`;
    setTabState('consensus', 'done');
    if (cons.summary) {
      renderInfographic($('#infographic'), cons.summary, { legend: $('#legend').textContent, meta: $('#consensusMeta').textContent });
      $('#tab-infographic').disabled = false;
      setTabState('infographic', 'done');
    }
    lastRound = { result: cons.markdown, summary: cons.summary };
  } else {
    setConsensus('placeholder', '이 기록에는 합의 답변이 없습니다. (합의 전에 중지되었거나 실패한 질문입니다)');
  }
  setTabState('answers', 'done');
  $('#tabs').hidden = false;
  showTab(cons ? 'consensus' : 'answers');
  const ta = $('#question');
  ta.value = entry.question;
  autosize();
  $('#examples').hidden = true;
  $('#historyBannerText').textContent = `저장된 기록 · ${fmtDate(entry.createdAt)}${entry.status === 'partial' ? ' · 미완료' : ''} — 다시 질문하려면 [물어보기]를 누르세요.`;
  const link = $('#historyBannerLink');
  link.href = obsidianUrl(file);
  link.hidden = false;
  $('#historyBanner').hidden = false;
  $('#tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

let historyReq = 0;
async function loadHistoryList(q = '') {
  const my = ++historyReq;
  const list = $('#historyList');
  const empty = $('#historyEmpty');
  try {
    const [{ entries }, cfg] = await Promise.all([api(`/api/history?q=${encodeURIComponent(q)}`), api('/api/history/config')]);
    if (my !== historyReq) return; // 더 최신 검색이 있다
    $('#historyTotal').textContent = q ? `검색 결과 ${entries.length}개` : `${entries.length}개`;
    $('#historyWhere').textContent = `저장 폴더: ${cfg.dir}${cfg.enabled ? '' : ' (저장 꺼짐)'}`;
    list.replaceChildren(
      ...entries.map((m) => {
        const li = document.createElement('li');
        li.className = 'h-item';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'h-open';
        const qEl = document.createElement('span');
        qEl.className = 'h-q';
        qEl.textContent = m.question || '(제목 없음)';
        const meta = document.createElement('span');
        meta.className = 'h-meta';
        meta.textContent = [fmtDate(m.date), m.combo, m.mode, m.confidence ? `신뢰도 ${m.confidence}` : ''].filter(Boolean).join(' · ');
        if (m.status === 'partial') {
          const badge = document.createElement('span');
          badge.className = 'h-badge';
          badge.textContent = '미완료';
          meta.append(badge);
        }
        open.append(qEl, meta);
        if (m.conclusion) {
          const c = document.createElement('span');
          c.className = 'h-concl';
          c.textContent = m.conclusion;
          open.append(c);
        }
        open.addEventListener('click', async () => {
          try {
            const { entry, file } = await api(`/api/history/${encodeURIComponent(m.id)}`);
            if (restoreEntry(entry, file)) $('#historyDlg').close();
          } catch (err) {
            toast(err.message.slice(0, 140));
          }
        });
        const side = document.createElement('div');
        side.className = 'h-side';
        const obs = document.createElement('a');
        obs.href = obsidianUrl(m.file);
        obs.target = '_blank';
        obs.rel = 'noopener noreferrer';
        obs.textContent = '옵시디언';
        obs.title = '옵시디언에서 이 노트 열기';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'h-del';
        del.textContent = '삭제';
        del.addEventListener('click', async () => {
          if (!confirm(`이 기록을 삭제할까요?\n\n"${(m.question || '').slice(0, 60)}"\n\n저장 폴더의 노트 파일도 함께 삭제됩니다.`)) return;
          try {
            await api(`/api/history/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
            toast('삭제했습니다');
            loadHistoryList($('#historySearch').value.trim());
          } catch (err) {
            toast(err.message.slice(0, 140));
          }
        });
        side.append(obs, del);
        li.append(open, side);
        return li;
      }),
    );
    empty.hidden = entries.length > 0;
    empty.textContent = q ? '검색 결과가 없습니다.' : '아직 저장된 기록이 없습니다. 질문하면 자동으로 저장됩니다.';
    $('#historyClear').disabled = !entries.length && !q;
  } catch (err) {
    if (my !== historyReq) return;
    list.replaceChildren();
    empty.hidden = false;
    empty.textContent = `기록을 불러오지 못했습니다: ${err.message}`;
  }
}

function setupHistory() {
  const dlg = $('#historyDlg');
  const search = $('#historySearch');
  let timer;
  $('#historyBtn').addEventListener('click', () => {
    search.value = '';
    dlg.showModal();
    loadHistoryList();
  });
  $('#historyClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => loadHistoryList(search.value.trim()), 250);
  });
  $('#historyClear').addEventListener('click', async () => {
    if (!confirm('저장된 기록을 모두 삭제할까요?\n\n저장 폴더에서 이 앱이 만든 노트만 삭제되며, 다른 노트는 그대로 남습니다. 되돌릴 수 없습니다.')) return;
    try {
      const { deleted } = await post('/api/history/clear', { confirm: true });
      toast(`${deleted}개 기록을 삭제했습니다`);
      loadHistoryList();
    } catch (err) {
      toast(err.message.slice(0, 140));
    }
  });
}

/* ---- 설정: 기록 저장 위치 ---- */
async function loadHistoryConfig() {
  try {
    const c = await api('/api/history/config');
    $('#historyDir').value = c.dir;
    $('#historyEnabled').checked = c.enabled;
    $('#historyCount').textContent = `노트 ${c.count}개`;
    $('#historyStatus').textContent = c.enabled ? '' : '저장이 꺼져 있습니다. 새 질문은 기록되지 않습니다.';
  } catch (err) {
    $('#historyStatus').textContent = `설정을 불러오지 못했습니다: ${err.message}`;
  }
}

async function applyHistoryDir(dir) {
  try {
    await post('/api/history/config', { dir });
    toast('저장 폴더를 적용했습니다');
  } catch (err) {
    toast(err.message.slice(0, 140));
  }
  await loadHistoryConfig();
}

function setupHistorySettings() {
  const pick = $('#pickFolderBtn');
  if (window.desktop?.pickFolder) pick.hidden = false; // 폴더 선택 창은 데스크탑 앱에서만 쓸 수 있다
  pick.addEventListener('click', async () => {
    const r = await window.desktop.pickFolder();
    if (r?.path) {
      $('#historyDir').value = r.path;
      applyHistoryDir(r.path);
    }
  });
  $('#applyDirBtn').addEventListener('click', () => applyHistoryDir($('#historyDir').value));
  $('#historyDir').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // 설정 창이 저장/닫힘으로 처리되지 않게
      applyHistoryDir($('#historyDir').value);
    }
  });
  $('#historyEnabled').addEventListener('change', async (e) => {
    try {
      await post('/api/history/config', { enabled: e.target.checked });
      toast(e.target.checked ? '기록 저장을 켰습니다' : '기록 저장을 껐습니다');
    } catch (err) {
      toast(err.message.slice(0, 140));
    }
    loadHistoryConfig();
  });
}

/** 카드 헤더에 실제로 응답한 모델명을 표시한다 (별칭/기본값이 아니라 CLI·API 가 알려준 값) */
function showActualModel(id, model) {
  rememberModel(id, model);
  const el = cards[id]?.model;
  if (!el) return;
  el.textContent = model;
  el.title = '실제로 응답한 모델';
  el.dataset.actual = '1';
}

function setConsensus(kind, text) {
  const body = $('#consensusBody');
  body.className = 'md';
  body.replaceChildren();
  const p = document.createElement('p');
  p.className = kind === 'error' ? 'error placeholder' : 'placeholder';
  if (kind === 'error') p.style.color = 'var(--danger)';
  p.textContent = text;
  body.append(p);
}

function setRunning(on) {
  const btn = $('#sendBtn');
  btn.classList.toggle('stop', on);
  btn.querySelector('.send-label').textContent = on ? '중지' : '물어보기';
}

function finish(ctl) {
  if (ctl.signal.aborted) {
    for (const t of ['answers', 'consensus']) {
      const el = $(`#tab-${t} .tab-state`);
      if (el.dataset.s === 'run') el.dataset.s = 'idle';
    }
  }
  if (run?.abort === ctl) {
    setRunning(false);
    run = null;
  }
}

/* ---------- 에이전트 칩 · 모드 · 예시 ---------- */
function renderChips() {
  const wrap = $('#agentChips');
  wrap.replaceChildren();
  for (const a of comboAgents()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.style.setProperty('--agent', `var(--c-${a.id})`);
    b.setAttribute('aria-pressed', String(settings.enabled[a.id]));
    b.title = hasKey(a.id)
      ? `${a.name} 사용 가능 (${authOf(a.id) === 'cli' ? '로그인 CLI' : 'API 키'})`
      : `${a.name}: ${authOf(a.id) === 'cli' ? 'CLI 설치가 필요합니다' : 'API 키가 필요합니다'}`;
    b.innerHTML = `${svgUse('g-' + a.id)}${a.name}<span class="dot ${hasKey(a.id) ? 'ok' : ''}"></span>`;
    b.addEventListener('click', () => {
      settings.enabled[a.id] = !settings.enabled[a.id];
      saveSettings();
      renderChips();
    });
    wrap.append(b);
  }
}

/** 조합(세 번째 AI) 적용. 합의 조정 AI 가 조합에서 빠지면 Claude 로 되돌린다 */
function refreshSynthOptions() {
  const sel = $('#synthSelect');
  const current = sel.value || settings.synth;
  sel.replaceChildren(...comboAgents().map((a) => new Option(`${a.name} (${a.vendor})`, a.id)));
  sel.value = comboAgents().some((a) => a.id === current) ? current : 'anthropic';
}

function applyCombo(value) {
  settings.combo = value === 'antigravity' ? 'antigravity' : 'gemini';
  if (!comboAgents().some((a) => a.id === settings.synth)) settings.synth = 'anthropic';
  saveSettings();
  $('#comboSelect').value = settings.combo;
  renderChips();
  refreshSynthOptions(); // 설정창이 열려 있으면 합의 조정 AI 후보도 조합에 맞춘다
}

function setupCombo() {
  const select = $('#comboSelect');
  select.value = settings.combo;
  const dlg = $('#agyWarn');
  select.addEventListener('change', () => {
    if (select.value === 'antigravity' && !settings.agyAck) {
      select.value = settings.combo; // 확인 전에는 되돌려 둔다
      dlg.showModal();
      return;
    }
    applyCombo(select.value);
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok') {
      settings.agyAck = true;
      applyCombo('antigravity');
    }
    dlg.returnValue = '';
  });
}

function renderMode() {
  for (const b of document.querySelectorAll('.seg button')) {
    b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode));
  }
}

function renderExamples() {
  const wrap = $('#examples');
  for (const q of EXAMPLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'example';
    b.textContent = q;
    b.addEventListener('click', () => {
      const ta = $('#question');
      ta.value = q.replace(/[“”]/g, '"');
      autosize();
      ta.focus();
    });
    wrap.append(b);
  }
}

function autosize() {
  const ta = $('#question');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 320) + 'px';
}

/* ---------- 설정 창 ---------- */
const draftAuth = {};

function renderSettings() {
  const wrap = $('#providerFields');
  wrap.replaceChildren();
  for (const a of AGENTS) {
    draftAuth[a.id] = authOf(a.id);
    const serverKey = serverCfg.providers[a.id]?.serverKey;
    const cli = cliInfo(a.id);
    const sec = document.createElement('section');
    sec.className = 'provider';
    sec.dataset.auth = draftAuth[a.id];
    sec.classList.toggle('api-only', !supportsCli(a.id) && !isCliOnly(a.id));
    sec.classList.toggle('cli-only', isCliOnly(a.id));
    sec.style.setProperty('--agent', `var(--c-${a.id})`);
    sec.innerHTML = `
      <div class="provider-head">${svgUse('g-' + a.id)}${a.name}<small>${a.vendor}</small>
        <div class="seg small" role="radiogroup" aria-label="${a.name} 연결 방식">
          <button type="button" role="radio" data-auth="cli">로그인(CLI)</button>
          <button type="button" role="radio" data-auth="api">API 키</button>
        </div></div>

      <div class="only-cli">
        <p class="cli-status ${cli?.installed ? 'ok' : 'bad'}">
          ${cli?.installed ? `✓ <code></code> 감지됨` : `✗ <code></code> 를 찾을 수 없습니다`}
          <button type="button" class="ghost" data-recheck>다시 확인</button></p>
        <p class="hint cli-hint"></p>
        <div class="field"><span>모델 <small data-last></small></span>
          <select data-model-select="${a.id}"><option value="">불러오는 중…</option></select>
          <input type="text" data-model-cli="${a.id}" hidden spellcheck="false" placeholder="모델 이름 직접 입력 (예: gpt-5.5)" style="margin-top:6px">
        </div>
        ${a.id === 'antigravity' ? `
        <label class="field"><span>추론 노력 <small>낮을수록 빠릅니다</small></span>
          <select data-effort="antigravity"><option value="">자동 (agy 기본)</option><option value="low">낮음 (low)</option><option value="medium">중간 (medium)</option><option value="high">높음 (high)</option></select></label>
        <p class="hint">조합 선택(입력창 위)에서 <b>ChatGPT + Antigravity + Claude</b>를 고르면 사용됩니다. Google 약관상 회색지대이니 처음 켤 때 안내를 확인하세요. 프롬프트가 길면(약 2만 4천 자 초과) 실행하지 않고 안내합니다.</p>` : ''}
      </div>

      <div class="only-api">
        ${supportsCli(a.id) || isCliOnly(a.id) ? '' : `<p class="hint">Google 개인 계정의 Gemini CLI 로그인은 2026-06-18 에 종료되어 <b>API 키</b>만 지원합니다. 키는 Google AI Studio(aistudio.google.com/apikey)에서 발급합니다.</p>`}
        <label class="field"><span>API 키 <small>${serverKey ? '서버 .env 키 사용 가능' : ''}</small></span>
          <input type="password" data-key="${a.id}" placeholder="${serverKey ? '(비워 두면 서버 키 사용)' : a.keyHint}" autocomplete="off" spellcheck="false"></label>
        <label class="field"><span>모델</span>
          <div class="model-row"><input type="text" data-model-api="${a.id}" list="models-${a.id}" placeholder="${serverCfg.providers[a.id]?.model || ''}" spellcheck="false">
          <button type="button" class="ghost" data-load="${a.id}">목록 불러오기</button></div>
          <datalist id="models-${a.id}"></datalist></label>
      </div>`;
    // 서버가 돌려준 문자열은 textContent 로만 넣는다
    const codes = sec.querySelectorAll('.cli-status code');
    if (codes[0]) codes[0].textContent = cli ? `${cli.cmd.split(/[\\/]/).pop()}${cli.version ? ' ' + cli.version : ''}` : '';
    sec.querySelector('.cli-hint').textContent = `${cli?.installed ? '' : `설치: ${cli?.install ?? ''}  ·  `}${cli?.login ?? ''}. 로그인은 터미널에서 한 번만 하면 됩니다.`;
    sec.querySelector('[data-key]').value = settings.keys[a.id] || '';
    sec.querySelector('[data-model-api]').value = settings.models[a.id] || '';
    sec.querySelector('[data-model-cli]').value = settings.cliModels[a.id] || '';
    sec.querySelector('[data-last]').textContent = settings.lastModel[a.id] ? `최근 실제 응답: ${settings.lastModel[a.id]}` : '';
    const effortSel = sec.querySelector('[data-effort]');
    if (effortSel) effortSel.value = settings.effort[a.id] || '';
    if (supportsCli(a.id)) fillCliModelSelect(a.id, sec);
    for (const b of sec.querySelectorAll('[data-auth]')) {
      b.setAttribute('aria-checked', String(b.dataset.auth === draftAuth[a.id]));
      b.addEventListener('click', () => {
        draftAuth[a.id] = b.dataset.auth;
        sec.dataset.auth = draftAuth[a.id];
        for (const o of sec.querySelectorAll('[data-auth]')) o.setAttribute('aria-checked', String(o === b));
      });
    }
    sec.querySelector('[data-recheck]').addEventListener('click', async () => {
      try {
        serverCfg = await (await fetch('/api/config?refresh=1')).json();
        const keep = { ...draftAuth };
        applyDraftToSettings();
        renderSettings();
        for (const id of Object.keys(keep)) draftAuth[id] = keep[id];
        renderChips();
        toast('다시 확인했습니다');
      } catch {
        toast('확인에 실패했습니다');
      }
    });
    sec.querySelector('[data-load]').addEventListener('click', (e) => loadModels(a.id, sec, e.currentTarget));
    wrap.append(sec);
  }
  const sel = $('#synthSelect');
  refreshSynthOptions();
}

const cliModelCache = {};

/** CLI 방식 모델 드롭다운을 채운다: 자동(기본) + 목록 + 직접 입력 */
async function fillCliModelSelect(id, sec) {
  const select = sec.querySelector('[data-model-select]');
  const input = sec.querySelector('[data-model-cli]');
  const saved = input.value.trim();
  let models = cliModelCache[id];
  let failed = '';
  if (!models) {
    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: id, auth: 'cli' }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      models = cliModelCache[id] = j.models;
    } catch (err) {
      models = [];
      failed = err.message;
    }
  }
  const opts = [new Option('자동 — 로그인한 계정의 기본 모델', '')];
  for (const m of models) opts.push(new Option(m.label || m.id, m.id));
  if (saved && !models.some((m) => m.id === saved)) opts.push(new Option(`${saved} (저장된 값)`, saved));
  opts.push(new Option('직접 입력…', '__custom'));
  select.replaceChildren(...opts);
  select.value = saved || '';
  if (failed) toast(`모델 목록을 못 불러왔습니다. 직접 입력할 수 있습니다. (${failed.slice(0, 80)})`);
  select.onchange = () => {
    const custom = select.value === '__custom';
    input.hidden = !custom;
    if (custom) input.focus();
    else input.value = select.value;
  };
}

async function loadModels(id, sec, btn) {
  const key = sec.querySelector('[data-key]').value.trim();
  btn.disabled = true;
  btn.textContent = '불러오는 중…';
  try {
    const res = await fetch('/api/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: id, apiKey: key }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    sec.querySelector('datalist').replaceChildren(...j.models.map((m) => new Option(m.id)));
    toast(`${j.models.length}개 모델을 불러왔습니다. 입력창을 눌러 고르세요`);
    sec.querySelector('[data-model-api]').focus();
  } catch (err) {
    toast(err.message.slice(0, 120));
  } finally {
    btn.disabled = false;
    btn.textContent = '목록 불러오기';
  }
}

function applyDraftToSettings() {
  for (const a of AGENTS) {
    settings.auth[a.id] = supportsCli(a.id) ? draftAuth[a.id] || authOf(a.id) : 'api';
    settings.keys[a.id] = document.querySelector(`[data-key="${a.id}"]`).value.trim();
    settings.models[a.id] = document.querySelector(`[data-model-api="${a.id}"]`).value.trim();
    settings.cliModels[a.id] = document.querySelector(`[data-model-cli="${a.id}"]`).value.trim();
  }
  settings.synth = $('#synthSelect').value;
  const effort = document.querySelector('[data-effort="antigravity"]');
  if (effort) settings.effort.antigravity = effort.value;
}

function applySettingsFromDialog() {
  applyDraftToSettings();
  saveSettings();
  renderChips();
  for (const a of AGENTS) if (cards[a.id]) cards[a.id].model.textContent = modelLabel(a.id);
}

/* ---------- 데스크탑 앱 (Electron 에서만 window.desktop 이 존재) ---------- */
const UPDATE_TEXT = {
  idle: '',
  checking: '업데이트 확인 중…',
  none: '최신 버전입니다.',
  dev: '개발 모드에서는 업데이트를 확인하지 않습니다.',
  downloaded: '내려받기 완료 — 설치를 위해 앱이 곧 재시작됩니다.',
};

function describeUpdate(s) {
  if (s.state === 'available') return `새 버전 ${s.version} 을(를) 발견했습니다.`;
  if (s.state === 'downloading') return `업데이트를 내려받는 중… ${s.percent ?? 0}%`;
  if (s.state === 'error') return `업데이트 확인 실패: ${s.message ?? ''}`;
  return UPDATE_TEXT[s.state] ?? '';
}

async function setupDesktop() {
  $('#appVersion').textContent = serverCfg.version ? `v${serverCfg.version}` : '';
  if (!window.desktop) return; // 일반 브라우저에서는 이 섹션을 숨긴 채로 둔다
  $('#desktopSection').hidden = false;
  const info = await window.desktop.getInfo();
  if (info) $('#desktopVersion').textContent = `v${info.version}`;
  window.desktop.onUpdateStatus((s) => ($('#updateStatus').textContent = describeUpdate(s)));
  $('#checkUpdateBtn').addEventListener('click', () => window.desktop.checkForUpdates());
}

/* ---------- 초기화 ---------- */
async function init() {
  try {
    serverCfg = await (await fetch('/api/config')).json();
  } catch {
    toast('서버에 연결할 수 없습니다');
  }
  $('#mockBadge').hidden = !serverCfg.mock;
  setupDesktop();
  renderChips();
  setupCombo();
  setupHistory();
  setupHistorySettings();
  renderMode();
  renderExamples();
  renderSettings();

  const ta = $('#question');
  ta.addEventListener('input', autosize);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = ta.value.trim();
    if (q) ask(q);
  });
  $('#resetBtn').addEventListener('click', resetAll);
  $('#sendBtn').addEventListener('click', (e) => {
    if (run) {
      e.preventDefault(); // 같은 클릭이 폼 제출로 이어져 재실행되는 것을 막는다
      run.abort.abort();
      finish(run.abort);
      toast('중지했습니다');
    }
  });

  for (const b of document.querySelectorAll('.seg button')) {
    b.addEventListener('click', () => {
      settings.mode = b.dataset.mode;
      saveSettings();
      renderMode();
    });
  }

  for (const b of document.querySelectorAll('#tabs [role=tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));
  $('#tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...document.querySelectorAll('#tabs [role=tab]')].filter((t) => !t.disabled);
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    showTab(next.dataset.tab);
    e.preventDefault();
  });

  const dlg = $('#settings');
  $('#settingsBtn').addEventListener('click', () => {
    renderSettings();
    loadHistoryConfig();
    dlg.showModal();
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'save') applySettingsFromDialog();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });

  $('#copyConsensus').addEventListener('click', () => lastRound?.result && copy(lastRound.result));
  $('#retryConsensus').addEventListener('click', async () => {
    if (!lastRound || run) return;
    const ctl = new AbortController();
    run = { abort: ctl };
    setRunning(true);
    await runConsensus(ctl);
    finish(ctl);
    if (currentSession?.round === lastRound) await persistRun(currentSession); // 재시도 결과로 같은 노트를 갱신한다
  });
}

init();

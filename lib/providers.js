import { streamCli } from './cli.js';

export const PROVIDERS = ['openai', 'gemini', 'anthropic'];

const KEY_ENV = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

const MODEL_ENV = {
  openai: ['OPENAI_MODEL', 'gpt-5'],
  gemini: ['GEMINI_MODEL', 'gemini-pro-latest'],
  anthropic: ['ANTHROPIC_MODEL', 'claude-sonnet-5-5'],
};

export class UpstreamError extends Error {
  constructor(provider, status, detail) {
    super(friendly(provider, status, detail));
    this.status = status;
  }
}

function friendly(provider, status, detail) {
  const d = String(detail || '').trim().slice(0, 400);
  if (status === 401 || status === 403) return `API 키가 거부되었습니다 (${status}). 키와 권한을 확인하세요. ${d}`;
  if (status === 404) return `모델을 찾을 수 없습니다 (404). 설정에서 '목록 불러오기'로 모델을 다시 고르세요. ${d}`;
  if (status === 429) return `요청 한도 또는 쿼터를 초과했습니다 (429). ${d}`;
  return `${provider} 오류 (${status}): ${d || '알 수 없는 오류'}`;
}

export function getModel(provider, env = process.env) {
  const [name, fallback] = MODEL_ENV[provider];
  return env[name] || fallback;
}

export function getServerKey(provider, env = process.env) {
  return (env[KEY_ENV[provider]] || '').trim();
}

async function failIfBad(provider, res) {
  if (res.ok) return;
  const text = await res.text().catch(() => '');
  let detail = text;
  try {
    const j = JSON.parse(text);
    detail = j?.error?.message || j?.message || (Array.isArray(j) ? j[0]?.error?.message : '') || text;
  } catch {
    /* plain text body */
  }
  throw new UpstreamError(provider, res.status, detail);
}

/** fetch 응답(SSE)에서 data 페이로드 문자열을 하나씩 꺼낸다. */
async function* sseData(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const pick = (block) => {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    return data || null;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let m;
      while ((m = /\r?\n\r?\n/.exec(buf))) {
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        const data = pick(block);
        if (data) yield data;
      }
    }
    const tail = pick(buf);
    if (tail) yield tail;
  } finally {
    reader.cancel().catch(() => {});
  }
}

const jsonHeaders = { 'content-type': 'application/json' };

async function* openai({ model, apiKey, system, prompt, signal }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { ...jsonHeaders, authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
    }),
  });
  await failIfBad('OpenAI', res);
  for await (const data of sseData(res)) {
    if (data === '[DONE]') return;
    const ev = JSON.parse(data);
    if (ev.error) throw new UpstreamError('OpenAI', 500, ev.error.message);
    const text = ev.choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}

async function* anthropic({ model, apiKey, system, prompt, signal }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: { ...jsonHeaders, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      stream: true,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  await failIfBad('Anthropic', res);
  for await (const data of sseData(res)) {
    const ev = JSON.parse(data);
    if (ev.type === 'error') throw new UpstreamError('Anthropic', 500, ev.error?.message);
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') yield ev.delta.text;
  }
}

async function* gemini({ model, apiKey, system, prompt, signal }) {
  const id = encodeURIComponent(model.replace(/^models\//, ''));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${id}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      signal,
      headers: { ...jsonHeaders, 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
    },
  );
  await failIfBad('Gemini', res);
  for await (const data of sseData(res)) {
    const ev = JSON.parse(data);
    if (ev.promptFeedback?.blockReason) {
      throw new UpstreamError('Gemini', 400, `프롬프트가 차단되었습니다: ${ev.promptFeedback.blockReason}`);
    }
    for (const part of ev.candidates?.[0]?.content?.parts ?? []) {
      if (part.text && !part.thought) yield part.text;
    }
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))), { once: true });
  });

const MOCK_TEXT = {
  answer: {
    openai: (q) =>
      `**요약:** "${q}"에 대한 첫 번째 관점입니다.\n\n- 핵심 주장 1: 상황에 따라 달라지지만 대체로 비용 대비 효과가 중요합니다.\n- 핵심 주장 2: 단기 지표보다 장기 지표를 먼저 보세요.\n- 주의: 개인 사정에 따라 결론이 뒤집힐 수 있습니다.`,
    gemini: (q) =>
      `"${q}"를 세 단계로 나눠 보겠습니다.\n\n1. 목표를 숫자로 정의하기\n2. 선택지별 총비용 비교하기\n3. 되돌릴 수 있는 선택인지 확인하기\n\n대체로 위 순서를 따르면 결론이 안정적입니다.`,
    anthropic: (q) =>
      `"${q}"에 대해 확실한 부분과 불확실한 부분을 나눠 답합니다.\n\n**확실:** 비용 대비 효과를 장기 기준으로 보는 것이 맞습니다.\n\n**불확실:** 개인 상황에 따른 변수가 크므로 단정은 피합니다.\n\n\`\`\`\n판단 기준 = 장기 효과 / 총비용\n\`\`\``,
  },
  revise: () =>
    '**수정 입장:** 다른 답변들과 비교해 보니 "장기 기준"이라는 공통 전제가 타당합니다. 다만 단일 출처 주장은 근거가 약해 비중을 낮췄습니다.\n\n변경점: 단정적 표현을 완화함.',
  consensus: () =>
    '## 최종 답변\n\n세 답변이 공통으로 가리키는 결론은 **장기 기준으로 총비용 대비 효과를 비교하라**는 것입니다. 단기 지표만으로 결정하면 뒤집힐 수 있습니다.\n\n## 합의 현황\n\n- **일치:** 장기 기준 비교(A·B·C 모두)\n- **충돌:** 없음 — 표현 강도만 다릅니다.\n- **단일 출처:** 목표를 숫자로 정의하라는 제안(B)\n\n## 신뢰도\n\n**보통** — 세 모델이 일치하지만 구체적 수치 근거는 없습니다.',
};

async function* mock({ provider, prompt, role, signal }) {
  if (provider === 'gemini' && prompt.includes('ERR_TEST')) {
    await sleep(300, signal);
    throw new UpstreamError('Gemini', 429, 'mock: quota exceeded');
  }
  const q = prompt.replace(/\s+/g, ' ').slice(0, 40);
  const make = MOCK_TEXT[role] ?? MOCK_TEXT.answer;
  const text = typeof make === 'function' ? make(q) : make[provider](q);
  const delay = { openai: 14, gemini: 22, anthropic: 18 }[provider] ?? 18;
  for (const piece of text.match(/\s*\S+/g)) {
    await sleep(delay, signal);
    yield piece;
  }
}

const IMPLS = { openai, gemini, anthropic };

/** auth: 'api'(API 키) | 'cli'(공식 CLI 로그인). 데모 모드는 둘 다 모의 응답을 쓴다. */
export async function* streamChat({ provider, mock: useMock, auth, ...rest }) {
  if (!PROVIDERS.includes(provider)) throw new Error(`알 수 없는 제공자: ${provider}`);
  const impl = useMock ? mock : auth === 'cli' ? streamCli : IMPLS[provider];
  yield* impl({ provider, ...rest });
}

async function getJson(provider, url, headers, signal) {
  const res = await fetch(url, { headers, signal });
  await failIfBad(provider, res);
  return res.json();
}

/** 내 키로 실제 호출 가능한 모델 목록 (모델명이 자주 바뀌므로 하드코딩 대신 조회) */
export async function listModels({ provider, apiKey, signal }) {
  let ids;
  if (provider === 'openai') {
    const j = await getJson('OpenAI', 'https://api.openai.com/v1/models', { authorization: `Bearer ${apiKey}` }, signal);
    ids = j.data
      .map((m) => m.id)
      .filter((id) => /^(gpt|o\d|chatgpt)/.test(id))
      .filter((id) => !/embed|audio|realtime|transcribe|tts|image|moderation|whisper|search|codex|instruct/.test(id));
  } else if (provider === 'anthropic') {
    const j = await getJson(
      'Anthropic',
      'https://api.anthropic.com/v1/models?limit=100',
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal,
    );
    ids = j.data.map((m) => m.id);
  } else if (provider === 'gemini') {
    const j = await getJson(
      'Gemini',
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      { 'x-goog-api-key': apiKey },
      signal,
    );
    ids = j.models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((id) => id.startsWith('gemini') && !/embed|image|tts|live|veo|robotics|audio/.test(id));
  } else {
    throw new Error(`알 수 없는 제공자: ${provider}`);
  }
  return [...new Set(ids)].sort().reverse();
}

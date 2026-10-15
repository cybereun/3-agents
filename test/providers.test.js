import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { streamChat, listModels, UpstreamError } from '../lib/providers.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** SSE 본문을 임의 청크 경계로 잘라 내려주는 가짜 fetch (실제 네트워크의 분할을 흉내) */
function fakeFetch(chunks, { status = 200, capture } = {}) {
  globalThis.fetch = async (url, init) => {
    capture?.({ url: String(url), init });
    if (status !== 200) return new Response(JSON.stringify({ error: { message: 'boom' } }), { status });
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(c) {
          for (const ch of chunks) c.enqueue(enc.encode(ch));
          c.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  };
}

async function collect(gen) {
  let out = '';
  for await (const t of gen) out += t;
  return out;
}

test('OpenAI: 요청 형태와 delta 파싱, [DONE] 처리, 청크 경계 분할', async () => {
  let seen;
  const sse =
    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"안"}}]}\n\ndata: {"choices":[{"delta":{"content":"녕"}}]}\n\n' +
    'data: [DONE]\n\n';
  // 일부러 이벤트 중간에서 자른다
  fakeFetch([sse.slice(0, 50), sse.slice(50, 120), sse.slice(120)], { capture: (x) => (seen = x) });
  const text = await collect(streamChat({ provider: 'openai', model: 'm1', apiKey: 'sk-x', system: 'S', prompt: 'P' }));
  assert.equal(text, '안녕');
  assert.equal(seen.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(seen.init.headers.authorization, 'Bearer sk-x');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.stream, true);
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'P' },
  ]);
});

test('Anthropic: text_delta 만 추출하고 헤더/본문 형태가 맞다', async () => {
  let seen;
  fakeFetch(
    [
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ],
    { capture: (x) => (seen = x) },
  );
  const text = await collect(streamChat({ provider: 'anthropic', model: 'claude-x', apiKey: 'k', system: 'S', prompt: 'P' }));
  assert.equal(text, 'Hello');
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], 'k');
  assert.equal(seen.init.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.system, 'S');
  assert.ok(body.max_tokens > 0);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'P' }]);
});

test('Gemini: parts 의 text 만 모으고 thought 는 제외, 키는 URL 이 아닌 헤더', async () => {
  let seen;
  fakeFetch(
    [
      'data: {"candidates":[{"content":{"parts":[{"text":"생각","thought":true},{"text":"가"}]}}]}\r\n\r\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"나"}]}}]}\r\n\r\n',
    ],
    { capture: (x) => (seen = x) },
  );
  const text = await collect(streamChat({ provider: 'gemini', model: 'models/gemini-x', apiKey: 'gk', system: 'S', prompt: 'P' }));
  assert.equal(text, '가나');
  assert.equal(
    seen.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse',
  );
  assert.ok(!seen.url.includes('gk'));
  assert.equal(seen.init.headers['x-goog-api-key'], 'gk');
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'S' }] });
  assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'P' }] }]);
});

test('Gemini: 프롬프트 차단은 에러로 올라온다', async () => {
  fakeFetch(['data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n']);
  await assert.rejects(collect(streamChat({ provider: 'gemini', model: 'm', apiKey: 'k', prompt: 'p' })), /SAFETY/);
});

test('HTTP 오류는 상태별 한국어 메시지로 바뀐다', async () => {
  for (const [status, re] of [
    [401, /API 키가 거부/],
    [404, /모델을 찾을 수 없습니다/],
    [429, /한도/],
  ]) {
    fakeFetch([], { status });
    await assert.rejects(
      collect(streamChat({ provider: 'openai', model: 'm', apiKey: 'k', prompt: 'p' })),
      (e) => e instanceof UpstreamError && re.test(e.message) && e.message.includes('boom'),
    );
  }
});

test('모델 목록: 제공자별로 필터링하고 정렬한다', async () => {
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = u.includes('openai')
      ? { data: [{ id: 'gpt-5' }, { id: 'text-embedding-3' }, { id: 'gpt-4o-audio-preview' }, { id: 'o3' }, { id: 'dall-e-3' }] }
      : u.includes('anthropic')
        ? { data: [{ id: 'claude-a' }, { id: 'claude-b' }] }
        : {
            models: [
              { name: 'models/gemini-pro', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-embedding', supportedGenerationMethods: ['embedContent'] },
              { name: 'models/gemini-flash', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/imagen-3', supportedGenerationMethods: ['generateContent'] },
            ],
          };
    return new Response(JSON.stringify(json), { status: 200 });
  };
  assert.deepEqual(await listModels({ provider: 'openai', apiKey: 'k' }), ['o3', 'gpt-5']);
  assert.deepEqual(await listModels({ provider: 'anthropic', apiKey: 'k' }), ['claude-b', 'claude-a']);
  assert.deepEqual(await listModels({ provider: 'gemini', apiKey: 'k' }), ['gemini-pro', 'gemini-flash']);
});

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvFile } from './lib/env.js';
import { PROVIDERS, getModel, getServerKey, listModels, streamChat } from './lib/providers.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_BODY = 4 * 1024 * 1024;
const MAX_PROMPT = 200_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
};

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, '요청이 너무 큽니다.');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, '잘못된 JSON 입니다.');
  }
}

export function createAppServer({ env = process.env, host = '127.0.0.1' } = {}) {
  const mock = env.MOCK === '1';
  const loopbackOnly = LOOPBACK.has(host);

  /** 다른 웹사이트가 내 로컬 서버를 두드려 키를 소모시키는 것(CSRF/DNS rebinding)을 차단 */
  function guard(req) {
    const hostHeader = (req.headers.host || '').replace(/:\d+$/, '');
    if (loopbackOnly && !LOOPBACK.has(hostHeader)) throw new HttpError(403, '허용되지 않은 Host 입니다.');
    const origin = req.headers.origin;
    if (origin) {
      let originHost;
      try {
        originHost = new URL(origin).host;
      } catch {
        throw new HttpError(403, '잘못된 Origin 입니다.');
      }
      if (originHost !== req.headers.host) throw new HttpError(403, '허용되지 않은 Origin 입니다.');
    }
  }

  function resolveKey(provider, bodyKey) {
    const key = (typeof bodyKey === 'string' && bodyKey.trim()) || getServerKey(provider, env);
    if (!key && !mock) {
      throw new HttpError(400, 'API 키가 없습니다. 설정에서 키를 입력하거나 .env 에 추가하세요.');
    }
    return key;
  }

  function checkProvider(provider) {
    if (!PROVIDERS.includes(provider)) throw new HttpError(400, `알 수 없는 제공자: ${provider}`);
  }

  async function handleChat(req, res) {
    const body = await readJson(req);
    checkProvider(body.provider);
    const { provider } = body;
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new HttpError(400, '질문이 비어 있습니다.');
    if (body.prompt.length > MAX_PROMPT) throw new HttpError(413, '질문이 너무 깁니다.');
    const apiKey = resolveKey(provider, body.apiKey);
    const model = (typeof body.model === 'string' && body.model.trim()) || getModel(provider, env);

    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    });
    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) ac.abort();
    });
    const emit = (obj) => res.write(JSON.stringify(obj) + '\n');
    try {
      for await (const text of streamChat({
        provider,
        mock,
        model,
        apiKey,
        system: typeof body.system === 'string' ? body.system : '',
        prompt: body.prompt,
        role: body.role,
        signal: ac.signal,
      })) {
        emit({ t: 'delta', text });
      }
      emit({ t: 'done' });
    } catch (err) {
      if (!ac.signal.aborted) emit({ t: 'error', message: err.message || String(err) });
    }
    res.end();
  }

  async function handleModels(req, res) {
    const body = await readJson(req);
    checkProvider(body.provider);
    if (mock) return sendJson(res, 200, { models: ['mock-model-1', 'mock-model-2'] });
    const apiKey = resolveKey(body.provider, body.apiKey);
    try {
      const models = await listModels({ provider: body.provider, apiKey });
      sendJson(res, 200, { models });
    } catch (err) {
      sendJson(res, 502, { error: err.message });
    }
  }

  function handleConfig(res) {
    sendJson(res, 200, {
      mock,
      providers: Object.fromEntries(
        PROVIDERS.map((p) => [p, { serverKey: Boolean(getServerKey(p, env)), model: getModel(p, env) }]),
      ),
    });
  }

  async function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.resolve(PUBLIC_DIR, rel);
    if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Forbidden');
    let data;
    try {
      data = await readFile(file);
    } catch {
      throw new HttpError(404, 'Not found');
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  return http.createServer(async (req, res) => {
    try {
      guard(req);
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname.startsWith('/api/')) {
        if (pathname === '/api/config' && req.method === 'GET') return handleConfig(res);
        if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
        if (pathname === '/api/chat') return await handleChat(req, res);
        if (pathname === '/api/models') return await handleModels(req, res);
        throw new HttpError(404, 'Not found');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      await serveStatic(req, res, pathname);
    } catch (err) {
      const status = err.status || 500;
      if (res.headersSent) return res.end();
      if (status === 500) console.error(err);
      sendJson(res, status, { error: status === 500 ? '서버 오류' : err.message });
    }
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  loadEnvFile(path.join(ROOT, '.env'));
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT) || 3000;
  createAppServer({ host }).listen(port, host, () => {
    const mode = process.env.MOCK === '1' ? ' (데모 모드: 실제 AI를 호출하지 않음)' : '';
    console.log(`3 Agents → http://${host === '0.0.0.0' ? 'localhost' : host}:${port}${mode}`);
    if (!LOOPBACK.has(host)) console.warn('⚠ 외부 접속이 열려 있습니다. 서버의 API 키를 누구나 사용할 수 있습니다.');
  });
}

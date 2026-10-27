import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, statSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync as readSync } from 'node:fs';
import util from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvFile } from './lib/env.js';
import { HistoryError, HistoryStore } from './lib/history.js';
import { CLI_PROVIDERS, detectCli, listCliModels, resolveCmd } from './lib/cli.js';
import { CLI_ONLY, PROVIDERS, getModel, getServerKey, listModels, streamChat } from './lib/providers.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_BODY = 4 * 1024 * 1024;

// 앱 버전 (package.json). 데스크탑 앱과 설정 화면이 같은 값을 보여준다.
export const APP_VERSION = (() => {
  try {
    return JSON.parse(readSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

// 이 앱은 자기 자신(same-origin) 외에는 아무것도 불러오지 않는다
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
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
  // 기록 설정(저장 폴더 등)의 보관 위치. 데스크탑 앱은 사용자 데이터 폴더(APP_DATA_DIR)를 쓴다
  const history = new HistoryStore({ dataDir: env.APP_DATA_DIR || path.join(ROOT, 'data') });

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
    const viaCli = body.auth === 'cli';
    if (!viaCli && CLI_ONLY.includes(provider)) throw new HttpError(400, `${provider} 는 CLI 로그인 방식만 지원합니다.`);
    if (viaCli && !CLI_PROVIDERS.includes(provider)) {
      throw new HttpError(400, `${provider} 는 CLI 로그인 방식을 지원하지 않습니다. API 키를 사용하세요.`);
    }
    const apiKey = viaCli ? '' : resolveKey(provider, body.apiKey);
    // CLI 는 모델을 비우면 로그인한 계정의 기본 모델을 쓴다 (구독별로 쓸 수 있는 모델이 다르다)
    const model = (typeof body.model === 'string' && body.model.trim()) || (viaCli ? '' : getModel(provider, env));

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
        auth: viaCli ? 'cli' : 'api',
        env,
        model,
        apiKey,
        system: typeof body.system === 'string' ? body.system : '',
        prompt: body.prompt,
        role: body.role,
        effort: typeof body.effort === 'string' ? body.effort : '',
        signal: ac.signal,
        onMeta: (m) => {
          // 실제로 응답한 모델명을 화면에 알린다 (길이/형식 제한)
          if (typeof m?.model === 'string' && /^[\w.:\-/]{1,80}$/.test(m.model) && !res.writableEnded) emit({ t: 'meta', model: m.model });
        },
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
    if (mock) return sendJson(res, 200, { models: ['mock-model-1', 'mock-model-2'].map((id) => ({ id, label: id })) });
    try {
      if (body.auth === 'cli') {
        if (!CLI_PROVIDERS.includes(body.provider)) throw new HttpError(400, 'CLI 방식을 지원하지 않는 제공자입니다.');
        return sendJson(res, 200, { models: await listCliModels(body.provider, env) });
      }
      const apiKey = resolveKey(body.provider, body.apiKey);
      const models = (await listModels({ provider: body.provider, apiKey })).map((id) => ({ id, label: id }));
      sendJson(res, 200, { models });
    } catch (err) {
      sendJson(res, err instanceof HttpError ? err.status : 502, { error: err.message });
    }
  }

  let cliCache = { at: 0, data: null };
  async function cliStatus(force) {
    if (mock) {
      return Object.fromEntries(
        CLI_PROVIDERS.map((p) => [p, { cmd: resolveCmd(p, env), installed: true, version: 'mock', install: '', login: '' }]),
      );
    }
    if (!force && cliCache.data && Date.now() - cliCache.at < 30_000) return cliCache.data;
    const entries = await Promise.all(CLI_PROVIDERS.map(async (p) => [p, await detectCli(p, env)]));
    cliCache = { at: Date.now(), data: Object.fromEntries(entries) };
    return cliCache.data;
  }

  async function handleConfig(res, refresh) {
    sendJson(res, 200, {
      mock,
      version: APP_VERSION,
      cli: await cliStatus(refresh),
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
      'content-security-policy': CSP,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  const historyInfo = async () => {
    const cfg = await history.config();
    return { dir: cfg.dir, enabled: cfg.enabled, count: await history.count() };
  };

  async function handleHistory(req, res, pathname, searchParams) {
    const rel = pathname.slice('/api/history'.length); // '' | '/config' | '/clear' | '/<id>'
    try {
      if (rel === '/config') {
        if (req.method === 'GET') return sendJson(res, 200, await historyInfo());
        if (req.method === 'POST') {
          const b = await readJson(req);
          await history.setConfig({ dir: b.dir, enabled: b.enabled });
          return sendJson(res, 200, await historyInfo());
        }
      } else if (rel === '/clear') {
        if (req.method === 'POST') {
          const b = await readJson(req);
          if (b.confirm !== true) throw new HttpError(400, '확인이 필요합니다.');
          return sendJson(res, 200, await history.clear());
        }
      } else if (rel === '') {
        if (req.method === 'GET') {
          const entries = (await history.list({ q: searchParams.get('q') || '' })).map((m) => ({
            id: m.id,
            date: m.date,
            question: m.question,
            mode: m.mode,
            combo: m.combo,
            status: m.status,
            conclusion: m.conclusion,
            confidence: m.confidence,
            file: m.file,
          }));
          return sendJson(res, 200, { entries });
        }
        if (req.method === 'POST') {
          const b = await readJson(req);
          return sendJson(res, 200, await history.save(b.entry, typeof b.id === 'string' ? b.id : undefined));
        }
      } else if (rel.startsWith('/')) {
        let id;
        try {
          id = decodeURIComponent(rel.slice(1));
        } catch {
          throw new HttpError(400, '잘못된 기록 번호입니다.');
        }
        if (req.method === 'GET') return sendJson(res, 200, await history.get(id));
        if (req.method === 'DELETE') return sendJson(res, 200, await history.remove(id));
      }
    } catch (err) {
      if (err instanceof HistoryError) throw new HttpError(400, err.message);
      throw err;
    }
    throw new HttpError(405, 'Method not allowed');
  }

  return http.createServer(async (req, res) => {
    try {
      guard(req);
      const { pathname, searchParams } = new URL(req.url, 'http://localhost');
      if (pathname.startsWith('/api/')) {
        if (pathname === '/api/config' && req.method === 'GET') return await handleConfig(res, searchParams.has('refresh'));
        if (pathname === '/api/history' || pathname.startsWith('/api/history/')) return await handleHistory(req, res, pathname, searchParams);
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

/** 기본 브라우저로 주소를 연다 (고정 URL 만 전달하므로 셸 인젝션 여지 없음) */
function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
}

/** --log: console 출력을 server.log 에 남긴다 (숨김 실행에서는 창이 없어 로그가 유일한 단서) */
function setupFileLog(file) {
  try {
    if (statSync(file).size > 1_000_000) truncateSync(file, 0);
  } catch {
    /* 파일이 아직 없음 */
  }
  const write = (level, args) => {
    const line = args.map((a) => (typeof a === 'string' ? a : util.inspect(a))).join(' ');
    try {
      appendFileSync(file, `${new Date().toISOString()} ${level} ${line}\n`);
    } catch {
      /* 로그 실패가 서버를 멈추면 안 된다 */
    }
  };
  for (const [name, level] of [['log', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR']]) console[name] = (...a) => write(level, a);
}

/** 포트를 쥔 게 이 앱인지 확인한다 (다른 프로그램이면 브라우저를 열지 않는다) */
async function isOurApp(url) {
  try {
    const res = await fetch(`${url}/api/config`, { signal: AbortSignal.timeout(2000) });
    return res.ok && Boolean((await res.json())?.providers);
  } catch {
    return false;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  loadEnvFile(path.join(ROOT, '.env'));
  const flags = new Set(process.argv.slice(2));
  // 플래그로 받는 이유: `MOCK=1 node ...` 문법은 Windows(cmd/PowerShell)에서 동작하지 않는다
  if (flags.has('--mock')) process.env.MOCK = '1';
  if (flags.has('--log')) setupFileLog(path.join(ROOT, 'server.log'));
  process.on('uncaughtException', (err) => {
    console.error('치명적 오류:', err);
    process.exit(1);
  });

  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT) || 3000;
  const url = `http://${LOOPBACK.has(host) ? 'localhost' : host}:${port}`;
  // 실행 상태 파일: stop.bat(PID)와 start-hidden.vbs(포트)가 읽는다
  const stateDir = process.env.APP_STATE_DIR || ROOT;
  const pidFile = path.join(stateDir, '.server.pid');
  const portFile = path.join(stateDir, '.server.port');

  const server = createAppServer({ host });
  server.on('error', async (err) => {
    if (err.code !== 'EADDRINUSE') {
      console.error('서버 오류:', err);
      process.exit(1);
    }
    // 이미 이 앱이 떠 있으면 새로 띄우지 않고 브라우저만 연다
    if (await isOurApp(url)) {
      console.log(`이미 실행 중입니다 → ${url}`);
      if (flags.has('--open')) openBrowser(url);
      process.exit(0);
    }
    console.error(`포트 ${port} 를 다른 프로그램이 사용 중입니다. .env 에 PORT=3001 처럼 다른 포트를 지정하세요.`);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const mode = process.env.MOCK === '1' ? ' (데모 모드: 실제 AI를 호출하지 않음)' : '';
    console.log(`3 Agents → ${url}${mode}`);
    if (!LOOPBACK.has(host)) console.warn('⚠ 외부 접속이 열려 있습니다. 서버의 API 키를 누구나 사용할 수 있습니다.');
    try {
      writeFileSync(pidFile, String(process.pid));
      writeFileSync(portFile, String(port));
    } catch (err) {
      console.error('상태 파일을 쓰지 못했습니다:', err.message);
    }
    process.on('exit', () => {
      try {
        if (readFileSync(pidFile, 'utf8') === String(process.pid)) {
          unlinkSync(pidFile);
          unlinkSync(portFile);
        }
      } catch {
        /* 이미 지워짐 */
      }
    });
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => process.exit(0));
    if (flags.has('--open')) openBrowser(url);
  });
}

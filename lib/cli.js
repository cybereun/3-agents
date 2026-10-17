import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * 공식 CLI(claude / codex / gemini)를 자식 프로세스로 실행해 "로그인(구독)" 방식으로 질의한다.
 * - 이 앱은 CLI 를 실행만 한다. 토큰·쿠키·자격 증명 파일에는 접근하지 않는다.
 * - 도구 사용은 모두 꺼서(읽기 전용) 순수한 질의응답으로만 쓴다.
 * - 프롬프트는 stdin 으로 전달한다 (인자 길이 제한과 셸 인젝션을 피한다).
 */

const IS_WIN = process.platform === 'win32';
const SAFE_MODEL = /^[\w.:\-/]+$/;
const MAX_OUTPUT = 4 * 1024 * 1024;

// CLI 가 구독 로그인 대신 API 과금 경로를 타지 않도록 자식 프로세스에서 제거
const STRIP_ENV = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY', 'CODEX_API_KEY',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY',
];

const BANNERS = [/^Loaded cached credentials\.?$/i, /^Data collection is (disabled|enabled)\.?$/i];

const STDIN_INSTRUCTION = 'Answer the request above.'; // gemini -p 로 붙는 고정 ASCII 지시문 (Windows 셸 인코딩 안전)

const SPECS = {
  anthropic: {
    cmd: 'claude',
    envName: 'CLAUDE_CMD',
    login: "터미널에서 'claude' 를 실행해 /login 으로 로그인하세요",
    install: 'npm i -g @anthropic-ai/claude-code',
    build({ model, system, systemViaArg }) {
      return {
        args: [
          '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
          '--tools', '', '--no-session-persistence',
          '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands',
          ...(system && systemViaArg ? ['--system-prompt', system] : []),
          ...(model ? ['--model', model] : []),
        ],
        systemInPrompt: Boolean(system) && !systemViaArg,
      };
    },
    parser: claudeParser,
  },
  openai: {
    cmd: 'codex',
    envName: 'CODEX_CMD',
    login: "터미널에서 'codex login' 으로 ChatGPT 계정에 로그인하세요",
    install: 'npm i -g @openai/codex',
    build({ model, outFile }) {
      return {
        args: [
          'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--ignore-user-config',
          '--color', 'never', '-o', outFile,
          ...(model ? ['-m', model] : []),
          '-',
        ],
        systemInPrompt: true, // codex 에는 시스템 프롬프트 옵션이 없다
      };
    },
    parser: codexParser,
    async finish(ctx, acc) {
      const fromFile = await readFile(ctx.outFile, 'utf8').catch(() => '');
      return (fromFile || acc.stdout).trim();
    },
  },
  gemini: {
    cmd: 'gemini',
    envName: 'GEMINI_CMD',
    login: "터미널에서 'gemini' 를 실행해 'Login with Google' 로 로그인하세요",
    install: 'npm i -g @google/gemini-cli',
    build({ model }) {
      return {
        args: ['-p', STDIN_INSTRUCTION, '--skip-trust', '-o', 'text', ...(model ? ['-m', model] : [])],
        systemInPrompt: true,
      };
    },
    parser: geminiParser,
  },
};

/* ---------- 출력 파서 ---------- */

function claudeParser() {
  let buf = '';
  let sawDelta = false;
  let fallback = '';
  let resultText = '';
  let error = '';
  const handle = (line) => {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      return [];
    }
    if (e.type === 'stream_event' && e.event?.type === 'content_block_delta' && e.event.delta?.type === 'text_delta') {
      sawDelta = true;
      return [e.event.delta.text];
    }
    if (e.type === 'assistant') {
      for (const b of e.message?.content ?? []) if (b.type === 'text') fallback += b.text;
    } else if (e.type === 'result') {
      resultText = typeof e.result === 'string' ? e.result : '';
      if (e.is_error) error = resultText || e.subtype || 'error';
    }
    return [];
  };
  return {
    push(s) {
      buf += s;
      const out = [];
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) out.push(...handle(line));
      }
      return out;
    },
    end() {
      if (buf.trim()) this.push('\n');
      if (error) throw new CliError(error);
      return sawDelta ? [] : [fallback || resultText].filter(Boolean);
    },
  };
}

function codexParser() {
  const acc = { stdout: '' };
  return { acc, push: (s) => ((acc.stdout += s), []), end: () => [] };
}

function geminiParser() {
  let pending = '';
  let started = false;
  return {
    push(s) {
      if (started) return [s];
      pending += s;
      for (;;) {
        const nl = pending.indexOf('\n');
        if (nl < 0) break;
        const line = pending.slice(0, nl).trim();
        if (!BANNERS.some((re) => re.test(line))) {
          started = true;
          const out = pending;
          pending = '';
          return [out];
        }
        pending = pending.slice(nl + 1);
      }
      if (pending.length > 80) {
        started = true;
        const out = pending;
        pending = '';
        return [out];
      }
      return [];
    },
    end() {
      started = true;
      const out = pending;
      pending = '';
      return BANNERS.some((re) => re.test(out.trim())) || !out ? [] : [out];
    },
  };
}

/* ---------- 에러 ---------- */

export class CliError extends Error {}

function tail(text, n = 500) {
  const t = text.trim();
  return t.length > n ? '…' + t.slice(-n) : t;
}

function friendlyError(spec, cmd, { code, stderr, parserError }) {
  // 경고 로그가 길어도 핵심 오류 줄이 잘리지 않도록 ERROR 줄을 우선한다
  const errorLine = stderr.split('\n').filter((l) => /\bERROR\b|error:/i.test(l)).at(-1);
  const detail = tail(parserError || errorLine || stderr || '');
  const hay = `${parserError || ''}\n${stderr}`;
  if (/not logged in|please run \/login|log ?in|authenticat|unauthori[sz]ed|auth method|credential|sign in|api key|401/i.test(hay)) {
    return `로그인이 필요합니다. ${spec.login}. (${detail || '인증 오류'})`;
  }
  if (/rate.?limit|usage limit|quota|limit reached|too many requests|429|resource.?exhausted/i.test(hay)) {
    return `구독 사용량 한도에 도달했습니다. 잠시 뒤 다시 시도하세요. (${detail})`;
  }
  if (/unexpected argument|unknown (option|argument)|unrecognized/i.test(hay)) {
    return `'${cmd}' 버전이 오래되어 옵션을 인식하지 못합니다. 최신 버전으로 업데이트하세요: ${spec.install}@latest (${detail})`;
  }
  return `'${cmd}' 실행 실패 (종료 코드 ${code}): ${detail || '출력 없음'}`;
}

/* ---------- 프로세스 유틸 ---------- */

export const winQuote = (a) => (/^[\w.:\-/=\\]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);

export function resolveCmd(provider, env = process.env) {
  const spec = SPECS[provider];
  return (env[spec.envName] || '').trim() || spec.cmd;
}

// npm 전역 설치 CLI 는 Windows 에서 .cmd 셸 스크립트라 셸이 필요하다 (모든 인자는 고정값이거나 검증된 값)
const needsShell = (cmd) => IS_WIN && !/\.exe$/i.test(cmd);

function spawnCli(cmd, args, cwd) {
  const env = { ...process.env };
  for (const k of STRIP_ENV) delete env[k];
  const useShell = needsShell(cmd);
  const child = useShell
    ? spawn([cmd, ...args].map(winQuote).join(' '), { cwd, env, shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn(cmd, args, { cwd, env, detached: !IS_WIN, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  return { child };
}

function killTree(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (IS_WIN) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* 이미 종료됨 */
    }
  }, 3000).unref();
}

let workDir;
async function getWorkDir() {
  // 프로젝트 파일/설정이 없는 빈 디렉터리에서 실행해 컨텍스트 유출과 파일 접근을 막는다
  workDir ??= path.join(os.tmpdir(), '3-agents-cli');
  await mkdir(workDir, { recursive: true });
  return workDir;
}

/** CLI 설치 여부와 버전을 확인한다. */
export async function detectCli(provider, env = process.env) {
  const spec = SPECS[provider];
  const cmd = resolveCmd(provider, env);
  const base = { cmd, install: spec.install, login: spec.login };
  try {
    const { child } = spawnCli(cmd, ['--version'], await getWorkDir());
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (out += d));
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.stdin.end();
    const timer = setTimeout(() => killTree(child), 8000);
    const code = await new Promise((resolve) => {
      child.once('error', () => resolve(-1));
      child.once('close', (c) => resolve(c));
    });
    clearTimeout(timer);
    const version = out.trim().split('\n').pop().slice(0, 60);
    return { ...base, installed: code === 0 && Boolean(version), version };
  } catch {
    return { ...base, installed: false, version: '' };
  }
}

/** CLI 로 질의하고 텍스트 조각을 스트리밍한다. */
export async function* streamCli({ provider, model, system, prompt, signal, env = process.env }) {
  const spec = SPECS[provider];
  if (!spec) throw new Error(`알 수 없는 제공자: ${provider}`);
  if (model && !SAFE_MODEL.test(model)) throw new Error('모델 이름에 허용되지 않는 문자가 있습니다.');
  const cmd = resolveCmd(provider, env);
  const timeoutMs = Number(env.CLI_TIMEOUT_MS) || 300_000;
  const cwd = await getWorkDir();
  const tmp = await mkdtemp(path.join(os.tmpdir(), '3-agents-out-'));
  const outFile = path.join(tmp, 'last-message.txt');

  const built = spec.build({ model, system, outFile, systemViaArg: !needsShell(cmd) });
  // 시스템 프롬프트를 인자로 못 넘기는 경우(codex/gemini/Windows 셸)는 stdin 본문 앞에 붙인다
  const input = system && built.systemInPrompt ? `[지시]\n${system}\n\n[요청]\n${prompt}` : prompt;

  const { child } = spawnCli(cmd, built.args, cwd);
  const parser = spec.parser();
  let stderr = '';
  let spawnError;
  let timedOut = false;
  let size = 0;
  let produced = false;

  child.once('error', (e) => (spawnError = e));
  child.stderr.setEncoding('utf8').on('data', (d) => (stderr = (stderr + d).slice(-8000)));
  child.stdin.on('error', () => {});
  const exited = new Promise((resolve) => {
    child.once('close', resolve);
    child.once('error', () => resolve(-1)); // spawn 실패 시 close 가 오지 않을 수 있다
  });
  const onAbort = () => killTree(child);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ((timedOut = true), killTree(child)), timeoutMs);

  try {
    child.stdin.end(input);
    child.stdout.setEncoding('utf8');
    try {
      for await (const chunk of child.stdout) {
        size += chunk.length;
        if (size > MAX_OUTPUT) {
          killTree(child);
          throw new CliError('출력이 너무 큽니다.');
        }
        for (const t of parser.push(chunk)) {
          produced = true;
          yield t;
        }
      }
    } catch (e) {
      if (!spawnError) throw e; // spawn 실패로 스트림이 깨진 경우는 아래에서 친절한 메시지로 처리
    }
    const code = await exited;

    if (signal?.aborted) throw new Error('aborted');
    if (spawnError) {
      const hint = spawnError.code === 'ENOENT' ? `'${cmd}' 명령을 찾을 수 없습니다. 설치하세요: ${spec.install} — 그리고 ${spec.login}.` : spawnError.message;
      throw new CliError(hint);
    }
    if (timedOut) throw new CliError(`시간 초과 (${Math.round(timeoutMs / 1000)}초). CLI_TIMEOUT_MS 로 늘릴 수 있습니다.`);

    let parserError = '';
    let tailPieces = [];
    try {
      tailPieces = parser.end();
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      parserError = e.message;
    }
    if (parserError || code !== 0) {
      throw new CliError(friendlyError(spec, cmd, { code, stderr, parserError }));
    }
    for (const t of tailPieces) {
      produced = true;
      yield t;
    }
    if (spec.finish) {
      const text = await spec.finish({ outFile }, parser.acc);
      if (text) {
        produced = true;
        yield text;
      }
    }
    if (!produced) throw new CliError(`'${cmd}' 가 빈 응답을 돌려주었습니다. ${tail(stderr, 300)}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    killTree(child);
    rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

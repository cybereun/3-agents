import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, session, shell } from 'electron';
import electronUpdater from 'electron-updater';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killAllChildren } from '../lib/cli.js';
import { loadEnvFile } from '../lib/env.js';
import { createAppServer } from '../server.js';
import { createTokenStore, isValidToken } from './token-store.js';

const { autoUpdater } = electronUpdater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 포트가 바뀌면 브라우저 저장소(설정/API 키)의 출처가 달라져 설정이 사라지므로 고정 포트를 쓴다
const PREFERRED_PORT = 39217;
const REPO = { owner: 'cybereun', repo: '3-agents' };
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const SMOKE = process.argv.includes('--smoke-test');
const SMOKE_OUT = (process.argv.find((a) => a.startsWith('--smoke-out=')) || '').slice('--smoke-out='.length);

if (SMOKE) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), '3agents-smoke-'))); // 실제 사용자 데이터를 건드리지 않는다
app.setAppUserModelId('com.cybereun.three-agents');

let win = null;
let server = null;
let origin = '';
let store = null;
let manualCheck = false;
let downloading = false;
let updateTimer = null;

/* ---------- 로그 ---------- */
function log(...args) {
  const line = `${new Date().toISOString()} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  try {
    const dir = app.getPath('logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'main.log'), line);
  } catch {
    /* 로그 실패는 무시 */
  }
  if (!app.isPackaged) process.stdout.write(line);
}

/* ---------- 서버 ---------- */
async function startServer() {
  loadEnvFile(path.join(app.getPath('userData'), '.env')); // 선택: API 키/CLI 경로 등을 .env 로 지정
  server = createAppServer({ host: '127.0.0.1' });
  const listen = (port) =>
    new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onError);
        resolve(server.address().port);
      });
    });
  try {
    return { port: await listen(PREFERRED_PORT), fallback: false };
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    return { port: await listen(0), fallback: true };
  }
}

/* ---------- 창 ---------- */
function createWindow(port) {
  origin = `http://127.0.0.1:${port}`;
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 820,
    minHeight: 600,
    show: false,
    title: '3 Agents',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0c0f' : '#fafaf9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => !SMOKE && win.show());
  win.on('closed', () => (win = null));
  win.loadURL(`${origin}/`);
  return win;
}

const isHttp = (url) => /^https?:\/\//i.test(url);

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  // 모델 응답의 링크(target=_blank)는 앱 안이 아니라 기본 브라우저로 연다
  contents.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    if (origin && url.startsWith(origin)) return;
    e.preventDefault();
    if (isHttp(url)) shell.openExternal(url);
  });
});

/* ---------- 업데이트 ---------- */
const push = (status) => {
  if (win && !win.isDestroyed()) win.webContents.send('desktop:update-status', status);
};

function plainNotes(notes) {
  const raw = Array.isArray(notes) ? notes.map((n) => n.note ?? '').join('\n') : String(notes ?? '');
  return raw.replace(/<[^>]*>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 600);
}

function configureFeed() {
  const token = store.get();
  autoUpdater.setFeedURL({ provider: 'github', ...REPO, private: true, token: token || undefined });
}

function installAndRestart() {
  killAllChildren(); // 실행 중인 CLI 가 파일을 잡고 있으면 설치가 실패한다
  server?.close();
  autoUpdater.quitAndInstall(true, true); // (조용히 설치, 설치 후 앱 다시 실행)
}

function setupUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

  autoUpdater.on('checking-for-update', () => push({ state: 'checking' }));

  autoUpdater.on('update-available', async (info) => {
    push({ state: 'available', version: info.version });
    const notes = plainNotes(info.releaseNotes);
    const { response } = await dialog.showMessageBox(win ?? undefined, {
      type: 'info',
      title: '3 Agents 업데이트',
      message: `새 버전 ${info.version} 이 있습니다. (현재 ${app.getVersion()})`,
      detail: `${notes ? `${notes}\n\n` : ''}[지금 업데이트]를 누르면 내려받은 뒤 앱이 잠시 종료되고, 자동으로 다시 설치·실행됩니다. 진행 중인 질문은 중단됩니다.`,
      buttons: ['지금 업데이트', '나중에'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return push({ state: 'idle' });
    downloading = true;
    push({ state: 'downloading', percent: 0, version: info.version });
    autoUpdater.downloadUpdate().catch((err) => log('downloadUpdate', err.message));
  });

  autoUpdater.on('update-not-available', () => {
    push({ state: 'none' });
    if (manualCheck) {
      dialog.showMessageBox(win ?? undefined, { type: 'info', title: '3 Agents', message: `최신 버전입니다. (${app.getVersion()})`, buttons: ['확인'] });
    }
  });

  autoUpdater.on('download-progress', (p) => {
    const percent = Math.round(p.percent);
    win?.setProgressBar(p.percent / 100);
    win?.setTitle(`3 Agents — 업데이트 다운로드 ${percent}%`);
    push({ state: 'downloading', percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    push({ state: 'downloaded', version: info.version });
    win?.setProgressBar(-1);
    installAndRestart();
  });

  autoUpdater.on('error', (err) => {
    log('updater error', err?.message);
    win?.setProgressBar(-1);
    win?.setTitle('3 Agents');
    const message = String(err?.message ?? err).split('\n')[0].slice(0, 300);
    push({ state: 'error', message });
    if (manualCheck || downloading) {
      dialog.showErrorBox('업데이트 실패', `${message}\n\n토큰이 만료되었거나 권한(Contents: Read-only)이 없는지 확인하세요. 설정(⚙) → 데스크탑 앱에서 다시 저장할 수 있습니다.`);
    }
    downloading = false;
  });
}

async function checkForUpdates({ manual }) {
  manualCheck = manual;
  if (!app.isPackaged) {
    push({ state: 'dev' });
    if (manual) dialog.showMessageBox(win ?? undefined, { type: 'info', title: '3 Agents', message: '개발 모드에서는 업데이트를 확인하지 않습니다.', buttons: ['확인'] });
    return;
  }
  if (!store.has()) {
    push({ state: 'need-token' });
    if (manual) await askForToken();
    return;
  }
  configureFeed();
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    /* 오류는 'error' 이벤트에서 처리한다 */
  }
}

/** 처음 한 번, 또는 수동 확인 시: 업데이트를 받으려면 토큰이 필요하다고 안내한다 */
async function askForToken() {
  const { response } = await dialog.showMessageBox(win ?? undefined, {
    type: 'info',
    title: '자동 업데이트 설정',
    message: '자동 업데이트를 쓰려면 GitHub 토큰(읽기 전용)이 필요합니다.',
    detail: '이 앱의 저장소는 비공개라서, 업데이트를 확인하려면 이 PC에 토큰을 한 번 저장해야 합니다.\n\n설정(⚙) → 데스크탑 앱에서 토큰을 입력하세요. 토큰은 Windows 보안 저장소(DPAPI)로 암호화되어 이 PC에만 저장됩니다.',
    buttons: ['설정 열기', '나중에'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) win?.webContents.executeJavaScript("document.querySelector('#settingsBtn')?.click()").catch(() => {});
}

function scheduleUpdateChecks() {
  setTimeout(async () => {
    const flag = path.join(app.getPath('userData'), 'token-notice-shown');
    if (!store.has() && !fs.existsSync(flag)) {
      fs.writeFileSync(flag, '1');
      await askForToken(); // 토큰이 없는 PC 에는 처음 한 번만 안내
      return;
    }
    checkForUpdates({ manual: false });
  }, 5000);
  updateTimer = setInterval(() => checkForUpdates({ manual: false }), UPDATE_CHECK_INTERVAL_MS);
}

/* ---------- IPC (우리 화면에서 온 요청만 처리) ---------- */
function trusted(event) {
  return Boolean(origin) && String(event.senderFrame?.url ?? '').startsWith(origin);
}

function setupIpc() {
  ipcMain.handle('desktop:info', async (e) => {
    if (!trusted(e)) return null;
    return { version: app.getVersion(), packaged: app.isPackaged, hasToken: store.has(), canStoreToken: await store.available() };
  });
  ipcMain.handle('desktop:set-token', async (e, token) => {
    if (!trusted(e)) return { ok: false, message: '허용되지 않은 요청입니다.' };
    try {
      if (!isValidToken(token)) throw new Error('토큰 형식이 올바르지 않습니다. 공백 없이 토큰 문자열만 붙여넣으세요.');
      await store.set(token);
      configureFeed();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });
  ipcMain.handle('desktop:clear-token', (e) => {
    if (!trusted(e)) return { ok: false };
    store.clear();
    return { ok: true };
  });
  ipcMain.handle('desktop:check-update', (e) => {
    if (!trusted(e)) return { ok: false };
    checkForUpdates({ manual: true });
    return { ok: true };
  });
}

/* ---------- 메뉴 ---------- */
function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '앱',
        submenu: [
          { label: '업데이트 확인…', click: () => checkForUpdates({ manual: true }) },
          { label: '로그 폴더 열기', click: () => shell.openPath(app.getPath('logs')) },
          { type: 'separator' },
          { label: '종료', role: 'quit' },
        ],
      },
      { label: '편집', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '보기', submenu: [{ role: 'reload' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
    ]),
  );
}

/* ---------- 스모크 테스트 (CI 에서 설치 전 패키지를 검증) ---------- */
async function runSmokeTest(port) {
  const fail = (msg) => {
    fs.writeFileSync(SMOKE_OUT || path.join(os.tmpdir(), 'smoke-result.txt'), `SMOKE-FAIL ${msg}\n`);
    app.exit(1);
  };
  const timer = setTimeout(() => fail('timeout'), 60_000);
  try {
    await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    const cfg = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
    if (cfg.version !== app.getVersion()) throw new Error(`version mismatch ${cfg.version} != ${app.getVersion()}`);
    const run = (code) => win.webContents.executeJavaScript(code);
    if ((await run('document.title')) !== '3 Agents') throw new Error('title');
    for (let i = 0; i < 60 && !(await run("Boolean(document.querySelector('.chip'))")); i++) await new Promise((r) => setTimeout(r, 250));
    if (!(await run("Boolean(document.querySelector('.chip'))"))) throw new Error('UI did not render (script/CSP problem?)');
    const info = await run('window.desktop.getInfo()');
    if (info?.version !== app.getVersion()) throw new Error('preload bridge');
    clearTimeout(timer);
    fs.writeFileSync(SMOKE_OUT || path.join(os.tmpdir(), 'smoke-result.txt'), `SMOKE-OK version=${app.getVersion()} packaged=${app.isPackaged} port=${port}\n`);
    app.exit(0);
  } catch (err) {
    fail(err.message);
  }
}

/* ---------- 시작/종료 ---------- */
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    store = createTokenStore({ dir: app.getPath('userData'), safeStorage });
    setupIpc();
    buildMenu();
    const { port, fallback } = await startServer();
    createWindow(port);
    log('started', { version: app.getVersion(), port, packaged: app.isPackaged });
    if (SMOKE) return runSmokeTest(port);
    if (fallback) {
      dialog.showMessageBox(win, {
        type: 'warning',
        title: '3 Agents',
        message: `기본 포트(${PREFERRED_PORT})를 다른 프로그램이 사용 중이라 임시 포트로 실행했습니다.`,
        detail: '이 경우 저장된 설정(API 키, 모델 선택)이 보이지 않을 수 있습니다. 포트를 사용하는 프로그램을 종료한 뒤 다시 실행하세요.',
      });
    }
    setupUpdater();
    if (app.isPackaged) scheduleUpdateChecks();
  });

  app.on('before-quit', () => {
    clearInterval(updateTimer);
    killAllChildren();
    server?.close();
  });
  app.on('window-all-closed', () => app.quit());
}

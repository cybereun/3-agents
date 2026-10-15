import { readFileSync } from 'node:fs';

/** 의존성 없는 .env 로더. 이미 설정된 환경변수는 덮어쓰지 않는다. */
export function loadEnvFile(file, target = process.env) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);
    if (target[key] === undefined || target[key] === '') target[key] = val;
  }
}

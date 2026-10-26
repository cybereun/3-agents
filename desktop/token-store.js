import fs from 'node:fs';
import path from 'node:path';

// GitHub 토큰(ghp_..., github_pat_...) 모양만 허용한다. 공백/따옴표 등은 거부.
const TOKEN_RE = /^[A-Za-z0-9_-]{20,255}$/;

export const isValidToken = (t) => typeof t === 'string' && TOKEN_RE.test(t);

/**
 * 업데이트용 GitHub 토큰 저장소.
 * OS 암호화(safeStorage: Windows DPAPI)로만 저장하고, 암호화를 쓸 수 없으면 저장을 거부한다 (평문 저장 없음).
 * 의존성(safeStorage, fs)을 주입받아 테스트할 수 있다.
 */
export function createTokenStore({ dir, safeStorage, fsImpl = fs }) {
  const file = path.join(dir, 'update-token.bin');
  const store = {
    /** 새 API(isAsyncEncryptionAvailable)가 있으면 우선 사용 — 구 API 는 곧 제거될 예정이다 */
    async available() {
      try {
        if (typeof safeStorage.isAsyncEncryptionAvailable === 'function') return Boolean(await safeStorage.isAsyncEncryptionAvailable());
        return Boolean(safeStorage.isEncryptionAvailable());
      } catch {
        return false;
      }
    },
    has: () => fsImpl.existsSync(file),
    get() {
      try {
        if (!fsImpl.existsSync(file)) return '';
        return safeStorage.decryptString(fsImpl.readFileSync(file));
      } catch {
        return ''; // 다른 계정/PC에서 복사된 파일 등 복호화 불가
      }
    },
    async set(token) {
      if (!isValidToken(token)) throw new Error('토큰 형식이 올바르지 않습니다. 공백 없이 토큰 문자열만 붙여넣으세요.');
      if (!(await store.available())) throw new Error('이 PC에서는 토큰을 안전하게 암호화해 저장할 수 없습니다.');
      fsImpl.mkdirSync(dir, { recursive: true });
      fsImpl.writeFileSync(file, safeStorage.encryptString(token), { mode: 0o600 });
    },
    clear() {
      fsImpl.rmSync(file, { force: true });
    },
  };
  return store;
}

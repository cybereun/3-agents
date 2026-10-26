import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAppServer, APP_VERSION } from '../server.js';

test('서버: /api/config 에 앱 버전이 있고 package.json 과 같다, 정적 응답에 CSP 가 붙는다', async () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(APP_VERSION, pkg.version);
  const server = createAppServer({ env: { MOCK: '1' } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await (await fetch(`${base}/api/config`)).json()).version, pkg.version);
    const csp = (await fetch(`${base}/`)).headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.ok(!/unsafe-eval|script-src[^;]*unsafe-inline/.test(csp), '스크립트에는 unsafe-* 를 허용하지 않는다');
  } finally {
    server.close();
  }
});

test('업데이트 설정: 공개 저장소 방식(토큰/private 없음), 설치 파일 이름 규칙이 latest.yml 과 맞는다', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const [publish] = pkg.build.publish;
  assert.deepEqual(publish, { provider: 'github', owner: 'cybereun', repo: '3-agents' });
  assert.ok(!('private' in publish) && !('token' in publish), '공개 저장소이므로 private/token 설정이 없어야 한다');
  assert.equal(pkg.build.nsis.artifactName, '3-Agents-Setup-${version}.exe', '워크플로의 업로드 파일명과 같아야 한다');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test('릴리스 워크플로: main 푸시에서만, 한 번에 하나씩 실행한다', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  assert.match(yml, /branches: \[main\]/);
  assert.match(yml, /concurrency:\s+group: release\s+cancel-in-progress: false/);
  assert.ok(!yml.includes("'**'"), '모든 브랜치에서 릴리스하면 안 된다');
});

test('저작권 표기: LICENSE, package.json, README 에 일관되게 들어 있다', () => {
  const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.license, 'UNLICENSED');
  assert.match(pkg.build.copyright, /Copyright © 2026 cybereun/);
  assert.match(read('LICENSE'), /Copyright \(c\) 2026 cybereun\. All rights reserved\./);
  const readme = read('README.md');
  assert.match(readme, /Copyright © 2026 cybereun\. All rights reserved\./);
  assert.match(readme, /badge\/Developer-cybereun/);
  assert.ok(!/@[\w.-]+\.(com|net|kr)/.test(readme), 'README 에 개인 이메일 주소를 넣지 않는다');
  assert.ok(readme.includes(`v${pkg.version}`), '릴리스 히스토리에 현재 버전이 있어야 한다');
});

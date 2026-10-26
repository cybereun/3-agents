# 3 Agents

ChatGPT · Gemini · Claude 에게 **동시에 질문**하고, 세 답변을 **한 화면에서 비교**한 뒤, 충돌 지점까지 드러낸 **하나의 합의 답변**을 만들어 주는 앱.

![logo](public/icons/icon-192.png)

## 실행 (로그인 방식, API 키 불필요)

ChatGPT·Claude는 공식 CLI를 **한 번만 설치·로그인**해 두면, 앱이 그 CLI를 실행해 구독 계정으로 질의합니다. **Gemini는 API 키만 지원**합니다(아래 참고).

```bash
npm i -g @anthropic-ai/claude-code @openai/codex

claude          # 실행 후 /login  → Claude 구독 계정
codex login     # → ChatGPT 계정

npm start       # → http://127.0.0.1:3000   (설치된 CLI는 자동 감지)
```

**Gemini**: Google이 개인 계정(AI Pro/Ultra 포함)의 Gemini CLI 로그인을 2026-06-18에 종료했습니다([공지](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)). [Google AI Studio](https://aistudio.google.com/apikey)에서 API 키를 발급해 앱 설정(⚙) → Gemini에 입력하세요.
다른 제공자도 API 키 방식을 쓰려면 `cp .env.example .env` 후 키를 넣거나, 앱 설정에서 **API 키**를 고르세요.

- 의존성 없음. Node 20+ 만 있으면 됩니다.
- 로그인·키 없이 화면만 체험: `npm run dev` (데모 모드, 실제 AI를 호출하지 않음)
- 테스트: `npm test`
- 크롬/엣지에서 주소창의 **설치** 버튼을 누르면 독립 창 앱(PWA)으로 쓸 수 있습니다.

## 설치형 데스크탑 앱 (Windows)

### 설치 (다른 PC 포함)

1. 브라우저에서 GitHub에 **로그인**한 뒤 이 저장소의 **Releases** → 최신 버전의 `3-Agents-Setup-x.y.z.exe` 를 내려받습니다. (저장소가 비공개라 로그인해야 보입니다)
2. 실행하면 관리자 권한 없이 설치되고 바탕화면/시작 메뉴에 **3 Agents** 가 생깁니다. 서명되지 않은 파일이라 Windows SmartScreen 경고가 뜨면 **추가 정보 → 실행** 을 누르세요.
3. **PC마다 CLI 설치와 로그인은 따로 필요합니다**: `npm i -g @anthropic-ai/claude-code @openai/codex` 후 `claude`(/login), `codex login`. Gemini 는 앱 설정에 API 키를 입력합니다. (Node.js 는 앱에 포함되어 있어 따로 설치하지 않아도 됩니다. CLI 설치용으로만 필요합니다.)

### 자동 업데이트

- 앱을 켜면 새 버전을 확인하고, 있으면 **업데이트 창**이 뜹니다. **[지금 업데이트]** 를 누르면 내려받기 → 설치 → 앱 재실행이 자동으로 진행됩니다. 설정(⚙)/설정 값(API 키, 모델 선택)은 그대로 유지됩니다.
- 저장소가 비공개라서, **PC마다 읽기 전용 GitHub 토큰을 한 번** 저장해야 업데이트를 받을 수 있습니다.
  1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token
  2. Repository access: **Only select repositories → 3-agents**, Permissions: **Contents: Read-only** (이 권한만)
  3. 앱의 설정(⚙) → **데스크탑 앱** → 토큰 붙여넣기 → 저장. 토큰은 Windows 보안 저장소(DPAPI)로 암호화되어 이 PC에만 저장되며 화면에서 다시 볼 수 없습니다.
- 설정(⚙) → 데스크탑 앱 → **업데이트 확인** 으로 수동 확인할 수 있습니다. 로그: 메뉴 앱 → **로그 폴더 열기**.

### 새 버전 배포 (개발자)

```powershell
npm version patch --no-git-tag-version   # 0.1.0 → 0.1.1  (minor/major 도 가능)
git add -A; git commit -m "v0.1.1: 변경 내용"
git push
```

push 하면 GitHub Actions(`release.yml`)가 테스트 → Windows 설치 파일 빌드 → **패키지 스모크 테스트** → GitHub Release 업로드까지 자동으로 합니다. 같은 버전의 릴리스가 이미 있으면 빌드하지 않으므로, **`package.json` 의 version 을 올리지 않으면 새 릴리스가 생기지 않고 앱도 업데이트를 인식하지 못합니다.**

로컬에서 데스크탑 앱 실행/빌드: `npm install` → `npm run desktop` / `npm run dist`

## 모델 선택과 실제 모델 확인

- 설정(⚙)에서 ChatGPT·Claude의 **모델을 드롭다운으로 고릅니다.** 기본값 "자동"은 로그인한 계정의 기본 모델을 씁니다.
  - ChatGPT: `codex debug models` 로 **내 CLI가 실제로 제공하는 목록**을 읽어 옵니다. (오래된 codex 는 목록을 못 줄 수 있으니 `npm i -g @openai/codex@latest`)
  - Claude: 최신 별칭(`fable`/`opus`/`sonnet`/`haiku`)과 전체 ID. CLI에 목록 명령이 없어 앱에 내장된 목록이라, 새 모델은 **직접 입력…** 으로 쓰세요.
- **카드의 모델명은 CLI/API가 알려준 실제 응답 모델**입니다. 별칭이나 "자동"을 골라도 어떤 모델이 답했는지 보이고, 합의 패널에도 조정 AI의 실제 모델이 표시됩니다.
- 설정창에는 제공자별 **최근 실제 응답 모델**이 함께 표시됩니다.

## 결과 화면 (탭 3개)

| 탭 | 내용 |
| --- | --- |
| 개별 답변 | 세 AI의 답변을 나란히 (토론 합의면 수정 입장 포함) |
| 합의 답변 | 최종 답변 · 합의 현황(일치/충돌/단일 출처) · 신뢰도 |
| 한눈에 보기 | 결론, 신뢰도 게이지, 핵심 포인트, 일치/충돌/단일 출처 개수, 직접 확인할 일 |

- 인포그래픽은 합의 호출 1회에 **요약 JSON을 함께 받아** 그립니다. 추가 호출이 없어 구독 사용량이 늘지 않습니다.
- 합의 AI가 JSON 형식을 지키지 않으면 합의 답변 본문의 섹션에서 추출해 그리고, 그 사실을 화면에 표시합니다.
- 퍼센트 같은 수치는 그리지 않습니다. 모델이 지어낸 값이기 때문에 **개수와 문장**만 보여줍니다.

## 합의 방식

| 모드 | 흐름 | API 호출 |
| --- | --- | --- |
| 빠른 합의 | 3개 병렬 답변 → 조정 AI가 종합 | 4회 |
| 토론 합의 | 3개 병렬 답변 → 서로의 답변을 읽고 수정 → 종합 | 7회 |

- 종합 단계에서는 답변을 **A/B/C 기호로 익명화**해 브랜드 편향(특히 조정 AI가 자기 답을 편드는 경향)을 줄입니다.
- 종합 결과는 `최종 답변 / 합의 현황(일치·충돌·단일 출처) / 신뢰도` 구조입니다.
- 한 AI가 실패해도 나머지 2개 이상이면 합의를 진행합니다.

## Windows 설치 (PowerShell)

```powershell
# 1) Node.js 22 LTS 와 Git for Windows 설치 (Claude Code 가 Git Bash 를 필요로 합니다)
winget install OpenJS.NodeJS.LTS Git.Git

# 2) CLI 2종 설치 후 각각 한 번씩 로그인
npm i -g @anthropic-ai/claude-code @openai/codex
claude        # /login
codex login
# Gemini 는 앱 설정(⚙)에 API 키 입력

# 3) 실행: start.bat 더블클릭 (또는 npm start) → 브라우저가 자동으로 열립니다
```

### 창 없이 실행하기 (숨김 실행)

```powershell
.\create-shortcuts.bat      # 바탕화면에 "3 Agents" / "3 Agents Stop" 바로가기를 만듭니다 (한 번만)
```

| 하고 싶은 것 | 방법 |
| --- | --- |
| 켜기 | 바탕화면 **3 Agents** 더블클릭 → 터미널 창 없이 서버가 켜지고 브라우저가 열립니다 |
| 이미 켜져 있을 때 | 다시 더블클릭하면 서버를 또 띄우지 않고 브라우저만 엽니다 |
| 끄기 | 바탕화면 **3 Agents Stop** 더블클릭 (또는 폴더의 `stop.bat`) |
| 안 켜질 때 | 팝업이 뜹니다 → 폴더의 `server.log` 를 확인하세요 (Node 22+ 설치 여부 포함) |

- 서버는 **창을 닫아도 계속 실행**됩니다. 쓰지 않을 때는 Stop 으로 끄세요.
- `stop.bat` 은 `.server.pid` 에 기록된 **이 앱의 프로세스만** 종료합니다 (node.exe 인지 확인 후, CLI 자식 프로세스까지 정리).
- 업데이트(`git pull`) 후에는 Stop → 다시 켜기를 해야 반영됩니다.
- PC를 켤 때마다 자동으로 켜고 싶다면 `Win+R` → `shell:startup` 폴더에 "3 Agents" 바로가기를 복사하세요. (로그인 시 브라우저가 열립니다.)

- `npm run dev` 는 데모 모드입니다 (로그인·키 없이 화면만 확인).
- 'running scripts is disabled' 오류는 PowerShell 정책 문제입니다. 앱은 `cmd.exe` 로 CLI 를 실행하므로 영향이 없지만, 터미널에서 직접 `claude` 를 실행할 때 나면 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 로 해결합니다.
- 설정(⚙)에서 CLI 가 '찾을 수 없음'으로 나오면, 새 터미널을 연 뒤 `where claude` 로 경로를 확인하고 `.env` 에 `CLAUDE_CMD=전체경로` 로 지정하세요.
- Windows 에서는 자동 테스트의 가짜 CLI 항목이 건너뛰어집니다 (실제 CLI 연동은 직접 질문해 확인).

## 연결 방식: 로그인(CLI) vs API 키

| | 로그인(CLI) | API 키 |
| --- | --- | --- |
| 비용 | 기존 구독 사용량에서 차감 | 호출당 종량 과금 |
| 스트리밍 | Claude 지원, Codex는 완료 후 한꺼번에 | 3사 모두 |
| 속도 | 호출마다 CLI 기동 시간(수 초) 추가 | 빠름 |
| 모델 | 비우면 로그인한 계정의 기본 모델 | 목록 조회 후 선택 |
| 안정성 | CLI 버전·옵션 변화에 영향 | 공식 API 계약 |

CLI 호출(ChatGPT·Claude)은 안전하게 격리됩니다: 도구/MCP/플러그인 비활성, 읽기 전용, 빈 임시 폴더에서 실행, 프롬프트는 stdin 전달.
`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` 등 API 키 환경변수는 자식 프로세스에서 제거해서, 실수로 구독 대신 API 과금 경로를 타지 않게 합니다.

## 주의할 점

- **구독 사용량을 빠르게 씁니다.** 질문 1개 = CLI 4회(빠른 합의) 또는 7회(토론 합의). 사용량 한도(5시간/주간 등)에 걸리면 해당 카드에 한도 초과 메시지가 뜹니다.
- **개인 사용 전용으로 쓰세요.** 이 앱은 공식 CLI를 *실행만* 하고 토큰·쿠키·자격 증명 파일은 읽지 않습니다. 구독 토큰을 꺼내 다른 앱이나 서버에서 대신 쓰는 방식은 각 사 약관이 금지하거나 제한합니다(특히 Anthropic). 이 서버를 다른 사람과 공유하지 마세요.
- CLI의 약관·옵션은 바뀔 수 있습니다. 오류가 나면 카드의 메시지를 먼저 확인하세요(미설치·미로그인·한도·버전 오래됨을 구분해 안내합니다).
- 세 모델이 **일치한다고 맞는 것은 아닙니다.** 같은 학습 데이터의 같은 오류를 공유할 수 있습니다. 사실 확인이 필요한 답은 '신뢰도'와 '단일 출처' 항목을 보고 직접 검증하세요.
- 모델명은 자주 바뀝니다. 기본값은 `.env.example` 에 있고, 404가 나면 설정 창의 **목록 불러오기**로 내 키로 쓸 수 있는 모델을 고르세요.

## 웹앱 vs 데스크탑앱

**결론: 웹앱(로컬 서버 + PWA)으로 시작하세요.**

| | 웹앱 | 데스크탑앱 (Electron/Tauri) |
| --- | --- | --- |
| 개발·수정 속도 | 빠름 (이 저장소 그대로) | 래핑·빌드·서명 추가 |
| 배포 | URL 하나 | 설치 파일, 코드 서명, 자동 업데이트 직접 구축 |
| 여러 기기 | 브라우저면 어디서든 | OS별 빌드 |
| API 키 보관 | 서버 `.env` | OS 키체인 (더 안전) |
| 전역 단축키·트레이 | 불가 | 가능 |

데스크탑이 필요해지는 경우는 ① 전역 단축키로 어디서나 호출 ② OS 키체인에 키 저장 ③ 파일 시스템 접근 정도입니다. 그때 이 `public/` 을 Tauri/Electron 에 그대로 올리면 됩니다.

**공개 배포 금지:** 이 서버는 인증이 없습니다. 서버 키를 넣은 채 인터넷에 열면 누구나 내 키로 호출합니다. 기본 바인딩은 `127.0.0.1` 이고, Origin/Host 검사로 다른 사이트가 로컬 서버를 두드리는 것을 막습니다. 공개하려면 로그인과 사용량 제한을 먼저 붙여야 합니다.

## 구조

```
server.js            정적 파일 + /api/chat(NDJSON 스트림) /api/models /api/config
lib/providers.js     OpenAI · Gemini · Anthropic API 스트리밍 어댑터, 모델 목록, 데모 모드
desktop/             Electron 앱 (main.js, preload, 토큰 저장소) — 자동 업데이트
lib/cli.js           claude · codex CLI 실행 어댑터 (격리, 파싱, 중단/타임아웃)
public/              index.html · styles.css · app.js · markdown.js · summary.js · infographic.js · icons/
scripts/make-icons   SVG → PNG 아이콘 생성 (개발용, playwright 필요)
test/                node:test (렌더러 XSS, 요약 파서, API/CLI 어댑터, 서버 보안) + test/fixtures 가짜 CLI
```

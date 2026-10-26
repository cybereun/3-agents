<div align="center">

<img src="public/icons/icon-192.png" width="96" alt="3 Agents 로고" />

# 3 Agents

**ChatGPT · Gemini · Claude 에게 한 번에 묻고, 세 답변을 하나로 합의시키는 앱**

[![Developer](https://img.shields.io/badge/Developer-cybereun-181717?style=for-the-badge&logo=github)](https://github.com/cybereun)

[![Release](https://img.shields.io/github/v/release/cybereun/3-agents?label=release&color=5b6cff)](https://github.com/cybereun/3-agents/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/cybereun/3-agents/total?color=10a37f)](https://github.com/cybereun/3-agents/releases)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2022-339933)
![Copyright](https://img.shields.io/badge/%C2%A9%202026-cybereun-e8794b)
![License](https://img.shields.io/badge/license-All%20Rights%20Reserved-lightgrey)

[**⬇ 최신 설치 파일 받기**](https://github.com/cybereun/3-agents/releases/latest)

</div>

---

## 개발자

| | |
| --- | --- |
| **개발자** | [cybereun](https://github.com/cybereun) |
| **저장소** | https://github.com/cybereun/3-agents |
| **문의 · 버그 제보** | [GitHub Issues](https://github.com/cybereun/3-agents/issues) |

## 저작권

**Copyright © 2026 cybereun. All rights reserved.**

이 소프트웨어(소스 코드, 디자인, 아이콘, 설치 파일 포함)의 저작권은 개발자 **cybereun** 에게 있습니다. 저작권자의 서면 허가 없이 복제·수정·재배포·상업적 이용을 할 수 없으며, 설치해서 개인적으로 사용하는 것만 허용됩니다. 자세한 내용은 [LICENSE](LICENSE) 를 확인하세요.

- 이 앱은 [Electron](https://www.electronjs.org/)(MIT) 등 오픈소스 구성요소를 포함하며, 해당 구성요소는 각자의 라이선스를 따릅니다. (설치 폴더의 `LICENSE.electron.txt`, `LICENSES.chromium.html` 참고)
- ChatGPT·OpenAI, Claude·Anthropic, Gemini·Google 은 각 사의 상표입니다. 이 앱은 해당 회사들과 **제휴·후원 관계가 없는 비공식 도구**입니다.

---

## 이런 앱입니다

한 번 질문하면 세 AI가 **동시에** 답하고, 그 답들을 비교해 **충돌하는 지점까지 드러낸 하나의 합의 답변**을 만들어 줍니다.

### 주요 특징

- **3개 AI 동시 질의** — ChatGPT, Gemini, Claude 의 답변을 한 화면에서 나란히 스트리밍으로 봅니다. 한 AI가 실패해도 나머지 2개 이상이면 합의를 진행합니다.
- **합의 답변** — 답변을 익명(A/B/C)으로 만들어 브랜드 편향을 줄이고, `최종 답변 · 일치/충돌/단일 출처 · 신뢰도` 구조로 종합합니다.
- **두 가지 합의 방식** — *빠른 합의*(종합만) / *토론 합의*(서로의 답을 읽고 수정한 뒤 종합).
- **결과 탭 3개** — `개별 답변` / `합의 답변` / `한눈에 보기`(결론·신뢰도·핵심 포인트·직접 확인할 일을 한 장으로 보여주는 인포그래픽).
- **구독 로그인(CLI) 방식** — 이미 쓰는 ChatGPT·Claude 구독을 공식 CLI 로 실행해 쓸 수 있어 API 키가 필요 없습니다. (Gemini 는 API 키)
- **실제 응답 모델 표시** — 별칭이나 "자동"을 골라도 카드에 어떤 모델이 실제로 답했는지 보입니다. 설정에서 모델을 드롭다운으로 고릅니다.
- **자동 업데이트** — 새 버전이 나오면 업데이트 창이 뜨고, 버튼 한 번으로 내려받기 → 설치 → 재실행까지 진행됩니다.
- **로컬 우선 · 안전** — 서버는 내 PC(`127.0.0.1`)에서만 열리고, 다른 웹사이트가 호출하지 못하게 막습니다. CLI 는 도구를 끈 읽기 전용으로 실행합니다.
- 미니멀 디자인, 라이트/다크 자동, 반응형.

---

## 설치 방법 (Windows)

### 방법 1. 설치 파일 (권장)

1. [**Releases**](https://github.com/cybereun/3-agents/releases/latest) 에서 `3-Agents-Setup-x.y.z.exe` 를 내려받아 실행합니다.
2. 관리자 권한 없이 설치되고, 바탕화면과 시작 메뉴에 **3 Agents** 가 생깁니다.
   - 서명되지 않은 파일이라 Windows SmartScreen 경고가 뜰 수 있습니다. **추가 정보 → 실행** 을 누르세요.
3. **AI 연결을 한 번만 설정합니다.** 앱에는 Node.js 가 포함되어 있지만, CLI 는 PC마다 따로 설치·로그인해야 합니다.

   ```powershell
   winget install OpenJS.NodeJS.LTS Git.Git        # CLI 설치용 (Claude Code 는 Git for Windows 필요)
   npm i -g @anthropic-ai/claude-code @openai/codex
   claude        # 실행 후 /login  → Claude 구독 계정
   codex login   # → ChatGPT 계정
   ```
   Gemini 는 [Google AI Studio](https://aistudio.google.com/apikey) 에서 API 키를 발급해 앱의 **설정(⚙) → Gemini** 에 입력합니다.
   (Google 이 개인 계정의 Gemini CLI 로그인을 2026-06-18 에 종료해 API 키만 지원합니다. [공지](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals))
4. 앱을 열고 설정(⚙)에서 CLI 가 **감지됨**으로 보이는지 확인한 뒤 질문하세요.

### 방법 2. 소스에서 실행 (개발자용)

```powershell
git clone https://github.com/cybereun/3-agents.git
cd 3-agents
npm start            # → http://127.0.0.1:3000   (Node.js 22 이상, 별도 설치 패키지 없음)
npm run dev          # 데모 모드: 로그인·키 없이 화면만 확인
```

---

## 자동 업데이트

- 앱을 켠 뒤 5초 후, 그리고 4시간마다 새 버전을 확인합니다.
- 새 버전이 있으면 **업데이트 창**이 뜹니다. **[지금 업데이트]** 를 누르면 내려받기 → 설치 → 앱 재실행이 자동으로 진행되고, 설정(API 키, 모델 선택)은 유지됩니다.
- 로그인이나 토큰은 필요 없습니다. 설정(⚙) → 데스크탑 앱 → **업데이트 확인**으로 수동 확인할 수 있고, 로그는 메뉴 *앱 → 로그 폴더 열기*에서 봅니다.
- 업데이트하면 앱이 종료되므로 진행 중인 질문은 중단됩니다.

> **0.1.0 을 쓰고 있다면**: 0.1.0 은 비공개 저장소용 업데이트 방식이라 자동 업데이트가 되지 않습니다. 최신 설치 파일을 한 번 직접 설치(덮어쓰기)하면 그 뒤로는 자동입니다.

---

## 릴리스 히스토리

전체 목록과 설치 파일: [Releases](https://github.com/cybereun/3-agents/releases)

### v0.2.0 — 2026-10-26
- **자동 업데이트를 공개 저장소 방식으로 변경** — 토큰·로그인 없이 업데이트를 확인합니다. (토큰 입력 UI와 저장 코드 제거)
- 설정 화면과 푸터에 **앱 버전** 표시.
- 릴리스 자동화 정리: `main` 에서만 릴리스, 동시 실행 방지, 릴리스 노트가 업데이트 창에 표시됩니다.
- 0.1.0 에서 저장한 업데이트 토큰이 있으면 첫 실행 때 자동으로 삭제합니다.

### v0.1.0 — 2026-10-26 · 첫 설치형 릴리스
- **Windows 설치 파일(.exe)** — 관리자 권한 없이 설치, 단일 인스턴스, 고정 포트로 설정 유지.
- 업데이트 창 → 내려받기 → 자동 설치 → 재실행 (비공개 저장소용 토큰 방식).
- 보안: 샌드박스·컨텍스트 격리, CSP 헤더, 외부 링크는 기본 브라우저로, 업데이트 직전 실행 중인 CLI 정리.
- GitHub Actions 로 Windows 빌드·패키지 스모크 테스트·릴리스 업로드 자동화.

### 릴리스 이전 개발 이력 (웹 버전)
- **2026-10-17** — 결과 탭 3개와 인포그래픽(`한눈에 보기`) · 모델 선택 드롭다운과 실제 응답 모델 표시 · 창 없는 숨김 실행 · Gemini 를 API 키 전용으로 변경 · Windows 지원 보강(`start.bat`).
- **2026-10-15** — 첫 버전: 3개 AI 동시 질의, 합의 답변(빠른/토론), 로그인(CLI) 연결 방식.

---

## 알아둘 점

- **구독 사용량을 빠르게 씁니다.** 질문 1개 = 호출 4회(빠른 합의) 또는 7회(토론 합의)입니다. 한도에 걸리면 해당 카드에 한도 초과 메시지가 뜹니다.
- **세 AI가 일치해도 사실이라는 보장은 없습니다.** 같은 오류를 공유할 수 있으니 중요한 판단은 '신뢰도'와 '단일 출처'를 보고 직접 검증하세요. 인포그래픽은 AI가 만든 요약입니다.
- **개인 사용 전용으로 쓰세요.** 이 앱은 공식 CLI 를 *실행만* 하고 토큰·쿠키·자격 증명 파일은 읽지 않습니다. 구독 로그인을 다른 사람과 공유하거나 서버로 옮기는 방식은 각 사 약관이 금지하거나 제한합니다.
- 서버는 `127.0.0.1` 에서만 열립니다. 포트를 외부에 열지 마세요(로그인이 없고 내 구독을 대신 씁니다).

---

## 개발자 가이드

<details>
<summary><b>연결 방식: 로그인(CLI) vs API 키</b></summary>

| | 로그인(CLI) | API 키 |
| --- | --- | --- |
| 비용 | 기존 구독 사용량에서 차감 | 호출당 종량 과금 |
| 스트리밍 | Claude 지원, Codex는 완료 후 한꺼번에 | 3사 모두 |
| 속도 | 호출마다 CLI 기동 시간(수 초) 추가 | 빠름 |
| 모델 | 비우면 로그인한 계정의 기본 모델 | 목록 조회 후 선택 |

CLI 호출은 도구/MCP/플러그인을 끄고 읽기 전용으로, 빈 임시 폴더에서, 프롬프트는 stdin 으로 전달합니다. `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` 등 API 키 환경변수는 자식 프로세스에서 제거해 구독 대신 API 과금 경로를 타지 않게 합니다.
</details>

<details>
<summary><b>모델 선택과 실제 모델 확인</b></summary>

- ChatGPT: `codex debug models` 로 내 CLI 가 제공하는 목록을 읽어 옵니다. (오래된 codex 는 `npm i -g @openai/codex@latest`)
- Claude: 최신 별칭(`fable`/`opus`/`sonnet`/`haiku`)과 전체 ID. 새 모델은 *직접 입력…* 으로 사용합니다.
- 카드의 모델명은 CLI/API 가 알려준 **실제 응답 모델**이며, 합의 패널에는 조정 AI 의 실제 모델이 표시됩니다.
</details>

<details>
<summary><b>합의 방식과 결과 화면</b></summary>

| 모드 | 흐름 | 호출 수 |
| --- | --- | --- |
| 빠른 합의 | 3개 병렬 답변 → 조정 AI 가 종합 | 4회 |
| 토론 합의 | 3개 병렬 답변 → 서로의 답변을 읽고 수정 → 종합 | 7회 |

인포그래픽은 합의 호출 1회에 **요약 JSON 을 함께 받아** 그립니다(추가 호출 없음). 형식을 지키지 않으면 합의 본문의 섹션에서 추출하고 화면에 표시합니다. 퍼센트 같은 수치는 모델이 지어낸 값이라 그리지 않고 **개수와 문장**만 보여줍니다.
</details>

<details>
<summary><b>웹으로 실행: 창 없이 실행(숨김 실행)</b></summary>

설치 파일 대신 소스로 쓸 때:

```powershell
.\start.bat                  # 터미널 창과 함께 실행
.\create-shortcuts.bat       # 바탕화면에 "3 Agents" / "3 Agents Stop" 바로가기 생성 (한 번만)
```

`3 Agents` 바로가기는 창 없이 서버를 켜고 브라우저를 열며, 이미 켜져 있으면 브라우저만 엽니다. 안 켜지면 팝업과 `server.log` 로 알려줍니다. `3 Agents Stop`(또는 `stop.bat`)은 `.server.pid` 의 이 앱 프로세스만 종료합니다.
</details>

<details>
<summary><b>새 버전 배포</b></summary>

```powershell
npm version patch --no-git-tag-version   # 0.2.0 → 0.2.1  (minor/major 도 가능)
# release-notes\0.2.1.md 에 이번 변경 내용을 쓰면 업데이트 창과 릴리스에 표시됩니다
git add -A; git commit -m "v0.2.1: 변경 내용"
git push origin main
```

`main` 에 push 하면 GitHub Actions(`release.yml`)가 테스트 → Windows 설치 파일 빌드 → **패키지 스모크 테스트** → 릴리스 업로드를 자동으로 합니다. **`package.json` 의 version 을 올리지 않으면 새 릴리스가 생기지 않고 앱도 업데이트를 인식하지 못합니다.** 브랜치 push 만으로는 릴리스가 생기지 않으니 `main` 으로 합쳐야 합니다.

로컬 실행/빌드: `npm install` → `npm run desktop` / `npm run dist` · 테스트: `npm test`
</details>

<details>
<summary><b>프로젝트 구조</b></summary>

```
server.js            정적 파일 + /api/chat(NDJSON 스트림) /api/models /api/config
desktop/             Electron 앱 (main.js, preload) — 자동 업데이트
lib/providers.js     OpenAI · Gemini · Anthropic API 어댑터, 모델 목록, 데모 모드
lib/cli.js           claude · codex CLI 실행 어댑터 (격리, 파싱, 중단/타임아웃)
public/              화면 (index.html · styles.css · app.js · markdown.js · summary.js · infographic.js · icons/)
release-notes/       버전별 릴리스 노트
scripts/make-icons   SVG → PNG/ICO 아이콘 생성 (개발용)
test/                node:test (렌더러 XSS, 요약 파서, API/CLI 어댑터, 서버 보안) + 가짜 CLI fixture
```
</details>

---

<div align="center">

**© 2026 cybereun. All rights reserved.**

</div>

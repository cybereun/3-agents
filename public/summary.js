// 합의 응답을 "읽을 본문(마크다운)"과 "인포그래픽용 요약 데이터"로 나눈다. 순수 함수만 둔다 (Node 에서 테스트 가능).
// 모델 출력은 신뢰할 수 없으므로 모든 값을 문자열로 검증하고 길이를 제한한다.

const LEVELS = ['높음', '보통', '낮음'];

/** 응답 끝의 ```json 블록을 떼어낸다. 블록이 아직 닫히지 않았으면(스트리밍 중) json 은 null 이다. */
export function splitConsensus(text) {
  const src = String(text ?? '');
  let m = /```json[^\n]*\n?/i.exec(src);
  if (!m) {
    // 언어 태그 없이 ``` 로 감싼 요약 객체도 허용
    m = /```[^\n]*\n(?=\s*\{[\s\S]*"headline")/.exec(src);
  }
  if (!m) return { markdown: stripPartialFence(src.trim()), json: null };
  const markdown = src.slice(0, m.index).trim();
  const rest = src.slice(m.index + m[0].length);
  const end = rest.indexOf('```');
  return { markdown, json: end >= 0 ? rest.slice(0, end).trim() : null };
}

// 스트리밍 도중 "```js" 가 쓰이는 중간 상태가 본문에 비치지 않게 한다
const stripPartialFence = (s) => s.replace(/\n?`{1,3}(j(s(o(n)?)?)?)?$/i, '');

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v, max, f) => (Array.isArray(v) ? v.slice(0, max).map(f).filter(Boolean) : []);
const level = (v) => LEVELS.find((l) => String(v ?? '').includes(l)) || '';

/** 모델이 준 JSON 문자열 → 검증된 요약. 쓸 수 없으면 null. */
export function parseSummary(jsonText) {
  let o;
  try {
    o = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const headline = str(o.headline, 160);
  const points = list(o.points, 5, (p) => {
    const title = str(p?.title, 40);
    const detail = str(p?.detail, 200);
    return title || detail ? { title, detail } : null;
  });
  if (!headline && !points.length) return null;
  return {
    source: 'model',
    headline,
    points,
    agree: list(o.agree, 5, (s) => str(s, 200) || null),
    conflict: list(o.conflict, 4, (c) => {
      if (typeof c === 'string') return str(c, 300) ? { issue: str(c, 300), views: '' } : null;
      const issue = str(c?.issue, 120);
      const views = str(c?.views, 300);
      return issue || views ? { issue, views } : null;
    }),
    single: list(o.single, 4, (s) => str(s, 200) || null),
    confidence: { level: level(o.confidence?.level), reason: str(o.confidence?.reason, 200) },
    actions: list(o.actions, 4, (s) => str(s, 160) || null),
  };
}

const plain = (s) => s.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();

function sections(md) {
  const out = {};
  const parts = String(md).split(/^##\s+(.+)$/m); // [머리말, 제목1, 본문1, 제목2, 본문2 ...]
  for (let i = 1; i < parts.length; i += 2) out[parts[i].trim()] = parts[i + 1] ?? '';
  return out;
}

/** JSON 을 못 받았을 때 합의 본문(마크다운)의 정해진 섹션에서 요약을 뽑는다. */
export function summaryFromMarkdown(md) {
  const sec = sections(md);
  const answer = sec['최종 답변'] ?? '';
  const status = sec['합의 현황'] ?? '';
  const conf = sec['신뢰도'] ?? '';
  if (!answer.trim() && !status.trim()) return null;

  const firstPara = answer
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^([-*+]|\d+[.)])\s/.test(p));
  const headline = plain(firstPara ?? '').slice(0, 160);

  const points = [];
  for (const line of answer.split('\n')) {
    const m = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (!m || points.length >= 5) continue;
    const bold = /^\*\*(.+?)\*\*[:：]?\s*(.*)$/.exec(m[1]);
    points.push(bold ? { title: plain(bold[1]).replace(/[:：]$/, '').slice(0, 40), detail: plain(bold[2]).slice(0, 200) } : { title: '', detail: plain(m[1]).slice(0, 200) });
  }

  const pick = (label) => {
    const re = new RegExp(`^\\s*[-*+]\\s*\\*{0,2}${label}[:：]?\\*{0,2}[:：]?\\s*(.*)$`, 'm');
    const t = plain(re.exec(status)?.[1] ?? '');
    return !t || /^(없음|해당 없음|없습니다)/.test(t) ? [] : [t.slice(0, 300)]; // '없음 — 부연 설명'도 없음으로 본다
  };
  const conflictText = pick('충돌');

  return {
    source: 'markdown',
    headline,
    points,
    agree: pick('일치'),
    conflict: conflictText.map((issue) => ({ issue, views: '' })),
    single: pick('단일 출처'),
    confidence: { level: level(conf), reason: plain(conf).slice(0, 200) },
    actions: [],
  };
}

/** 합의 전체 응답 → { markdown, summary } */
export function interpretConsensus(text) {
  const { markdown, json } = splitConsensus(text);
  const summary = (json && parseSummary(json)) || summaryFromMarkdown(markdown);
  return { markdown, summary };
}

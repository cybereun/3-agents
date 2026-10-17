import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretConsensus, parseSummary, splitConsensus, summaryFromMarkdown } from '../public/summary.js';

const GOOD = {
  headline: '장기 기준으로 비교하세요',
  points: [{ title: '장기 비용', detail: '총비용으로 본다' }, { title: '변수', detail: '개인 사정이 크다' }],
  agree: ['장기 기준 비교'],
  conflict: [{ issue: '연료비', views: 'A는 낮다, B는 비슷하다' }],
  single: ['목표 수치화 (B)'],
  confidence: { level: '보통', reason: '수치 근거 부족' },
  actions: ['내 주행거리 계산'],
};
const MD = '## 최종 답변\n\n결론 문장입니다.\n\n## 합의 현황\n\n- **일치:** 장기 기준\n- **충돌:** 없음\n- **단일 출처:** 수치화(B)\n\n## 신뢰도\n\n**낮음** — 근거 부족';

test('splitConsensus: 본문과 json 을 분리한다', () => {
  const { markdown, json } = splitConsensus(`${MD}\n\n\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\``);
  assert.ok(markdown.endsWith('근거 부족'));
  assert.ok(!markdown.includes('headline'));
  assert.deepEqual(JSON.parse(json), GOOD);
});

test('splitConsensus: 스트리밍 중 닫히지 않은 블록과 펜스 조각이 본문에 비치지 않는다', () => {
  for (const tail of ['\n```', '\n```js', '\n```json', '\n```json\n{"headline": "아직']) {
    const { markdown, json } = splitConsensus(MD + tail);
    assert.equal(json, null, tail);
    assert.ok(!markdown.includes('`'), `본문에 펜스 잔여물: ${JSON.stringify(markdown.slice(-12))}`);
    assert.ok(markdown.endsWith('근거 부족'));
  }
});

test('splitConsensus: 언어 태그가 없는 펜스도 요약이면 인식한다', () => {
  const { markdown, json } = splitConsensus(`${MD}\n\`\`\`\n${JSON.stringify(GOOD)}\n\`\`\``);
  assert.ok(!markdown.includes('```'));
  assert.equal(parseSummary(json).headline, GOOD.headline);
});

test('parseSummary: 정상 입력을 정규화한다', () => {
  const s = parseSummary(JSON.stringify(GOOD));
  assert.equal(s.source, 'model');
  assert.equal(s.points.length, 2);
  assert.equal(s.confidence.level, '보통');
  assert.deepEqual(s.conflict, [{ issue: '연료비', views: 'A는 낮다, B는 비슷하다' }]);
});

test('parseSummary: 깨진/엉뚱한 입력은 null, 잘못된 타입은 걸러낸다', () => {
  assert.equal(parseSummary('not json'), null);
  assert.equal(parseSummary('[]'), null);
  assert.equal(parseSummary('{}'), null);
  const s = parseSummary(JSON.stringify({ headline: 5, points: 'x', agree: [1, null, '유효'], confidence: { level: '아주 높음!' } }));
  assert.equal(s, null, 'headline/points 가 모두 무효면 null');
  const t = parseSummary(JSON.stringify({ headline: 'ok', agree: [1, null, '유효'], points: 'x', conflict: ['문자열 충돌'], confidence: { level: '아주 높음!' } }));
  assert.deepEqual(t.agree, ['유효']);
  assert.deepEqual(t.conflict, [{ issue: '문자열 충돌', views: '' }]);
  assert.equal(t.confidence.level, '높음');
});

test('parseSummary: 길이와 개수를 제한한다 (과도한 출력 방어)', () => {
  const s = parseSummary(JSON.stringify({ headline: 'h'.repeat(1000), points: Array.from({ length: 20 }, (_, i) => ({ title: 't'.repeat(100) + i, detail: 'd' })) }));
  assert.equal(s.headline.length, 160);
  assert.equal(s.points.length, 5);
  assert.equal(s.points[0].title.length, 40);
});

test('summaryFromMarkdown: 정해진 섹션에서 요약을 뽑는다 ("없음"은 제외)', () => {
  const s = summaryFromMarkdown(MD);
  assert.equal(s.source, 'markdown');
  assert.equal(s.headline, '결론 문장입니다.');
  assert.deepEqual(s.agree, ['장기 기준']);
  assert.deepEqual(s.conflict, []);
  assert.deepEqual(s.single, ['수치화(B)']);
  assert.equal(s.confidence.level, '낮음');
});

test("summaryFromMarkdown: '없음 — 부연 설명' 형태도 항목으로 세지 않는다", () => {
  const md = '## 최종 답변\n\n결론.\n\n## 합의 현황\n\n- **일치:** 장기 기준\n- **충돌:** 없음 — 표현 강도만 다릅니다.\n- **단일 출처:** 해당 없음\n';
  const s = summaryFromMarkdown(md);
  assert.deepEqual(s.conflict, []);
  assert.deepEqual(s.single, []);
  assert.equal(s.agree.length, 1);
});

test('summaryFromMarkdown: 최종 답변의 목록을 핵심 포인트로 쓴다', () => {
  const s = summaryFromMarkdown('## 최종 답변\n\n요지입니다.\n\n- **비용:** 총비용을 보세요\n- 두 번째 항목\n\n## 신뢰도\n\n보통');
  assert.equal(s.headline, '요지입니다.');
  assert.deepEqual(s.points, [{ title: '비용', detail: '총비용을 보세요' }, { title: '', detail: '두 번째 항목' }]);
});

test('interpretConsensus: json 이 있으면 json, 깨졌거나 없으면 마크다운으로 대체한다', () => {
  assert.equal(interpretConsensus(`${MD}\n\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\``).summary.source, 'model');
  assert.equal(interpretConsensus(`${MD}\n\`\`\`json\n{깨짐\n\`\`\``).summary.source, 'markdown');
  assert.equal(interpretConsensus(MD).summary.source, 'markdown');
  assert.equal(interpretConsensus('요약할 구조가 없는 자유 서술').summary, null);
});

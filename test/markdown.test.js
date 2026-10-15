import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/markdown.js';

test('HTML 은 이스케이프된다 (XSS 방어)', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> <script>alert(1)</script>');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script'));
  assert.match(html, /&lt;img/);
});

test('javascript: 링크는 만들지 않고 http(s)만 링크가 된다', () => {
  assert.ok(!renderMarkdown('[x](javascript:alert(1))').includes('<a '));
  const ok = renderMarkdown('[문서](https://example.com/a?b=1&c=2)');
  assert.match(ok, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">문서<\/a>/);
});

test('링크 URL 안의 따옴표로 속성을 탈출할 수 없다', () => {
  const html = renderMarkdown('[x](https://a.com/"onmouseover="alert(1))');
  assert.ok(!/<a [^>]*\sonmouseover/.test(html));
  assert.ok(!html.includes('"onmouseover'));
});

test('제목, 굵게, 코드, 목록, 표, 펜스 코드', () => {
  assert.match(renderMarkdown('## 제목'), /<h4>제목<\/h4>/);
  assert.match(renderMarkdown('**굵게** 와 `코드`'), /<strong>굵게<\/strong> 와 <code>코드<\/code>/);
  assert.match(renderMarkdown('- a\n- b'), /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(renderMarkdown('1. a\n2. b'), /<ol><li>a<\/li><li>b<\/li><\/ol>/);
  assert.match(renderMarkdown('- a\n  - b\n- c'), /<ul><li>a<ul><li>b<\/li><\/ul><\/li><li>c<\/li><\/ul>/);
  assert.match(renderMarkdown('|a|b|\n|--|--|\n|1|2|'), /<table>.*<th>a<\/th>.*<td>2<\/td>/s);
  assert.match(renderMarkdown('```js\n<b>x</b>\n```'), /<pre><code>&lt;b&gt;x&lt;\/b&gt;<\/code><\/pre>/);
});

test('스트리밍 중 닫히지 않은 코드 펜스도 안전하게 렌더링된다', () => {
  assert.match(renderMarkdown('```\nconst a = 1'), /<pre><code>const a = 1<\/code><\/pre>/);
});

test('코드 스팬 안의 마크다운은 해석되지 않는다', () => {
  assert.match(renderMarkdown('`**x**`'), /<code>\*\*x\*\*<\/code>/);
});

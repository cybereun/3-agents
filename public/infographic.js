// 합의 요약 → 인포그래픽 DOM. 모델이 준 문자열은 textContent 로만 넣는다 (innerHTML 금지).
// 숫자는 "개수"만 보여준다. 모델이 만든 퍼센트 같은 가짜 정밀도는 그리지 않는다.

const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

const LEVELS = [
  { key: '낮음', hint: '교차 검증 필요' },
  { key: '보통', hint: '참고용' },
  { key: '높음', hint: '비교적 신뢰' },
];

function confidenceCard(conf) {
  const card = h('section', 'ig-card ig-conf');
  card.append(h('h3', 'ig-label', '신뢰도'));
  const bar = h('div', 'ig-meter');
  const idx = LEVELS.findIndex((l) => l.key === conf.level);
  LEVELS.forEach((l, i) => {
    const seg = h('div', 'ig-seg');
    if (idx >= 0 && i <= idx) seg.dataset.on = String(idx); // 채워진 칸 수에 따라 색이 달라진다
    bar.append(seg);
  });
  card.append(bar);
  const row = h('div', 'ig-conf-row');
  row.append(h('strong', 'ig-conf-level', idx >= 0 ? conf.level : '판단 불가'));
  if (idx >= 0) row.append(h('span', 'ig-conf-hint', LEVELS[idx].hint));
  card.append(row);
  if (conf.reason) card.append(h('p', 'ig-conf-reason', conf.reason));
  return card;
}

function counter(kind, label, glyph, n) {
  const el = h('div', `ig-count ig-${kind}`);
  el.append(h('span', 'ig-count-glyph', glyph), h('span', 'ig-count-n', String(n)), h('span', 'ig-count-label', label));
  return el;
}

function column(kind, title, glyph, items, emptyText) {
  const col = h('section', `ig-col ig-${kind}`);
  const head = h('header', 'ig-col-head');
  head.append(h('span', 'ig-glyph', glyph), h('h3', null, title), h('span', 'ig-col-n', String(items.length)));
  col.append(head);
  if (!items.length) {
    col.append(h('p', 'ig-empty', emptyText));
    return col;
  }
  const ul = h('ul', 'ig-list');
  for (const it of items) {
    const li = h('li');
    if (typeof it === 'string') {
      li.textContent = it;
    } else {
      if (it.issue) li.append(h('strong', null, it.issue));
      if (it.views) li.append(h('span', 'ig-views', it.views));
    }
    ul.append(li);
  }
  col.append(ul);
  return col;
}

/** root 를 비우고 요약을 그린다. summary 가 null 이면 안내 문구를 보여준다. */
export function renderInfographic(root, summary, { legend = '', meta = '' } = {}) {
  root.replaceChildren();
  if (!summary) {
    root.append(h('p', 'ig-empty ig-none', '요약할 수 있는 구조가 없어 인포그래픽을 만들지 못했습니다. "합의 답변" 탭의 본문을 확인하세요.'));
    return;
  }

  const hero = h('section', 'ig-hero');
  hero.append(h('span', 'ig-kicker', '결론'));
  hero.append(h('h2', 'ig-headline', summary.headline || '결론 문장을 찾지 못했습니다'));
  root.append(hero);

  const top = h('div', 'ig-top');
  top.append(confidenceCard(summary.confidence));
  const counts = h('section', 'ig-card ig-counts');
  counts.append(h('h3', 'ig-label', '합의 현황 (개수)'));
  const wrap = h('div', 'ig-count-wrap');
  wrap.append(
    counter('agree', '일치', '✓', summary.agree.length),
    counter('conflict', '충돌', '!', summary.conflict.length),
    counter('single', '단일 출처', '◇', summary.single.length),
  );
  counts.append(wrap);
  top.append(counts);
  root.append(top);

  if (summary.points.length) {
    const pts = h('section', 'ig-points');
    pts.append(h('h3', 'ig-label', '핵심 포인트'));
    const grid = h('div', 'ig-point-grid');
    summary.points.forEach((p, i) => {
      const card = h('article', 'ig-card ig-point');
      card.append(h('span', 'ig-num', String(i + 1)));
      if (p.title) card.append(h('h4', null, p.title));
      if (p.detail) card.append(h('p', null, p.detail));
      grid.append(card);
    });
    pts.append(grid);
    root.append(pts);
  }

  const cols = h('div', 'ig-cols');
  cols.append(
    column('agree', '일치한 내용', '✓', summary.agree, '모든 답변이 일치한 항목이 없습니다.'),
    column('conflict', '충돌한 내용', '!', summary.conflict, '충돌한 내용이 없습니다.'),
    column('single', '단일 출처', '◇', summary.single, '한 답변에만 있던 내용이 없습니다.'),
  );
  root.append(cols);

  if (summary.actions.length) {
    const box = h('section', 'ig-card ig-actions');
    box.append(h('h3', 'ig-label', '직접 확인할 일'));
    const ul = h('ul', 'ig-checklist');
    summary.actions.forEach((a, i) => {
      const li = h('li');
      const label = h('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = `ig-act-${i}`;
      label.append(cb, h('span', null, a));
      li.append(label);
      ul.append(li);
    });
    box.append(ul);
    root.append(box);
  }

  const foot = h('footer', 'ig-foot');
  if (summary.source === 'markdown') {
    foot.append(h('p', 'ig-note', '합의 AI가 요약 형식을 지키지 않아 합의 답변 본문에서 추출한 요약입니다. 누락이 있을 수 있습니다.'));
  }
  foot.append(h('p', null, [legend, meta].filter(Boolean).join('  ·  ')));
  foot.append(h('p', 'ig-note', 'AI가 만든 요약입니다. 세 AI가 일치해도 사실이라는 보장은 없습니다.'));
  root.append(foot);
}

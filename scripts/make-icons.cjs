// public/icons/icon.svg 에서 PNG 아이콘을 생성한다. (개발용: playwright 필요)
//   NODE_PATH=$(npm root -g) node scripts/make-icons.cjs
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'public', 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
// 마스커블: 배경을 전면으로 채우고 로고를 안전영역(80%) 안으로 축소
const maskable = svg
  .replace('rx="15"', 'rx="0"')
  .replace('viewBox="0 0 64 64">', 'viewBox="0 0 64 64"><g transform="translate(6.4 6.4) scale(.8)">')
  .replace('</svg>', '</g></svg>')
  .replace('<rect width="64" height="64" rx="0" fill="#0c0c0f"/>', '')
  .replace('<g transform', '<rect width="64" height="64" fill="#0c0c0f"/><g transform');

const jobs = [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['apple-touch-icon.png', 180, svg.replace('rx="15"', 'rx="0"')],
  ['icon-maskable-512.png', 512, maskable],
];

(async () => {
  const browser = await chromium.launch();
  for (const [name, size, markup] of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
    await page.screenshot({ path: path.join(dir, name), omitBackground: true });
    await page.close();
    console.log('wrote', name);
  }
  await browser.close();
})();

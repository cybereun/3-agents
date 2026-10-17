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
  // Windows 바로가기용 .ico (PNG 압축 항목 방식, Vista 이상 지원)
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
    pngs.push(await page.screenshot({ omitBackground: true }));
    await page.close();
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((size, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bit depth
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
  });
  fs.writeFileSync(path.join(dir, 'app.ico'), Buffer.concat([header, ...entries, ...pngs]));
  console.log('wrote app.ico');
  await browser.close();
})();

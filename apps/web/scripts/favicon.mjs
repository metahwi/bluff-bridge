// 사이트 아이콘(하마 얼굴)을 만든다. 그림을 고치려면 아래 격자의 글자를 바꾸고 다시 돌린다.
// 사용: node scripts/favicon.mjs  →  public/favicon.svg, public/apple-touch-icon.png
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// pixel.tsx의 하마와 같은 색. o 외곽선, h 몸, m 주둥이, p 귓속, k 눈, w 눈빛·이빨, n 콧구멍
const PALETTE = { o: '#3a2a33', h: '#8f6f7a', m: '#bfa0a6', p: '#f29bb0', k: '#1b1210', w: '#ffffff', n: '#5e4650' };
const ROWS = [
  '.ooo........ooo.',
  'ohpho.oooo.ohpho',
  'ohphhhhhhhhhhpho',
  '.ohhhhhhhhhhhho.',
  '.ohkkhhhhhhkkho.',
  '.ohkwhhhhhhkwho.',
  'ohhhhhhhhhhhhhho',
  'ommmmmmmmmmmmmmo',
  'ommnnmmmmmmnnmmo',
  'ommmmmmmmmmmmmmo',
  'owwmmmmmmmmmmwwo',
  'ommmmmmmmmmmmmmo',
  '.oooooooooooooo.',
];

function rects() {
  let out = '';
  ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const ch = row[x];
      let run = 1;
      while (row[x + run] === ch) run++;
      if (PALETTE[ch]) out += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${PALETTE[ch]}"/>`;
      x += run;
    }
  });
  return out;
}

const pub = fileURLToPath(new URL('../public/', import.meta.url));
const top = (16 - ROWS.length) / 2;
// 탭 아이콘: 바탕 없이 얼굴만.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-top} 16 16" shape-rendering="crispEdges">${rects()}</svg>`;
writeFileSync(pub + 'favicon.svg', svg);

// 휴대폰 홈 화면 아이콘: 풀밭 색 바탕 위에 얼굴.
const touch = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="-3 ${-top - 3} 22 22" shape-rendering="crispEdges"><rect x="-3" y="${-top - 3}" width="22" height="22" fill="#7cc25b"/>${rects()}</svg>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 180, height: 180 } });
await page.setContent(`<body style="margin:0">${touch}</body>`);
await page.screenshot({ path: pub + 'apple-touch-icon.png' });
// 확인용: 실제 탭 크기(16, 32)와 크게 본 모습
await page.setViewportSize({ width: 360, height: 140 });
await page.setContent(`<body style="margin:12px;background:#dee1e6;display:flex;gap:16px;align-items:center"><img src="data:image/svg+xml,${encodeURIComponent(svg)}" width="16"><img src="data:image/svg+xml,${encodeURIComponent(svg)}" width="32"><img src="data:image/svg+xml,${encodeURIComponent(svg)}" width="112"><div style="background:#202124;padding:8px"><img src="data:image/svg+xml,${encodeURIComponent(svg)}" width="32"></div></body>`);
await page.screenshot({ path: fileURLToPath(new URL('../.shots/favicon.png', import.meta.url)) });
await browser.close();
console.log('saved favicon.svg, apple-touch-icon.png');

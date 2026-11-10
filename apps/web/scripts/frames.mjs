// 추락 연출의 여러 시점을 한 번에 찍는다. 각 시점은 무대를 그 시각으로 건너뛴 뒤 멈춘 장면이다.
// 사용: node scripts/frames.mjs 1.0,2.3,2.6 [너비x높이]
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const times = (process.argv[2] ?? '1.0,2.3,2.6,3.2,4.6').split(',');
const [width, height] = (process.argv[3] ?? '1000x820').split('x').map(Number);
const outDir = fileURLToPath(new URL('../.shots/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const t of times) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`http://localhost:5173/?stage=${process.argv[4] ?? 'chomp'}&at=${t}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}f-${t}.png`, clip: { x: 0, y: 0, width, height: Math.min(height, 760) } });
  console.log('saved', `${outDir}f-${t}.png`);
  await page.close();
}
await browser.close();

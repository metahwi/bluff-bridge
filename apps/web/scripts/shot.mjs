// 화면을 자동으로 찍는 도구. 디자인 작업 중에 결과를 눈으로 확인하는 데 쓴다.
// 사용: node scripts/shot.mjs <주소 경로> <이름> [너비x높이] [찍을 시점(ms), 쉼표로 구분]
// 예:   node scripts/shot.mjs "/?stage=chomp" chomp 900x900 500,2500,3300
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [path = '/', name = 'shot', size = '900x900', times = '1200'] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const outDir = new URL('../.shots/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  // 화면 없는 환경에서도 WebGL(3D)이 그려지게 소프트웨어 렌더러를 쓴다.
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push('console: ' + m.text());
});
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

await page.goto('http://localhost:5173' + path, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const start = Date.now();
for (const t of times.split(',').map(Number)) {
  const wait = t - (Date.now() - start);
  if (wait > 0) await page.waitForTimeout(wait);
  const file = new URL(`${name}-${t}.png`, outDir);
  await page.screenshot({ path: file.pathname.slice(1).replaceAll('%20', ' ') });
  console.log('saved', decodeURIComponent(file.pathname.slice(1)));
}
if (problems.length) console.log('PROBLEMS:\n' + [...new Set(problems)].join('\n'));
await browser.close();

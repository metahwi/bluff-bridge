// 휴대폰 크기에서 오른쪽 위 톱니바퀴(설정) 주변을 찍는다: 첫 화면, 대기실, 설정 창을 연 모습.
// 사용: node scripts/gear.mjs [너비=390]
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const width = Number(process.argv[2] ?? 390);
const out = fileURLToPath(new URL('../.shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const shot = async (name, clip) => {
  await page.screenshot({ path: `${out}gear-${width}-${name}.png`, clip });
  console.log('saved', `gear-${width}-${name}.png`);
};
const top = { x: 0, y: 0, width, height: 260 };

await page.goto('http://localhost:5173');
await page.getByLabel('닉네임').waitFor();
await page.waitForTimeout(1200);
await shot('home', top);
await page.getByRole('button', { name: '설정' }).click();
await page.waitForTimeout(300);
await shot('home-open', { x: 0, y: 0, width, height: 560 });
await page.keyboard.press('Escape');

await page.getByLabel('닉네임').fill('긴닉네임열여섯글자까지가능');
await page.getByRole('button', { name: '친구와 하기 (방 만들기)' }).click();
await page.waitForURL(/\/r\//);
await page.waitForTimeout(1200);
await shot('lobby', top);
await page.getByRole('button', { name: '설정' }).click();
await page.waitForTimeout(300);
await shot('lobby-open', { x: 0, y: 0, width, height: 560 });
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const r = (el) => el && (({ x, y, width, height }) => ({ x, y, w: width, h: height }))(el.getBoundingClientRect());
      return { header: r(document.querySelector('main.room > header')), gear: r(document.querySelector('.gear')), svg: r(document.querySelector('.gear svg')), panel: r(document.querySelector('.settingsPanel')), vw: innerWidth, doc: document.documentElement.scrollWidth };
    }),
  ),
);
await browser.close();

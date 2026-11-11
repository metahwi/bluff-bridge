// 브라우저 두 개로 실제 한 판을 시작해 화면을 찍는다(디자인 확인용).
// A가 방을 만들고 B가 초대 링크로 들어온 뒤, 뻥과 의심이 한 번 일어날 때까지 진행한다.
// 사용: node scripts/play.mjs [너비x높이]
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const [width, height] = (process.argv[2] ?? '1100x1000').split('x').map(Number);
const out = fileURLToPath(new URL('../.shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const base = 'http://localhost:5173';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function player(name) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror:`, e.message));
  page.on('console', (m) => m.type() === 'error' && console.log(`[${name}] console:`, m.text()));
  return page;
}
const shot = async (page, name) => {
  await page.screenshot({ path: `${out}play-${name}.png` });
  console.log('saved', `play-${name}.png`);
};
const button = (page, text) => page.getByRole('button', { name: text, exact: true });

const a = await player('A');
await a.goto(base);
await a.getByLabel('닉네임').fill('에이');
await button(a, '친구와 하기 (방 만들기)').click();
await a.waitForURL(/\/r\//);
const link = a.url();

const b = await player('B');
await b.goto(link);
await b.getByLabel('닉네임').fill('비');
await b.getByRole('button', { name: /입장$/ }).click();

await button(b, '준비 완료').click();
await button(a, '게임 시작').click();
await a.getByText('완주').first().waitFor();
await a.waitForTimeout(1500);
await shot(a, 'start');

const THROW = '꾹 눌러 주사위 던지기';
/** 단추를 꾹 눌렀다 놓아 주사위를 던진다. 누르는 동안의 화면도 찍을 수 있다. */
async function throwDice(page, holdMs, shootAs) {
  const box = await button(page, THROW).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  if (shootAs) await shot(page, shootAs);
  await page.mouse.up();
}

// 차례인 쪽이 던지고 5를 선언한다. 상대는 처음 두 번은 믿고(전진을 보려고), 그다음에 의심한다.
for (let turn = 0; turn < 8; turn++) {
  await Promise.race([button(a, THROW).waitFor(), button(b, THROW).waitFor()]);
  const [roller, other] = (await button(a, THROW).isVisible()) ? [a, b] : [b, a];
  await throwDice(roller, 600, turn === 0 ? 'charging' : null);
  if (turn === 0) {
    await roller.waitForTimeout(2300);
    await shot(roller, 'rolled-mine');
    await shot(other, 'rolled-theirs');
  }
  await button(roller, '4').click();
  if (turn < 2) {
    await button(other, '믿기').click();
    await a.waitForTimeout(1300);
    if (turn === 1) await shot(a, 'moved');
    continue;
  }
  await button(other, '의심하기').click();
  for (const [t, name] of [[1500, 'suspense'], [1400, 'lunge'], [500, 'chomp'], [1300, 'chew'], [1500, 'burp'], [2600, 'after']]) {
    await a.waitForTimeout(t);
    await shot(a, name);
  }
  break;
}
await browser.close();

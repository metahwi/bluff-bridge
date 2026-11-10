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

await button(a, '준비 완료').click();
await button(b, '준비 완료').click();
await a.getByText('완주').first().waitFor();
await a.waitForTimeout(1500);
await shot(a, 'start');

// 차례인 쪽이 굴리고 5를 선언한다. 상대는 처음 두 번은 믿고(전진을 보려고), 그다음에 의심한다.
for (let turn = 0; turn < 8; turn++) {
  const [roller, other] = (await button(a, '주사위 굴리기').isVisible()) ? [a, b] : [b, a];
  await button(roller, '주사위 굴리기').click();
  await button(roller, '5').click();
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

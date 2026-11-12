// 말이 다 떨어진 뒤의 규칙 확인용: 2인 판에서 한쪽의 말을 다 떨어뜨린 뒤,
// 그 사람이 진짜 선언을 의심해 완주한 말을 잃는 장면까지 진행하며 화면을 찍는다.
// 사용: node scripts/endgame.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const out = fileURLToPath(new URL('../.shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const base = 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function player(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror:`, e.message));
  page.on('console', (m) => m.type() === 'error' && console.log(`[${name}] console:`, m.text()));
  return page;
}
const shot = async (page, name) => {
  await page.screenshot({ path: `${out}endgame-${name}.png` });
  console.log('saved', `endgame-${name}.png`);
};
const button = (page, text) => page.getByRole('button', { name: text, exact: true });
const THROW = '꾹 눌러 주사위 던지기';
const NOTE = '굴릴 말이 없어서';

const a = await player('A');
await a.goto(base);
await a.getByLabel('닉네임').fill('에이');
await button(a, '친구와 하기 (방 만들기)').click();
await a.waitForURL(/\/r\//);
const b = await player('B');
await b.goto(a.url());
await b.getByLabel('닉네임').fill('비');
await b.getByRole('button', { name: /입장$/ }).click();
await button(b, '준비 완료').click();
await button(a, '게임 시작').click();

const over = (page) => page.getByRole('button', { name: /다시 하기|상대를 기다리는 중/ });
let pawnless = null; // 말이 다 떨어진 쪽의 화면
let seenRevoke = false;
for (let turn = 0; turn < 80; turn++) {
  await Promise.race([button(a, THROW).waitFor(), button(b, THROW).waitFor(), over(a).waitFor()]);
  if (await over(a).isVisible()) break;
  const [roller, other] = (await button(a, THROW).isVisible()) ? [a, b] : [b, a];
  if (!pawnless && (await other.getByText(NOTE).isVisible())) {
    pawnless = other;
    await shot(other, 'pawnless-waiting');
    await shot(roller, 'pawnless-seen-by-roller');
  }
  const box = await button(roller, THROW).boundingBox();
  await roller.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await roller.mouse.down();
  await roller.waitForTimeout(200);
  await roller.mouse.up();
  await button(roller, '4').waitFor();
  // 한쪽 말이 다 떨어진 뒤에는 진짜 눈을 선언한다(꽝이면 4). 진짜 눈의 단추만 색이 다르다.
  const honest = roller.locator('.claims button:not(.ghost)');
  if (pawnless && (await honest.count())) await honest.first().click();
  else await button(roller, '4').click();

  // 처음 여섯 턴은 서로 믿어 각자 한 번씩 완주하고, 그 뒤로는 무조건 의심해 말을 빨리 줄인다.
  const doubt = turn >= 6;
  try {
    await button(other, '믿기').waitFor({ timeout: 5000 });
  } catch {
    continue; // 잃을 말이 없어 응답하지 못하는 경우
  }
  if (pawnless === other) await shot(other, 'pawnless-respond');
  await button(other, doubt ? '의심하기' : '믿기').click();
  if (doubt && pawnless === other && !seenRevoke) {
    await other.waitForTimeout(3600);
    if (await other.getByText('완주한 말').first().isVisible()) {
      seenRevoke = true;
      await shot(other, 'revoked');
    }
  }
}
await over(a).waitFor({ timeout: 30000 });
await a.waitForTimeout(2500);
await shot(a, 'result');
console.log('말이 다 떨어진 상황:', pawnless ? '나옴' : '안 나옴', '| 완주 취소 장면:', seenRevoke ? '나옴' : '안 나옴');
await browser.close();

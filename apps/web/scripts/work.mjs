// 업무 모드 확인용: A는 업무 모드, B는 원래 게임 화면으로 실제 한 판을 끝까지 한다.
// 사용: node scripts/work.mjs [너비x높이]
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const [width, height] = (process.argv[2] ?? '1280x800').split('x').map(Number);
const out = fileURLToPath(new URL('../.shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const base = 'http://localhost:5173';
const tag = width < 600 ? 'm-' : '';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function player(name, work) {
  const context = await browser.newContext({ viewport: { width, height } });
  if (work) await context.addInitScript(() => localStorage.setItem('hama:work', 'on'));
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror:`, e.message));
  page.on('console', (m) => m.type() === 'error' && console.log(`[${name}] console:`, m.text()));
  return page;
}
const shot = async (page, name) => {
  await page.screenshot({ path: `${out}work-${tag}${name}.png` });
  console.log('saved', `work-${tag}${name}.png`);
};
const button = (page, text) => page.getByRole('button', { name: text, exact: true });

const a = await player('A', true);
await a.goto(base);
await a.getByLabel('담당자 이름').fill('김대리');
await shot(a, 'home');
console.log('title:', await a.title());
await button(a, '새 공유 시트').click();
await a.waitForURL(/\/r\//);
const link = a.url();

const b = await player('B', false);
await b.goto(link);
await b.getByLabel('닉네임').fill('비');
await b.getByRole('button', { name: /입장$/ }).click();
await a.waitForTimeout(800);
await shot(a, 'lobby');

await button(a, '준비 완료').click();
await button(b, '준비 완료').click();
await a.getByText('1단계').waitFor();
await shot(a, 'start');

const ROLL_A = '다시 계산 (F9)';
const THROW_B = '꾹 눌러 주사위 던지기';
const shots = new Set();
const once = async (page, name) => {
  if (shots.has(name)) return;
  shots.add(name);
  await shot(page, name);
};

for (let turn = 0; turn < 60; turn++) {
  const over = a.getByText('분기 결산');
  await Promise.race([button(a, ROLL_A).waitFor(), button(b, THROW_B).waitFor(), over.waitFor()]);
  if (await over.isVisible()) break;
  if (await button(a, ROLL_A).isVisible()) {
    // A(업무 모드) 차례: F9와 단추를 번갈아 쓴다.
    if (turn % 2) await a.keyboard.press('F9');
    else await button(a, ROLL_A).click();
    await button(a, '4').waitFor();
    await once(a, 'claim');
    await button(a, '4').click();
    await a.waitForTimeout(300);
    await once(a, 'reported');
    await button(b, turn % 3 === 2 ? '의심하기' : '믿기').click();
    if (turn % 3 === 2) {
      await a.waitForTimeout(700);
      await once(a, 'audited-me');
    } else {
      await a.waitForTimeout(400);
      await once(a, 'moved');
    }
  } else {
    const box = await button(b, THROW_B).boundingBox();
    await b.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await b.mouse.down();
    await b.waitForTimeout(300);
    await b.mouse.up();
    await button(b, '4').click();
    await button(a, '감사 요청').waitFor();
    await once(a, 'respond');
    const audit = turn % 4 < 2;
    await button(a, audit ? '감사 요청' : '승인').click();
    if (audit) {
      await a.waitForTimeout(700);
      await once(a, 'audit');
    }
  }
}
await a.getByText('분기 결산').waitFor({ timeout: 20000 });
await a.waitForTimeout(500);
await shot(a, 'result');
await b.waitForTimeout(4000);
await b.screenshot({ path: `${out}work-${tag}other-side.png` });

// 설정 창, 그리고 업무 모드를 끄면 원래 화면으로 돌아오는지
await a.getByRole('button', { name: '설정' }).click();
await shot(a, 'settings');
await a.getByRole('switch', { name: '업무 모드' }).click();
await a.waitForTimeout(1500);
console.log('title after off:', await a.title());
await shot(a, 'back-to-game');
await browser.close();

// 관리자 페이지 확인용: 로그인 → 탭 둘러보기 → 봇을 켜고 빠른 매칭에서 봇과 붙어 보기 → 봇을 끈다.
// 사용: node scripts/admin.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const out = fileURLToPath(new URL('../.shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const base = 'http://localhost:5173';
const password = readFileSync(new URL('../../server/.dev.vars', import.meta.url), 'utf8').match(/^ADMIN_PASSWORD=(.+)$/m)[1].trim();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
const shot = async (p, name) => {
  await p.screenshot({ path: `${out}admin-${name}.png` });
  console.log('saved', `admin-${name}.png`);
};
const tab = (name) => page.getByRole('navigation').getByRole('button', { name, exact: true });

await page.goto(`${base}/admin`);
await page.getByLabel('관리자 암호').fill('틀린-암호');
await page.getByRole('button', { name: '들어가기' }).click();
await page.getByText('암호가 맞지 않아요.').waitFor();
await shot(page, 'login');
await page.getByLabel('관리자 암호').fill(password);
await page.getByRole('button', { name: '들어가기' }).click();
await page.getByText('진행 중인 판').waitFor();
await shot(page, 'overview');

await tab('게임 설정').click();
const bots = page.getByRole('switch', { name: '봇 상대' });
await bots.waitFor();
// 이미 켜져 있으면(앞선 실행이 도중에 멈춘 경우) 그대로 둔다
if ((await bots.getAttribute('aria-checked')) !== 'true') {
  await bots.click();
  await page.getByText('저장했어요.').waitFor();
}
await page.getByRole('spinbutton').first().fill('3');
const saveButton = page.getByRole('button', { name: '저장', exact: true });
// 값이 이미 같으면 저장 단추가 꺼져 있다
if (await saveButton.isEnabled()) {
  await saveButton.click();
  await page.getByText('저장했어요.').waitFor();
}
await shot(page, 'settings');

for (const [name, wait, file] of [
  ['회원', '닉네임', 'users'],
  ['의견', null, 'feedback'],
  ['채팅', '방 코드', 'chat'],
]) {
  await tab(name).click();
  if (wait) await page.getByPlaceholder(wait, { exact: false }).first().waitFor();
  await page.waitForTimeout(700);
  await shot(page, file);
}

// 새로 고침해도 로그인이 유지되고, 다른 브라우저(쿠키 없음)에서는 로그인 화면이 나온다
await page.reload();
await page.getByText('진행 중인 판').waitFor();
const stranger = await (await browser.newContext()).newPage();
await stranger.goto(`${base}/admin`);
await stranger.getByLabel('관리자 암호').waitFor();
console.log('쿠키 없는 브라우저는 로그인 화면:', true);
await stranger.close();

// 봇과 한 판: 손님이 빠른 매칭을 누르면 잠시 뒤 봇이 상대로 들어온다
const player = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
player.on('pageerror', (e) => console.log('[player] pageerror:', e.message));
await player.goto(base);
await player.getByLabel('닉네임', { exact: true }).fill('혼자놀기');
await player.getByRole('button', { name: '빠른 매칭', exact: true }).click();
await player.getByText('완주').first().waitFor({ timeout: 45000 });
await player.waitForTimeout(2500);
await shot(player, 'bot-start');
const THROW = '꾹 눌러 주사위 던지기';
for (let turn = 0; turn < 4; turn++) {
  // 내 차례면 던지고 4를 선언, 봇 차례면 믿는다
  const mine = player.getByRole('button', { name: THROW, exact: true });
  const accept = player.getByRole('button', { name: '믿기', exact: true });
  await Promise.race([mine.waitFor({ timeout: 40000 }), accept.waitFor({ timeout: 40000 })]);
  if (await accept.isVisible()) {
    if (turn < 2) await shot(player, `bot-claimed-${turn}`);
    await accept.click();
  } else {
    const box = await mine.boundingBox();
    await player.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await player.mouse.down();
    await player.waitForTimeout(250);
    await player.mouse.up();
    await player.getByRole('button', { name: '4', exact: true }).click();
  }
  await player.waitForTimeout(600);
}
await player.waitForTimeout(3000);
await shot(player, 'bot-playing');
// 봇과 판이 진행 중일 때의 한눈에 보기
await tab('한눈에 보기').click();
await page.getByText('게임 중').first().waitFor({ timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}admin-eye.png`, fullPage: true });
console.log('saved admin-eye.png');
await page.getByRole('button', { name: /^\d\d-\d\d: / }).nth(13).hover();
await page.waitForTimeout(300);
await shot(page, 'eye-hover');
await tab('활동 기록').click();
await page.getByText('설정 변경').first().waitFor();
await shot(page, 'log');
await player.close();

// 봇을 다시 끈다
await tab('게임 설정').click();
await bots.waitFor();
if ((await bots.getAttribute('aria-checked')) === 'true') await bots.click();
await page.getByText('저장했어요.').waitFor();
console.log('봇 스위치 끔:', (await bots.getAttribute('aria-checked')) === 'false');
await browser.close();

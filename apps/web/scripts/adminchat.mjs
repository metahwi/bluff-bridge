// 관리자 페이지의 채팅 탭 확인용: 두 사람이 친구 방에서 이야기하며 한 판을 하고(한 명이 나가서 끝남),
// 관리자 페이지에서 그 방의 대화가 한 묶음으로 보이는지 찍는다. 사용: node scripts/adminchat.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const out = fileURLToPath(new URL('../.shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const base = 'http://localhost:5173';
const password = readFileSync(new URL('../../server/.dev.vars', import.meta.url), 'utf8').match(/^ADMIN_PASSWORD=(.+)$/m)[1].trim();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const open = async () => {
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  return page;
};
const say = async (page, text) => {
  await page.getByLabel('채팅 입력').fill(text);
  await page.keyboard.press('Enter');
  await page.getByText(text).first().waitFor();
  await page.waitForTimeout(950); // 도배 방지 간격
};
const quick = async (page, text) => {
  await page.getByRole('button', { name: text, exact: true }).click();
  await page.waitForTimeout(950);
};

const a = await open();
await a.goto(base);
await a.getByLabel('닉네임', { exact: true }).fill('수달');
await a.getByRole('button', { name: '친구와 하기 (방 만들기)' }).click();
await a.waitForURL(/\/r\//);
const b = await open();
await b.goto(a.url());
await b.getByLabel('닉네임', { exact: true }).fill('너구리');
await b.getByRole('button', { name: /입장$/ }).click();
await b.getByLabel('채팅 입력').waitFor();

await say(a, '왔어? 한 판 하자');
await say(b, 'ㅇㅇ 준비 누를게');
await quick(b, '안녕!');
await b.getByRole('button', { name: '준비 완료', exact: true }).click();
await a.getByRole('button', { name: '게임 시작', exact: true }).click();
await a.getByText('완주').first().waitFor();
await say(a, '이번엔 안 속는다');
await quick(b, '뻥이지?');
await say(b, '아 미안 나 밥 먹으러 가야 돼');
await b.getByRole('button', { name: '나가기', exact: true }).first().click();
await b.getByRole('dialog').getByRole('button', { name: '나가기', exact: true }).click();
await a.getByRole('button', { name: '다시 하기' }).waitFor({ timeout: 20000 });
await say(a, '에이 도망갔네');

const admin = await open();
await admin.goto(`${base}/admin`);
await admin.getByLabel('관리자 암호').fill(password);
await admin.getByRole('button', { name: '들어가기' }).click();
await admin.getByText('진행 중인 판').waitFor();
await admin.getByRole('navigation').getByRole('button', { name: '채팅', exact: true }).click();
await admin.getByText('왔어? 한 판 하자').waitFor();
await admin.screenshot({ path: `${out}admin-chatrooms.png` });
console.log('saved admin-chatrooms.png');
await admin.getByLabel('방 코드, 닉네임, 내용으로 찾기').fill('너구리');
await admin.waitForTimeout(300);
console.log('"너구리"로 찾은 방 수:', await admin.locator('.admRoom').count());
await admin.getByLabel('방 코드, 닉네임, 내용으로 찾기').fill('');
await admin.getByLabel(/정해진 말만 오간 방도 보기/).check();
await admin.getByLabel(/점검용 계정의 방도 보기/).check();
await admin.waitForTimeout(300);
await admin.screenshot({ path: `${out}admin-chatrooms-all.png` });
console.log('saved admin-chatrooms-all.png · 전체 방 수:', await admin.locator('.admRoom').count());
await browser.close();

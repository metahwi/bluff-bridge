// 가입 유도 확인용: 게스트의 첫 화면(잠긴 전적), 판이 끝난 뒤의 가입 권유, 눌렀을 때 가입 양식이 열리는지,
// 가입하면 전적이 보이는지. 사용: node scripts/join.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const out = fileURLToPath(new URL('../.shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const base = 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const open = async () => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  return page;
};
const shot = async (page, name, full = false) => {
  await page.screenshot({ path: `${out}join-${name}.png`, fullPage: full });
  console.log('saved', `join-${name}.png`);
};

const a = await open();
await a.goto(base);
await a.getByLabel('닉네임', { exact: true }).waitFor();
await a.waitForTimeout(1000);
await shot(a, 'home-visitor', true);
await a.getByLabel('닉네임', { exact: true }).fill('수달');
await a.getByRole('button', { name: '친구와 하기 (방 만들기)' }).click();
await a.waitForURL(/\/r\//);
const b = await open();
await b.goto(a.url());
await b.getByLabel('닉네임', { exact: true }).fill('너구리');
await b.getByRole('button', { name: /입장$/ }).click();
await b.getByRole('button', { name: '준비 완료', exact: true }).click();
await a.getByRole('button', { name: '게임 시작', exact: true }).click();
await a.getByText('완주').first().waitFor();
await b.getByRole('button', { name: '나가기', exact: true }).first().click();
await b.getByRole('dialog').getByRole('button', { name: '나가기', exact: true }).click();

// 이긴 게스트의 결과 화면에 가입 권유가 뜬다
const nudge = a.getByRole('button', { name: '가입하고 전적 쌓기' });
await nudge.waitFor({ timeout: 20000 });
await a.waitForTimeout(1800);
await nudge.scrollIntoViewIfNeeded();
await shot(a, 'result-nudge');
await nudge.click();

// 첫 화면으로 돌아와 가입 양식이 열려 있고, 지금까지 한 판 수가 적혀 있다
await a.getByLabel('비밀번호 (8자 이상)').waitFor();
console.log('가입 양식이 열림 · 닉네임 칸:', await a.getByLabel('닉네임', { exact: true }).nth(1).inputValue());
await a.waitForTimeout(900);
await shot(a, 'signup-open');
console.log('잠긴 전적 안내:', (await a.locator('.lockNote p').innerText()).replace(/\s+/g, ' '));

// 가입하면 회원이 되고, 게스트 때의 판은 전적에 없다(다음 판부터 쌓인다)
await a.getByLabel('이메일').fill(`join-${Math.random().toString(36).slice(2)}@example.com`);
await a.getByLabel('비밀번호 (8자 이상)').fill('hippo-bridge-1234');
await a.getByLabel('만 14세 이상이에요.').check();
await a.getByRole('checkbox').nth(1).check();
await a.getByRole('button', { name: '가입하기', exact: true }).click();
await a.getByText('수달 님으로 로그인됨').waitFor();
await a.waitForTimeout(800);
console.log('가입 후: 잠긴 전적 칸', (await a.locator('.records.locked').count()) === 0 ? '없음' : '남아 있음', '· 전적 칸', (await a.getByText(/^전적 \d+전/).count()) === 0 ? '없음(아직 0판)' : '있음');
await shot(a, 'member-home', true);
await browser.close();

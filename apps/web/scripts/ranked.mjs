// 순위전 확인용: 회원 두 명(한 명은 업무 모드)이 순위전으로 만나 한 판을 하고, 화면을 찍는다.
// 사용: node scripts/ranked.mjs [너비x높이]
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const [width, height] = (process.argv[2] ?? '390x800').split('x').map(Number);
const out = fileURLToPath(new URL('../.shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const base = 'http://localhost:5173';
const tag = width < 600 ? 'm-' : '';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const password = 'ranked-hippo-1234';

/** 게임 화면에서 가입한 뒤, work면 업무 모드로 바꾼다. */
async function member(name, work, size) {
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror:`, e.message));
  await page.goto(base);
  await page.getByLabel('닉네임', { exact: true }).fill(name);
  await page.getByRole('button', { name: '회원가입', exact: true }).click();
  await page.getByLabel('이메일').fill(`shot-${Math.random().toString(36).slice(2)}@example.com`);
  await page.getByLabel('비밀번호 (8자 이상)').fill(password);
  await page.getByLabel('만 14세 이상이에요.').check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: '가입하기', exact: true }).click();
  await page.getByText(`${name} 님으로 로그인됨`).waitFor();
  if (work) {
    await page.evaluate(() => localStorage.setItem('hama:work', 'on'));
    await page.reload();
    await page.getByLabel('담당자 이름').waitFor();
  }
  return page;
}
const shot = async (page, name, full = false) => {
  await page.screenshot({ path: `${out}ranked-${tag}${name}.png`, fullPage: full });
  console.log('saved', `ranked-${tag}${name}.png`);
};

const a = await member('하마왕', false, { width, height });
const b = await member('김대리', true, { width: 1280, height: 800 });
await a.evaluate(() => scrollTo(0, 0));
await a.waitForTimeout(800);
await shot(a, 'home', true);
await shot(b, 'work-home');

// 게스트에게는 순위전 단추가 잠겨 있다
const guest = await (await browser.newContext({ viewport: { width, height } })).newPage();
await guest.goto(base);
await guest.getByLabel('닉네임', { exact: true }).fill('손님');
console.log('게스트의 순위전 단추 잠김:', await guest.getByRole('button', { name: /^순위전/ }).isDisabled());
await guest.close();

await a.getByRole('button', { name: /^순위전/ }).click();
await a.getByText('순위전 상대를 찾는 중…').waitFor();
await shot(a, 'matching');
await b.getByRole('button', { name: '평가 배정 (1대1)' }).click();

// 둘 다 방에 들어와 판이 시작되면, 업무 모드 쪽이 나가서 진다
await a.getByText('순위전', { exact: false }).first().waitFor();
await a.getByText('완주').first().waitFor({ timeout: 15000 }).catch(async (e) => {
  await shot(a, 'debug-a');
  await shot(b, 'debug-b');
  throw e;
});
await b.getByText('1단계').waitFor({ timeout: 30000 });
await a.waitForTimeout(2500);
await shot(a, 'playing');
await b.getByRole('button', { name: '닫기', exact: true }).first().click();
await b.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
await a.getByRole('button', { name: '다시 매칭' }).waitFor({ timeout: 30000 });
await a.waitForTimeout(2200);
await shot(a, 'result');

// 진 쪽은 첫 화면으로 돌아가 점수가 내려간 것을 본다
await b.getByLabel('담당자 이름').waitFor();
await b.waitForTimeout(500);
await shot(b, 'work-home-after');

// 이긴 쪽이 '다시 매칭'을 누르면 곧바로 순위전 줄에 다시 선다
await a.getByRole('button', { name: '다시 매칭' }).click();
await a.getByText('순위전 상대를 찾는 중…').waitFor();
console.log('다시 매칭 → 순위전 줄에 다시 섬');
await a.getByRole('button', { name: '취소' }).click();
await a.getByLabel('닉네임', { exact: true }).waitFor();
await a.waitForTimeout(600);
await shot(a, 'home-after', true);
await browser.close();

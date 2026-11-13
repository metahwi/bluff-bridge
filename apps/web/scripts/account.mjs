// 가입 → 설정에서 의견 보내기 → 로그아웃 → 로그인 → 탈퇴를 실제 화면으로 해 보며 찍는다.
// 사용: node scripts/account.mjs [너비x높이]
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const [width, height] = (process.argv[2] ?? '390x800').split('x').map(Number);
const out = fileURLToPath(new URL('../.shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const base = 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
const shot = async (name, full = false) => {
  await page.screenshot({ path: `${out}account-${name}.png`, fullPage: full });
  console.log('saved', `account-${name}.png`);
};
const button = (text) => page.getByRole('button', { name: text, exact: true });
const email = `ui-${Date.now()}@example.com`;
const password = 'hippo-bridge-1234';

await page.goto(base);
await page.getByLabel('닉네임', { exact: true }).fill('하마왕');
await button('회원가입').scrollIntoViewIfNeeded();
await button('회원가입').click();
await page.getByLabel('이메일').fill(email);
await page.getByLabel('비밀번호 (8자 이상)').fill(password);
await button('가입하기').click();
await page.getByText('두 항목에 모두 체크해 주세요.').waitFor();
await page.getByLabel('만 14세 이상이에요.').check();
await page.getByRole('checkbox').nth(1).check();
await button('가입하기').scrollIntoViewIfNeeded();
await shot('signup');
await button('가입하기').click();
await page.getByText('하마왕 님으로 로그인됨').waitFor();
await page.getByText('하마왕 님으로 로그인됨').scrollIntoViewIfNeeded();
await shot('member');

// 의견 보내기
await page.getByRole('button', { name: '설정' }).click();
await button('쓰기').click();
await page.getByLabel('의견').fill('휴대폰에서 채팅 입력칸이 조금 작아요. 키웠으면 좋겠어요.');
await shot('feedback');
await button('보내기').click();
await page.getByText('잘 받았어요. 고맙습니다!').waitFor();
await shot('feedback-sent');
await page.keyboard.press('Escape');

// 로그아웃 → 틀린 비밀번호 → 로그인
await button('로그아웃').click();
await button('로그인').click();
await page.getByLabel('이메일').fill(email);
await page.getByLabel('비밀번호', { exact: true }).fill('wrong-password');
await button('이메일로 로그인').click();
await page.getByText('이메일이나 비밀번호가 맞지 않아요.').waitFor();
await page.getByLabel('비밀번호', { exact: true }).fill(password);
await button('이메일로 로그인').click();
await page.getByText('하마왕 님으로 로그인됨').waitFor();
console.log('로그인 확인');

// 게스트는 의견을 보낼 수 없다는 안내(다른 창)
const guest = await (await browser.newContext({ viewport: { width, height } })).newPage();
await guest.goto(base);
await guest.getByRole('button', { name: '설정' }).click();
await guest.getByRole('button', { name: '쓰기', exact: true }).click();
await guest.getByText('로그인한 뒤에 보낼 수 있어요.').waitFor();
await guest.screenshot({ path: `${out}account-feedback-guest.png` });

// 약관 페이지
await guest.goto(`${base}/privacy`);
await guest.getByRole('heading', { name: '개인정보 처리방침' }).waitFor();
await guest.screenshot({ path: `${out}account-privacy.png` });

// 탈퇴
await button('회원 탈퇴').click();
await page.getByLabel('비밀번호 (이메일로 가입한 경우)').fill(password);
await button('탈퇴하기').scrollIntoViewIfNeeded();
await shot('leave');
await button('탈퇴하기').click();
await button('회원가입').waitFor();
console.log('탈퇴 확인');
await browser.close();

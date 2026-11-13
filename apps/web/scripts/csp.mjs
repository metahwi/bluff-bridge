// 배포될 파일 그대로(게임 서버 8787이 주는 화면 + 보안 헤더)에서 화면이 깨지지 않는지 본다.
// 보안 정책(CSP)에 막힌 것이 있으면 콘솔 오류로 나온다. 사용: node scripts/csp.mjs
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:8787';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

const res = await page.goto(base);
const h = res.headers();
for (const k of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy']) console.log(k + ':', h[k] ? 'ok' : 'MISSING');
await page.getByLabel('닉네임', { exact: true }).fill('검사');
await page.waitForTimeout(1500);
// 업무 모드(탭 아이콘이 data: 그림)와 설정 창
await page.getByRole('button', { name: '설정' }).click();
await page.getByRole('switch', { name: '업무 모드' }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '설정' }).click();
await page.getByRole('switch', { name: '업무 모드' }).click();
await page.keyboard.press('Escape');
// 방을 만들어 3D 무대, 실시간 연결, 소리를 쓴다
await page.getByRole('button', { name: '친구와 하기 (방 만들기)' }).click();
await page.waitForURL(/\/r\//);
await page.getByText('친구를 기다리는 중…').waitFor();
await page.getByLabel('채팅 입력').fill('안녕');
await page.keyboard.press('Enter');
await page.getByText('안녕').first().waitFor();
await page.waitForTimeout(1500);
for (const path of ['/admin', '/privacy']) {
  await page.goto(base + path);
  await page.waitForTimeout(800);
}
console.log(problems.length ? '문제:\n' + [...new Set(problems)].join('\n') : '콘솔 오류 없음');
await browser.close();
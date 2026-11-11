// 새 방문자가 닉네임을 넣고 빠른 매칭을 누를 때 로그인 요청이 어떻게 응답하는지 기록한다.
// 사용: node scripts/guest-check.mjs [주소] [동시에 접속할 사람 수] [반복 횟수]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const parallel = Number(process.argv[3] ?? 4);
const rounds = Number(process.argv[4] ?? 3);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

let n = 0;
async function visitor() {
  const id = ++n;
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const page = await context.newPage();
  const calls = [];
  page.on('response', async (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/ws/')) return;
    let body = '';
    if (res.status() >= 400) body = (await res.text().catch(() => '')).slice(0, 120);
    calls.push(`${res.request().method()} ${url.pathname} ${res.status()}${body ? ' ' + body : ''}`);
  });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.getByLabel('닉네임').fill('손님' + id);
  await page.getByRole('button', { name: '빠른 매칭', exact: true }).click();
  await page.waitForTimeout(3500);
  const alert = await page.locator('[role=alert]').allInnerTexts();
  const waiting = await page.getByText('상대를 찾는 중').count();
  const cookies = (await context.cookies()).map((c) => c.name);
  const inRoomUrl = page.url();
  void inRoomUrl;
  const bad = calls.filter((c) => / [45]\d\d/.test(c));
  const result = async (r) => {
    await context.close();
    return r;
  };
  // 동시에 들어온 사람끼리 바로 매칭되면 대기 화면이 아니라 방으로 넘어간다. 그것도 정상이다.
  const inRoom = /\/r\//.test(page.url());
  return result({ id, ok: (waiting > 0 || inRoom) && !alert.length && !bad.length, alert, bad, cookies, calls });
}

let failures = 0;
for (let r = 0; r < rounds; r++) {
  const results = await Promise.all(Array.from({ length: parallel }, visitor));
  for (const v of results) {
    if (!v.ok) failures++;
    console.log(`#${v.id} ${v.ok ? '정상' : '실패'}${v.alert.length ? ' 화면 오류: ' + v.alert.join(' / ') : ''}${v.bad.length ? ' | ' + v.bad.join(' | ') : ''}${v.ok ? '' : ' | 쿠키: ' + v.cookies.join(',')}`);
  }
}
console.log(`\n${n}명 중 ${failures}명 실패`);
await browser.close();

// 소리 점검. 사람 귀 대신 숫자로 확인한다: 음악과 효과음의 음량, 그리고 클릭 후 실제로 재생이 시작되는지.
// peak가 1에 가까우면 찢어지고, rms가 0에 가까우면 안 들린다.
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
await page.goto('http://localhost:5173/?stage=idle', { waitUntil: 'networkidle' });

const names = ['music', 'hop', 'roll', 'suspense', 'lie', 'truth', 'whoosh', 'splash', 'crunch', 'munch', 'bone', 'burp', 'win', 'lose'];
for (const name of names) {
  const r = await page.evaluate((n) => window.__sound.measure(n), name);
  const verdict = r.rms < 0.005 ? '너무 작음' : r.peak > 0.98 ? '찢어질 수 있음' : '정상';
  console.log(name.padEnd(9), `peak ${String(r.peak).padEnd(6)} rms ${String(r.rms).padEnd(7)} ${r.seconds}s  ${verdict}`);
}

const before = await page.evaluate(() => window.__sound.ctx?.state ?? 'none');
await page.mouse.click(450, 300);
await page.waitForTimeout(1200);
const after = await page.evaluate(() => ({ state: window.__sound.ctx?.state ?? 'none', steps: window.__sound.step, time: window.__sound.ctx?.currentTime }));
console.log(`클릭 전: ${before} → 클릭 후: ${after.state}, 예약된 음표 칸 ${after.steps}, 재생 시간 ${after.time?.toFixed(2)}초`);

await page.getByRole('button', { name: '소리 켜짐' }).click();
await page.waitForTimeout(300);
console.log('끄기 단추 후:', await page.evaluate(() => window.__sound.ctx.state), '| 단추 글자:', await page.locator('.soundToggle').innerText());

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : '오류 없음');
await browser.close();

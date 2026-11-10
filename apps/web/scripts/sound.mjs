// 소리 점검. 사람 귀 대신 숫자로 확인한다: 음악과 효과음의 음량, 클릭 후 재생 시작, 음량 조절과 끄기.
// peak가 1에 가까우면 찢어지고, rms가 0에 가까우면 안 들린다.
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

const names = ['music', 'hop', 'throw', 'dice', 'cup', 'suspense', 'lie', 'truth', 'whoosh', 'splash', 'crunch', 'munch', 'bone', 'burp', 'win', 'lose'];
for (const name of names) {
  const r = await page.evaluate((n) => window.__sound.measure(n), name);
  const verdict = r.rms < 0.004 ? '너무 작음' : r.peak > 0.98 ? '찢어질 수 있음' : '정상';
  console.log(name.padEnd(9), `peak ${String(r.peak).padEnd(6)} rms ${String(r.rms).padEnd(7)} ${verdict}`);
}

const state = () =>
  page.evaluate(() => {
    const s = window.__sound;
    return `${s.ctx?.state ?? 'none'} · 음량 ${s.volume} · 실제 출력 ${s.master ? s.master.gain.value.toFixed(3) : '-'}`;
  });
console.log('클릭 전:', await state());
await page.mouse.click(450, 500);
await page.waitForTimeout(1200);
console.log('클릭 후:', await state());

const slider = page.getByLabel('음량');
await slider.fill('30');
await page.waitForTimeout(400);
console.log('음량 30:', await state());
await slider.fill('100');
await page.waitForTimeout(400);
console.log('음량 100:', await state());

await page.getByRole('button', { name: '소리 켜짐' }).click();
await page.waitForTimeout(300);
console.log('끄기 후:', await state(), '· 단추:', await page.locator('.soundControl button').innerText());
await slider.fill('50');
await page.waitForTimeout(400);
console.log('끈 상태에서 막대를 올림:', await state(), '· 단추:', await page.locator('.soundControl button').innerText());

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : '오류 없음');
await browser.close();

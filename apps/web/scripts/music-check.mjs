// 음악이 실제로 흘러나오는지 확인한다: 클릭 후 음표가 계속 예약되는지, 출력 신호가 0이 아닌지.
// 사용: node scripts/music-check.mjs [주소]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));

// 페이지가 만드는 AudioContext의 최종 출력에 측정기를 끼워 넣는다(운영 사이트에서도 잴 수 있게).
await page.addInitScript(() => {
  const Original = window.AudioContext;
  window.__probes = [];
  window.AudioContext = class extends Original {
    constructor(...args) {
      super(...args);
      const analyser = this.createAnalyser();
      analyser.fftSize = 2048;
      const real = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'destination').get.call(this);
      analyser.connect(real);
      Object.defineProperty(this, 'destination', { get: () => analyser });
      window.__probes.push({ ctx: this, analyser });
    }
  };
});

await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.mouse.click(600, 60);

const sample = () =>
  page.evaluate(() => {
    const p = window.__probes[0];
    if (!p) return { state: 'AudioContext가 만들어지지 않음' };
    const data = new Float32Array(p.analyser.fftSize);
    p.analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    return { state: p.ctx.state, time: +p.ctx.currentTime.toFixed(2), peak: +peak.toFixed(4) };
  });

let heard = 0;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(250);
  const s = await sample();
  if (s.peak > 0.001) heard++;
  if (i % 3 === 2) console.log(JSON.stringify(s));
}
console.log(heard > 0 ? `소리 신호 있음 (12번 중 ${heard}번 측정됨)` : '소리 신호 없음: 음악이 나오지 않는다');
console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : '오류 없음');
await browser.close();
process.exit(heard > 0 && !problems.length ? 0 : 1);

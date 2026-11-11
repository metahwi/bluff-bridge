// 3~4명 대결 확인용: 브라우저 여러 개로 실제 한 판을 끝까지 하며 화면을 찍는다. 세 번째 사람은 업무 모드로 본다.
// 사용: node scripts/multi.mjs [인원=4] [너비x높이]
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const count = Number(process.argv[2] ?? 4);
const [width, height] = (process.argv[3] ?? '1280x800').split('x').map(Number);
const out = fileURLToPath(new URL('../.shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const base = 'http://localhost:5173';
const tag = `multi${count}-${width < 600 ? 'm-' : ''}`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function player(name, work) {
  const context = await browser.newContext({ viewport: { width, height } });
  if (work) await context.addInitScript(() => localStorage.setItem('hama:work', 'on'));
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror:`, e.message));
  page.on('console', (m) => m.type() === 'error' && console.log(`[${name}] console:`, m.text()));
  return { page, name, work };
}
const shot = async (p, name) => {
  await p.page.screenshot({ path: `${out}${tag}${name}.png` });
  console.log('saved', `${tag}${name}.png`);
};
const shots = new Set();
const once = async (p, name) => {
  if (shots.has(name)) return;
  shots.add(name);
  await shot(p, name);
};
const button = (p, text) => p.page.getByRole('button', { name: text, exact: true });

const names = ['에이', '비', '김대리', '디'].slice(0, count);
const people = [];
for (const [i, name] of names.entries()) people.push(await player(name, i === 2));
const [host, ...guests] = people;

await host.page.goto(base);
await host.page.getByLabel('닉네임').fill(host.name);
await button(host, '친구와 하기 (방 만들기)').click();
await host.page.waitForURL(/\/r\//);
const link = host.page.url();
await host.page.waitForTimeout(600);
await shot(host, 'lobby-alone');

for (const g of guests) {
  await g.page.goto(link);
  if (g.work) {
    await g.page.getByLabel('담당자 이름').fill(g.name);
    await button(g, '열기').click();
  } else {
    await g.page.getByLabel('닉네임').fill(g.name);
    await g.page.getByRole('button', { name: /입장$/ }).click();
  }
  await button(g, '준비 완료').click();
}
await host.page.waitForTimeout(600);
await shot(host, 'lobby-full');
const worker = people.find((p) => p.work);
if (worker) await shot(worker, 'work-lobby');
await button(host, '게임 시작').click();
await host.page.getByText('완주').first().waitFor();
await host.page.waitForTimeout(2200);
await shot(host, 'start');

const rollLabel = (p) => (p.work ? '다시 계산 (F9)' : '꾹 눌러 주사위 던지기');
const acceptLabel = (p) => (p.work ? '승인' : '믿기');
const doubtLabel = (p) => (p.work ? '감사 요청' : '의심하기');
const overText = (p) => (p.work ? p.page.getByText('분기 결산') : p.page.getByRole('button', { name: /다시 하기|상대를 기다리는 중/ }));

for (let turn = 0; turn < 120; turn++) {
  await Promise.race([...people.map((p) => button(p, rollLabel(p)).waitFor()), overText(host).waitFor()]);
  if (await overText(host).isVisible()) break;
  let roller;
  for (const p of people) if (await button(p, rollLabel(p)).isVisible()) roller = p;
  if (!roller) continue;
  if (roller.work) await button(roller, rollLabel(roller)).click();
  else {
    const box = await button(roller, rollLabel(roller)).boundingBox();
    await roller.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await roller.page.mouse.down();
    await roller.page.waitForTimeout(250);
    await roller.page.mouse.up();
  }
  await button(roller, '4').click();

  // 응답: 세 턴에 한 번은 마지막으로 누르는 사람이 의심한다(앞사람을 기다리는 화면을 보려고 거꾸로 누른다).
  const others = [];
  for (const p of people) {
    if (p === roller) continue;
    try {
      await button(p, acceptLabel(p)).waitFor({ timeout: 4000 });
      others.push(p);
    } catch {
      // 탈락해서 구경 중인 사람
    }
  }
  const doubtTurn = turn % 3 === 2;
  if (others[0] && !others[0].work) await once(others[0], 'respond');
  if (worker && others.includes(worker)) await once(worker, 'work-respond');
  for (const [i, p] of others.entries()) {
    const doubt = doubtTurn && i === 0;
    if (doubtTurn && i === 0) {
      // 차례가 먼 사람부터 믿기를 눌러 두고, 이 사람은 맨 나중에 의심한다
      continue;
    }
    if (!(await button(p, acceptLabel(p)).isVisible())) continue;
    await button(p, doubt ? doubtLabel(p) : acceptLabel(p)).click();
    await p.page.waitForTimeout(150);
    if (i === 1 && !p.work) await once(p, 'replied-waiting');
    if (i === 1) await once(host, 'someone-replied');
  }
  if (doubtTurn && others[0] && (await button(others[0], doubtLabel(others[0])).isVisible())) {
    await button(others[0], doubtLabel(others[0])).click();
    await host.page.waitForTimeout(3200);
    await once(host, 'chomp');
    if (worker) await once(worker, 'work-audit');
  } else {
    await host.page.waitForTimeout(900);
    await once(host, 'moved');
  }
}
await overText(host).waitFor({ timeout: 30000 });
await host.page.waitForTimeout(2500);
await shot(host, 'result');
if (worker) await shot(worker, 'work-result');
await browser.close();

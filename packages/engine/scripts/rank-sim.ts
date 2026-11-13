// 순위전 점수가 실제로 어떻게 퍼지는지 본다(티어 구간을 정하는 데 쓴다).
// 실력이 다른 봇 여럿이 점수가 비슷한 상대와 계속 붙는다. 사용: node scripts/rank-sim.ts [사람 수] [한 사람당 판 수]
import { DEFAULT_BOT, RATING_START, TIER_FLOORS, awaiting, botAction, createGame, rate, reduce, tierOf, viewFor } from '../src/index.ts';
import type { BotConfig } from '../src/index.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(777);

interface Bot {
  cfg: BotConfig;
  /** 0(서툼) ~ 1(능숙). 표시용. */
  skill: number;
  rating: number;
  games: number;
}

/**
 * 실력 차이를 흉내 낸다. 서툰 봇은 큰 숫자를 자주 뻥치면서도 남의 선언은 거의 의심하지 않고,
 * 능숙한 봇은 뻥을 아끼고 큰 숫자 선언을 잘 의심한다.
 */
function makeBot(skill: number): Bot {
  return {
    skill,
    cfg: { bluffRate: 0.5 - 0.4 * skill, challengeBase: 0.02 + 0.06 * skill, challengeSlope: 0.02 + 0.14 * skill },
    rating: RATING_START,
    games: 0,
  };
}

function play(a: Bot, b: Bot): number {
  let s = createGame(['a', 'b'], undefined, rng() < 0.5 ? 0 : 1);
  while (s.phase !== 'over') {
    const who = awaiting(s)!;
    s = reduce(s, who, botAction(viewFor(s, who), rng, who === 0 ? a.cfg : b.cfg), rng).state;
  }
  return s.winner!;
}

const people = Number(process.argv[2] ?? 200);
const perPerson = Number(process.argv[3] ?? 60);
const bots = Array.from({ length: people }, (_, i) => makeBot(i / (people - 1)));

for (let round = 0; round < perPerson; round++) {
  // 점수가 가까운 사람끼리 짝짓는다(약간의 무작위를 섞어 늘 같은 상대만 만나지 않게).
  const order = [...bots].sort((x, y) => x.rating + rng() * 60 - (y.rating + rng() * 60));
  for (let i = 0; i + 1 < order.length; i += 2) {
    const [x, y] = [order[i]!, order[i + 1]!];
    const [w, l] = play(x, y) === 0 ? [x, y] : [y, x];
    const d = rate(w, l);
    w.rating += d.winner;
    l.rating += d.loser;
    w.games++;
    l.games++;
  }
}

const sorted = bots.map((b) => b.rating).sort((x, y) => x - y);
const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
console.log(`${people}명이 ${perPerson}판씩 한 뒤의 점수`);
console.log(`최저 ${sorted[0]} · 하위 10% ${pick(0.1)} · 25% ${pick(0.25)} · 중간 ${pick(0.5)} · 75% ${pick(0.75)} · 상위 10% ${pick(0.9)} · 상위 3% ${pick(0.97)} · 최고 ${sorted.at(-1)}`);
const counts = TIER_FLOORS.map(() => 0);
for (const b of bots) counts[tierOf(b.rating)]!++;
console.log('티어별 인원: ' + TIER_FLOORS.map((floor, i) => `${floor}+ ${((100 * counts[i]!) / people).toFixed(0)}%`).join(' | '));
// 실력과 점수가 얼마나 같이 가는지(1에 가까울수록 실력이 점수에 잘 드러난다)
const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;
const [ms, mr] = [mean(bots.map((b) => b.skill)), mean(bots.map((b) => b.rating))];
const cov = mean(bots.map((b) => (b.skill - ms) * (b.rating - mr)));
const sd = (xs: number[], m: number) => Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
console.log(`실력과 점수의 상관: ${(cov / (sd(bots.map((b) => b.skill), ms) * sd(bots.map((b) => b.rating), mr))).toFixed(2)}`);
void DEFAULT_BOT;

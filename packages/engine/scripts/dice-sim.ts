// 주사위 구성을 바꿨을 때 게임이 어떻게 달라지는지 본다(꽝 비율 조정용).
// 선언할 수 있는 숫자는 주사위에 있는 숫자들로 본다. 사용: node scripts/dice-sim.ts [판 수]
import { BLANK, RULES, awaiting, createGame, reduce, viewFor } from '../src/index.ts';
import type { Action, PlayerView, Rules } from '../src/index.ts';

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

/** 주사위에 있는 숫자만 선언하는 봇. 큰 숫자일수록 더 의심한다. */
function bot(view: PlayerView, rng: () => number, faces: number[]): Action {
  if (view.phase === 'roll') return { type: 'roll' };
  if (view.phase === 'claim') {
    const die = view.die!;
    const higher = faces.filter((f) => f > die);
    if (die === BLANK) return { type: 'claim', value: faces[Math.floor(rng() * faces.length)]! };
    if (higher.length && rng() < 0.25) return { type: 'claim', value: higher[Math.floor(rng() * higher.length)]! };
    return { type: 'claim', value: die };
  }
  const rank = faces.indexOf(view.claim!) / Math.max(1, faces.length - 1); // 0 = 가장 작은 숫자, 1 = 가장 큰 숫자
  return { type: rng() < 0.05 + 0.32 * rank ? 'challenge' : 'accept' };
}

function run(label: string, dieFaces: number[], games: number, change: Partial<Rules> = {}): void {
  const faces = [...new Set(dieFaces.filter((f) => f !== BLANK))].sort((a, b) => a - b);
  const rules: Rules = { ...RULES, ...change, dieFaces, maxClaim: Math.max(...faces) };
  const rng = mulberry32(2024);
  let rounds = 0;
  let short = 0;
  let first = 0;
  let eaten = 0;
  for (let g = 0; g < games; g++) {
    let s = createGame(['a', 'b'], rules);
    while (s.phase !== 'over') {
      const who = awaiting(s)!;
      s = reduce(s, who, bot(viewFor(s, who), rng, faces), rng).state;
    }
    rounds += s.round;
    if (s.winner === 0) first++;
    if (s.players[s.winner!]!.finished < rules.finishesToWin) short++;
    eaten += s.players[0]!.lost + s.players[1]!.lost;
  }
  const blank = dieFaces.filter((f) => f === BLANK).length / dieFaces.length;
  const pct = (n: number) => ((100 * n) / games).toFixed(1) + '%';
  console.log(
    `${label.padEnd(24)} 꽝 ${(blank * 100).toFixed(1).padStart(4)}% | 평균 ${(rounds / games).toFixed(1)}턴 | ` +
      `선공 승률 ${pct(first)} | 3번을 못 채우고 끝난 판 ${pct(short)} | 한 판에 먹히는 말 ${(eaten / games).toFixed(1)}마리`,
  );
}

const games = Number(process.argv[2] ?? 20000);
console.log(`2인, 말 ${RULES.runners}개, 완주 ${RULES.finishesToWin}번, 다리 ${RULES.bridgeLength}칸 · ${games}판씩\n`);
run('1 2 3 4 5 꽝 (지금)', [1, 2, 3, 4, 5, 0], games);
run('1 2 3 5 꽝 꽝', [1, 2, 3, 5, 0, 0], games);
run('2 3 4 5 꽝 꽝', [2, 3, 4, 5, 0, 0], games);
run('1 2 3 4 꽝 꽝', [1, 2, 3, 4, 0, 0], games);

console.log('\n주사위 1 2 3 4 꽝 꽝에서 다리 길이와 말 수를 바꾸면:');
for (const bridgeLength of [9, 8, 7]) run(`다리 ${bridgeLength}칸 · 말 7개`, [1, 2, 3, 4, 0, 0], games, { bridgeLength });
for (const runners of [8, 9]) run(`다리 10칸 · 말 ${runners}개`, [1, 2, 3, 4, 0, 0], games, { runners });
run('다리 8칸 · 말 8개', [1, 2, 3, 4, 0, 0], games, { bridgeLength: 8, runners: 8 });

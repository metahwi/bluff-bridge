// 봇끼리 대결시켜 규칙 숫자의 밸런스를 본다.
// 사용: node scripts/sim.ts [판 수]
import { RULES, awaiting, botAction, createGame, reduce, viewFor } from '../src/index.ts';
import type { Rules } from '../src/index.ts';

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

function run(label: string, playerCount: number, rules: Rules, games: number): void {
  const rng = mulberry32(12345);
  const wins = new Array<number>(playerCount).fill(0);
  let rounds = 0;
  let maxRounds = 0;
  let byElimination = 0;

  for (let g = 0; g < games; g++) {
    let state = createGame(
      Array.from({ length: playerCount }, (_, i) => `P${i + 1}`),
      rules,
    );
    while (state.phase !== 'over') {
      const who = awaiting(state)!;
      state = reduce(state, who, botAction(viewFor(state, who), rng), rng).state;
    }
    wins[state.winner!]!++;
    rounds += state.round;
    maxRounds = Math.max(maxRounds, state.round);
    if (state.players[state.winner!]!.finished < rules.finishesToWin) byElimination++;
  }

  const pct = (n: number) => ((100 * n) / games).toFixed(1) + '%';
  console.log(
    `${label.padEnd(34)} 평균 ${(rounds / games).toFixed(1)}턴 (최장 ${maxRounds}) | ` +
      `순서별 승률 ${wins.map(pct).join(' / ')} | 탈락으로 끝난 판 ${pct(byElimination)}`,
  );
}

const games = Number(process.argv[2] ?? 20000);
console.log(`${games}판씩 시뮬레이션\n`);

run('2인 · 기본 규칙', 2, RULES, games);
run('4인 · 기본 규칙', 4, RULES, games);
for (const bridgeLength of [8, 12]) {
  run(`2인 · 다리 ${bridgeLength}칸`, 2, { ...RULES, bridgeLength }, games);
}
for (const runners of [4, 6]) {
  run(`2인 · 말 ${runners}개`, 2, { ...RULES, runners }, games);
}
run('2인 · 3개 완주', 2, { ...RULES, finishesToWin: 3, runners: 6 }, games);

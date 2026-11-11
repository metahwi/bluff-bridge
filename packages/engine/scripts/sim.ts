// 봇끼리 대결시켜 규칙 숫자의 밸런스를 본다.
// 사용: node scripts/sim.ts [판 수]
import { DEFAULT_BOT, RULES, awaiting, botAction, createGame, reduce, rulesFor, viewFor } from '../src/index.ts';
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

/**
 * doubt: 한 사람이 의심하는 정도(1 = 2인 때와 같음). 여럿이 동시에 응답하면 "누가 하겠지" 하고
 * 각자는 덜 의심하게 되므로, 사람이 많을 때는 낮춘 값으로도 본다.
 */
function run(label: string, playerCount: number, rules: Rules, games: number, doubt = 1): void {
  const rng = mulberry32(12345);
  const cfg = { ...DEFAULT_BOT, challengeBase: DEFAULT_BOT.challengeBase * doubt, challengeSlope: DEFAULT_BOT.challengeSlope * doubt };
  const wins = new Array<number>(playerCount).fill(0);
  let rounds = 0;
  let maxRounds = 0;
  let byElimination = 0;
  let eaten = 0;

  for (let g = 0; g < games; g++) {
    let state = createGame(
      Array.from({ length: playerCount }, (_, i) => `P${i + 1}`),
      rules,
    );
    while (state.phase !== 'over') {
      const who = awaiting(state)!;
      state = reduce(state, who, botAction(viewFor(state, who), rng, cfg), rng).state;
    }
    wins[state.winner!]!++;
    rounds += state.round;
    maxRounds = Math.max(maxRounds, state.round);
    eaten += state.players.reduce((n, p) => n + p.lost, 0);
    if (state.players[state.winner!]!.finished < rules.finishesToWin) byElimination++;
  }

  const pct = (n: number) => ((100 * n) / games).toFixed(1) + '%';
  console.log(
    `${label.padEnd(30)} 평균 ${(rounds / games).toFixed(1).padStart(5)}턴 (최장 ${String(maxRounds).padStart(3)}) | ` +
      `순서별 승률 ${wins.map(pct).join(' / ')} | 완주 수를 못 채운 판 ${pct(byElimination).padStart(5)} | 먹힌 말 ${(eaten / games).toFixed(1)}`,
  );
}

const games = Number(process.argv[2] ?? 20000);
console.log(`${games}판씩 시뮬레이션\n`);

for (const n of [2, 3, 4]) {
  const r = rulesFor(n);
  run(`${n}인 · 지금 규칙 (말 ${r.runners}, 완주 ${r.finishesToWin})`, n, r, games);
}
console.log('');
for (const n of [3, 4]) {
  for (const doubt of [1, 0.6]) {
    for (const [runners, finishesToWin] of [
      [7, 3],
      [6, 3],
      [5, 2],
      [6, 2],
      [4, 2],
    ] as const) {
      run(`${n}인 · 의심 ${doubt} · 말 ${runners} 완주 ${finishesToWin}`, n, { ...RULES, runners, finishesToWin }, games, doubt);
    }
    console.log('');
  }
}

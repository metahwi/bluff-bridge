import { describe, expect, it } from 'vitest';
import {
  BLANK,
  GameError,
  RULES,
  awaiting,
  createGame,
  forfeit,
  reduce,
  scoreOf,
  K_NORMAL,
  K_PLACEMENT,
  PLACEMENT_GAMES,
  RATING_START,
  TIER_FLOORS,
  expected,
  pending,
  rate,
  rulesFor,
  tierOf,
  toNextTier,
  timeout,
  timeoutAction,
  viewEvent,
  viewFor,
} from '../src/index.ts';
import type { Action, GameState } from '../src/index.ts';

/** 원하는 눈이 나오게 하는 rng. */
const rngFor = (face: number) => () => RULES.dieFaces.indexOf(face) / RULES.dieFaces.length;

function play(state: GameState, player: number, action: Action, face = 1) {
  return reduce(state, player, action, rngFor(face));
}

/** 굴리기 → 선언까지 진행. */
function toRespond(state: GameState, face: number, claim: number): GameState {
  const roller = state.turn;
  let s = play(state, roller, { type: 'roll' }, face).state;
  s = play(s, roller, { type: 'claim', value: claim }).state;
  return s;
}

/** 시작할 때 출발 지점에 한 개를 올리고 남는 대기 말 수. */
const RESERVE = RULES.runners - 1;
/** 선언할 수 있는 가장 큰 숫자와 다리 길이. 규칙 숫자를 바꿔도 테스트가 따라가게 한다. */
const MAX = RULES.maxClaim;
const LEN = RULES.bridgeLength;

describe('시작', () => {
  it('각자 말 하나를 출발 지점에 올리고 나머지는 대기', () => {
    const s = createGame(['a', 'b']);
    expect(s.players.map((p) => [p.pos, p.reserve])).toEqual([
      [0, RESERVE],
      [0, RESERVE],
    ]);
    expect([s.phase, s.turn, awaiting(s)]).toEqual(['roll', 0, 0]);
  });

  it('인원 수가 범위를 벗어나면 거부', () => {
    expect(() => createGame(['a'])).toThrow();
    expect(() => createGame(['a', 'b', 'c', 'd', 'e'])).toThrow();
  });
});

describe('차례와 단계 검증', () => {
  it('차례가 아닌 사람은 행동할 수 없다', () => {
    const s = createGame(['a', 'b']);
    expect(() => play(s, 1, { type: 'roll' })).toThrow(GameError);
  });

  it('단계에 맞지 않는 행동은 거부', () => {
    const s = createGame(['a', 'b']);
    expect(() => play(s, 0, { type: 'claim', value: 3 })).toThrow(GameError);
    expect(() => play(s, 0, { type: 'accept' })).toThrow(GameError);
  });

  it('범위를 벗어난 선언은 거부', () => {
    const s = play(createGame(['a', 'b']), 0, { type: 'roll' }, 3).state;
    for (const value of [0, MAX + 1, 2.5, NaN]) {
      expect(() => play(s, 0, { type: 'claim', value })).toThrow(GameError);
    }
  });

  it('입력 state를 변경하지 않는다', () => {
    const s = createGame(['a', 'b']);
    const before = JSON.stringify(s);
    play(s, 0, { type: 'roll' }, 4);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('믿기', () => {
  it('거짓말이어도 선언한 만큼 전진하고 차례가 넘어간다', () => {
    const s = play(toRespond(createGame(['a', 'b']), BLANK, MAX), 1, { type: 'accept' }).state;
    expect(s.players[0]!.pos).toBe(MAX);
    expect([s.phase, s.turn, s.die, s.claim]).toEqual(['roll', 1, null, null]);
  });
});

describe('의심하기', () => {
  it('거짓말이면 굴린 사람의 말이 추락하고 이동은 없다', () => {
    const { state, events } = play(toRespond(createGame(['a', 'b']), 2, MAX), 1, { type: 'challenge' });
    expect(state.players[0]).toMatchObject({ pos: 0, reserve: RESERVE - 1, lost: 1 });
    expect(state.players[1]).toMatchObject({ pos: 0, reserve: RESERVE, lost: 0 });
    expect(events.find((e) => e.type === 'challenged')).toMatchObject({ type: 'challenged', die: 2, claim: MAX, truth: false, fallen: 0 });
  });

  it('진실이면 의심한 사람의 말이 추락하고 굴린 사람은 전진', () => {
    const { state, events } = play(toRespond(createGame(['a', 'b']), 4, 4), 1, { type: 'challenge' });
    expect(state.players[0]).toMatchObject({ pos: 4, lost: 0 });
    expect(state.players[1]).toMatchObject({ pos: 0, reserve: RESERVE - 1, lost: 1 });
    expect(events.find((e) => e.type === 'challenged')).toMatchObject({ truth: true, fallen: 1 });
  });

  it('꽝은 어떤 선언을 해도 거짓말', () => {
    for (let claim = 1; claim <= RULES.maxClaim; claim++) {
      const { events } = play(toRespond(createGame(['a', 'b']), BLANK, claim), 1, { type: 'challenge' });
      expect(events.find((e) => e.type === 'challenged')).toMatchObject({ truth: false, fallen: 0 });
    }
  });
});

describe('완주와 승패', () => {
  it('다리 끝을 넘으면 완주하고 다음 말이 출발', () => {
    const s0 = createGame(['a', 'b']);
    s0.players[0]!.pos = LEN - 1;
    const { state, events } = play(toRespond(s0, 3, 3), 1, { type: 'accept' });
    expect(state.players[0]).toMatchObject({ finished: 1, pos: 0, reserve: RESERVE - 1 });
    expect(events.some((e) => e.type === 'finished')).toBe(true);
  });

  it('마지막 칸에 정확히 서면 아직 완주가 아니다', () => {
    const s0 = createGame(['a', 'b']);
    s0.players[0]!.pos = LEN - 2;
    const s = play(toRespond(s0, 2, 2), 1, { type: 'accept' }).state;
    expect(s.players[0]).toMatchObject({ finished: 0, pos: LEN });
  });

  it('정해진 수만큼 완주하면 승리', () => {
    const s0 = createGame(['a', 'b']);
    Object.assign(s0.players[0]!, { pos: LEN - 1,finished: RULES.finishesToWin - 1 });
    const { state, events } = play(toRespond(s0, 2, 2), 1, { type: 'accept' });
    expect([state.phase, state.winner]).toEqual(['over', 0]);
    expect(events.at(-1)).toEqual({ type: 'over', winner: 0 });
    expect(() => play(state, 1, { type: 'roll' })).toThrow(GameError);
  });

  it('말을 모두 잃으면 탈락하고 남은 한 명이 승리', () => {
    const s0 = createGame(['a', 'b']);
    Object.assign(s0.players[0]!, { reserve: 0 });
    const { state } = play(toRespond(s0, 1, MAX), 1, { type: 'challenge' });
    expect(state.players[0]).toMatchObject({ out: true, pos: null });
    expect([state.phase, state.winner]).toEqual(['over', 1]);
  });
});

describe('말이 떨어졌을 때의 승패', () => {
  /** a가 마지막 말로 1개를 완주해 말이 없고(1:0), b는 말이 남아 있는 상황. 다음은 b 차례. */
  function leaderOutOfPawns(): GameState {
    const s0 = createGame(['a', 'b']);
    Object.assign(s0.players[0]!, { pos: LEN - 1, reserve: 0 });
    return play(toRespond(s0, 2, 2), 1, { type: 'accept' }).state;
  }

  it('앞서는 사람이 말을 다 써도 판은 끝나지 않고, 남은 사람이 계속 건넌다', () => {
    const s = leaderOutOfPawns();
    expect(s.players[0]).toMatchObject({ finished: 1, out: true });
    expect([s.phase, s.turn, s.winner]).toEqual(['roll', 1, null]);
    // 말이 없는 a는 굴리지 못하고 b가 계속 굴린다. a는 완주한 말이 있으니 의심은 할 수 있다.
    const next = play(toRespond(s, 3, 3), 0, { type: 'accept' }).state;
    expect([next.phase, next.turn, next.players[1]!.pos]).toEqual(['roll', 1, 3]);
  });

  it('말이 없는 사람의 의심이 틀리면 완주한 말을 잃는다', () => {
    const { state, events } = play(toRespond(leaderOutOfPawns(), 3, 3), 0, { type: 'challenge' });
    expect(events.find((e) => e.type === 'challenged')).toMatchObject({ truth: true, fallen: 0, revoked: true });
    expect(state.players[0]).toMatchObject({ finished: 0, lost: 1, out: true });
    // 이제 a는 잃을 말이 없어 의심도 못 한다. b 혼자 건너기만 하면 되므로 판을 끝낸다.
    expect([state.phase, state.winner]).toEqual(['over', 1]);
  });

  it('말이 없는 사람의 의심이 맞으면 완주한 말은 그대로다', () => {
    const { state, events } = play(toRespond(leaderOutOfPawns(), BLANK, 3), 0, { type: 'challenge' });
    expect(events.find((e) => e.type === 'challenged')).toMatchObject({ truth: false, fallen: 1 });
    expect(state.players[0]!.finished).toBe(1);
    expect(state.players[1]!.lost).toBe(1);
    expect(state.phase).toBe('roll');
  });

  it('남은 사람도 말이 다 떨어지면 완주가 많은 사람이 이긴다', () => {
    const s = leaderOutOfPawns();
    Object.assign(s.players[1]!, { reserve: 0 });
    const { state } = play(toRespond(s, BLANK, 3), 0, { type: 'challenge' });
    expect(state.players.map((p) => p.out)).toEqual([true, true]);
    expect([state.phase, state.winner]).toEqual(['over', 0]);
  });

  it('남은 사람이 따라잡으면 완주가 같아도 먹힌 말이 적은 쪽이 이긴다', () => {
    const s = leaderOutOfPawns();
    Object.assign(s.players[0]!, { lost: 3 });
    Object.assign(s.players[1]!, { pos: LEN - 1, reserve: 0, lost: 1 });
    // b가 마지막 말로 완주해 1:1, 둘 다 말이 없다.
    const { state } = play(toRespond(s, 2, 2), 0, { type: 'accept' });
    expect(state.players.map((p) => p.finished)).toEqual([1, 1]);
    expect([state.phase, state.winner]).toEqual(['over', 1]);
  });
  it('둘 다 말이 떨어지고 완주 수가 같으면 굴린 사람이 이긴다', () => {
    const s0 = createGame(['a', 'b']);
    Object.assign(s0.players[0]!, { pos: LEN - 1,reserve: 0 });
    Object.assign(s0.players[1]!, { reserve: 0, finished: 1 });
    // b가 a의 진실을 의심 → b 추락·소진, a는 완주하며 소진. 완주 1:1.
    const { state } = play(toRespond(s0, 2, 2), 1, { type: 'challenge' });
    expect(state.players.map((p) => p.out)).toEqual([true, true]);
    expect([state.phase, state.winner]).toEqual(['over', 0]);
  });
});

describe('여럿이 할 때의 응답', () => {
  const four = () => createGame(['a', 'b', 'c', 'd'], rulesFor(4));

  it('굴린 사람을 뺀 모두가 응답하고, 모두 믿어야 전진한다', () => {
    let s = toRespond(four(), 3, 3);
    expect(pending(s)).toEqual([1, 2, 3]);
    s = play(s, 2, { type: 'accept' }).state;
    expect([s.phase, pending(s)]).toEqual(['respond', [1, 3]]);
    expect(() => play(s, 2, { type: 'challenge' })).toThrow(GameError);
    expect(() => play(s, 0, { type: 'accept' })).toThrow(GameError);
    s = play(s, 1, { type: 'accept' }).state;
    const { state, events } = play(s, 3, { type: 'accept' });
    expect(state.players[0]!.pos).toBe(3);
    expect([state.phase, state.turn]).toEqual(['roll', 1]);
    expect(events.some((e) => e.type === 'accepted')).toBe(true);
  });

  it('여럿이 의심하면 차례가 가장 가까운 사람이 의심자가 된다', () => {
    let s = toRespond(four(), 3, 3); // 진실
    s = play(s, 3, { type: 'challenge' }).state;
    // d가 먼저 눌렀어도 앞 순서인 b, c의 선택을 기다린다
    expect([s.phase, pending(s)]).toEqual(['respond', [1, 2]]);
    s = play(s, 1, { type: 'accept' }).state;
    const { state, events } = play(s, 2, { type: 'challenge' });
    expect(events.find((e) => e.type === 'challenged')).toMatchObject({ challenger: 2, truth: true, fallen: 2 });
    expect(state.players.map((p) => p.lost)).toEqual([0, 0, 1, 0]);
    expect(state.stats.map((x) => x.challenges)).toEqual([0, 0, 1, 0]);
  });

  it('가장 가까운 사람이 의심하면 나머지를 기다리지 않고 바로 공개한다', () => {
    const { state, events } = play(toRespond(four(), BLANK, 2), 1, { type: 'challenge' });
    expect(events.find((e) => e.type === 'challenged')).toMatchObject({ challenger: 1, truth: false, fallen: 0 });
    expect([state.phase, state.turn]).toEqual(['roll', 1]);
    expect(state.replies).toEqual([null, null, null, null]);
  });

  it('탈락한 사람은 응답하지 않고 차례도 건너뛴다', () => {
    const s0 = four();
    Object.assign(s0.players[1]!, { reserve: 0 });
    // b가 a의 진실을 의심 → b 탈락
    const s1 = play(toRespond(s0, 3, 3), 1, { type: 'challenge' }).state;
    expect(s1.players[1]!.out).toBe(true);
    expect([s1.phase, s1.turn]).toEqual(['roll', 2]);
    expect(pending(toRespond(s1, 1, 1))).toEqual([3, 0]);
  });

  it('남의 응답은 골랐는지만 보이고 내용은 보이지 않는다', () => {
    const s = play(toRespond(four(), 3, 3), 3, { type: 'challenge' }).state;
    expect(viewFor(s, 3).replies).toEqual([null, null, null, 'challenge']);
    expect(viewFor(s, 1).replies).toEqual([null, null, null, 'hidden']);
    expect(JSON.stringify(viewFor(s, 1))).not.toContain('challenge');
  });

  it('시간이 지나면 고르지 않은 사람은 모두 믿은 것으로 친다', () => {
    const s = play(toRespond(four(), 3, 3), 2, { type: 'accept' }).state;
    const { state, events } = timeout(s, () => 0);
    expect(state.players[0]!.pos).toBe(3);
    expect([state.phase, state.turn]).toEqual(['roll', 1]);
    expect(events.filter((e) => e.type === 'replied').length).toBe(2);
    // 굴리기 단계의 시간 초과는 한 수만 둔다
    expect(timeout(state, () => 0).state.phase).toBe('claim');
  });

  it('이미 의심한 사람이 있으면 시간 초과 때 그 의심이 살아난다', () => {
    const s = play(toRespond(four(), BLANK, 4), 3, { type: 'challenge' }).state;
    const { events } = timeout(s, () => 0);
    expect(events.find((e) => e.type === 'challenged')).toMatchObject({ challenger: 3, fallen: 0 });
  });

  it('셋 이상이면 말 5개, 완주 2번', () => {
    expect(rulesFor(2)).toMatchObject({ runners: RULES.runners, finishesToWin: RULES.finishesToWin });
    expect(rulesFor(3)).toMatchObject({ runners: 5, finishesToWin: 2 });
    expect(four().players[0]!.reserve).toBe(4);
  });
});

describe('기권', () => {
  it('2인에서 기권하면 완주 수와 상관없이 상대가 이긴다', () => {
    const s0 = createGame(['a', 'b']);
    s0.players[0]!.finished = 1;
    const { state, events } = forfeit(s0, 0);
    expect([state.phase, state.winner]).toEqual(['over', 1]);
    expect(events.map((e) => e.type)).toEqual(['forfeit', 'over']);
  });

  it('4인에서 굴릴 차례인 사람이 기권하면 다음 사람 차례가 된다', () => {
    const s = forfeit(toRespond(createGame(['a', 'b', 'c', 'd']), 3, 3), 0).state;
    expect([s.phase, s.turn, s.die, s.claim]).toEqual(['roll', 1, null, null]);
    expect(s.players.filter((p) => !p.out).length).toBe(3);
  });

  it('4인에서 응답을 기다리던 사람이 기권하면 남은 응답으로 판정한다', () => {
    let s = toRespond(createGame(['a', 'b', 'c', 'd']), 3, 3);
    s = play(s, 2, { type: 'accept' }).state;
    s = play(s, 3, { type: 'accept' }).state;
    expect(s.phase).toBe('respond');
    const after = forfeit(s, 1).state;
    expect([after.phase, after.turn, after.players[0]!.pos]).toEqual(['roll', 2, 3]);
  });
});
describe('정보 은닉', () => {
  it('주사위 눈은 굴린 본인에게만 보인다', () => {
    const rolled = play(createGame(['a', 'b']), 0, { type: 'roll' }, 4);
    const claimed = play(rolled.state, 0, { type: 'claim', value: MAX }).state;
    for (const s of [rolled.state, claimed]) {
      expect(viewFor(s, 0).die).toBe(4);
      expect(viewFor(s, 1).die).toBeNull();
      expect(viewFor(s, null).die).toBeNull();
      expect(JSON.stringify(viewFor(s, 1))).not.toContain('"die":4');
    }
  });

  it('rolled 이벤트의 눈도 본인에게만 보인다', () => {
    const { events } = play(createGame(['a', 'b']), 0, { type: 'roll' }, 4);
    expect(viewEvent(events[0]!, 0)).toMatchObject({ die: 4 });
    expect(viewEvent(events[0]!, 1)).toMatchObject({ die: null });
  });

  it('의심으로 공개된 주사위는 모두에게 보인다', () => {
    const { events } = play(toRespond(createGame(['a', 'b']), 2, MAX), 1, { type: 'challenge' });
    expect(viewEvent(events.find((e) => e.type === 'challenged')!, null)).toMatchObject({ die: 2 });
  });
});

describe('판 기록과 점수', () => {
  it('뻥, 안 들킨 뻥, 의심 성공을 센다', () => {
    // a가 2를 굴려 5라고 뻥 → b가 믿음
    let s = play(toRespond(createGame(['a', 'b']), 2, MAX), 1, { type: 'accept' }).state;
    expect(s.stats[0]).toMatchObject({ bluffs: 1, bluffsPassed: 1 });
    // b가 꽝을 굴려 3이라고 뻥 → a가 의심해서 맞힘
    s = play(toRespond(s, BLANK, 3), 0, { type: 'challenge' }).state;
    expect(s.stats[1]).toMatchObject({ bluffs: 1, bluffsPassed: 0 });
    expect(s.stats[0]).toMatchObject({ challenges: 1, challengesWon: 1 });
    // a가 4를 굴려 4라고 진실 → b가 의심해서 틀림
    s = play(toRespond(s, 4, 4), 1, { type: 'challenge' }).state;
    expect(s.stats[0]!.bluffs).toBe(1);
    expect(s.stats[1]).toMatchObject({ challenges: 1, challengesWon: 0 });
  });

  it('뻥 횟수는 판이 끝나기 전에는 누구에게도 보이지 않는다', () => {
    const s = toRespond(createGame(['a', 'b']), 2, MAX);
    expect(viewFor(s, 0).stats).toBeNull();
    expect(viewFor(s, 1).stats).toBeNull();
    expect(JSON.stringify(viewFor(s, 1))).not.toContain('bluffs');
    const over = forfeit(s, 1).state;
    expect(viewFor(over, 1).stats?.[0]).toMatchObject({ bluffs: 1 });
  });

  it('점수: 완주 100, 안 들킨 뻥 30, 맞힌 의심 40, 먹힌 말 -20, 승리 150', () => {
    const p = { ...createGame(['a', 'b']).players[0]!, finished: 3, lost: 2 };
    const line = scoreOf(p, { bluffs: 5, bluffsPassed: 4, challenges: 3, challengesWon: 2 }, true);
    expect(line).toEqual({ finish: 300, bluff: 120, challenge: 80, eaten: -40, win: 150, total: 610 });
    expect(scoreOf({ ...p, finished: 0, lost: 5 }, { bluffs: 0, bluffsPassed: 0, challenges: 0, challengesWon: 0 }, false).total).toBe(0);
  });

  it('기록이 없던 예전 판도 이어서 둘 수 있다', () => {
    const old = createGame(['a', 'b']) as Partial<GameState> & GameState;
    delete (old as Partial<GameState>).stats;
    const s = play(toRespond(old, 2, MAX), 1, { type: 'accept' }).state;
    expect(s.stats[0]).toMatchObject({ bluffs: 1, bluffsPassed: 1 });
  });
});

describe('시간 초과', () => {
  it('굴리기는 자동, 선언은 진짜 눈, 응답은 믿기', () => {
    const s0 = createGame(['a', 'b']);
    expect(timeoutAction(s0, () => 0)).toEqual({ type: 'roll' });
    const s1 = play(s0, 0, { type: 'roll' }, 3).state;
    expect(timeoutAction(s1, () => 0)).toEqual({ type: 'claim', value: 3 });
    const s2 = play(s1, 0, { type: 'claim', value: 3 }).state;
    expect(timeoutAction(s2, () => 0)).toEqual({ type: 'accept' });
  });

  it('꽝이면 유효한 숫자를 무작위로 선언', () => {
    const s = play(createGame(['a', 'b']), 0, { type: 'roll' }, BLANK).state;
    for (const r of [0, 0.5, 0.999]) {
      const a = timeoutAction(s, () => r);
      expect(() => play(s, awaiting(s)!, a)).not.toThrow();
    }
  });
});

describe('순위전 점수', () => {
  const veteran = (rating: number) => ({ rating, games: PLACEMENT_GAMES });
  const rookie = (rating: number) => ({ rating, games: 0 });

  it('점수가 같으면 이긴 쪽이 K의 절반만큼 오르고 진 쪽이 그만큼 내린다', () => {
    expect(expected(1000, 1000)).toBe(0.5);
    expect(rate(veteran(1000), veteran(1000))).toEqual({ winner: K_NORMAL / 2, loser: -K_NORMAL / 2 });
  });

  it('배치 중에는 더 크게 움직인다', () => {
    expect(rate(rookie(RATING_START), rookie(RATING_START))).toEqual({ winner: K_PLACEMENT / 2, loser: -K_PLACEMENT / 2 });
    // 배치 중인 사람과 아닌 사람이 만나면 각자 자기 K로 움직인다
    expect(rate(rookie(1000), veteran(1000))).toEqual({ winner: K_PLACEMENT / 2, loser: -K_NORMAL / 2 });
  });

  it('강한 상대를 이기면 많이 오르고, 약한 상대를 이기면 조금 오른다', () => {
    const upset = rate(veteran(1000), veteran(1200));
    const routine = rate(veteran(1200), veteran(1000));
    expect(upset.winner).toBeGreaterThan(K_NORMAL / 2);
    expect(routine.winner).toBeLessThan(K_NORMAL / 2);
    expect(upset.winner + routine.winner).toBe(K_NORMAL);
    expect(upset.loser).toBe(-upset.winner);
  });

  it('아무리 차이가 나도 적어도 1점은 움직이고, 0점 아래로는 내려가지 않는다', () => {
    expect(rate(veteran(3000), veteran(100))).toEqual({ winner: 1, loser: -1 });
    expect(rate(veteran(1000), veteran(0)).loser).toBe(-0);
    expect(rate(veteran(5), veteran(5)).loser).toBe(-5);
  });

  it('티어는 점수 구간으로 정해진다', () => {
    expect(TIER_FLOORS.length).toBe(5);
    expect(tierOf(0)).toBe(0);
    expect(tierOf(RATING_START)).toBe(1);
    expect(tierOf(TIER_FLOORS[2] - 1)).toBe(1);
    expect(tierOf(TIER_FLOORS[2])).toBe(2);
    expect(tierOf(9999)).toBe(4);
    expect(toNextTier(TIER_FLOORS[2] - 7)).toBe(7);
    expect(toNextTier(9999)).toBeNull();
  });
});

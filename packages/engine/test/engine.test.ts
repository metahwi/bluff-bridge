import { describe, expect, it } from 'vitest';
import {
  BLANK,
  GameError,
  RULES,
  awaiting,
  createGame,
  forfeit,
  reduce,
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

describe('시작', () => {
  it('각자 말 하나를 출발 지점에 올리고 나머지는 대기', () => {
    const s = createGame(['a', 'b']);
    expect(s.players.map((p) => [p.pos, p.reserve])).toEqual([
      [0, RESERVE],
      [0, RESERVE],
    ]);
    expect([s.phase, s.turn, s.responder]).toEqual(['roll', 0, 1]);
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
    for (const value of [0, 6, 2.5, NaN]) {
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
    const s = play(toRespond(createGame(['a', 'b']), BLANK, 5), 1, { type: 'accept' }).state;
    expect(s.players[0]!.pos).toBe(5);
    expect([s.phase, s.turn, s.responder, s.die, s.claim]).toEqual(['roll', 1, 0, null, null]);
  });
});

describe('의심하기', () => {
  it('거짓말이면 굴린 사람의 말이 추락하고 이동은 없다', () => {
    const { state, events } = play(toRespond(createGame(['a', 'b']), 2, 5), 1, { type: 'challenge' });
    expect(state.players[0]).toMatchObject({ pos: 0, reserve: RESERVE - 1, lost: 1 });
    expect(state.players[1]).toMatchObject({ pos: 0, reserve: RESERVE, lost: 0 });
    expect(events[0]).toMatchObject({ type: 'challenged', die: 2, claim: 5, truth: false, fallen: 0 });
  });

  it('진실이면 의심한 사람의 말이 추락하고 굴린 사람은 전진', () => {
    const { state, events } = play(toRespond(createGame(['a', 'b']), 4, 4), 1, { type: 'challenge' });
    expect(state.players[0]).toMatchObject({ pos: 4, lost: 0 });
    expect(state.players[1]).toMatchObject({ pos: 0, reserve: RESERVE - 1, lost: 1 });
    expect(events[0]).toMatchObject({ truth: true, fallen: 1 });
  });

  it('꽝은 어떤 선언을 해도 거짓말', () => {
    for (let claim = 1; claim <= RULES.maxClaim; claim++) {
      const { events } = play(toRespond(createGame(['a', 'b']), BLANK, claim), 1, { type: 'challenge' });
      expect(events[0]).toMatchObject({ truth: false, fallen: 0 });
    }
  });
});

describe('완주와 승패', () => {
  it('다리 끝을 넘으면 완주하고 다음 말이 출발', () => {
    const s0 = createGame(['a', 'b']);
    s0.players[0]!.pos = 8;
    const { state, events } = play(toRespond(s0, 3, 3), 1, { type: 'accept' });
    expect(state.players[0]).toMatchObject({ finished: 1, pos: 0, reserve: RESERVE - 1 });
    expect(events.some((e) => e.type === 'finished')).toBe(true);
  });

  it('마지막 칸에 정확히 서면 아직 완주가 아니다', () => {
    const s0 = createGame(['a', 'b']);
    s0.players[0]!.pos = 8;
    const s = play(toRespond(s0, 2, 2), 1, { type: 'accept' }).state;
    expect(s.players[0]).toMatchObject({ finished: 0, pos: 10 });
  });

  it('정해진 수만큼 완주하면 승리', () => {
    const s0 = createGame(['a', 'b']);
    Object.assign(s0.players[0]!, { pos: 9, finished: RULES.finishesToWin - 1 });
    const { state, events } = play(toRespond(s0, 2, 2), 1, { type: 'accept' });
    expect([state.phase, state.winner]).toEqual(['over', 0]);
    expect(events.at(-1)).toEqual({ type: 'over', winner: 0 });
    expect(() => play(state, 1, { type: 'roll' })).toThrow(GameError);
  });

  it('말을 모두 잃으면 탈락하고 남은 한 명이 승리', () => {
    const s0 = createGame(['a', 'b']);
    Object.assign(s0.players[0]!, { reserve: 0 });
    const { state } = play(toRespond(s0, 1, 5), 1, { type: 'challenge' });
    expect(state.players[0]).toMatchObject({ out: true, pos: null });
    expect([state.phase, state.winner]).toEqual(['over', 1]);
  });
});

describe('말이 떨어졌을 때의 승패', () => {
  it('완주가 더 많으면 말을 다 써도 이긴다', () => {
    const s0 = createGame(['a', 'b']);
    Object.assign(s0.players[0]!, { pos: 9, reserve: 0 });
    // a가 마지막 말로 1개 완주 → 말 소진. b는 완주 0개.
    const { state } = play(toRespond(s0, 2, 2), 1, { type: 'accept' });
    expect(state.players[0]).toMatchObject({ finished: 1, out: true });
    expect([state.phase, state.winner]).toEqual(['over', 0]);
  });

  it('둘 다 말이 떨어지고 완주 수가 같으면 굴린 사람이 이긴다', () => {
    const s0 = createGame(['a', 'b']);
    Object.assign(s0.players[0]!, { pos: 9, reserve: 0 });
    Object.assign(s0.players[1]!, { reserve: 0, finished: 1 });
    // b가 a의 진실을 의심 → b 추락·소진, a는 완주하며 소진. 완주 1:1.
    const { state } = play(toRespond(s0, 2, 2), 1, { type: 'challenge' });
    expect(state.players.map((p) => p.out)).toEqual([true, true]);
    expect([state.phase, state.winner]).toEqual(['over', 0]);
  });
});

describe('4인', () => {
  it('응답은 다음 차례 사람이 하고, 탈락자는 건너뛴다', () => {
    const s0 = createGame(['a', 'b', 'c', 'd']);
    expect(s0.responder).toBe(1);
    Object.assign(s0.players[1]!, { reserve: 0 });
    // b가 a의 진실을 의심 → b 탈락
    const s1 = play(toRespond(s0, 3, 3), 1, { type: 'challenge' }).state;
    expect(s1.players[1]!.out).toBe(true);
    expect([s1.phase, s1.turn, s1.responder]).toEqual(['roll', 2, 3]);
    // c, d 차례가 지나면 다시 a이고 응답자는 b를 건너뛴 c
    let s = play(toRespond(s1, 1, 1), 3, { type: 'accept' }).state;
    s = play(toRespond(s, 1, 1), 0, { type: 'accept' }).state;
    expect([s.turn, s.responder]).toEqual([0, 2]);
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
    expect([s.phase, s.turn, s.responder, s.die, s.claim]).toEqual(['roll', 1, 2, null, null]);
  });

  it('4인에서 응답할 사람이 기권하면 그 다음 사람이 응답한다', () => {
    const s = forfeit(toRespond(createGame(['a', 'b', 'c', 'd']), 3, 3), 1).state;
    expect([s.phase, s.turn, s.responder, s.claim]).toEqual(['respond', 0, 2, 3]);
  });
});

describe('정보 은닉', () => {
  it('주사위 눈은 굴린 본인에게만 보인다', () => {
    const rolled = play(createGame(['a', 'b']), 0, { type: 'roll' }, 4);
    const claimed = play(rolled.state, 0, { type: 'claim', value: 5 }).state;
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
    const { events } = play(toRespond(createGame(['a', 'b']), 2, 5), 1, { type: 'challenge' });
    expect(viewEvent(events[0]!, null)).toMatchObject({ die: 2 });
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

import { BLANK } from './rules.ts';
import type { Rules } from './rules.ts';
import { awaiting, nextActive } from './state.ts';
import type { Action, GameEvent, GameState, Player } from './state.ts';

/** 규칙에 어긋나는 행동. 서버는 이 오류를 그대로 요청자에게 돌려준다. */
export class GameError extends Error {}

/** [0, 1) 범위의 난수. 서버는 crypto 기반, 테스트는 고정값을 넣는다. */
export type Rng = () => number;

export function rollDie(rules: Rules, rng: Rng): number {
  return rules.dieFaces[Math.floor(rng() * rules.dieFaces.length)]!;
}

/** 다음 말을 출발 지점에 올린다. 남은 말이 없으면 탈락. */
function deploy(p: Player, idx: number, events: GameEvent[]): void {
  if (p.reserve > 0) {
    p.reserve--;
    p.pos = 0;
  } else {
    p.pos = null;
    p.out = true;
    events.push({ type: 'out', player: idx });
  }
}

function fall(state: GameState, idx: number, events: GameEvent[]): void {
  const p = state.players[idx]!;
  p.lost++;
  deploy(p, idx, events);
}

function advance(state: GameState, idx: number, steps: number, events: GameEvent[]): void {
  const p = state.players[idx]!;
  p.pos = (p.pos ?? 0) + steps;
  if (p.pos > state.rules.bridgeLength) {
    p.finished++;
    events.push({ type: 'finished', player: idx });
    if (p.finished < state.rules.finishesToWin) deploy(p, idx, events);
    else p.pos = null;
  }
}

function endTurn(state: GameState, events: GameEvent[]): void {
  state.die = null;
  state.claim = null;

  let winner = state.players.findIndex((p) => p.finished >= state.rules.finishesToWin);
  if (winner === -1) {
    // 말이 남은 사람이 한 명 이하면 종료. 완주가 가장 많은 사람이 이기고,
    // 동률이면 말이 남은 사람 → 이번 턴에 굴린 사람 순으로 우선한다.
    const active = state.players.flatMap((p, i) => (p.out ? [] : [i]));
    if (active.length <= 1) {
      const best = Math.max(...state.players.map((p) => p.finished));
      const top = state.players.flatMap((p, i) => (p.finished === best ? [i] : []));
      winner = top.find((i) => i === active[0]) ?? top.find((i) => i === state.turn) ?? top[0]!;
    }
  }
  if (winner !== -1) {
    state.phase = 'over';
    state.winner = winner;
    events.push({ type: 'over', winner });
    return;
  }

  state.turn = nextActive(state, state.turn);
  state.responder = nextActive(state, state.turn);
  state.phase = 'roll';
  state.round++;
}

/**
 * 게임의 유일한 상태 전이 함수. 입력 state는 변경하지 않는다.
 * 반환되는 events에는 비공개 정보(rolled의 die)가 들어 있으므로
 * 클라이언트로 보낼 때는 반드시 viewEvent를 거친다.
 */
export function reduce(
  prev: GameState,
  player: number,
  action: Action,
  rng: Rng,
): { state: GameState; events: GameEvent[] } {
  if (prev.phase === 'over') throw new GameError('게임이 끝났어요.');
  if (awaiting(prev) !== player) throw new GameError('지금은 내 차례가 아니에요.');

  const state = structuredClone(prev);
  const events: GameEvent[] = [];

  switch (action.type) {
    case 'roll': {
      if (state.phase !== 'roll') throw new GameError('지금은 굴릴 수 없어요.');
      state.die = rollDie(state.rules, rng);
      state.phase = 'claim';
      events.push({ type: 'rolled', player, die: state.die });
      break;
    }
    case 'claim': {
      if (state.phase !== 'claim') throw new GameError('지금은 선언할 수 없어요.');
      const v = action.value;
      if (!Number.isInteger(v) || v < 1 || v > state.rules.maxClaim) {
        throw new GameError(`1~${state.rules.maxClaim} 중에서 선언해 주세요.`);
      }
      state.claim = v;
      state.phase = 'respond';
      events.push({ type: 'claimed', player, value: v });
      break;
    }
    case 'accept': {
      if (state.phase !== 'respond') throw new GameError('지금은 응답할 수 없어요.');
      const steps = state.claim!;
      events.push({ type: 'accepted', player, roller: state.turn, steps });
      advance(state, state.turn, steps, events);
      endTurn(state, events);
      break;
    }
    case 'challenge': {
      if (state.phase !== 'respond') throw new GameError('지금은 응답할 수 없어요.');
      const die = state.die!;
      const claim = state.claim!;
      const truth = die !== BLANK && die === claim;
      const fallen = truth ? player : state.turn;
      events.push({ type: 'challenged', challenger: player, roller: state.turn, die, claim, truth, fallen });
      fall(state, fallen, events);
      if (truth) advance(state, state.turn, claim, events);
      endTurn(state, events);
      break;
    }
    default:
      throw new GameError('알 수 없는 행동이에요.');
  }

  return { state, events };
}

/** 기권(나가기·접속 끊김). 완주 수와 상관없이 남은 사람이 한 명이면 그 사람이 이긴다. */
export function forfeit(prev: GameState, player: number): { state: GameState; events: GameEvent[] } {
  if (prev.phase === 'over') throw new GameError('게임이 끝났어요.');
  const state = structuredClone(prev);
  const p = state.players[player];
  if (!p || p.out) throw new GameError('기권할 수 없어요.');
  const events: GameEvent[] = [{ type: 'forfeit', player }];
  p.out = true;
  p.pos = null;
  p.reserve = 0;

  const active = state.players.flatMap((q, i) => (q.out ? [] : [i]));
  if (active.length === 1) {
    state.phase = 'over';
    state.winner = active[0]!;
    state.die = null;
    state.claim = null;
    events.push({ type: 'over', winner: state.winner });
  } else if (state.turn === player) {
    state.die = null;
    state.claim = null;
    state.turn = nextActive(state, player);
    state.responder = nextActive(state, state.turn);
    state.phase = 'roll';
    state.round++;
  } else if (state.responder === player) {
    state.responder = nextActive(state, state.turn);
  }
  return { state, events };
}

/** 제한 시간이 지났을 때 서버가 대신 두는 수. */
export function timeoutAction(state: GameState, rng: Rng): Action {
  switch (state.phase) {
    case 'roll':
      return { type: 'roll' };
    case 'claim':
      return {
        type: 'claim',
        value: state.die === BLANK || state.die === null ? 1 + Math.floor(rng() * state.rules.maxClaim) : state.die,
      };
    case 'respond':
      return { type: 'accept' };
    default:
      throw new GameError('게임이 끝났어요.');
  }
}

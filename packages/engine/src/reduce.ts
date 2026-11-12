import { BLANK } from './rules.ts';
import type { Rules } from './rules.ts';
import { canRespond, emptyStats, nextActive, pending, responders } from './state.ts';
import type { Action, GameEvent, GameState, Player } from './state.ts';

/** 규칙에 어긋나는 행동. 서버는 이 오류를 그대로 요청자에게 돌려준다. */
export class GameError extends Error {}

/** [0, 1) 범위의 난수. 서버는 crypto 기반, 테스트는 고정값을 넣는다. */
export type Rng = () => number;

type Result = { state: GameState; events: GameEvent[] };

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

/**
 * 말 하나를 잃는다. 굴릴 말이 남아 있지 않은 사람은 이미 완주한 말을 대신 잃는다(true를 돌려준다).
 * 그래서 앞서는 사람이 일부러 말을 다 버리고 판을 끝내는 수가 통하지 않는다: 말이 없어도 판은
 * 계속되고, 그 뒤로는 의심이 틀릴 때마다 벌어 둔 완주가 깎인다.
 */
function fall(state: GameState, idx: number, events: GameEvent[]): boolean {
  const p = state.players[idx]!;
  p.lost++;
  if (p.out) {
    if (p.finished > 0) p.finished--;
    return true;
  }
  deploy(p, idx, events);
  return false;
}

/** 순위: 완주가 많은 사람 → 먹힌 말이 적은 사람 → 굴릴 말이 남은 사람 → 방금 굴린 사람. */
function best(state: GameState): number {
  const order = state.players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.gone)
    .sort(
      (a, b) =>
        b.p.finished - a.p.finished ||
        a.p.lost - b.p.lost ||
        Number(a.p.out) - Number(b.p.out) ||
        Number(b.i === state.turn) - Number(a.i === state.turn),
    );
  return order[0]!.i;
}

/**
 * 판이 끝났는지 본다. 끝났으면 승자 번호, 아니면 -1.
 *  - 누군가 정해진 수만큼 완주했다.
 *  - 굴릴 말이 남은 사람이 아무도 없다 → 순위가 가장 높은 사람.
 *  - 굴릴 말이 남은 사람이 한 명뿐이고 그 선언을 의심할 수 있는 사람도 없다 → 혼자 건너기만 하면
 *    되므로 더 두지 않는다. 남은 말을 다 건너보내도 못 따라잡는 경우만 앞선 사람이 이긴다.
 */
function winnerOf(state: GameState): number {
  const done = state.players.findIndex((p) => !p.gone && p.finished >= state.rules.finishesToWin);
  if (done !== -1) return done;
  const rollers = state.players.flatMap((p, i) => (p.out ? [] : [i]));
  if (rollers.length === 0) return best(state);
  if (rollers.length === 1 && !state.players.some((p, i) => i !== rollers[0] && canRespond(p))) {
    const sole = state.players[rollers[0]!]!;
    const reach = sole.finished + sole.reserve + (sole.pos !== null ? 1 : 0);
    const rival = Math.max(-1, ...state.players.flatMap((p, i) => (i === rollers[0] || p.gone ? [] : [p.finished])));
    return reach >= rival ? rollers[0]! : best(state);
  }
  return -1;
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

function clearTurn(state: GameState): void {
  state.die = null;
  state.claim = null;
  state.replies = state.players.map(() => null);
}

function endTurn(state: GameState, events: GameEvent[]): void {
  clearTurn(state);

  const winner = winnerOf(state);
  if (winner !== -1) {
    state.phase = 'over';
    state.winner = winner;
    events.push({ type: 'over', winner });
    return;
  }

  state.turn = nextActive(state, state.turn);
  state.phase = 'roll';
  state.round++;
}

/**
 * 모인 응답으로 판정한다. 굴린 사람 다음 차례부터 순서대로 본다.
 *  - 의심한 사람을 만나면 그 사람이 의심자가 되어 주사위를 공개한다(뒤 순서의 의심은 없던 일이 된다).
 *  - 아직 고르지 않은 사람을 만나면 그 사람을 기다린다.
 *  - 끝까지 모두 믿었으면 선언한 만큼 전진한다.
 * 그래서 여럿이 의심해도 추락 위험을 지는 사람은 차례가 가장 가까운 한 명뿐이다.
 */
function settle(state: GameState, events: GameEvent[]): void {
  const order = responders(state);
  const die = state.die!;
  const claim = state.claim!;
  const truth = die !== BLANK && die === claim;

  for (const who of order) {
    const reply = state.replies[who];
    if (!reply) return;
    if (reply === 'accept') continue;
    const fallen = truth ? who : state.turn;
    state.stats[who]!.challenges++;
    if (!truth) state.stats[who]!.challengesWon++;
    const event: GameEvent = { type: 'challenged', challenger: who, roller: state.turn, die, claim, truth, fallen };
    events.push(event);
    if (fall(state, fallen, events)) event.revoked = true;
    if (truth) advance(state, state.turn, claim, events);
    return endTurn(state, events);
  }

  if (order.length === 0) return endTurn(state, events);
  if (!truth) state.stats[state.turn]!.bluffsPassed++;
  events.push({ type: 'accepted', player: order[0]!, roller: state.turn, steps: claim });
  advance(state, state.turn, claim, events);
  endTurn(state, events);
}

/**
 * 게임의 유일한 상태 전이 함수. 입력 state는 변경하지 않는다.
 * 반환되는 events에는 비공개 정보(rolled의 die)가 들어 있으므로
 * 클라이언트로 보낼 때는 반드시 viewEvent를 거친다.
 */
export function reduce(prev: GameState, player: number, action: Action, rng: Rng): Result {
  if (prev.phase === 'over') throw new GameError('게임이 끝났어요.');

  const state = structuredClone(prev);
  const events: GameEvent[] = [];
  // 기록·동시 응답 기능이 생기기 전에 시작한 판(서버에 저장돼 있던 진행 중인 판)도 이어서 둘 수 있게 한다.
  state.stats ??= state.players.map(emptyStats);
  state.replies ??= state.players.map(() => null);

  if (!pending(state).includes(player)) {
    throw new GameError(state.phase === 'respond' && state.replies[player] ? '이미 골랐어요.' : '지금은 내 차례가 아니에요.');
  }

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
      if (state.die === BLANK || state.die !== v) state.stats[player]!.bluffs++;
      state.phase = 'respond';
      events.push({ type: 'claimed', player, value: v });
      break;
    }
    case 'accept':
    case 'challenge': {
      if (state.phase !== 'respond') throw new GameError('지금은 응답할 수 없어요.');
      state.replies[player] = action.type;
      events.push({ type: 'replied', player });
      settle(state, events);
      break;
    }
    default:
      throw new GameError('알 수 없는 행동이에요.');
  }

  return { state, events };
}

/** 기권(나가기·접속 끊김). 완주 수와 상관없이 남은 사람이 한 명이면 그 사람이 이긴다. */
export function forfeit(prev: GameState, player: number): Result {
  if (prev.phase === 'over') throw new GameError('게임이 끝났어요.');
  const state = structuredClone(prev);
  state.stats ??= state.players.map(emptyStats);
  state.replies ??= state.players.map(() => null);
  const p = state.players[player];
  if (!p || p.gone) throw new GameError('기권할 수 없어요.');
  const events: GameEvent[] = [{ type: 'forfeit', player }];
  p.gone = true;
  p.out = true;
  p.pos = null;
  p.reserve = 0;

  const staying = state.players.flatMap((q, i) => (q.gone ? [] : [i]));
  const winner = staying.length === 1 ? staying[0]! : winnerOf(state);
  if (winner !== -1) {
    state.phase = 'over';
    state.winner = winner;
    clearTurn(state);
    events.push({ type: 'over', winner });
  } else if (state.turn === player) {
    clearTurn(state);
    state.turn = nextActive(state, player);
    state.phase = 'roll';
    state.round++;
  } else if (state.phase === 'respond') {
    // 응답을 기다리던 사람이 나갔으면 남은 사람들의 응답으로 판정한다.
    settle(state, events);
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

/** 제한 시간이 지났을 때의 처리. 응답 단계에서는 아직 고르지 않은 모두가 '믿기'를 고른 것으로 친다. */
export function timeout(prev: GameState, rng: Rng): Result {
  let state = prev;
  const events: GameEvent[] = [];
  const round = prev.round;
  const phase = prev.phase;
  do {
    const who = pending(state)[0];
    if (who === undefined) break;
    const step = reduce(state, who, timeoutAction(state, rng), rng);
    state = step.state;
    events.push(...step.events);
  } while (phase === 'respond' && state.phase === 'respond' && state.round === round);
  return { state, events };
}

import { RULES } from './rules.ts';
import type { Rules } from './rules.ts';

export type Phase = 'roll' | 'claim' | 'respond' | 'over';
export type Reply = 'accept' | 'challenge';

export interface Player {
  name: string;
  /** 다리 위 말의 위치. 0 = 출발 지점. 말이 하나도 남지 않았으면 null. */
  pos: number | null;
  /** 아직 출발하지 않은 대기 말. */
  reserve: number;
  finished: number;
  lost: number;
  /** 말을 모두 잃어 탈락. */
  out: boolean;
}

/** 한 사람의 판 기록. 뻥 횟수는 게임 중에는 비밀이고, 끝난 뒤에만 공개한다(viewFor 참고). */
export interface Stats {
  /** 실제 눈과 다르게 선언한 횟수(꽝 포함). */
  bluffs: number;
  /** 상대가 믿어 줘서 안 들킨 뻥. */
  bluffsPassed: number;
  /** 의심한 횟수와 그중 맞힌 횟수. */
  challenges: number;
  challengesWon: number;
}

export const emptyStats = (): Stats => ({ bluffs: 0, bluffsPassed: 0, challenges: 0, challengesWon: 0 });

/** 결과 화면의 점수 배점. */
export const POINTS = { finish: 100, bluffPassed: 30, challengeWon: 40, eaten: -20, win: 150 };

export interface ScoreLine {
  finish: number;
  bluff: number;
  challenge: number;
  eaten: number;
  win: number;
  total: number;
}

/** 끝난 판의 점수. 완주가 가장 크고, 안 들킨 뻥과 맞힌 의심이 보너스, 먹힌 말은 감점. */
export function scoreOf(player: Player, stats: Stats, won: boolean): ScoreLine {
  const line = {
    finish: player.finished * POINTS.finish,
    bluff: stats.bluffsPassed * POINTS.bluffPassed,
    challenge: stats.challengesWon * POINTS.challengeWon,
    eaten: player.lost * POINTS.eaten,
    win: won ? POINTS.win : 0,
  };
  return { ...line, total: Math.max(0, line.finish + line.bluff + line.challenge + line.eaten + line.win) };
}

export interface GameState {
  rules: Rules;
  players: Player[];
  /** stats[i] = i번 플레이어의 기록. */
  stats: Stats[];
  phase: Phase;
  /** 주사위를 굴리는 사람. */
  turn: number;
  /**
   * 이번 선언에 대한 각자의 응답. replies[i] = i번 플레이어가 고른 것, 아직 안 골랐으면 null.
   * 굴린 사람을 뺀 모두가 동시에 고르고, 남의 선택은 판정 전까지 비밀이다(viewFor 참고).
   */
  replies: (Reply | null)[];
  /** 이번 턴의 실제 주사위 눈. 서버만 안다 (viewFor 참고). */
  die: number | null;
  claim: number | null;
  winner: number | null;
  round: number;
}

export type Action =
  | { type: 'roll' }
  | { type: 'claim'; value: number }
  | { type: 'accept' }
  | { type: 'challenge' };

export type GameEvent =
  | { type: 'rolled'; player: number; die: number | null }
  | { type: 'claimed'; player: number; value: number }
  /** 누군가 응답을 골랐다(무엇을 골랐는지는 담지 않는다). */
  | { type: 'replied'; player: number }
  | { type: 'accepted'; player: number; roller: number; steps: number }
  | {
      type: 'challenged';
      challenger: number;
      roller: number;
      die: number;
      claim: number;
      truth: boolean;
      fallen: number;
    }
  | { type: 'finished'; player: number }
  | { type: 'out'; player: number }
  | { type: 'forfeit'; player: number }
  | { type: 'over'; winner: number };

export function nextActive(state: GameState, from: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    if (!state.players[idx]!.out) return idx;
  }
  throw new Error('no active players');
}

export function createGame(names: string[], rules: Rules = RULES, firstTurn = 0): GameState {
  if (names.length < rules.minPlayers || names.length > rules.maxPlayers) {
    throw new Error(`players must be ${rules.minPlayers}-${rules.maxPlayers}`);
  }
  const state: GameState = {
    rules,
    players: names.map((name) => ({
      name,
      pos: 0,
      reserve: rules.runners - 1,
      finished: 0,
      lost: 0,
      out: false,
    })),
    stats: names.map(emptyStats),
    phase: 'roll',
    turn: firstTurn,
    replies: names.map(() => null),
    die: null,
    claim: null,
    winner: null,
    round: 1,
  };
  return state;
}

/** 차례 계산에 필요한 부분. 서버의 전체 상태와 브라우저가 받는 뷰 둘 다 넣을 수 있다. */
export type Table = Pick<GameState, 'players' | 'turn' | 'phase'> & { replies?: (string | null)[] };

/** 이번 선언에 응답하는 사람들: 굴린 사람 다음부터 차례 순서대로, 말이 남은 사람만. */
export function responders(state: Table): number[] {
  const n = state.players.length;
  const list: number[] = [];
  for (let i = 1; i < n; i++) {
    const idx = (state.turn + i) % n;
    if (!state.players[idx]!.out) list.push(idx);
  }
  return list;
}

/** 지금 행동해야 하는 사람들. 응답 단계에서는 아직 고르지 않은 모두, 그 밖에는 굴리는 사람 한 명. */
export function pending(state: Table): number[] {
  if (state.phase === 'over') return [];
  if (state.phase !== 'respond') return [state.turn];
  return responders(state).filter((i) => !state.replies?.[i]);
}

/** 지금 행동해야 하는 플레이어 중 차례가 가장 빠른 사람. 게임이 끝났으면 null. */
export function awaiting(state: Table): number | null {
  return pending(state)[0] ?? null;
}

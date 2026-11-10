import { RULES } from './rules.ts';
import type { Rules } from './rules.ts';

export type Phase = 'roll' | 'claim' | 'respond' | 'over';

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

export interface GameState {
  rules: Rules;
  players: Player[];
  phase: Phase;
  /** 주사위를 굴리는 사람. */
  turn: number;
  /** 믿기/의심하기를 고르는 사람. */
  responder: number;
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
    phase: 'roll',
    turn: firstTurn,
    responder: 0,
    die: null,
    claim: null,
    winner: null,
    round: 1,
  };
  state.responder = nextActive(state, firstTurn);
  return state;
}

/** 지금 행동해야 하는 플레이어. 게임이 끝났으면 null. */
export function awaiting(state: GameState): number | null {
  if (state.phase === 'over') return null;
  return state.phase === 'respond' ? state.responder : state.turn;
}

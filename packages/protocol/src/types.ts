// 서버와 브라우저가 주고받는 메시지 형식. 이 파일은 런타임 의존성이 없어야 한다
// (브라우저 번들에 그대로 들어간다).
import type { Action, GameEvent, PlayerView } from '@bluff-bridge/engine';

/** 한 행동의 제한 시간. */
export const TURN_MS = 30_000;
/** 접속이 끊긴 뒤 기권 처리까지 기다리는 시간. */
export const GRACE_MS = 60_000;
export const MAX_SEATS = 2;
export const NAME_MAX = 16;
export const ROOM_CODE = /^[A-HJKMNP-Z2-9]{6}$/;

export type ClientMessage =
  | { t: 'ready'; ready: boolean }
  | { t: 'act'; action: Action }
  | { t: 'rematch' }
  | { t: 'leave' };

export interface SeatView {
  name: string;
  ready: boolean;
  online: boolean;
  rematch: boolean;
}

export interface RoomView {
  code: string;
  status: 'lobby' | 'playing' | 'over';
  seats: SeatView[];
  /** 내 자리 번호. 게임 중에는 game.players의 번호와 같다. */
  me: number;
  game: PlayerView | null;
  /** 마지막 상태 변화에서 일어난 일. seq가 바뀔 때 한 번만 연출한다. */
  events: GameEvent[];
  seq: number;
  /** 현재 행동의 남은 시간. 게임 중이 아니면 null. */
  remainingMs: number | null;
}

export type ServerMessage =
  | { t: 'state'; room: RoomView }
  | { t: 'error'; message: string; fatal?: boolean };

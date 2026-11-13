// 서버와 브라우저가 주고받는 메시지 형식. 이 파일은 런타임 의존성이 없어야 한다
// (브라우저 번들에 그대로 들어간다).
import type { Action, GameEvent, PlayerView } from '@bluff-bridge/engine';

/** 한 행동의 제한 시간. */
export const TURN_MS = 30_000;
/** 접속이 끊긴 뒤 기권 처리까지 기다리는 시간. */
export const GRACE_MS = 60_000;
/** 한 방에 들어올 수 있는 인원. 2명 이상 모이면 방장이 시작할 수 있다. */
export const MAX_SEATS = 4;
export const MIN_SEATS = 2;
export const NAME_MAX = 16;
/** 채팅 한 줄의 최대 글자 수. */
export const CHAT_MAX = 60;
/** 채팅을 연달아 보낼 때 지켜야 하는 간격. */
export const CHAT_GAP_MS = 800;
/**
 * 눌러서 바로 보내는 말. 번호로 주고받고, 받는 쪽 화면이 자기 모드(게임/업무)에 맞는 글로 보여 준다.
 * 빠른 매칭 방(모르는 사람과 만나는 방)에서는 이 말들만 보낼 수 있다.
 */
export const CHAT_PRESETS = ['안녕!', 'ㅋㅋㅋ', '뻥이지?', '진짜야!', '빨리빨리~', '아깝다!', '잘한다!', '한 판 더?'] as const;
export const CHAT_PRESETS_WORK = ['안녕하세요', 'ㅎㅎ', '근거 자료 있나요?', '사실입니다', '빠른 회신 부탁드립니다', '아쉽네요', '수고하셨습니다', '한 건 더 하시죠'] as const;
export const ROOM_CODE = /^[A-HJKMNP-Z2-9]{6}$/;

export type ClientMessage =
  | { t: 'ready'; ready: boolean }
  /** 방장(첫 번째 자리)만 보낼 수 있다. 다른 사람이 모두 준비했으면 판을 시작한다. */
  | { t: 'start' }
  | { t: 'act'; action: Action }
  | { t: 'rematch' }
  /** 채팅. text(직접 쓴 글)와 preset(정해진 말의 번호) 중 하나를 보낸다. */
  | { t: 'chat'; text?: string; preset?: number }
  | { t: 'leave' };

export interface SeatView {
  name: string;
  ready: boolean;
  online: boolean;
  rematch: boolean;
}

/** 순위전 한 판이 끝난 뒤 한 사람의 점수 변화. */
export interface RankChange {
  before: number;
  after: number;
  delta: number;
  /** 점수에 반영됐는지. 같은 상대와 하루 제한을 넘기면 false(점수 변동 없음). */
  counted: boolean;
  /** 이 판까지 한 순위전 판 수. */
  games: number;
  /** 판 전후의 티어 번호(0 = 가장 낮음). 배치 판을 다 하기 전에는 null. */
  tierBefore: number | null;
  tier: number | null;
  won: boolean;
}

export interface RoomView {
  code: string;
  status: 'lobby' | 'playing' | 'over';
  /** 빠른 매칭으로 만들어진 방. 매칭된 사람이 모두 모이면 바로 시작한다. */
  auto: boolean;
  /** 순위전 방. 결과가 점수에 반영되고, 다시 하기가 없다. */
  ranked: boolean;
  /** 순위전이 끝난 뒤 자리별 점수 변화. 그 전에는 null. */
  rank: RankChange[] | null;
  /** 자리 목록. 첫 번째 자리가 방장이다. */
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

/** 빠른 매칭 대기열(/ws/match)이 보내는 메시지. */
export type MatchMessage =
  | { t: 'waiting' }
  | { t: 'matched'; code: string }
  | { t: 'error'; message: string };

export type ServerMessage =
  | { t: 'state'; room: RoomView }
  /** 누군가 보낸 채팅. 서버에 저장하지 않고 지금 방에 있는 사람에게만 전한다. */
  | { t: 'chat'; from: number; name: string; text?: string; preset?: number }
  | { t: 'error'; message: string; fatal?: boolean };

import type { GameEvent, GameState, Stats } from './state.ts';

/** 한 플레이어(또는 관전자)가 볼 수 있는 상태. */
export interface PlayerView extends Omit<GameState, 'stats'> {
  /** 이 뷰의 주인. 관전자는 null. */
  me: number | null;
  /** 판 기록. 뻥 횟수가 들어 있어서 게임이 끝나기 전에는 null이다. */
  stats: Stats[] | null;
}

/**
 * 정보 은닉의 유일한 관문. 클라이언트로 나가는 상태는 전부 이 함수를 거친다.
 * 주사위 눈은 굴린 본인에게만 보이고, 누가 뻥을 몇 번 쳤는지는 판이 끝난 뒤에만 보인다.
 */
export function viewFor(state: GameState, me: number | null): PlayerView {
  const view = structuredClone(state) as unknown as PlayerView;
  view.me = me;
  if (me === null || me !== state.turn) view.die = null;
  if (state.phase !== 'over') view.stats = null;
  return view;
}

/** 이벤트의 비공개 정보를 가린다. 의심으로 공개된 주사위(challenged)는 모두에게 보인다. */
export function viewEvent(event: GameEvent, me: number | null): GameEvent {
  if (event.type === 'rolled' && event.player !== me) return { ...event, die: null };
  return event;
}

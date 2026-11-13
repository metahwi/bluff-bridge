// 순위전 점수(Elo 방식)와 티어. 순수 계산만 있고, 저장은 서버(apps/server/src/ranking.ts)가 한다.
//
// 이기면 오르고 지면 내린다. 얼마나 움직이는지는 상대와의 점수 차로 정한다:
// 나보다 강한 상대를 이기면 많이 오르고, 약한 상대에게 지면 많이 내린다.
// 판의 내용(완주 수, 뻥 횟수)은 반영하지 않는다. 시간 끌기나 일부러 봐주기를 부르지 않기 위해서다.

/** 처음 순위전을 하는 사람의 점수. */
export const RATING_START = 1000;
/** 배치 판 수. 이만큼 하기 전에는 티어를 보여 주지 않고, 점수가 더 크게 움직인다. */
export const PLACEMENT_GAMES = 5;
/** 한 판에 움직이는 최대 폭. 주사위 운이 큰 게임이라 흔히 쓰는 32보다 낮게 잡았다. */
export const K_PLACEMENT = 40;
export const K_NORMAL = 24;

/**
 * 티어의 시작 점수(낮은 티어부터). 이름은 화면이 붙인다(게임: 아기 하마~하마왕, 업무 모드: 사원~임원).
 *
 * 구간은 scripts/rank-sim.ts로 실력이 다른 봇들을 돌려 본 분포에 맞췄다. 운이 큰 게임이라 점수가
 * 1000점 둘레 ±80점쯤에 몰린다(40판 뒤 하위 10%가 약 900, 상위 3%가 약 1160). 그래서 구간을 80점
 * 폭으로 촘촘히 잡았다: 대략 25% / 38% / 27% / 8% / 2%로 나뉘고, 시작 점수(1000)는 두 번째 티어다.
 */
export const TIER_FLOORS = [0, 950, 1030, 1110, 1190] as const;
export const TIER_COUNT = TIER_FLOORS.length;

/** 점수가 속한 티어 번호(0 = 가장 낮은 티어). */
export function tierOf(rating: number): number {
  let tier = 0;
  for (let i = 0; i < TIER_FLOORS.length; i++) if (rating >= TIER_FLOORS[i]!) tier = i;
  return tier;
}

/** 다음 티어까지 남은 점수. 가장 높은 티어면 null. */
export function toNextTier(rating: number): number | null {
  const next = TIER_FLOORS[tierOf(rating) + 1];
  return next === undefined ? null : next - rating;
}

/** a가 b를 이길 것으로 보는 확률(0~1). 점수가 같으면 0.5, 400점 높으면 약 0.91. */
export function expected(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

export interface Rated {
  rating: number;
  /** 지금까지 한 순위전 판 수(이번 판 제외). */
  games: number;
}

const kFor = (games: number) => (games < PLACEMENT_GAMES ? K_PLACEMENT : K_NORMAL);

/**
 * 한 판의 결과로 두 사람의 점수가 얼마나 바뀌는지.
 * 이긴 쪽은 적어도 +1, 진 쪽은 적어도 -1이고, 점수는 0 아래로 내려가지 않는다.
 * 두 사람의 K가 다를 수 있어서(배치 중인 사람) 오른 만큼 꼭 내려가는 것은 아니다.
 */
export function rate(winner: Rated, loser: Rated): { winner: number; loser: number } {
  const chance = expected(winner.rating, loser.rating);
  const gain = Math.max(1, Math.round(kFor(winner.games) * (1 - chance)));
  const loss = Math.max(1, Math.round(kFor(loser.games) * (1 - chance)));
  return { winner: gain, loser: -Math.min(loser.rating, loss) };
}

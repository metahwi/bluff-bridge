// 순위전 점수의 저장과 조회 (D1). 계산 규칙은 packages/engine/src/rating.ts에 있다.
import { PLACEMENT_GAMES, RATING_START, rate, tierOf } from '@bluff-bridge/engine';
import type { RankChange } from '@bluff-bridge/protocol';

/** 같은 두 사람이 하루에 점수를 주고받을 수 있는 판 수. 넘으면 판은 되지만 점수는 그대로다(짜고 올리기 방지). */
export const PAIR_GAMES_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export const RANK_TABLES = [
  `CREATE TABLE IF NOT EXISTS ratings (
    user_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    rating INTEGER NOT NULL,
    games INTEGER NOT NULL,
    wins INTEGER NOT NULL,
    losses INTEGER NOT NULL,
    best INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ratings_order ON ratings (rating DESC)`,
  // 판마다 한 사람에 한 줄. 지금은 하루 제한 확인에 쓰고, 나중에 시즌제나 분석에도 쓴다.
  `CREATE TABLE IF NOT EXISTS rating_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    opponent_id TEXT NOT NULL,
    before INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    counted INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS rating_changes_pair ON rating_changes (user_id, opponent_id, created_at)`,
];

interface Row {
  user_id: string;
  name: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  best: number;
}

const fresh = (id: string, name: string): Row => ({ user_id: id, name, rating: RATING_START, games: 0, wins: 0, losses: 0, best: RATING_START });

export interface Rank {
  rating: number;
  /** 티어 번호(0 = 가장 낮음). 배치 판을 다 하기 전에는 null. */
  tier: number | null;
  games: number;
  wins: number;
  losses: number;
  best: number;
  /** 순위표에서의 등수. 배치 중이면 null. */
  place: number | null;
}

/** 내 순위전 정보. 아직 한 판도 안 했으면 시작 점수로 채운다. */
export async function getRank(db: D1Database, userId: string): Promise<Rank> {
  const row = (await db.prepare('SELECT * FROM ratings WHERE user_id = ?').bind(userId).first<Row>()) ?? fresh(userId, '');
  const placed = row.games >= PLACEMENT_GAMES;
  let place: number | null = null;
  if (placed) {
    const above = await db.prepare('SELECT COUNT(*) AS n FROM ratings WHERE games >= ? AND rating > ?').bind(PLACEMENT_GAMES, row.rating).first<{ n: number }>();
    place = (above?.n ?? 0) + 1;
  }
  return { rating: row.rating, tier: placed ? tierOf(row.rating) : null, games: row.games, wins: row.wins, losses: row.losses, best: row.best, place };
}

export interface RankEntry {
  name: string;
  rating: number;
  tier: number;
  wins: number;
  losses: number;
}

/** 순위표: 배치를 마친 사람 중 점수가 높은 순. */
export async function topRanks(db: D1Database, limit = 20): Promise<RankEntry[]> {
  const rows = await db
    .prepare('SELECT name, rating, wins, losses FROM ratings WHERE games >= ? ORDER BY rating DESC, wins DESC, updated_at ASC LIMIT ?')
    .bind(PLACEMENT_GAMES, limit)
    .all<Pick<Row, 'name' | 'rating' | 'wins' | 'losses'>>();
  return rows.results.map((r) => ({ name: r.name, rating: r.rating, tier: tierOf(r.rating), wins: r.wins, losses: r.losses }));
}

export interface RankedPlayer {
  id: string;
  name: string;
}

/**
 * 순위전 한 판의 결과를 점수에 반영하고, 두 사람의 변화를 [이긴 사람, 진 사람] 순서로 돌려준다.
 * 같은 두 사람이 오늘 이미 PAIR_GAMES_PER_DAY판을 했으면 기록만 남기고 점수는 건드리지 않는다.
 */
export async function applyRanked(db: D1Database, matchId: string, winner: RankedPlayer, loser: RankedPlayer, now = Date.now()): Promise<[RankChange, RankChange]> {
  const [w0, l0, pair] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT * FROM ratings WHERE user_id = ?').bind(winner.id),
    db.prepare('SELECT * FROM ratings WHERE user_id = ?').bind(loser.id),
    db.prepare('SELECT COUNT(*) AS n FROM rating_changes WHERE user_id = ? AND opponent_id = ? AND counted = 1 AND created_at > ?').bind(winner.id, loser.id, now - DAY_MS),
  ]);
  const w = (w0!.results[0] as unknown as Row | undefined) ?? fresh(winner.id, winner.name);
  const l = (l0!.results[0] as unknown as Row | undefined) ?? fresh(loser.id, loser.name);
  const counted = Number(pair!.results[0]?.n ?? 0) < PAIR_GAMES_PER_DAY;
  const delta = counted ? rate(w, l) : { winner: 0, loser: 0 };

  const change = (row: Row, d: number, won: boolean): RankChange => {
    const after = row.rating + d;
    const games = row.games + (counted ? 1 : 0);
    const placedBefore = row.games >= PLACEMENT_GAMES;
    const placedAfter = games >= PLACEMENT_GAMES;
    return {
      before: row.rating,
      after,
      delta: d,
      counted,
      games,
      tierBefore: placedBefore ? tierOf(row.rating) : null,
      tier: placedAfter ? tierOf(after) : null,
      won,
    };
  };
  const result: [RankChange, RankChange] = [change(w, delta.winner, true), change(l, delta.loser, false)];

  const upsert = (row: Row, name: string, c: RankChange) =>
    db
      .prepare(
        `INSERT INTO ratings (user_id, name, rating, games, wins, losses, best, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, rating = excluded.rating, games = excluded.games,
           wins = excluded.wins, losses = excluded.losses, best = excluded.best, updated_at = excluded.updated_at`,
      )
      .bind(row.user_id, name, c.after, c.games, row.wins + (counted && c.won ? 1 : 0), row.losses + (counted && !c.won ? 1 : 0), Math.max(row.best, c.after), now);
  const log = (me: RankedPlayer, other: RankedPlayer, c: RankChange) =>
    db
      .prepare('INSERT INTO rating_changes (match_id, user_id, opponent_id, before, delta, counted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(matchId, me.id, other.id, c.before, c.delta, counted ? 1 : 0, now);

  await db.batch([upsert(w, winner.name, result[0]), upsert(l, loser.name, result[1]), log(winner, loser, result[0]), log(loser, winner, result[1])]);
  return result;
}

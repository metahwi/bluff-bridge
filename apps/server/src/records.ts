// 전적 저장과 조회 (D1).

export const RECORD_TABLES = [
  `CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL,
    player_count INTEGER NOT NULL,
    rounds INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ended_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS match_players (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    seat INTEGER NOT NULL,
    name TEXT NOT NULL,
    finished INTEGER NOT NULL,
    lost INTEGER NOT NULL,
    won INTEGER NOT NULL,
    PRIMARY KEY (match_id, seat)
  )`,
  `CREATE INDEX IF NOT EXISTS match_players_user ON match_players (user_id, match_id)`,
];

/** finish: 완주로 승리, elimination: 말이 떨어져 종료, forfeit: 기권·접속 끊김. */
export type EndReason = 'finish' | 'elimination' | 'forfeit';

export interface MatchRecord {
  roomCode: string;
  rounds: number;
  reason: EndReason;
  players: { userId: string; name: string; finished: number; lost: number; won: boolean }[];
}

export async function saveMatch(db: D1Database, rec: MatchRecord): Promise<void> {
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare('INSERT INTO matches (id, room_code, player_count, rounds, reason, ended_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, rec.roomCode, rec.players.length, rec.rounds, rec.reason, Date.now()),
    ...rec.players.map((p, seat) =>
      db
        .prepare(
          'INSERT INTO match_players (match_id, user_id, seat, name, finished, lost, won) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(id, p.userId, seat, p.name, p.finished, p.lost, p.won ? 1 : 0),
    ),
  ]);
}

export async function moveRecords(db: D1Database, fromUserId: string, toUserId: string): Promise<void> {
  if (fromUserId === toUserId) return;
  await db.prepare('UPDATE match_players SET user_id = ? WHERE user_id = ?').bind(toUserId, fromUserId).run();
}

export interface RecentMatch {
  endedAt: number;
  won: boolean;
  opponents: string;
  rounds: number;
  reason: EndReason;
}

export async function getRecords(db: D1Database, userId: string) {
  const [stats, recent] = await db.batch<Record<string, unknown>>([
    db
      .prepare('SELECT COUNT(*) AS played, COALESCE(SUM(won), 0) AS won FROM match_players WHERE user_id = ?')
      .bind(userId),
    db
      .prepare(
        `SELECT m.ended_at AS endedAt, mp.won AS won, m.rounds AS rounds, m.reason AS reason,
                (SELECT group_concat(o.name, ', ') FROM match_players o
                  WHERE o.match_id = m.id AND o.seat != mp.seat) AS opponents
           FROM match_players mp JOIN matches m ON m.id = mp.match_id
          WHERE mp.user_id = ?
          ORDER BY m.ended_at DESC LIMIT 20`,
      )
      .bind(userId),
  ]);
  const s = stats!.results[0] ?? {};
  return {
    played: Number(s.played ?? 0),
    won: Number(s.won ?? 0),
    recent: recent!.results.map(
      (r): RecentMatch => ({
        endedAt: Number(r.endedAt),
        won: Number(r.won) === 1,
        opponents: String(r.opponents ?? ''),
        rounds: Number(r.rounds),
        reason: r.reason as EndReason,
      }),
    ),
  };
}

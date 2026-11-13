// 관리자 페이지의 '한눈에 보기'에 쓰는 데이터 (D1).
//  - live_rooms: 지금 열려 있는 방. 방(Durable Object)이 상태가 바뀔 때마다 한 줄을 고쳐 쓰고, 닫힐 때 지운다.
//  - 추이: 저장된 판 기록(matches)을 날짜별로 센다. 날짜는 한국 시간 기준이다.
import { PLACEMENT_GAMES, TIER_COUNT, tierOf } from '@bluff-bridge/engine';

/** 판의 종류. friend = 친구 방, quick = 빠른 매칭(사람끼리), ranked = 순위전, bot = 빠른 매칭에서 봇과. */
export type GameMode = 'friend' | 'quick' | 'ranked' | 'bot';

export const LIVE_TABLES = [
  `CREATE TABLE IF NOT EXISTS live_rooms (
    code TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    humans INTEGER NOT NULL,
    online INTEGER NOT NULL,
    bots INTEGER NOT NULL,
    names TEXT NOT NULL,
    round INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
];

/** 이만큼 소식이 없는 방은 이미 사라진 것으로 본다(방이 닫히면서 지우지 못한 줄을 걸러 낸다). */
const STALE_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 한국 시간으로 날짜를 뽑기 위한 보정(초). */
const KST = 9 * 3600;

export interface LiveRoom {
  code: string;
  mode: GameMode;
  status: 'lobby' | 'playing' | 'over';
  humans: number;
  online: number;
  bots: number;
  names: string;
  round: number;
}

export async function reportRoom(db: D1Database, room: LiveRoom, now = Date.now()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO live_rooms (code, mode, status, humans, online, bots, names, round, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET mode = excluded.mode, status = excluded.status, humans = excluded.humans, online = excluded.online,
         bots = excluded.bots, names = excluded.names, round = excluded.round, updated_at = excluded.updated_at`,
    )
    .bind(room.code, room.mode, room.status, room.humans, room.online, room.bots, room.names, room.round, now, now)
    .run();
}

export async function forgetRoom(db: D1Database, code: string): Promise<void> {
  await db.prepare('DELETE FROM live_rooms WHERE code = ?').bind(code).run();
}

export async function liveRooms(db: D1Database, now = Date.now()) {
  const rows = await db
    .prepare('SELECT code, mode, status, humans, online, bots, names, round, created_at AS createdAt, updated_at AS updatedAt FROM live_rooms WHERE updated_at > ? ORDER BY created_at DESC LIMIT 100')
    .bind(now - STALE_MS)
    .all<LiveRoom & { createdAt: number; updatedAt: number }>();
  return rows.results;
}

/** 오래된 줄을 치운다(매일 한 번). */
export async function purgeLive(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare('DELETE FROM live_rooms WHERE updated_at < ?').bind(now - STALE_MS).run();
}

/** 최근 days일의 날짜 목록(한국 시간, 'MM-DD', 오래된 날부터). */
function lastDays(days: number, now: number): string[] {
  return Array.from({ length: days }, (_, i) => new Date(now + KST * 1000 - (days - 1 - i) * DAY_MS).toISOString().slice(5, 10));
}

/** 최근 days일의 추이와 분포. */
export async function trends(db: D1Database, days = 14, now = Date.now()) {
  const since = now - days * DAY_MS;
  const day = `strftime('%m-%d', m.ended_at / 1000 + ${KST}, 'unixepoch')`;
  // 플레이한 사람 = 그 기간에 한 판이라도 끝낸 계정(봇과 탈퇴한 계정 제외). 한 사람이 여러 판을 해도,
  // 여러 날에 걸쳐 해도 한 번만 센다. 회원인지는 지금의 계정 상태로 본다.
  const human = "mp.user_id NOT LIKE 'bot-%' AND mp.user_id != 'deleted'";
  const isMember = 'u.id IS NOT NULL AND (u.isAnonymous IS NULL OR u.isAnonymous = 0)';
  const uniqueSince = (from: number) =>
    db
      .prepare(
        `SELECT COUNT(DISTINCT mp.user_id) AS n, COUNT(DISTINCT CASE WHEN ${isMember} THEN mp.user_id END) AS members
           FROM match_players mp JOIN matches m ON m.id = mp.match_id LEFT JOIN user u ON u.id = mp.user_id
          WHERE m.ended_at > ? AND ${human}`,
      )
      .bind(from);
  // 한국 시간으로 오늘 0시
  const todayStart = Math.floor((now + KST * 1000) / DAY_MS) * DAY_MS - KST * 1000;
  const [games, players, signups, reasons, ratings, recent, newest, uToday, uWeek, uPeriod, uMonth] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT ${day} AS d, COALESCE(m.mode, 'old') AS mode, COUNT(*) AS n FROM matches m WHERE m.ended_at > ? GROUP BY d, mode`).bind(since),
    db
      .prepare(
        `SELECT ${day} AS d, COUNT(DISTINCT mp.user_id) AS n, COUNT(DISTINCT CASE WHEN ${isMember} THEN mp.user_id END) AS members
           FROM match_players mp JOIN matches m ON m.id = mp.match_id LEFT JOIN user u ON u.id = mp.user_id
          WHERE m.ended_at > ? AND ${human} GROUP BY d`,
      )
      .bind(since),
    db.prepare(`SELECT strftime('%m-%d', createdAt, '+9 hours') AS d, SUM(CASE WHEN isAnonymous = 1 THEN 0 ELSE 1 END) AS members, SUM(CASE WHEN isAnonymous = 1 THEN 1 ELSE 0 END) AS guests FROM user WHERE createdAt > ? GROUP BY d`).bind(new Date(since).toISOString()),
    db.prepare('SELECT reason, COUNT(*) AS n, AVG(rounds) AS rounds FROM matches WHERE ended_at > ? GROUP BY reason').bind(since),
    db.prepare('SELECT rating FROM ratings WHERE games >= ? LIMIT 5000').bind(PLACEMENT_GAMES),
    db.prepare(
      `SELECT m.id, m.ended_at AS endedAt, COALESCE(m.mode, 'old') AS mode, m.rounds, m.reason, m.room_code AS code,
              (SELECT group_concat(CASE WHEN p.won = 1 THEN '★' ELSE '' END || p.name || CASE WHEN p.user_id LIKE 'bot-%' THEN ' [봇]' ELSE '' END, ', ')
                 FROM match_players p WHERE p.match_id = m.id) AS players
         FROM matches m ORDER BY m.ended_at DESC LIMIT 15`,
    ),
    db.prepare("SELECT name, isAnonymous AS guest, createdAt FROM user WHERE isAnonymous IS NULL OR isAnonymous = 0 ORDER BY createdAt DESC LIMIT 8"),
    uniqueSince(todayStart),
    uniqueSince(now - 7 * DAY_MS),
    uniqueSince(since),
    uniqueSince(now - 30 * DAY_MS),
  ]);
  const unique = (r: (typeof uToday)) => {
    const n = Number(r!.results[0]?.n ?? 0);
    const members = Number(r!.results[0]?.members ?? 0);
    return { all: n, members, guests: n - members };
  };

  const labels = lastDays(days, now);
  const modes = ['friend', 'quick', 'ranked', 'bot', 'old'] as const;
  const byDay = new Map(labels.map((d) => [d, { d, friend: 0, quick: 0, ranked: 0, bot: 0, old: 0, players: 0, playerMembers: 0, playerGuests: 0, members: 0, guests: 0 }]));
  for (const r of games!.results) {
    const row = byDay.get(String(r.d));
    const mode = modes.find((m) => m === r.mode) ?? 'old';
    if (row) row[mode] += Number(r.n);
  }
  for (const r of players!.results) {
    const row = byDay.get(String(r.d));
    if (row) Object.assign(row, { players: Number(r.n), playerMembers: Number(r.members), playerGuests: Number(r.n) - Number(r.members) });
  }
  for (const r of signups!.results) {
    const row = byDay.get(String(r.d));
    if (row) Object.assign(row, { members: Number(r.members), guests: Number(r.guests) });
  }
  const tiers = Array.from({ length: TIER_COUNT }, () => 0);
  for (const r of ratings!.results) tiers[tierOf(Number(r.rating))]!++;

  return {
    // 고유 인원: 오늘(DAU), 최근 7일(WAU), 차트 기간(14일), 최근 30일(MAU)
    unique: { today: unique(uToday), week: unique(uWeek), period: unique(uPeriod), month: unique(uMonth) },
    days: [...byDay.values()],
    reasons: reasons!.results.map((r) => ({ reason: String(r.reason), n: Number(r.n), rounds: Math.round(Number(r.rounds) * 10) / 10 })),
    tiers,
    recent: recent!.results,
    newest: newest!.results,
  };
}

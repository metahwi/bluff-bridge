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

// ───────── 통계에서 빼는 계정 ─────────

/**
 * 점검용 계정(배포 점검 스크립트가 만든 계정, 운영자 본인의 시험 계정 등).
 * 여기에 든 계정은 플레이한 사람 수·판 수·가입 수 같은 모든 통계에서 빠진다. 게임 자체는 똑같이 할 수 있다.
 */
export const STAT_TABLES = [
  `CREATE TABLE IF NOT EXISTS test_users (
    user_id TEXT PRIMARY KEY,
    marked_at INTEGER NOT NULL
  )`,
];

/** 통계에 넣는 '진짜 사람'인 참가자(mp = match_players). 봇, 탈퇴한 계정, 점검용 계정을 뺀다. */
export const REAL_PLAYER = "mp.user_id NOT LIKE 'bot-%' AND mp.user_id != 'deleted' AND mp.user_id NOT IN (SELECT user_id FROM test_users)";
/** 통계에 넣는 판(m = matches): 진짜 사람이 한 명이라도 낀 판. */
export const REAL_MATCH = `EXISTS (SELECT 1 FROM match_players mp WHERE mp.match_id = m.id AND ${REAL_PLAYER})`;
/** 통계에 넣는 계정(u = user). */
export const REAL_USER = 'u.id NOT IN (SELECT user_id FROM test_users)';

export async function markTest(db: D1Database, userId: string, test: boolean): Promise<void> {
  if (test) await db.prepare('INSERT OR IGNORE INTO test_users (user_id, marked_at) VALUES (?, ?)').bind(userId, Date.now()).run();
  else await db.prepare('DELETE FROM test_users WHERE user_id = ?').bind(userId).run();
}

/**
 * 이름으로 점검용 계정을 찾아 표시한다(표시 기능이 생기기 전에 만들어진 계정 정리용).
 *  - 참가자 전원이 names에 든 이름인 판에 나온 계정
 *  - 한 판도 하지 않았고 이름이 names에 든 계정
 * dryRun이면 몇 개가 해당하는지만 센다.
 */
export async function markTestByNames(db: D1Database, names: string[], dryRun: boolean): Promise<{ players: number; idle: number }> {
  if (names.length === 0 || names.length > 60) return { players: 0, idle: 0 };
  const marks = names.map(() => '?').join(',');
  const testMatches = `SELECT match_id FROM match_players GROUP BY match_id
    HAVING SUM(CASE WHEN name IN (${marks}) OR user_id LIKE 'bot-%' OR user_id = 'deleted' THEN 0 ELSE 1 END) = 0`;
  const players = `SELECT DISTINCT user_id FROM match_players WHERE user_id NOT LIKE 'bot-%' AND user_id != 'deleted' AND match_id IN (${testMatches})`;
  const idle = `SELECT id FROM user WHERE name IN (${marks}) AND id NOT IN (SELECT user_id FROM match_players)`;
  const count = async (sql: string) => Number((await db.prepare(`SELECT COUNT(*) AS n FROM (${sql}) WHERE 1 = 1`).bind(...names).first<{ n: number }>())?.n ?? 0);
  const result = { players: await count(players), idle: await count(idle) };
  if (!dryRun) {
    const now = Date.now();
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO test_users (user_id, marked_at) SELECT user_id, ${now} FROM (${players})`).bind(...names),
      db.prepare(`INSERT OR IGNORE INTO test_users (user_id, marked_at) SELECT id, ${now} FROM (${idle})`).bind(...names),
    ]);
  }
  return result;
}

// ───────── 추이 ─────────

/** 최근 days일의 추이와 분포. 점검용 계정과 그 계정들끼리 한 판은 넣지 않는다. */
export async function trends(db: D1Database, days = 14, now = Date.now()) {
  const since = now - days * DAY_MS;
  const day = `strftime('%m-%d', m.ended_at / 1000 + ${KST}, 'unixepoch')`;
  // 플레이한 사람 = 그 기간에 한 판이라도 끝낸 계정. 한 사람이 여러 판을 해도, 여러 날에 걸쳐 해도 한 번만 센다.
  // 회원인지는 지금의 계정 상태로 본다.
  const isMember = 'u.id IS NOT NULL AND (u.isAnonymous IS NULL OR u.isAnonymous = 0)';
  const plays = 'FROM match_players mp JOIN matches m ON m.id = mp.match_id LEFT JOIN user u ON u.id = mp.user_id';
  const uniqueSince = (from: number) =>
    db.prepare(`SELECT COUNT(DISTINCT mp.user_id) AS n, COUNT(DISTINCT CASE WHEN ${isMember} THEN mp.user_id END) AS members ${plays} WHERE m.ended_at > ? AND ${REAL_PLAYER}`).bind(from);
  // 한국 시간으로 오늘 0시
  const todayStart = Math.floor((now + KST * 1000) / DAY_MS) * DAY_MS - KST * 1000;
  /** 한국 시간 기준 날짜 번호(하루에 1씩 는다). 다음 날 다시 왔는지를 볼 때 쓴다. */
  const dayNo = `CAST((m.ended_at + ${KST * 1000}) / ${DAY_MS} AS INTEGER)`;

  const [games, players, signups, reasons, ratings, recent, newest, uToday, uWeek, uPeriod, uMonth, returning] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT ${day} AS d, COALESCE(m.mode, 'old') AS mode, COUNT(*) AS n FROM matches m WHERE m.ended_at > ? AND ${REAL_MATCH} GROUP BY d, mode`).bind(since),
    // 날짜별: 고유 인원, 그중 회원, 참가 횟수(한 사람이 세 판 하면 3), 판에 쓴 시간의 합
    db
      .prepare(
        `SELECT ${day} AS d, COUNT(DISTINCT mp.user_id) AS n, COUNT(DISTINCT CASE WHEN ${isMember} THEN mp.user_id END) AS members,
                COUNT(*) AS plays, COALESCE(SUM(m.duration_ms), 0) AS playMs, COUNT(m.duration_ms) AS timed
           ${plays} WHERE m.ended_at > ? AND ${REAL_PLAYER} GROUP BY d`,
      )
      .bind(since),
    db
      .prepare(
        `SELECT strftime('%m-%d', u.createdAt, '+9 hours') AS d, SUM(CASE WHEN u.isAnonymous = 1 THEN 0 ELSE 1 END) AS members, SUM(CASE WHEN u.isAnonymous = 1 THEN 1 ELSE 0 END) AS guests
           FROM user u WHERE u.createdAt > ? AND ${REAL_USER} GROUP BY d`,
      )
      .bind(new Date(since).toISOString()),
    db.prepare(`SELECT m.reason, COUNT(*) AS n, AVG(m.rounds) AS rounds, AVG(m.duration_ms) AS ms FROM matches m WHERE m.ended_at > ? AND ${REAL_MATCH} GROUP BY m.reason`).bind(since),
    db.prepare('SELECT rating FROM ratings WHERE games >= ? AND user_id NOT IN (SELECT user_id FROM test_users) LIMIT 5000').bind(PLACEMENT_GAMES),
    db.prepare(
      `SELECT m.id, m.ended_at AS endedAt, COALESCE(m.mode, 'old') AS mode, m.rounds, m.reason, m.room_code AS code, m.duration_ms AS durationMs,
              (SELECT group_concat(CASE WHEN p.won = 1 THEN '★' ELSE '' END || p.name || CASE WHEN p.user_id LIKE 'bot-%' THEN ' [봇]' ELSE '' END, ', ')
                 FROM match_players p WHERE p.match_id = m.id) AS players
         FROM matches m WHERE ${REAL_MATCH} ORDER BY m.ended_at DESC LIMIT 15`,
    ),
    db.prepare(`SELECT u.name, u.createdAt FROM user u WHERE (u.isAnonymous IS NULL OR u.isAnonymous = 0) AND ${REAL_USER} ORDER BY u.createdAt DESC LIMIT 8`),
    uniqueSince(todayStart),
    uniqueSince(now - 7 * DAY_MS),
    uniqueSince(since),
    uniqueSince(now - 30 * DAY_MS),
    // 다음 날 재방문: 어느 날 플레이한 사람 중 바로 다음 날에도 플레이한 사람
    db
      .prepare(
        `WITH p AS (SELECT DISTINCT ${dayNo} AS k, mp.user_id AS uid FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE m.ended_at > ? AND ${REAL_PLAYER})
         SELECT a.k AS k, COUNT(DISTINCT a.uid) AS base, COUNT(DISTINCT b.uid) AS back FROM p a LEFT JOIN p b ON b.uid = a.uid AND b.k = a.k + 1 GROUP BY a.k`,
      )
      .bind(since - DAY_MS),
  ]);
  const unique = (r: typeof uToday) => {
    const n = Number(r!.results[0]?.n ?? 0);
    const members = Number(r!.results[0]?.members ?? 0);
    return { all: n, members, guests: n - members };
  };

  const labels = lastDays(days, now);
  const modes = ['friend', 'quick', 'ranked', 'bot', 'old'] as const;
  const blank = (d: string) => ({ d, friend: 0, quick: 0, ranked: 0, bot: 0, old: 0, players: 0, playerMembers: 0, playerGuests: 0, plays: 0, playMs: 0, timed: 0, members: 0, guests: 0 });
  const byDay = new Map(labels.map((d) => [d, blank(d)]));
  for (const r of games!.results) {
    const row = byDay.get(String(r.d));
    const mode = modes.find((m) => m === r.mode) ?? 'old';
    if (row) row[mode] += Number(r.n);
  }
  for (const r of players!.results) {
    const row = byDay.get(String(r.d));
    if (row) {
      Object.assign(row, {
        players: Number(r.n),
        playerMembers: Number(r.members),
        playerGuests: Number(r.n) - Number(r.members),
        plays: Number(r.plays),
        playMs: Number(r.playMs),
        timed: Number(r.timed),
      });
    }
  }
  for (const r of signups!.results) {
    const row = byDay.get(String(r.d));
    if (row) Object.assign(row, { members: Number(r.members), guests: Number(r.guests) });
  }
  const tiers = Array.from({ length: TIER_COUNT }, () => 0);
  for (const r of ratings!.results) tiers[tierOf(Number(r.rating))]!++;

  // 다음 날 재방문율. 오늘은 아직 끝나지 않았으므로 '그저께 한 사람이 어제 다시 했는가'가 가장 최근의 온전한 값이다.
  const todayNo = Math.floor((now + KST * 1000) / DAY_MS);
  const cohorts = returning!.results.map((r) => ({ k: Number(r.k), base: Number(r.base), back: Number(r.back) })).filter((c) => c.k <= todayNo - 2);
  const latest = cohorts.find((c) => c.k === todayNo - 2) ?? { k: todayNo - 2, base: 0, back: 0 };
  const week = cohorts.filter((c) => c.k >= todayNo - 8);
  const weekBase = week.reduce((n, c) => n + c.base, 0);

  const list = [...byDay.values()];
  const sum = (key: 'plays' | 'playMs' | 'timed' | 'players') => list.reduce((n, d) => n + d[key], 0);
  const today = list.at(-1)!;
  return {
    // 고유 인원: 오늘(DAU), 최근 7일(WAU), 차트 기간(14일), 최근 30일(MAU)
    unique: { today: unique(uToday), week: unique(uWeek), period: unique(uPeriod), month: unique(uMonth) },
    engagement: {
      /** 플레이한 날 하루에 한 사람이 몇 판을 했는지(14일). */
      gamesPerPlayer: sum('players') ? Math.round((sum('plays') / sum('players')) * 10) / 10 : 0,
      gamesPerPlayerToday: today.players ? Math.round((today.plays / today.players) * 10) / 10 : 0,
      /** 한 판의 평균 길이(분). 길이를 기록하기 시작한 뒤의 판만. */
      minutesPerGame: sum('timed') ? Math.round((sum('playMs') / sum('timed') / 60000) * 10) / 10 : null,
      /** 플레이한 날 하루에 한 사람이 게임에 쓴 시간(분). 길이가 기록된 판만. */
      minutesPerPlayer: sum('timed') && sum('players') ? Math.round((sum('playMs') / sum('players') / 60000) * 10) / 10 : null,
      timedGames: sum('timed'),
      /** 그저께 플레이한 사람 중 어제 다시 플레이한 사람. */
      nextDay: { base: latest.base, back: latest.back },
      /** 최근 7일(온전한 날만)의 다음 날 재방문. */
      nextDayWeek: { base: weekBase, back: week.reduce((n, c) => n + c.back, 0) },
    },
    days: list,
    reasons: reasons!.results.map((r) => ({
      reason: String(r.reason),
      n: Number(r.n),
      rounds: Math.round(Number(r.rounds) * 10) / 10,
      minutes: r.ms === null || r.ms === undefined ? null : Math.round((Number(r.ms) / 60000) * 10) / 10,
    })),
    tiers,
    recent: recent!.results,
    newest: newest!.results,
  };
}

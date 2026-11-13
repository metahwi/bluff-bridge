// 관리자 페이지(/admin)가 쓰는 API. 전부 /api/admin/* 아래에 있다.
//
// 들어오는 방법은 두 가지다.
//  - 사람: 관리자 암호(ADMIN_PASSWORD)로 로그인하면 12시간짜리 쿠키를 받는다. 게임 계정과는 별개다.
//  - 스크립트: Authorization: Bearer <ADMIN_TOKEN> (배포 점검용).
// 둘 다 설정돼 있지 않으면 아무도 들어올 수 없다.
import { Hono } from 'hono';
import { getMigrations } from 'better-auth/db/migration';
import { PLACEMENT_GAMES, RATING_START, tierOf } from '@bluff-bridge/engine';
import { getAuth } from './auth.ts';
import type { Env } from './index.ts';
import { LIVE_TABLES, liveRooms, trends } from './live.ts';
import { RANK_TABLES } from './ranking.ts';
import { RECORD_ALTERS, RECORD_BACKFILL, RECORD_TABLES } from './records.ts';
import { SETTINGS_TABLES, getSettings, saveSettings } from './settings.ts';
import { CHAT_KEEP_DAYS, STORE_TABLES, purgeOldChat, recentChat, recentFeedback } from './store.ts';

const COOKIE = 'hama_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;
/** 같은 주소에서 15분 동안 암호를 이만큼 틀리면 잠시 막는다. */
const MAX_FAILS = 5;
/** 주소를 바꿔 가며 두드리는 경우에 대비해, 모든 주소를 합쳐 이만큼 틀리면 로그인 자체를 잠시 닫는다. */
const MAX_FAILS_ALL = 40;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

export const ADMIN_TABLES = [
  `CREATE TABLE IF NOT EXISTS admin_fails (
    ip TEXT NOT NULL,
    at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS admin_fails_ip ON admin_fails (ip, at)`,
  // 관리자가 한 일의 기록: 로그인, 설정 변경, 점수 수정, 삭제.
  `CREATE TABLE IF NOT EXISTS admin_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    ip TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL
  )`,
];

const ipOf = (request: Request) => request.headers.get('CF-Connecting-IP') ?? 'local';

/** 관리자 활동을 기록한다. 기록이 실패해도 하던 일은 막지 않는다. */
async function log(env: Env, request: Request, action: string, detail = ''): Promise<void> {
  await env.DB.prepare('INSERT INTO admin_log (at, ip, action, detail) VALUES (?, ?, ?, ?)')
    .bind(Date.now(), ipOf(request), action, detail.slice(0, 500))
    .run()
    .catch(() => null);
}

/**
 * 로그인 쿠키에 서명할 때 쓰는 글. 암호를 섞어 두었으므로, 암호를 바꾸면 그 전에 발급된 로그인은 모두 무효가 된다.
 */
const sessionText = (env: Env, expires: string | number) => `admin.${expires}.${env.ADMIN_PASSWORD ?? ''}`;

const encoder = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sign(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
}

/** 길이가 달라도 걸리는 시간으로 내용을 추측하지 못하게, 해시끼리 끝까지 비교한다. */
async function same(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(a)), crypto.subtle.digest('SHA-256', encoder.encode(b))]);
  const [p, q] = [new Uint8Array(x), new Uint8Array(y)];
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i]! ^ q[i]!;
  return diff === 0;
}

const readCookie = (header: string | undefined, name: string) =>
  header
    ?.split(/;\s*/)
    .find((c) => c.startsWith(name + '='))
    ?.slice(name.length + 1);

async function isAdmin(env: Env, request: Request): Promise<boolean> {
  const bearer = request.headers.get('Authorization');
  if (env.ADMIN_TOKEN && bearer && (await same(bearer, `Bearer ${env.ADMIN_TOKEN}`))) return true;
  const value = readCookie(request.headers.get('Cookie') ?? undefined, COOKIE);
  if (!value || !env.ADMIN_PASSWORD) return false;
  // 값을 바꾸는 요청은 우리 사이트에서 보낸 것만 받는다(다른 사이트가 관리자의 브라우저를 빌려 보내는 요청 차단).
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('Origin');
    if (!origin || new URL(origin).host !== new URL(env.BETTER_AUTH_URL || request.url).host) {
      // 로컬 개발에서는 화면 서버(5173)와 게임 서버(8787)의 주소가 다르므로 localhost끼리는 허용한다.
      const local = !env.BETTER_AUTH_URL && !!origin && /^(localhost|127\.0\.0\.1)$/.test(new URL(origin).hostname);
      if (!local) return false;
    }
  }
  const [expires, mac] = value.split('.');
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  return same(mac, await sign(env.BETTER_AUTH_SECRET, sessionText(env, expires)));
}

export const admin = new Hono<{ Bindings: Env }>();

admin.post('/login', async (c) => {
  const password = c.env.ADMIN_PASSWORD;
  if (!password) return c.json({ error: '관리자 암호가 설정되지 않았어요.' }, 503);
  const ip = ipOf(c.req.raw);
  const now = Date.now();
  const db = c.env.DB;
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM admin_fails WHERE ip = ? AND at > ?').bind(ip, now - FAIL_WINDOW_MS).first<{ n: number }>().catch(() => null);
  if ((recent?.n ?? 0) >= MAX_FAILS) return c.json({ error: '암호를 여러 번 틀렸어요. 15분 뒤에 다시 시도해 주세요.' }, 429);
  const everyone = await db.prepare('SELECT COUNT(*) AS n FROM admin_fails WHERE at > ?').bind(now - FAIL_WINDOW_MS).first<{ n: number }>().catch(() => null);
  if ((everyone?.n ?? 0) >= MAX_FAILS_ALL) return c.json({ error: '로그인 시도가 너무 많아 잠시 닫았어요. 15분 뒤에 다시 시도해 주세요.' }, 429);

  const body = (await c.req.json().catch(() => null)) as { password?: unknown } | null;
  if (typeof body?.password !== 'string' || !(await same(body.password, password))) {
    await db.batch([db.prepare('INSERT INTO admin_fails (ip, at) VALUES (?, ?)').bind(ip, now), db.prepare('DELETE FROM admin_fails WHERE at < ?').bind(now - FAIL_WINDOW_MS)]).catch(() => null);
    await log(c.env, c.req.raw, '로그인 실패');
    return c.json({ error: '암호가 맞지 않아요.' }, 401);
  }
  const expires = now + SESSION_MS;
  const secure = new URL(c.req.url).protocol === 'https:' ? '; Secure' : '';
  c.header('Set-Cookie', `${COOKIE}=${expires}.${await sign(c.env.BETTER_AUTH_SECRET, sessionText(c.env, expires))}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure}`);
  await log(c.env, c.req.raw, '로그인');
  return c.json({ ok: true });
});

admin.post('/logout', async (c) => {
  if (await isAdmin(c.env, c.req.raw)) await log(c.env, c.req.raw, '로그아웃');
  c.header('Set-Cookie', `${COOKIE}=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0`);
  return c.json({ ok: true });
});

admin.get('/session', async (c) => c.json({ admin: await isAdmin(c.env, c.req.raw) }));

// 여기부터는 관리자만.
admin.use('*', async (c, next) => {
  if (!(await isAdmin(c.env, c.req.raw))) return c.json({ error: 'forbidden' }, 403);
  await next();
});

/** DB 테이블을 만든다. 로컬에서는 처음 한 번, 운영에서는 배포할 때 실행한다. */
admin.post('/migrate', async (c) => {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(getAuth(c.env, c.req.raw).options);
  await runMigrations();
  await c.env.DB.batch([...RECORD_TABLES, ...STORE_TABLES, ...RANK_TABLES, ...SETTINGS_TABLES, ...ADMIN_TABLES, ...LIVE_TABLES].map((sql) => c.env.DB.prepare(sql)));
  // 나중에 추가한 열: 이미 있으면 실패하므로 하나씩 실행하고 넘어간다.
  for (const sql of RECORD_ALTERS) await c.env.DB.prepare(sql).run().catch(() => null);
  await c.env.DB.batch(RECORD_BACKFILL.map((sql) => c.env.DB.prepare(sql)));
  return c.json({ created: toBeCreated.map((t) => t.table), altered: toBeAdded.map((t) => t.table), records: 'ok' });
});

/** 한눈에 보는 숫자들. */
admin.get('/overview', async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const n = async (sql: string, ...args: unknown[]) => Number((await db.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0);
  const [users, members, matchesDay, matchesWeek, matches, botMatches, ranked, rankedPlayers, chat, feedback] = await Promise.all([
    n('SELECT COUNT(*) AS n FROM user'),
    n('SELECT COUNT(*) AS n FROM user WHERE isAnonymous IS NULL OR isAnonymous = 0'),
    n('SELECT COUNT(*) AS n FROM matches WHERE ended_at > ?', now - day),
    n('SELECT COUNT(*) AS n FROM matches WHERE ended_at > ?', now - 7 * day),
    n('SELECT COUNT(*) AS n FROM matches'),
    n("SELECT COUNT(DISTINCT match_id) AS n FROM match_players WHERE user_id LIKE 'bot-%'"),
    n('SELECT COUNT(DISTINCT match_id) AS n FROM rating_changes'),
    n('SELECT COUNT(*) AS n FROM ratings WHERE games >= ?', PLACEMENT_GAMES),
    n('SELECT COUNT(*) AS n FROM chat_messages'),
    n('SELECT COUNT(*) AS n FROM feedback'),
  ]);
  return c.json({ users, members, guests: users - members, matchesDay, matchesWeek, matches, botMatches, ranked, rankedPlayers, chat, chatKeepDays: CHAT_KEEP_DAYS, feedback });
});

/** 지금 이 순간: 열려 있는 방과 매칭 줄. */
admin.get('/live', async (c) => {
  const queue = (await (await c.env.MATCH.get(c.env.MATCH.idFromName('global')).fetch('https://match/stats')).json().catch(() => ({ quick: 0, ranked: 0 }))) as { quick: number; ranked: number };
  const rooms = await liveRooms(c.env.DB);
  const playing = rooms.filter((r) => r.status === 'playing');
  return c.json({
    now: Date.now(),
    queue,
    rooms,
    playingRooms: playing.length,
    playersOnline: rooms.reduce((n, r) => n + r.online, 0),
    playersInGame: playing.reduce((n, r) => n + r.online, 0),
    botsInGame: playing.reduce((n, r) => n + r.bots, 0),
  });
});

/** 최근 14일의 추이와 분포. */
admin.get('/trends', async (c) => c.json(await trends(c.env.DB)));

/** 관리자 활동 기록(최근 200건). */
admin.get('/log', async (c) => c.json({ log: (await c.env.DB.prepare('SELECT id, at, ip, action, detail FROM admin_log ORDER BY id DESC LIMIT 200').all()).results }));

/** 회원 목록. q가 있으면 닉네임·이메일로 찾는다. 게스트는 guests=1일 때만 포함한다. */
admin.get('/users', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const guests = c.req.query('guests') === '1';
  const where: string[] = [];
  const args: unknown[] = [];
  if (!guests) where.push('(u.isAnonymous IS NULL OR u.isAnonymous = 0)');
  if (q) {
    where.push('(u.name LIKE ? OR u.email LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.isAnonymous AS guest, u.createdAt,
            r.rating, r.games, r.wins, r.losses,
            (SELECT COUNT(*) FROM match_players mp WHERE mp.user_id = u.id) AS played
       FROM user u LEFT JOIN ratings r ON r.user_id = u.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY u.createdAt DESC LIMIT 200`,
  )
    .bind(...args)
    .all<Record<string, unknown>>();
  return c.json({
    users: rows.results.map((u) => ({
      id: u.id,
      name: u.name,
      // 게스트와 카카오 계정의 이메일 칸은 자리를 채우려고 만든 값이라 보여 주지 않는다.
      email: typeof u.email === 'string' && !/\.invalid$/.test(u.email) ? u.email : null,
      guest: !!u.guest,
      createdAt: u.createdAt,
      played: Number(u.played ?? 0),
      rating: u.rating === null || u.rating === undefined ? null : Number(u.rating),
      games: Number(u.games ?? 0),
      wins: Number(u.wins ?? 0),
      losses: Number(u.losses ?? 0),
      tier: u.rating !== null && u.rating !== undefined && Number(u.games ?? 0) >= PLACEMENT_GAMES ? tierOf(Number(u.rating)) : null,
    })),
  });
});

/** 순위전 점수를 고친다. rating을 비우면 처음 상태(기록 없음)로 되돌린다. */
admin.post('/users/:id/rating', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => null)) as { rating?: unknown } | null;
  const db = c.env.DB;
  if (body?.rating === null || body?.rating === undefined) {
    await db.batch([db.prepare('DELETE FROM ratings WHERE user_id = ?').bind(id), db.prepare('DELETE FROM rating_changes WHERE user_id = ?').bind(id)]);
    await log(c.env, c.req.raw, '순위전 기록 초기화', id);
    return c.json({ ok: true, rating: null });
  }
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 0 || rating > 5000) return c.json({ error: '점수는 0~5000 사이의 정수여야 해요.' }, 400);
  const user = await db.prepare('SELECT name FROM user WHERE id = ?').bind(id).first<{ name: string }>();
  if (!user) return c.json({ error: '없는 회원이에요.' }, 404);
  await db
    .prepare(
      `INSERT INTO ratings (user_id, name, rating, games, wins, losses, best, updated_at) VALUES (?, ?, ?, 0, 0, 0, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET rating = excluded.rating, best = MAX(best, excluded.rating), updated_at = excluded.updated_at`,
    )
    .bind(id, user.name, rating, Math.max(rating, RATING_START), Date.now())
    .run();
  await log(c.env, c.req.raw, '순위전 점수 수정', `${user.name} → ${rating}점`);
  return c.json({ ok: true, rating });
});

admin.get('/feedback', async (c) => c.json({ feedback: await recentFeedback(c.env.DB) }));
admin.delete('/feedback/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(Number(c.req.param('id'))).run();
  await log(c.env, c.req.raw, '의견 삭제', `#${c.req.param('id')}`);
  return c.json({ ok: true });
});

admin.get('/chat', async (c) => c.json({ chat: await recentChat(c.env.DB, c.req.query('room')?.trim().toUpperCase() || null) }));
admin.delete('/chat/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM chat_messages WHERE id = ?').bind(Number(c.req.param('id'))).run();
  await log(c.env, c.req.raw, '채팅 삭제', `#${c.req.param('id')}`);
  return c.json({ ok: true });
});
admin.post('/purge-chat', async (c) => c.json({ deleted: await purgeOldChat(c.env.DB) }));

admin.get('/settings', async (c) => c.json({ settings: await getSettings(c.env.DB, true) }));
admin.put('/settings', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: '잘못된 요청이에요.' }, 400);
  const before = await getSettings(c.env.DB, true);
  const after = await saveSettings(c.env.DB, body);
  const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]).map((k) => `${k}: ${String(before[k])} → ${String(after[k])}`);
  if (changed.length) await log(c.env, c.req.raw, '설정 변경', changed.join(', '));
  return c.json({ settings: after });
});

import { Hono } from 'hono';
import { getMigrations } from 'better-auth/db/migration';
import { ROOM_CODE } from '@bluff-bridge/protocol';
import { enabledProviders, getAuth, getUser } from './auth.ts';
import { createRoom, roomStub } from './codes.ts';
import { Matchmaker } from './matchmaker.ts';
import { RECORD_TABLES, getRecords } from './records.ts';
import { GameRoom } from './room.ts';

export interface Env {
  ROOM: DurableObjectNamespace<GameRoom>;
  MATCH: DurableObjectNamespace<Matchmaker>;
  ASSETS: Fetcher;
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  /** 운영 주소(예: https://도메인). 로컬에서는 비워 둔다. */
  BETTER_AUTH_URL?: string;
  /** DB 테이블 생성(/api/admin/migrate)을 허용하는 비밀 값. */
  ADMIN_TOKEN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  KAKAO_CLIENT_ID?: string;
  KAKAO_CLIENT_SECRET?: string;
}

const app = new Hono<{ Bindings: Env }>();

// 운영에서는 대표 주소(BETTER_AUTH_URL) 하나로 모은다.
// 예전 workers.dev 주소나 www로 들어오면 대표 주소의 같은 경로로 넘긴다(로그인은 대표 주소에서만 동작한다).
app.use('*', async (c, next) => {
  const canonical = c.env.BETTER_AUTH_URL;
  if (canonical) {
    const url = new URL(c.req.url);
    const home = new URL(canonical);
    // 주소가 다르거나 보안 연결(https)이 아니면 대표 주소로 넘긴다. http에서는 로그인 쿠키가 저장되지 않는다.
    if (url.host !== home.host || url.protocol !== home.protocol) {
      return c.redirect(home.origin + url.pathname + url.search, 301);
    }
  }
  await next();
  // 한 번 https로 들어온 브라우저는 앞으로 http 주소를 쳐도 스스로 https로 바꿔 열게 한다.
  if (canonical?.startsWith('https://')) c.header('Strict-Transport-Security', 'max-age=31536000');
});

app.on(['GET', 'POST'], '/api/auth/*', (c) => getAuth(c.env, c.req.raw).handler(c.req.raw));

/** 화면이 처음 뜰 때 필요한 정보: 내 계정, 전적, 켜져 있는 소셜 로그인. */
app.get('/api/me', async (c) => {
  const user = await getUser(c.env, c.req.raw);
  return c.json({
    user,
    providers: enabledProviders(c.env),
    records: user ? await getRecords(c.env.DB, user.id) : null,
  });
});

/** DB 테이블을 만든다. 로컬에서는 처음 한 번, 운영에서는 배포할 때 실행한다. */
app.post('/api/admin/migrate', async (c) => {
  const token = c.env.ADMIN_TOKEN;
  if (!token || c.req.header('Authorization') !== `Bearer ${token}`) return c.json({ error: 'forbidden' }, 403);
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(getAuth(c.env, c.req.raw).options);
  await runMigrations();
  await c.env.DB.batch(RECORD_TABLES.map((sql) => c.env.DB.prepare(sql)));
  return c.json({
    created: toBeCreated.map((t) => t.table),
    altered: toBeAdded.map((t) => t.table),
    records: 'ok',
  });
});

app.post('/api/rooms', async (c) => {
  if (!(await getUser(c.env, c.req.raw))) return c.json({ error: '먼저 닉네임을 정해 주세요.' }, 401);
  const code = await createRoom(c.env);
  if (code) return c.json({ code });
  return c.json({ error: '방을 만들지 못했어요. 다시 시도해 주세요.' }, 503);
});

/** 빠른 매칭 대기열. 짝이 정해지면 방 코드를 보내고 연결을 닫는다. */
app.get('/ws/match', async (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') return c.text('WebSocket only', 426);
  const user = await getUser(c.env, c.req.raw);
  if (!user) return c.text('login required', 401);
  const target = new URL('https://match/ws');
  target.searchParams.set('uid', user.id);
  return c.env.MATCH.get(c.env.MATCH.idFromName('global')).fetch(new Request(target, c.req.raw));
});

app.get('/api/rooms/:code', async (c) => {
  const code = c.req.param('code').toUpperCase();
  if (!ROOM_CODE.test(code)) return c.json({ exists: false }, 404);
  return roomStub(c.env, code).fetch('https://room/info');
});

app.get('/ws/room/:code', async (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') return c.text('WebSocket only', 426);
  const code = c.req.param('code').toUpperCase();
  if (!ROOM_CODE.test(code)) return c.text('bad room code', 400);
  const user = await getUser(c.env, c.req.raw);
  if (!user) return c.text('login required', 401);
  // 방은 이 주소로만 접속을 받는다. 누구인지는 브라우저가 아니라 서버가 정해서 넘긴다.
  const target = new URL('https://room/ws');
  target.searchParams.set('uid', user.id);
  target.searchParams.set('name', user.name);
  return roomStub(c.env, code).fetch(new Request(target, c.req.raw));
});

export default app;
export { GameRoom, Matchmaker };

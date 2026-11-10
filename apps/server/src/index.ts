import { Hono } from 'hono';
import { getMigrations } from 'better-auth/db/migration';
import { ROOM_CODE } from '@bluff-bridge/protocol';
import { enabledProviders, getAuth, getUser } from './auth.ts';
import { RECORD_TABLES, getRecords } from './records.ts';
import { GameRoom } from './room.ts';

export interface Env {
  ROOM: DurableObjectNamespace<GameRoom>;
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

// 헷갈리는 글자(I, L, O, 0, 1)를 뺀 방 코드용 글자.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

function roomStub(env: Env, code: string) {
  return env.ROOM.get(env.ROOM.idFromName(code));
}

const app = new Hono<{ Bindings: Env }>();

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
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const res = await roomStub(c.env, code).fetch(`https://room/create?code=${code}`, { method: 'POST' });
    if (res.ok) return c.json({ code });
  }
  return c.json({ error: '방을 만들지 못했어요. 다시 시도해 주세요.' }, 503);
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
export { GameRoom };

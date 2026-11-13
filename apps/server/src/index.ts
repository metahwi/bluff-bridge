import { Hono } from 'hono';
import { ROOM_CODE } from '@bluff-bridge/protocol';
import { admin } from './admin.ts';
import { enabledProviders, getAuth, getUser } from './auth.ts';
import { purgeLive } from './live.ts';
import { getSettings } from './settings.ts';
import { createRoom, roomStub } from './codes.ts';
import { Matchmaker } from './matchmaker.ts';
import { getRank, topRanks } from './ranking.ts';
import { getRecords } from './records.ts';
import { GameRoom } from './room.ts';
import { FEEDBACK_MAX, FEEDBACK_MIN, purgeOldChat, saveFeedback } from './store.ts';

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
  /** 관리자 페이지(/admin)에 로그인하는 암호. 없으면 관리자 페이지에 들어갈 수 없다. */
  ADMIN_PASSWORD?: string;
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
  // API 응답에 붙이는 보안 헤더(화면 파일의 헤더는 apps/web/public/_headers에서 붙인다).
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  // 계정·관리자 정보가 중간 저장소에 남지 않게 한다.
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
});

app.on(['GET', 'POST'], '/api/auth/*', (c) => getAuth(c.env, c.req.raw).handler(c.req.raw));

/** 화면이 처음 뜰 때 필요한 정보: 내 계정, 전적, 켜져 있는 소셜 로그인. */
app.get('/api/me', async (c) => {
  const user = await getUser(c.env, c.req.raw);
  return c.json({
    user,
    providers: enabledProviders(c.env),
    // 관리자가 올린 공지(없으면 빈 글).
    notice: (await getSettings(c.env.DB)).notice,
    // 방문 집계(Cloudflare Web Analytics) 토큰. 비어 있으면 화면이 집계 스크립트를 붙이지 않는다.
    analytics: (await getSettings(c.env.DB)).analyticsToken,
    records: user ? await getRecords(c.env.DB, user.id) : null,
    // 순위전은 회원만 한다.
    rank: user && !user.isAnonymous ? await getRank(c.env.DB, user.id) : null,
  });
});

// 관리자 페이지용 API(/api/admin/*)는 admin.ts에 있다.
app.route('/api/admin', admin);

/** 의견 보내기. 가입한 회원만 보낼 수 있다(게스트는 안 됨). */
app.post('/api/feedback', async (c) => {
  const user = await getUser(c.env, c.req.raw);
  if (!user || user.isAnonymous) return c.json({ error: '로그인한 뒤에 의견을 보낼 수 있어요.' }, 401);
  const body = (await c.req.json().catch(() => null)) as { text?: unknown; page?: unknown; mode?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.replace(/\r\n?/g, '\n').trim() : '';
  if ([...text].length < FEEDBACK_MIN) return c.json({ error: '조금만 더 자세히 적어 주세요.' }, 400);
  if ([...text].length > FEEDBACK_MAX) return c.json({ error: `의견은 ${FEEDBACK_MAX}자까지 보낼 수 있어요.` }, 400);
  const saved = await saveFeedback(c.env.DB, {
    userId: user.id,
    name: user.name,
    text,
    page: typeof body?.page === 'string' ? body.page : undefined,
    mode: typeof body?.mode === 'string' ? body.mode : undefined,
    agent: c.req.header('User-Agent'),
  });
  if (!saved) return c.json({ error: '오늘은 의견을 충분히 보내 주셨어요. 내일 다시 보내 주세요.' }, 429);
  return c.json({ ok: true });
});

app.post('/api/rooms', async (c) => {
  if (!(await getUser(c.env, c.req.raw))) return c.json({ error: '먼저 닉네임을 정해 주세요.' }, 401);
  const code = await createRoom(c.env, { turnMs: (await getSettings(c.env.DB)).turnSeconds * 1000 });
  if (code) return c.json({ code });
  return c.json({ error: '방을 만들지 못했어요. 다시 시도해 주세요.' }, 503);
});

/**
 * 실시간 연결(WebSocket)은 우리 사이트에서 연 것만 받는다. 다른 사이트의 페이지가 방문자의 로그인 쿠키를 빌려
 * 연결하는 것을 막는다. 로컬 개발(BETTER_AUTH_URL 없음)에서는 화면 서버와 주소가 달라 검사하지 않는다.
 */
app.use('/ws/*', async (c, next) => {
  const home = c.env.BETTER_AUTH_URL;
  const origin = c.req.header('Origin');
  if (home && origin && new URL(origin).host !== new URL(home).host) return c.text('forbidden origin', 403);
  await next();
});

/** 순위표: 배치를 마친 사람 중 상위 20명. 누구나 볼 수 있다. */
app.get('/api/ranking', async (c) => c.json({ top: await topRanks(c.env.DB, 20) }));

/** 매칭 대기열(빠른 매칭, ?mode=ranked면 순위전). 짝이 정해지면 방 코드를 보내고 연결을 닫는다. */
app.get('/ws/match', async (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') return c.text('WebSocket only', 426);
  const user = await getUser(c.env, c.req.raw);
  if (!user) return c.text('login required', 401);
  const target = new URL('https://match/ws');
  target.searchParams.set('uid', user.id);
  if (c.req.query('mode') === 'ranked') {
    if (user.isAnonymous) return c.text('members only', 403);
    target.searchParams.set('mode', 'ranked');
    target.searchParams.set('rating', String((await getRank(c.env.DB, user.id)).rating));
  }
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

export default {
  fetch: app.fetch,
  /** 매일 한 번(wrangler.jsonc의 crons) 보관 기간이 지난 채팅을 지운다. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // 사라진 방의 흔적, 오래된 관리자 로그인 실패 기록과 활동 기록(90일)도 함께 치운다.
    ctx.waitUntil(
      Promise.all([
        purgeLive(env.DB),
        env.DB.prepare('DELETE FROM admin_fails WHERE at < ?').bind(Date.now() - 24 * 60 * 60 * 1000).run(),
        env.DB.prepare('DELETE FROM admin_log WHERE at < ?').bind(Date.now() - 90 * 24 * 60 * 60 * 1000).run(),
      ]).catch(() => null),
    );
    ctx.waitUntil(purgeOldChat(env.DB).then((n) => console.log(`오래된 채팅 ${n}줄 삭제`)));
  },
} satisfies ExportedHandler<Env>;
export { GameRoom, Matchmaker };

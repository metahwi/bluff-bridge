import { Hono } from 'hono';
import { ROOM_CODE } from '@bluff-bridge/protocol';
import { GameRoom } from './room.ts';

export interface Env {
  ROOM: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
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

app.post('/api/rooms', async (c) => {
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
  const search = new URL(c.req.url).search;
  return roomStub(c.env, code).fetch(new Request(`https://room/ws${search}`, c.req.raw));
});

export default app;
export { GameRoom };

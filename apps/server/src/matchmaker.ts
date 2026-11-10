import { DurableObject } from 'cloudflare:workers';
import type { MatchMessage } from '@bluff-bridge/protocol';
import { createRoom } from './codes.ts';
import type { Env } from './index.ts';

interface Attachment {
  uid: string;
  /** 짝이 정해져 방을 만드는 중. 다른 사람과 다시 짝지어지지 않게 한다. */
  matched: boolean;
}

const OPEN = 1;

/**
 * 빠른 매칭 대기열. 전체에 하나만 있다.
 * 대기 중인 사람 = 열려 있는 WebSocket이므로 따로 저장하는 상태가 없다.
 * 창을 닫거나 취소하면 연결이 끊겨 대기열에서 자동으로 빠진다.
 */
export class Matchmaker extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private send(ws: WebSocket, msg: MatchMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // 이미 닫힌 소켓
    }
  }

  private finish(ws: WebSocket, msg: MatchMessage): void {
    this.send(ws, msg);
    try {
      ws.close(1000, 'done');
    } catch {
      // 이미 닫힌 소켓
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const uid = new URL(request.url).searchParams.get('uid');
    if (!uid) return new Response('bad request', { status: 400 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // 같은 사람이 다른 창에서 다시 누르면 이전 대기는 취소한다.
    for (const old of this.ctx.getWebSockets(uid)) old.close(4000, 'replaced');

    const partner = this.ctx.getWebSockets().find((ws) => {
      const att = ws.deserializeAttachment() as Attachment | null;
      return ws.readyState === OPEN && att !== null && !att.matched && att.uid !== uid;
    });

    this.ctx.acceptWebSocket(server, [uid]);
    if (!partner) {
      server.serializeAttachment({ uid, matched: false } satisfies Attachment);
      this.send(server, { t: 'waiting' });
      return new Response(null, { status: 101, webSocket: client });
    }

    // 방을 만드는 동안(await) 다른 요청이 끼어들 수 있으므로 먼저 둘 다 표시해 둔다.
    const partnerUid = (partner.deserializeAttachment() as Attachment).uid;
    partner.serializeAttachment({ uid: partnerUid, matched: true } satisfies Attachment);
    server.serializeAttachment({ uid, matched: true } satisfies Attachment);

    const code = await createRoom(this.env, { auto: true, reserved: [partnerUid, uid] });
    const msg: MatchMessage = code
      ? { t: 'matched', code }
      : { t: 'error', message: '방을 만들지 못했어요. 다시 시도해 주세요.' };
    this.finish(partner, msg);
    this.finish(server, msg);
    return new Response(null, { status: 101, webSocket: client });
  }

  // 대기 중에는 받을 메시지가 없다. 닫히면 런타임이 목록에서 빼 준다.
  override async webSocketMessage(): Promise<void> {}
  override async webSocketClose(): Promise<void> {}
}

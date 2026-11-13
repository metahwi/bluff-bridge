import { DurableObject } from 'cloudflare:workers';
import type { MatchMessage } from '@bluff-bridge/protocol';
import { createRoom } from './codes.ts';
import type { Env } from './index.ts';
import { getSettings } from './settings.ts';

type Mode = 'quick' | 'ranked';

interface Attachment {
  uid: string;
  /** 짝이 정해져 방을 만드는 중. 다른 사람과 다시 짝지어지지 않게 한다. */
  matched: boolean;
  /** 빠른 매칭과 순위전은 대기열이 따로다. */
  mode: Mode;
  /** 순위전 점수(빠른 매칭에서는 쓰지 않는다). */
  rating: number;
  /** 줄을 서기 시작한 시각. */
  since: number;
  /**
   * 연결한 뒤 'join'을 보내 실제로 줄을 섰는지. 연결만 하고 곧바로 끊은 소켓(취소, 화면 전환)은
   * 서버가 끊긴 것을 알기 전에 남과 짝지어질 수 있어서, 이 신호를 보낸 사람만 짝짓는다.
   */
  joined: boolean;
}

const OPEN = 1;
/** 순위전에서 처음 찾는 점수 차와, 기다릴수록 넓어지는 정도. ANYONE_MS가 지나면 누구와도 맞춘다. */
const RANGE_START = 100;
const RANGE_STEP = 50;
const STEP_MS = 5_000;
const ANYONE_MS = 30_000;
/** 봇이 꺼져 있을 때, 빠른 매칭 대기자가 있는 동안 설정을 다시 확인하는 간격. */
const RECHECK_MS = 10_000;

/** 이만큼 기다린 사람이 받아들이는 점수 차. */
function rangeAfter(waitedMs: number): number {
  if (waitedMs >= ANYONE_MS) return Infinity;
  return RANGE_START + RANGE_STEP * Math.floor(waitedMs / STEP_MS);
}

/**
 * 매칭 대기열. 전체에 하나만 있다.
 * 대기 중인 사람 = 열려 있는 WebSocket이므로 따로 저장하는 상태가 없다.
 * 창을 닫거나 취소하면 연결이 끊겨 대기열에서 자동으로 빠진다.
 *
 * 빠른 매칭은 먼저 온 사람과 바로 짝짓는다.
 * 순위전은 점수가 가까운 사람을 찾는다. 처음에는 ±100점 안에서만 찾고, 5초마다 ±50점씩 넓혀
 * 30초가 지나면 누구와도 맞춘다. 범위는 둘 중 더 오래 기다린 사람 기준이다.
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

  /** 지금 줄 서 있는 사람들(짝이 정해진 사람 제외). */
  private waiting(mode: Mode): { ws: WebSocket; att: Attachment }[] {
    const list: { ws: WebSocket; att: Attachment }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (ws.readyState === OPEN && att && att.joined && !att.matched && (att.mode ?? 'quick') === mode) list.push({ ws, att });
    }
    return list.sort((a, b) => a.att.since - b.att.since);
  }

  /** me와 짝이 될 수 있는 사람 중 가장 알맞은 사람. */
  private partnerFor(me: Attachment, now: number): { ws: WebSocket; att: Attachment } | undefined {
    const others = this.waiting(me.mode).filter((o) => o.att.uid !== me.uid);
    if (me.mode === 'quick') return others[0];
    return others
      .filter((o) => Math.abs(o.att.rating - me.rating) <= rangeAfter(now - Math.min(o.att.since, me.since)))
      .sort((a, b) => Math.abs(a.att.rating - me.rating) - Math.abs(b.att.rating - me.rating))[0];
  }

  private async pair(a: WebSocket, b: WebSocket): Promise<void> {
    const [x, y] = [a.deserializeAttachment() as Attachment, b.deserializeAttachment() as Attachment];
    // 방을 만드는 동안(await) 다른 요청이 끼어들 수 있으므로 먼저 둘 다 표시해 둔다.
    a.serializeAttachment({ ...x, matched: true } satisfies Attachment);
    b.serializeAttachment({ ...y, matched: true } satisfies Attachment);
    const turnMs = (await getSettings(this.env.DB)).turnSeconds * 1000;
    const code = await createRoom(this.env, { auto: true, reserved: [x.uid, y.uid], ranked: x.mode === 'ranked', turnMs });
    const msg: MatchMessage = code ? { t: 'matched', code } : { t: 'error', message: '방을 만들지 못했어요. 다시 시도해 주세요.' };
    this.finish(a, msg);
    this.finish(b, msg);
  }

  override async fetch(request: Request): Promise<Response> {
    // 관리자 페이지용: 지금 줄 서 있는 사람 수
    if (new URL(request.url).pathname === '/stats') {
      return Response.json({ quick: this.waiting('quick').length, ranked: this.waiting('ranked').length });
    }
    const params = new URL(request.url).searchParams;
    const uid = params.get('uid');
    if (!uid) return new Response('bad request', { status: 400 });
    const mode: Mode = params.get('mode') === 'ranked' ? 'ranked' : 'quick';
    const me: Attachment = { uid, matched: false, mode, rating: Number(params.get('rating')) || 0, since: Date.now(), joined: false };

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // 같은 사람이 다른 창에서 다시 누르면 이전 대기는 취소한다.
    for (const old of this.ctx.getWebSockets(uid)) old.close(4000, 'replaced');

    // 여기서는 연결만 받는다. 줄 서기와 짝짓기는 'join'을 받았을 때 한다.
    this.ctx.acceptWebSocket(server, [uid]);
    server.serializeAttachment(me);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** 연결이 열린 브라우저가 보내는 'join': 이제 줄을 선다. 알맞은 사람이 있으면 바로 짝짓는다. */
  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (raw !== 'join') return;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || att.joined || att.matched) return;
    const now = Date.now();
    const me: Attachment = { ...att, joined: true, since: now };
    ws.serializeAttachment(me);
    const partner = this.partnerFor(me, now);
    if (partner) return this.pair(partner.ws, ws);
    this.send(ws, { t: 'waiting' });
    await this.arm();
  }

  /** 사람을 못 만난 빠른 매칭 대기자에게 봇 방을 만들어 준다. */
  private async seatBot(ws: WebSocket, att: Attachment): Promise<void> {
    const settings = await getSettings(this.env.DB);
    ws.serializeAttachment({ ...att, matched: true } satisfies Attachment);
    const code = await createRoom(this.env, { auto: true, reserved: [att.uid], bot: settings.botLevel, turnMs: settings.turnSeconds * 1000 });
    this.finish(ws, code ? { t: 'matched', code } : { t: 'error', message: '방을 만들지 못했어요. 다시 시도해 주세요.' });
  }

  /**
   * 다음에 대기열을 다시 볼 시각을 예약한다.
   *  - 순위전 대기자가 둘 이상이면 점수 범위가 넓어지는 5초 뒤
   *  - 봇이 켜져 있고 빠른 매칭 대기자가 있으면, 가장 오래 기다린 사람이 봇을 만날 시각
   */
  private async arm(): Promise<void> {
    const now = Date.now();
    const times: number[] = [];
    if (this.waiting('ranked').length >= 2) times.push(now + STEP_MS);
    const quick = this.waiting('quick');
    if (quick.length) {
      const settings = await getSettings(this.env.DB);
      // 봇이 꺼져 있어도, 기다리는 사람이 있는 동안에는 가끔 다시 본다(그사이 관리자가 봇을 켰을 수 있다).
      times.push(settings.botsEnabled ? Math.max(now + 200, quick[0]!.att.since + settings.botWaitSec * 1000) : now + RECHECK_MS);
    }
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
  }

  /** 대기열을 다시 훑는다. 순위전은 오래 기다린 사람부터 짝을 찾고, 빠른 매칭은 오래 기다린 사람에게 봇을 붙인다. */
  override async alarm(): Promise<void> {
    const now = Date.now();
    for (const { ws, att } of this.waiting('ranked')) {
      const fresh = ws.deserializeAttachment() as Attachment | null;
      if (!fresh || fresh.matched) continue; // 이번 훑기에서 이미 짝이 정해졌다
      const partner = this.partnerFor(att, now);
      if (partner) await this.pair(ws, partner.ws);
    }
    // 빠른 매칭: 봇이 켜져 있으면, 정해진 시간 넘게 기다린 사람에게 봇을 붙인다.
    const settings = await getSettings(this.env.DB);
    if (settings.botsEnabled) {
      for (const { ws, att } of this.waiting('quick')) {
        if (Date.now() - att.since >= settings.botWaitSec * 1000) await this.seatBot(ws, att);
      }
    }
    await this.arm();
  }

  // 닫히면 런타임이 목록에서 빼 준다.
  override async webSocketClose(): Promise<void> {}
}

import { DurableObject } from 'cloudflare:workers';
import {
  GameError,
  RULES,
  awaiting,
  createGame,
  forfeit,
  reduce,
  timeoutAction,
  viewEvent,
  viewFor,
} from '@bluff-bridge/engine';
import type { GameEvent, GameState } from '@bluff-bridge/engine';
import { GRACE_MS, MAX_SEATS, NAME_MAX, TURN_MS, clientMessage } from '@bluff-bridge/protocol';
import type { RoomView, ServerMessage } from '@bluff-bridge/protocol';
import type { Env } from './index.ts';
import { saveMatch } from './records.ts';
import type { MatchRecord } from './records.ts';

interface Seat {
  /** 자리 주인의 계정 ID. 서버(index.ts)가 로그인 세션에서 확인해 넘겨준 값이다. */
  pid: string;
  name: string;
  ready: boolean;
  rematch: boolean;
  /** 접속이 끊긴 시각. 접속 중이면 null. */
  offlineSince: number | null;
}

interface Room {
  code: string;
  status: 'lobby' | 'playing' | 'over';
  /** 빠른 매칭 방: 두 명이 모이면 준비 없이 시작한다. */
  auto?: boolean;
  /** 빠른 매칭 방: 이 계정들만 들어올 수 있다. */
  reserved?: string[];
  seats: Seat[];
  /** 실제 주사위 눈이 들어 있는 전체 상태. 이 객체는 절대 그대로 내보내지 않는다. */
  game: GameState | null;
  deadline: number | null;
  events: GameEvent[];
  seq: number;
}

interface Attachment {
  pid: string;
}

const OPEN = 1;
const rng = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296;

/** 방 하나 = Durable Object 하나. 모든 판정이 여기서 순서대로 처리된다. */
export class GameRoom extends DurableObject<Env> {
  private room: Room | null | undefined;
  /** 방금 끝난 판의 전적. commit에서 DB에 쓴다. */
  private pendingRecord: MatchRecord | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private async load(): Promise<Room | null> {
    if (this.room === undefined) this.room = (await this.ctx.storage.get<Room>('room')) ?? null;
    return this.room;
  }

  private async destroy(): Promise<void> {
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, 'room closed');
      } catch {
        // 이미 닫힌 소켓
      }
    }
  }

  /** 저장 → 알람 예약 → 모두에게 전송. 상태를 바꾼 뒤에는 항상 이 함수로 끝낸다. */
  private async commit(room: Room): Promise<void> {
    const record = this.pendingRecord;
    this.pendingRecord = null;
    if (record) {
      try {
        await saveMatch(this.env.DB, record);
      } catch (e) {
        // 전적 저장이 실패해도 게임 진행은 막지 않는다.
        console.error('전적 저장 실패', e);
      }
    }
    if (room.seats.length === 0) return this.destroy();
    this.room = room;
    await this.ctx.storage.put('room', room);

    const times: number[] = [];
    if (room.status === 'playing' && room.deadline !== null) times.push(room.deadline);
    for (const s of room.seats) if (s.offlineSince !== null) times.push(s.offlineSince + GRACE_MS);
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
    else await this.ctx.storage.deleteAlarm();

    this.broadcast(room);
  }

  private view(room: Room, me: number): RoomView {
    return {
      code: room.code,
      status: room.status,
      auto: !!room.auto,
      seats: room.seats.map((s) => ({
        name: s.name,
        ready: s.ready,
        rematch: s.rematch,
        online: s.offlineSince === null,
      })),
      me,
      game: room.game ? viewFor(room.game, me) : null,
      events: room.events.map((e) => viewEvent(e, me)),
      seq: room.seq,
      remainingMs: room.status === 'playing' && room.deadline !== null ? Math.max(0, room.deadline - Date.now()) : null,
    };
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // 이미 닫힌 소켓
    }
  }

  private broadcast(room: Room): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      const me = att ? room.seats.findIndex((s) => s.pid === att.pid) : -1;
      if (me >= 0) this.send(ws, { t: 'state', room: this.view(room, me) });
    }
  }

  private applyResult(room: Room, result: { state: GameState; events: GameEvent[] }): void {
    room.game = result.state;
    room.events = result.events;
    room.seq++;
    if (result.state.phase === 'over') {
      const { state, events } = result;
      const winner = state.winner!;
      this.pendingRecord = {
        roomCode: room.code,
        rounds: state.round,
        reason: events.some((e) => e.type === 'forfeit')
          ? 'forfeit'
          : state.players[winner]!.finished >= state.rules.finishesToWin
            ? 'finish'
            : 'elimination',
        players: state.players.map((p, i) => ({
          userId: room.seats[i]!.pid,
          name: p.name,
          finished: p.finished,
          lost: p.lost,
          won: i === winner,
        })),
      };
      room.status = 'over';
      room.deadline = null;
      for (const s of room.seats) s.rematch = false;
    } else {
      room.deadline = Date.now() + TURN_MS;
    }
  }

  private start(room: Room): void {
    const first = Math.floor(rng() * room.seats.length);
    room.game = createGame(room.seats.map((s) => s.name), RULES, first);
    room.status = 'playing';
    room.events = [];
    room.seq++;
    room.deadline = Date.now() + TURN_MS;
    for (const s of room.seats) {
      s.ready = false;
      s.rematch = false;
    }
  }

  private forfeitSeat(room: Room, idx: number): void {
    this.applyResult(room, forfeit(room.game!, idx));
    // 결과 화면을 볼 시간을 준 뒤 자리를 정리한다.
    room.seats[idx]!.offlineSince = Date.now();
  }

  private removeSeat(room: Room, idx: number): void {
    room.seats.splice(idx, 1);
    if (room.status !== 'lobby') {
      room.status = 'lobby';
      room.game = null;
      room.events = [];
      room.deadline = null;
    }
    for (const s of room.seats) {
      s.ready = false;
      s.rematch = false;
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/create') {
      if (await this.load()) return new Response(null, { status: 409 });
      const opts = (await request.json()) as { code: string; auto?: boolean; reserved?: string[] };
      this.room = {
        code: opts.code,
        status: 'lobby',
        auto: opts.auto,
        reserved: opts.reserved,
        seats: [],
        game: null,
        deadline: null,
        events: [],
        seq: 0,
      };
      await this.ctx.storage.put('room', this.room);
      // 아무도 들어오지 않으면 알람에서 방을 지운다.
      await this.ctx.storage.setAlarm(Date.now() + GRACE_MS);
      return Response.json({ code: opts.code });
    }

    if (url.pathname === '/info') {
      const room = await this.load();
      if (!room) return Response.json({ exists: false }, { status: 404 });
      return Response.json({ exists: true, status: room.status, seats: room.seats.length });
    }

    if (url.pathname === '/ws') {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const accepted = () => new Response(null, { status: 101, webSocket: client });
      const reject = (message: string) => {
        server.accept();
        this.send(server, { t: 'error', message, fatal: true });
        server.close(4003, 'rejected');
        return accepted();
      };

      const room = await this.load();
      if (!room) return reject('방을 찾을 수 없어요.');
      const pid = url.searchParams.get('uid') ?? '';
      const name = (url.searchParams.get('name') ?? '').trim().slice(0, NAME_MAX);
      if (!/^[\w-]{8,64}$/.test(pid) || !name) return reject('입장 정보가 올바르지 않아요.');

      let seat = room.seats.find((s) => s.pid === pid);
      if (!seat) {
        if (room.status !== 'lobby') return reject('이미 게임이 진행 중인 방이에요.');
        if (room.seats.length >= MAX_SEATS) return reject('방이 가득 찼어요.');
        if (room.reserved && !room.reserved.includes(pid)) return reject('매칭된 사람만 들어올 수 있는 방이에요.');
        seat = { pid, name, ready: false, rematch: false, offlineSince: null };
        room.seats.push(seat);
        if (room.auto && room.seats.length === MAX_SEATS) this.start(room);
      } else if (room.status === 'lobby') {
        seat.name = name;
      }

      for (const old of this.ctx.getWebSockets(pid)) old.close(4000, 'replaced');
      this.ctx.acceptWebSocket(server, [pid]);
      server.serializeAttachment({ pid } satisfies Attachment);
      seat.offlineSince = null;
      await this.commit(room);
      return accepted();
    }

    return new Response('not found', { status: 404 });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 512) return;
    const room = await this.load();
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!room || !att) return;
    const idx = room.seats.findIndex((s) => s.pid === att.pid);
    const seat = room.seats[idx];
    if (!seat) return;

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = clientMessage.safeParse(json);
    if (!parsed.success) return this.send(ws, { t: 'error', message: '잘못된 요청이에요.' });
    const msg = parsed.data;

    switch (msg.t) {
      case 'ready':
        if (room.status !== 'lobby') return;
        seat.ready = msg.ready;
        if (room.seats.length === MAX_SEATS && room.seats.every((s) => s.ready)) this.start(room);
        break;

      case 'rematch':
        if (room.status !== 'over') return;
        seat.rematch = true;
        if (room.seats.length >= RULES.minPlayers && room.seats.every((s) => s.rematch)) this.start(room);
        break;

      case 'act':
        if (room.status !== 'playing' || !room.game) {
          return this.send(ws, { t: 'error', message: '게임 중이 아니에요.' });
        }
        try {
          this.applyResult(room, reduce(room.game, idx, msg.action, rng));
        } catch (e) {
          if (e instanceof GameError) return this.send(ws, { t: 'error', message: e.message });
          throw e;
        }
        break;

      case 'leave':
        if (room.status === 'playing') this.forfeitSeat(room, idx);
        else this.removeSeat(room, idx);
        ws.close(1000, 'left');
        break;
    }
    await this.commit(room);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const room = await this.load();
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!room || !att) return;
    const seat = room.seats.find((s) => s.pid === att.pid);
    if (!seat || seat.offlineSince !== null) return;
    // 같은 사람이 다른 창으로 다시 들어온 경우에는 끊긴 것이 아니다.
    if (this.ctx.getWebSockets(att.pid).some((w) => w !== ws && w.readyState === OPEN)) return;
    seat.offlineSince = Date.now();
    await this.commit(room);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  override async alarm(): Promise<void> {
    const room = await this.load();
    if (!room) return;
    if (room.seats.length === 0) return this.destroy();

    const now = Date.now();
    const gone = room.seats.findIndex((s) => s.offlineSince !== null && now - s.offlineSince >= GRACE_MS);
    if (gone >= 0) {
      if (room.status === 'playing') this.forfeitSeat(room, gone);
      else this.removeSeat(room, gone);
    } else if (room.status === 'playing' && room.game && room.deadline !== null && now >= room.deadline) {
      const who = awaiting(room.game)!;
      this.applyResult(room, reduce(room.game, who, timeoutAction(room.game, rng), rng));
    }
    await this.commit(room);
  }
}

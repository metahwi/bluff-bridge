import { DurableObject } from 'cloudflare:workers';
import {
  GameError,
  botAction,
  createGame,
  forfeit,
  pending,
  reduce,
  rulesFor,
  timeout,
  viewEvent,
  viewFor,
} from '@bluff-bridge/engine';
import type { GameEvent, GameState } from '@bluff-bridge/engine';
import { CHAT_GAP_MS, CHAT_PRESETS, GRACE_MS, MAX_SEATS, MIN_SEATS, NAME_MAX, TURN_MS, clientMessage } from '@bluff-bridge/protocol';
import type { RankChange, RoomView, ServerMessage } from '@bluff-bridge/protocol';
import { applyRanked } from './ranking.ts';
import type { Env } from './index.ts';
import { cleanChat } from './chat.ts';
import { saveMatch } from './records.ts';
import { saveChat } from './store.ts';
import { forgetRoom, reportRoom } from './live.ts';
import type { GameMode } from './live.ts';
import { BOT_LEVELS, BOT_NAMES, getSettings } from './settings.ts';
import type { BotLevel } from './settings.ts';
import type { MatchRecord } from './records.ts';

interface Seat {
  /** 자리 주인의 계정 ID. 서버(index.ts)가 로그인 세션에서 확인해 넘겨준 값이다. */
  pid: string;
  name: string;
  ready: boolean;
  rematch: boolean;
  /** 접속이 끊긴 시각. 접속 중이면 null. */
  offlineSince: number | null;
  /** 가입하지 않은 사람. 게스트의 전적(이름·승패)은 저장하지 않고, 판에 참가했다는 표시만 남긴다. */
  guest?: boolean;
  /**
   * 이번 판에서 기권했다(나갔거나 접속이 끊겼다). 판이 계속되는 동안에는 자리 번호가
   * game.players의 번호와 같아야 해서 자리를 지우지 않고 이 표시만 해 둔다.
   */
  left?: boolean;
  /**
   * 사람이 아니라 서버가 두는 봇. 접속이 없고, 자기 차례가 오면 서버가 대신 둔다.
   * 이 표시는 서버 안에서만 쓰고 브라우저로는 보내지 않는다(관리자 페이지에서만 봇인지 알 수 있다).
   */
  bot?: boolean;
}

/** 기권하고 돌아오지 않은 자리. 다음 판에는 끼지 않는다. */
const absent = (s: Seat) => !!s.left && s.offlineSince !== null;

/**
 * 기권한 자리를 아직 지우면 안 되는 때. 판이 진행 중이거나 결과 화면이 떠 있는 동안에는
 * 자리 번호가 game.players의 번호와 같아야 하므로, 남아 있는 사람이 있는 한 그대로 둔다
 * (다음 판을 시작할 때 start가 빼 준다).
 */
const held = (room: Room, s: Seat) => !!s.left && room.status !== 'lobby' && room.seats.some((x) => x.offlineSince === null && !x.bot);

interface Room {
  code: string;
  status: 'lobby' | 'playing' | 'over';
  /** 빠른 매칭 방: 두 명이 모이면 준비 없이 시작한다. */
  auto?: boolean;
  /** 순위전 방: 끝나면 점수에 반영하고, 다시 하기를 받지 않는다. */
  ranked?: boolean;
  /** 순위전이 끝난 뒤 자리별 점수 변화. */
  rankResult?: RankChange[];
  /** 빠른 매칭 방: 이 계정들만 들어올 수 있다. */
  reserved?: string[];
  /** 사람이 들어오면 이 난이도의 봇이 상대로 앉는다. */
  bot?: BotLevel;
  /** 봇이 다음 수를 둘 시각. 둘 차례가 아니면 null. */
  botAt?: number | null;
  /** 이번 판이 시작된 시각. 판이 걸린 시간을 기록하는 데 쓴다. */
  startedAt?: number;
  /** 한 행동의 제한 시간(밀리초). 방을 만들 때의 관리자 설정. */
  turnMs?: number;
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
  /** 사람마다 마지막으로 채팅을 보낸 시각(도배 방지). 저장하지 않는다. */
  private lastChat = new Map<string, number>();
  /** 관리자 페이지의 '진행 중인 방'에 마지막으로 알린 내용. 달라졌을 때만 다시 알린다. */
  private reported = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private async load(): Promise<Room | null> {
    if (this.room === undefined) this.room = (await this.ctx.storage.get<Room>('room')) ?? null;
    return this.room;
  }

  private async destroy(): Promise<void> {
    const code = this.room?.code;
    if (code) this.ctx.waitUntil(forgetRoom(this.env.DB, code).catch(() => null));
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
        const matchId = await saveMatch(this.env.DB, record);
        // 순위전이면 이긴 사람과 진 사람의 점수를 고치고, 그 결과를 결과 화면에 실어 보낸다.
        if (room.ranked && record.players.length === 2) {
          const w = record.players[0]!.won ? 0 : 1;
          const [win, lose] = [record.players[w]!, record.players[1 - w]!];
          const [a, b] = await applyRanked(this.env.DB, matchId, { id: win.userId, name: win.name }, { id: lose.userId, name: lose.name });
          room.rankResult = w === 0 ? [a, b] : [b, a];
        }
      } catch (e) {
        // 전적 저장이 실패해도 게임 진행은 막지 않는다.
        console.error('전적 저장 실패', e);
      }
    }
    // 사람이 한 명도 남지 않았으면(봇만 남았으면) 방을 닫는다.
    if (!room.seats.some((s) => !s.bot)) return this.destroy();
    this.planBot(room);
    this.room = room;
    await this.ctx.storage.put('room', room);

    const times: number[] = [];
    if (room.status === 'playing' && room.deadline !== null) times.push(room.deadline);
    if (room.botAt) times.push(room.botAt);
    for (const s of room.seats) {
      if (s.offlineSince !== null && !held(room, s)) times.push(s.offlineSince + GRACE_MS);
    }
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
    else await this.ctx.storage.deleteAlarm();

    this.report(room);
    this.broadcast(room);
  }

  private modeOf(room: Room): GameMode {
    return room.ranked ? 'ranked' : room.bot ? 'bot' : room.auto ? 'quick' : 'friend';
  }

  /** 관리자 페이지의 '진행 중인 방' 목록에 이 방의 상태를 알린다. 눈에 띄는 변화가 있을 때만 쓴다. */
  private report(room: Room): void {
    const humans = room.seats.filter((s) => !s.bot);
    const info = {
      code: room.code,
      mode: this.modeOf(room),
      status: room.status,
      humans: humans.length,
      online: humans.filter((s) => s.offlineSince === null).length,
      bots: room.seats.length - humans.length,
      names: room.seats.map((s) => s.name + (s.bot ? ' [봇]' : '')).join(', '),
      round: room.game?.round ?? 0,
    };
    // 턴이 넘어갈 때마다 쓰지 않도록 5턴 단위로만 본다.
    const key = JSON.stringify({ ...info, round: Math.floor(info.round / 5) });
    if (key === this.reported) return;
    this.reported = key;
    this.ctx.waitUntil(reportRoom(this.env.DB, info).catch(() => null));
  }

  private view(room: Room, me: number): RoomView {
    return {
      code: room.code,
      status: room.status,
      auto: !!room.auto,
      ranked: !!room.ranked,
      rank: room.status === 'over' ? (room.rankResult ?? null) : null,
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
    const before = room.game;
    room.game = result.state;
    room.events = result.events;
    room.seq++;
    if (result.state.phase === 'over') {
      const { state, events } = result;
      const winner = state.winner!;
      this.pendingRecord = {
        roomCode: room.code,
        mode: this.modeOf(room),
        durationMs: room.startedAt ? Date.now() - room.startedAt : undefined,
        rounds: state.round,
        reason: events.some((e) => e.type === 'forfeit')
          ? 'forfeit'
          : state.players[winner]!.finished >= state.rules.finishesToWin
            ? 'finish'
            : 'elimination',
        players: state.players.map((p, i) => ({
          userId: room.seats[i]!.pid,
          guest: !!room.seats[i]!.guest,
          name: p.name,
          finished: p.finished,
          lost: p.lost,
          won: i === winner,
        })),
      };
      room.status = 'over';
      room.deadline = null;
      for (const s of room.seats) {
        s.rematch = false;
      }
    } else if (before?.phase === 'respond' && result.state.phase === 'respond' && before.round === result.state.round) {
      // 여럿이 응답하는 동안에는 제한 시간을 새로 주지 않는다(한 명이 고를 때마다 늘어나지 않게).
    } else {
      room.deadline = Date.now() + (room.turnMs ?? TURN_MS);
    }
  }

  /** 지금 둘 차례인 봇의 자리 번호. 없으면 -1. */
  private botToMove(room: Room): number {
    if (room.status !== 'playing' || !room.game) return -1;
    return pending(room.game).find((i) => room.seats[i]?.bot) ?? -1;
  }

  /**
   * 봇이 둘 차례면 언제 둘지 정한다. 사람처럼 잠깐 뜸을 들인다: 굴리기는 빨리, 선언과 응답은 조금 더.
   * 방금 누군가 하마에게 먹혔으면 화면의 연출이 끝날 때까지 더 기다린다.
   */
  private planBot(room: Room): void {
    if (this.botToMove(room) < 0) {
      room.botAt = null;
      return;
    }
    if (room.botAt) return;
    const phase = room.game!.phase;
    const [min, span] = phase === 'roll' ? [1100, 1200] : phase === 'claim' ? [2400, 1600] : [1500, 2200];
    const afterScene = room.events.some((e) => e.type === 'challenged') ? 7000 : 0;
    room.botAt = Date.now() + afterScene + min + Math.floor(rng() * span);
  }

  /** 봇이 한 수 둔다. 봇은 사람과 똑같이 자기 눈만 보고 정한다(viewFor). */
  private moveBot(room: Room): void {
    room.botAt = null;
    const seat = this.botToMove(room);
    if (seat < 0) return;
    const action = botAction(viewFor(room.game!, seat), rng, BOT_LEVELS[room.bot ?? 'normal']);
    this.applyResult(room, reduce(room.game!, seat, action, rng));
  }

  private start(room: Room): void {
    room.seats = room.seats.filter((s) => !absent(s));
    for (const s of room.seats) s.left = false;
    const first = Math.floor(rng() * room.seats.length);
    room.game = createGame(room.seats.map((s) => s.name), rulesFor(room.seats.length), first);
    room.status = 'playing';
    room.startedAt = Date.now();
    room.rankResult = undefined;
    room.events = [];
    room.seq++;
    room.deadline = Date.now() + (room.turnMs ?? TURN_MS);
    for (const s of room.seats) {
      s.ready = false;
      s.rematch = false;
    }
  }

  private forfeitSeat(room: Room, idx: number): void {
    if (!room.game!.players[idx]!.gone) this.applyResult(room, forfeit(room.game!, idx));
    // 자리는 판이 끝나고 결과 화면을 볼 시간이 지난 뒤에 정리한다.
    room.seats[idx]!.left = true;
    room.seats[idx]!.offlineSince ??= Date.now();
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
      const opts = (await request.json()) as { code: string; auto?: boolean; reserved?: string[]; ranked?: boolean; bot?: BotLevel; turnMs?: number };
      this.room = {
        code: opts.code,
        status: 'lobby',
        auto: opts.auto,
        ranked: opts.ranked,
        reserved: opts.reserved,
        bot: opts.bot,
        turnMs: opts.turnMs,
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
        seat = { pid, name, ready: false, rematch: false, offlineSince: null, guest: url.searchParams.get('guest') === '1' };
        room.seats.push(seat);
        // 봇 방: 사람이 들어오면 봇이 맞은편에 앉는다.
        if (room.bot && !room.seats.some((s) => s.bot)) {
          const botName = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)]!;
          room.seats.push({ pid: `bot-${crypto.randomUUID()}`, name: botName, ready: true, rematch: false, offlineSince: null, bot: true });
        }
        const expected = room.bot ? 2 : (room.reserved?.length ?? MIN_SEATS);
        if (room.auto && room.seats.length === expected) this.start(room);
      } else if (room.status === 'lobby') {
        seat.name = name;
      }
      if (room.status !== 'playing') seat.left = false;

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
        break;

      case 'start':
        // 방장(첫 번째 자리)이 누른다. 방장을 뺀 모두가 준비했어야 한다.
        if (room.status !== 'lobby' || room.auto) return;
        if (idx !== 0) return this.send(ws, { t: 'error', message: '방장만 시작할 수 있어요.' });
        if (room.seats.length < MIN_SEATS) return this.send(ws, { t: 'error', message: '두 명 이상 모여야 시작할 수 있어요.' });
        if (!room.seats.every((s, i) => i === 0 || s.ready)) return this.send(ws, { t: 'error', message: '아직 준비하지 않은 사람이 있어요.' });
        this.start(room);
        break;

      case 'chat': {
        // 채팅은 방 상태를 바꾸지 않는다: 저장하지 않고 지금 접속한 사람에게만 전한다.
        const now = Date.now();
        const last = this.lastChat.get(att.pid) ?? 0;
        if (now - last < CHAT_GAP_MS) return;
        // 아래에서 설정을 읽느라 잠깐 기다리는 사이에 같은 사람의 다음 글이 끼어들 수 있으므로, 기다리기 전에 먼저 적어 둔다.
        // 글이 거절되면(보내지지 않으면) 원래대로 되돌려, 곧바로 다른 말을 보낼 수 있게 한다.
        this.lastChat.set(att.pid, now);
        const reject = (message?: string) => {
          this.lastChat.set(att.pid, last);
          if (message) this.send(ws, { t: 'error', message });
        };
        const out: ServerMessage = { t: 'chat', from: idx, name: seat.name };
        if (msg.preset !== undefined) {
          if (msg.preset >= CHAT_PRESETS.length) return reject();
          out.preset = msg.preset;
        } else {
          // 빠른 매칭은 모르는 사람과 만나는 방이라 정해진 말만 주고받는다.
          if (room.auto) return reject('빠른 매칭에서는 정해진 말만 보낼 수 있어요.');
          if (!(await getSettings(this.env.DB)).freeChat) return reject('지금은 정해진 말만 보낼 수 있어요.');
          const text = cleanChat(msg.text ?? '');
          if (!text) return reject();
          out.text = text;
        }
        // 신고·분쟁 확인용으로 일정 기간 보관한다. 저장이 실패해도 채팅 전달은 막지 않는다.
        this.ctx.waitUntil(
          saveChat(this.env.DB, { roomCode: room.code, userId: att.pid, name: seat.name, text: out.text, preset: out.preset, quickMatch: !!room.auto }).catch((e) =>
            console.error('채팅 저장 실패', e),
          ),
        );
        for (const peer of this.ctx.getWebSockets()) {
          const who = peer.deserializeAttachment() as Attachment | null;
          if (who && room.seats.some((s) => s.pid === who.pid)) this.send(peer, out);
        }
        return;
      }

      case 'rematch':
        // 순위전은 판마다 새로 매칭한다(같은 상대와 연달아 붙어 점수를 주고받지 못하게).
        if (room.status !== 'over' || room.ranked) return;
        seat.rematch = true;
        // 봇은 언제나 한 판 더 한다.
        for (const s of room.seats) if (s.bot) s.rematch = true;
        {
          const staying = room.seats.filter((s) => !absent(s));
          if (staying.length >= MIN_SEATS && staying.every((s) => s.rematch)) this.start(room);
        }
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
    // 사람이 한 명도 남지 않았으면(봇만 남았으면) 방을 닫는다.
    if (!room.seats.some((s) => !s.bot)) return this.destroy();
    this.planBot(room);

    const now = Date.now();
    const gone = room.seats.findIndex(
      (s) => s.offlineSince !== null && now - s.offlineSince >= GRACE_MS && !held(room, s),
    );
    if (gone >= 0) {
      if (room.status === 'playing') this.forfeitSeat(room, gone);
      else this.removeSeat(room, gone);
    } else if (room.botAt && now >= room.botAt) {
      this.moveBot(room);
    } else if (room.status === 'playing' && room.game && room.deadline !== null && now >= room.deadline) {
      this.applyResult(room, timeout(room.game, rng));
    }
    await this.commit(room);
  }
}

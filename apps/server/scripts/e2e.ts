// 실행 중인 서버(wrangler dev)에 두 명이 접속해 한 판을 끝까지 두는 테스트.
// 핵심 확인: 차례가 아닌 사람에게 주사위 눈이 한 번도 전송되지 않는다.
// 사용: node scripts/e2e.ts [서버 주소]
import { BLANK, awaiting } from '../../../packages/engine/src/index.ts';
import type { RoomView, ServerMessage, ClientMessage } from '../../../packages/protocol/src/types.ts';

const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const wsBase = base.replace(/^http/, 'ws');
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
};

interface Client {
  name: string;
  ws: WebSocket;
  room: RoomView | null;
  errors: string[];
  closed: number | null;
  onState: (room: RoomView) => void;
}

function connect(code: string, name: string, pid = crypto.randomUUID()): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws/room/${code}?pid=${pid}&name=${encodeURIComponent(name)}`);
    const c: Client = { name, ws, room: null, errors: [], closed: null, onState: () => {} };
    ws.onopen = () => resolve(c);
    ws.onerror = () => reject(new Error(`${name}: 접속 실패`));
    ws.onclose = (e) => (c.closed = e.code);
    ws.onmessage = (e) => {
      const raw = String(e.data);
      const msg = JSON.parse(raw) as ServerMessage;
      if (msg.t === 'error') return void c.errors.push(msg.message);
      const { game, me, events } = msg.room;
      // 차례가 아닌 사람이 받은 메시지에는 주사위 눈이 없어야 한다.
      if (game && game.turn !== me) {
        check(game.die === null, `${name}: 상대 차례인데 game.die=${game.die}`);
        for (const ev of events) {
          if (ev.type === 'rolled') check(ev.die === null, `${name}: 상대의 rolled 이벤트에 die=${ev.die}`);
        }
      }
      if (game && game.turn === me && game.phase !== 'roll' && game.phase !== 'over') {
        check(game.die !== null, `${name}: 내가 굴렸는데 눈이 안 보임`);
      }
      c.room = msg.room;
      c.onState(msg.room);
    };
  });
}

const send = (c: Client, m: ClientMessage) => c.ws.send(JSON.stringify(m));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`시간 초과: ${what}`);
    await sleep(20);
  }
}

// 1. 방 만들기와 입장
const created = (await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json()) as { code: string };
const code = created.code;
console.log(`방 ${code} 생성`);
const a = await connect(code, '에이');
const b = await connect(code, '비');
await until(() => a.room?.seats.length === 2 && b.room?.seats.length === 2, '두 명 입장');

// 2. 세 번째 사람은 거절
const c = await connect(code, '씨');
await until(() => c.closed !== null, '세 번째 입장 거절');
check(c.closed === 4003 && c.errors.length === 1, `세 번째 입장이 거절되지 않음 (close=${c.closed})`);

// 3. 둘 다 준비하면 시작
send(a, { t: 'ready', ready: true });
await sleep(100);
check(a.room?.status === 'lobby', '한 명만 준비했는데 시작됨');
send(b, { t: 'ready', ready: true });
await until(() => a.room?.status === 'playing' && b.room?.status === 'playing', '게임 시작');

// 4. 차례가 아닌 사람의 행동은 거절
const notTurn = a.room!.game!.turn === a.room!.me ? b : a;
send(notTurn, { t: 'act', action: { type: 'roll' } });
await until(() => notTurn.errors.length === 1, '차례 아닌 행동 거절');

// 5. 끝날 때까지 자동으로 둔다. 거짓말과 의심을 섞는다.
let moves = 0;
let challenges = 0;
let claims = 0;
let fives = 0;
function autoplay(cl: Client) {
  let acted = -1;
  const step = (room: RoomView) => {
    const g = room.game;
    if (room.status !== 'playing' || !g || awaiting(g) !== room.me || acted === room.seq) return;
    acted = room.seq;
    moves++;
    if (g.phase === 'roll') send(cl, { t: 'act', action: { type: 'roll' } });
    else if (g.phase === 'claim') {
      // 두 번에 한 번은 5라고 뻥친다.
      const lie = g.die === BLANK || claims++ % 2 === 0;
      send(cl, { t: 'act', action: { type: 'claim', value: lie ? 5 : g.die! } });
    } else {
      // 5라는 선언은 두 번에 한 번 의심한다 (첫 번째는 반드시).
      const doubt = g.claim === 5 && fives++ % 2 === 0;
      if (doubt) challenges++;
      send(cl, { t: 'act', action: { type: doubt ? 'challenge' : 'accept' } });
    }
  };
  cl.onState = step;
  if (cl.room) step(cl.room);
}
autoplay(a);
autoplay(b);
await until(() => a.room?.status === 'over' && b.room?.status === 'over', '게임 종료', 30_000);
const g = a.room!.game!;
console.log(`게임 종료: ${g.round}턴, 행동 ${moves}번, 의심 ${challenges}번, 승자 ${g.players[g.winner!]!.name}`);
check(a.room!.game!.winner === b.room!.game!.winner, '두 사람이 본 승자가 다름');
check(challenges > 0, '의심이 한 번도 일어나지 않아 공개 연출을 확인하지 못함');

// 6. 다시 하기
a.onState = b.onState = () => {};
send(a, { t: 'rematch' });
send(b, { t: 'rematch' });
await until(() => a.room?.status === 'playing', '다시 하기');

// 7. 게임 중 나가면 상대가 이긴다
send(a, { t: 'leave' });
await until(() => b.room?.status === 'over', '기권 처리');
check(b.room!.game!.winner === b.room!.me, '상대가 나갔는데 내가 이기지 않음');
check(b.room!.events.some((e) => e.type === 'forfeit'), '기권 이벤트가 없음');

b.ws.close();
if (failures.length) {
  console.error(`\n실패 ${failures.length}건:`);
  for (const f of new Set(failures)) console.error(' - ' + f);
  process.exit(1);
}
console.log('모든 확인 통과');
process.exit(0);

// 실행 중인 서버(wrangler dev)에 네 명이 접속해 한 판을 끝까지 두는 테스트.
// 핵심 확인: 차례가 아닌 사람에게 주사위 눈이 한 번도 전송되지 않는다.
// 사용: node scripts/e2e.ts [서버 주소]
import { readFileSync } from 'node:fs';
import { BLANK, pending } from '../../../packages/engine/src/index.ts';
import type { RoomView, ServerMessage, ClientMessage, MatchMessage } from '../../../packages/protocol/src/types.ts';

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
  /** 받은 채팅(보낸 사람 이름: 글 또는 #번호). */
  chats: string[];
  closed: number | null;
  onState: (room: RoomView) => void;
}

/** 게스트 계정을 만들고 닉네임을 정한 뒤 로그인 쿠키를 돌려준다. */
async function guest(name: string): Promise<string> {
  const headers = { 'Content-Type': 'application/json', Origin: base };
  const signIn = await fetch(`${base}/api/auth/sign-in/anonymous`, { method: 'POST', headers, body: '{}' });
  if (!signIn.ok) throw new Error(`게스트 로그인 실패: ${signIn.status} ${await signIn.text()}`);
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const update = await fetch(`${base}/api/auth/update-user`, {
    method: 'POST',
    headers: { ...headers, Cookie: cookie },
    body: JSON.stringify({ name }),
  });
  if (!update.ok) throw new Error(`닉네임 저장 실패: ${update.status} ${await update.text()}`);
  return cookie;
}

interface MeResponse {
  user: { id: string; name: string; isAnonymous: boolean } | null;
  records: { played: number; won: number; recent: { won: boolean; opponents: string; reason: string }[] } | null;
}
const me = async (cookie: string) =>
  (await (await fetch(`${base}/api/me`, { headers: { Cookie: cookie } })).json()) as MeResponse;

function connect(code: string, name: string, cookie: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    // Node의 WebSocket은 브라우저와 달리 헤더를 직접 넣을 수 있다.
    const ws = new WebSocket(`${wsBase}/ws/room/${code}`, { headers: { Cookie: cookie, Origin: base } } as never);
    const c: Client = { name, ws, room: null, errors: [], chats: [], closed: null, onState: () => {} };
    ws.onopen = () => resolve(c);
    ws.onerror = () => reject(new Error(`${name}: 접속 실패`));
    ws.onclose = (e) => (c.closed = e.code);
    ws.onmessage = (e) => {
      const raw = String(e.data);
      const msg = JSON.parse(raw) as ServerMessage;
      if (msg.t === 'error') return void c.errors.push(msg.message);
      if (msg.t === 'chat') return void c.chats.push(`${msg.name}: ${msg.text ?? '#' + msg.preset}`);
      const { game, me, events } = msg.room;
      // 누가 뻥을 몇 번 쳤는지는 판이 끝나기 전에는 누구에게도 가지 않는다.
      if (game && game.phase !== 'over') {
        check(game.stats === null && !raw.includes('bluffs'), `${name}: 게임 중인데 뻥 기록이 전송됨`);
      }
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

// 0. DB 테이블 준비 (.dev.vars의 ADMIN_TOKEN 사용)
const adminToken =
  process.env.ADMIN_TOKEN ??
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^ADMIN_TOKEN=(.+)$/m)?.[1];
const migrate = await fetch(`${base}/api/admin/migrate`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${adminToken}` },
});
if (!migrate.ok) throw new Error(`테이블 생성 실패: ${migrate.status} ${await migrate.text()}`);
console.log('테이블 준비:', JSON.stringify(await migrate.json()));
check((await fetch(`${base}/api/admin/migrate`, { method: 'POST' })).status === 403, '토큰 없이 migrate가 허용됨');

// 1. 로그인 없이는 방을 만들거나 들어올 수 없다
check((await fetch(`${base}/api/rooms`, { method: 'POST' })).status === 401, '로그인 없이 방이 만들어짐');
const cookieA = await guest('에이');
const cookieB = await guest('비');
const userA = (await me(cookieA)).user;
check(userA?.name === '에이' && userA.isAnonymous === true, `게스트 계정 정보가 이상함: ${JSON.stringify(userA)}`);

const created = (await (
  await fetch(`${base}/api/rooms`, { method: 'POST', headers: { Cookie: cookieA, Origin: base } })
).json()) as { code: string };
const code = created.code;
console.log(`방 ${code} 생성`);
const anonymous = await connect(code, '무명', '').then(
  () => true,
  () => false,
);
check(!anonymous, '로그인 없이 방에 접속됨');

const a = await connect(code, '에이', cookieA);
const b = await connect(code, '비', cookieB);
await until(() => a.room?.seats.length === 2 && b.room?.seats.length === 2, '두 명 입장');
check(a.room!.seats.map((s) => s.name).join() === '에이,비', `방에 표시된 이름이 다름: ${a.room!.seats.map((s) => s.name)}`);

// 2. 네 명까지 들어오고 다섯 번째 사람은 거절
const cookieC = await guest('씨');
const cookieD = await guest('디');
const c = await connect(code, '씨', cookieC);
const d = await connect(code, '디', cookieD);
await until(() => a.room?.seats.length === 4 && d.room?.seats.length === 4, '네 명 입장');
const fifth = await connect(code, '이', await guest('이'));
await until(() => fifth.closed !== null, '다섯 번째 입장 거절');
check(fifth.closed === 4003 && fifth.errors.length === 1, `다섯 번째 입장이 거절되지 않음 (close=${fifth.closed})`);
const all = [a, b, c, d];

// 2-1. 채팅: 방에 있는 모두에게 전해지고, 욕설·전화번호는 가려진다. 연달아 보내면 뒤의 것은 버린다.
send(b, { t: 'chat', text: '안녕  시 발 010-1234-5678' });
send(b, { t: 'chat', text: '도배' });
await until(() => all.every((x) => x.chats.length === 1), '채팅 전달');
check(a.chats[0] === '비: 안녕 ♥♥ (번호)', `채팅 글이 다듬어지지 않음: ${a.chats[0]}`);
await sleep(900);
send(c, { t: 'chat', preset: 1 });
await until(() => all.every((x) => x.chats.length === 2), '정해진 말 전달');
check(d.chats[1] === '씨: #1', `정해진 말이 다름: ${d.chats[1]}`);
check(fifth.chats.length === 0, '방에 없는 사람에게 채팅이 전달됨');

// 3. 방장(첫 번째로 들어온 사람)만, 나머지가 모두 준비한 뒤에 시작할 수 있다
send(b, { t: 'ready', ready: true });
send(c, { t: 'ready', ready: true });
await sleep(100);
send(a, { t: 'start' });
await until(() => a.errors.length === 1, '준비 안 된 사람이 있을 때 시작 거절');
check(a.room?.status === 'lobby', '준비하지 않은 사람이 있는데 시작됨');
send(d, { t: 'ready', ready: true });
await sleep(100);
send(b, { t: 'start' });
await until(() => b.errors.length === 1, '방장이 아닌 사람의 시작 거절');
check(a.room?.status === 'lobby', '방장이 아닌 사람이 시작함');
send(a, { t: 'start' });
await until(() => all.every((x) => x.room?.status === 'playing'), '게임 시작');
const rules = a.room!.game!.rules;
check(a.room!.game!.players.length === 4 && rules.runners === 5 && rules.finishesToWin === 2, `4인 규칙이 아님: ${JSON.stringify(rules)}`);

// 4. 차례가 아닌 사람의 행동은 거절
const notTurn = all.find((x) => x.room!.game!.turn !== x.room!.me)!;
const before = notTurn.errors.length;
send(notTurn, { t: 'act', action: { type: 'roll' } });
await until(() => notTurn.errors.length === before + 1, '차례 아닌 행동 거절');

// 5. 끝날 때까지 자동으로 둔다. 거짓말과 의심을 섞는다.
let moves = 0;
let challenges = 0;
let claims = 0;
let doubts = 0;
function autoplay(cl: Client) {
  let acted = -1;
  const step = (room: RoomView) => {
    const g = room.game;
    if (room.status !== 'playing' || !g || !pending(g).includes(room.me) || acted === room.seq) return;
    acted = room.seq;
    moves++;
    // 남의 응답은 골랐는지만 보여야 한다.
    check(g.replies.every((r, i) => i === room.me || r === null || r === 'hidden'), `${cl.name}: 남의 응답 내용이 전송됨`);
    if (g.phase === 'roll') send(cl, { t: 'act', action: { type: 'roll' } });
    else if (g.phase === 'claim') {
      // 두 번에 한 번은 가장 큰 숫자라고 뻥친다.
      const lie = g.die === BLANK || claims++ % 2 === 0;
      send(cl, { t: 'act', action: { type: 'claim', value: lie ? g.rules.maxClaim : g.die! } });
    } else {
      // 가장 큰 숫자라는 선언은 세 번에 한 번 의심한다 (첫 번째는 반드시).
      const doubt = g.claim === g.rules.maxClaim && doubts++ % 3 === 0;
      if (doubt) challenges++;
      send(cl, { t: 'act', action: { type: doubt ? 'challenge' : 'accept' } });
    }
  };
  cl.onState = step;
  if (cl.room) step(cl.room);
}
all.forEach(autoplay);
await until(() => all.every((x) => x.room?.status === 'over'), '게임 종료', 60_000);
const g = a.room!.game!;
console.log(`게임 종료: ${g.round}턴, 행동 ${moves}번, 의심 ${challenges}번, 승자 ${g.players[g.winner!]!.name}`);
check(all.every((x) => x.room!.game!.winner === g.winner), '사람마다 본 승자가 다름');
check(challenges > 0, '의심이 한 번도 일어나지 않아 공개 연출을 확인하지 못함');
// 끝난 뒤에는 점수표에 쓸 기록이 온다. 자동 대결은 두 번에 한 번 뻥을 치므로 뻥 기록이 있어야 한다.
const stats = a.room!.game!.stats;
check(Array.isArray(stats) && stats.length === 4, '끝났는데 판 기록이 오지 않음');
check((stats ?? []).reduce((n, x) => n + x.bluffs, 0) > 0, '뻥 기록이 0');
console.log('판 기록:', JSON.stringify(stats));

// 5-1. 전적이 모두에게 기록된다
const winnerIsA = g.winner === a.room!.me;
const [recA, recB] = [(await me(cookieA)).records!, (await me(cookieB)).records!];
check(recA.played === 1 && recB.played === 1, `전적 판 수가 다름: ${recA.played}, ${recB.played}`);
check(recA.won === (winnerIsA ? 1 : 0), '전적의 승패가 실제 결과와 다름');
check(!!recA.recent[0]?.opponents.includes('비') && !!recB.recent[0]?.opponents.includes('에이'), `전적의 상대 이름이 다름: ${recA.recent[0]?.opponents}`);

// 6. 다시 하기: 모두 눌러야 시작한다
for (const x of all) x.onState = () => {};
for (const x of all) send(x, { t: 'rematch' });
await until(() => all.every((x) => x.room?.status === 'playing'), '다시 하기');

// 7. 여럿이 하는 판에서 한 명이 나가도 판은 계속되고, 한 명만 남으면 그 사람이 이긴다
send(a, { t: 'leave' });
await until(() => b.room!.events.some((e) => e.type === 'forfeit'), '기권 알림');
check(b.room!.status === 'playing' && b.room!.game!.players[0]!.out, '한 명이 나갔는데 판이 계속되지 않음');
check(b.room!.seats.length === 4, '판 도중에 자리 번호가 바뀜');
send(c, { t: 'leave' });
await until(() => b.room!.game!.players[2]!.out, '두 번째 기권');
check(b.room!.status === 'playing', '두 명이 남았는데 판이 끝남');
send(d, { t: 'leave' });
await until(() => b.room?.status === 'over', '기권 처리');
check(b.room!.game!.winner === b.room!.me, '혼자 남았는데 내가 이기지 않음');
const afterForfeit = (await me(cookieB)).records!;
check(afterForfeit.played === 2 && afterForfeit.recent[0]?.reason === 'forfeit' && afterForfeit.recent[0].won, '기권 판이 전적에 기록되지 않음');

b.ws.close();
// 8. 빠른 매칭: 두 명이 대기열에 서면 같은 방 코드를 받고, 준비 없이 바로 시작한다
/** got: 지금까지 받은 메시지, done: 연결이 닫힐 때 끝나는 약속. */
function queue(cookie: string): { got: MatchMessage[]; done: Promise<MatchMessage[]> } {
  const got: MatchMessage[] = [];
  const done = new Promise<MatchMessage[]>((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws/match`, { headers: { Cookie: cookie, Origin: base } } as never);
    ws.onmessage = (e) => got.push(JSON.parse(String(e.data)) as MatchMessage);
    ws.onclose = () => resolve(got);
    ws.onerror = () => reject(new Error('대기열 접속 실패'));
  });
  return { got, done };
}
const noLogin = await queue('').done.then(
  () => true,
  () => false,
);
check(!noLogin, '로그인 없이 대기열에 접속됨');

const [cookieX, cookieY, cookieZ] = [await guest('엑스'), await guest('와이'), await guest('제트')];
const queueX = queue(cookieX);
await until(() => queueX.got.length > 0, 'X가 대기열에 섬'); // X가 줄을 선 것을 확인한 뒤 Y를 보낸다
const [gotX, gotY] = await Promise.all([queueX.done, queue(cookieY).done]);
const matchedX = gotX.find((m) => m.t === 'matched');
const matchedY = gotY.find((m) => m.t === 'matched');
check(gotX[0]?.t === 'waiting', '먼저 온 사람이 대기 안내를 받지 못함');
check(!!matchedX && !!matchedY && matchedX.code === matchedY.code, `두 사람의 방 코드가 다름: ${JSON.stringify([gotX, gotY])}`);
if (matchedX?.t === 'matched') {
  const x = await connect(matchedX.code, '엑스', cookieX);
  const intruder = await connect(matchedX.code, '제트', cookieZ);
  await until(() => intruder.closed !== null, '매칭되지 않은 사람 거절');
  check(intruder.closed === 4003, '매칭되지 않은 사람이 방에 들어옴');
  const y = await connect(matchedX.code, '와이', cookieY);
  await until(() => x.room?.status === 'playing' && y.room?.status === 'playing', '빠른 매칭 자동 시작');
  check(x.room!.auto === true, '빠른 매칭 방 표시가 없음');
  // 빠른 매칭 방에서는 직접 쓴 글은 거절되고 정해진 말만 전해진다
  const errorsBefore = x.errors.length;
  send(x, { t: 'chat', text: '어디 살아?' });
  await until(() => x.errors.length === errorsBefore + 1, '빠른 매칭에서 자유 채팅 거절');
  send(x, { t: 'chat', preset: 0 });
  await until(() => y.chats.length === 1, '빠른 매칭에서 정해진 말 전달');
  check(y.chats[0] === '엑스: #0', `빠른 매칭 채팅이 다름: ${y.chats}`);
  console.log(`빠른 매칭: 방 ${matchedX.code}에서 자동 시작`);
  x.ws.close();
  y.ws.close();
}

if (failures.length) {
  console.error(`\n실패 ${failures.length}건:`);
  for (const f of new Set(failures)) console.error(' - ' + f);
  process.exit(1);
}
console.log('모든 확인 통과');
process.exit(0);

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
async function until(cond: () => boolean | Promise<boolean>, what: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
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
// 7-1. 채팅은 서버에 보관된다(운영자만 볼 수 있다)
const admin = { Authorization: `Bearer ${adminToken}` };
check((await fetch(`${base}/api/admin/chat?room=${code}`)).status === 403, '토큰 없이 채팅 기록이 보임');
type ChatRow = { name: string; text: string | null; preset: number | null };
let stored: ChatRow[] = [];
await until(async () => {
  stored = ((await (await fetch(`${base}/api/admin/chat?room=${code}`, { headers: admin })).json()) as { chat: ChatRow[] }).chat;
  return stored.length >= 2;
}, '채팅 보관');
check(stored.some((m) => m.name === '비' && m.text === '안녕 ♥♥ (번호)') && stored.some((m) => m.name === '씨' && m.preset === 1), `보관된 채팅이 다름: ${JSON.stringify(stored)}`);
const purged = (await (await fetch(`${base}/api/admin/purge-chat`, { method: 'POST', headers: admin })).json()) as { deleted: number };
check(purged.deleted === 0, `방금 쓴 채팅이 지워짐: ${purged.deleted}`);

// 7-2. 회원가입: 게스트(비)가 이메일로 가입하면 회원이 되고, 게스트 때의 전적이 그대로 옮겨진다
async function authPost(path: string, body: unknown, cookie = ''): Promise<{ ok: boolean; status: number; cookie: string; text: string }> {
  const res = await fetch(`${base}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie && { Cookie: cookie }) },
    body: JSON.stringify(body),
  });
  const jar = new Map(cookie.split('; ').filter(Boolean).map((c) => [c.split('=')[0]!, c] as const));
  for (const c of res.headers.getSetCookie()) {
    const pair = c.split(';')[0]!;
    if (/max-age=0/i.test(c)) jar.delete(pair.split('=')[0]!);
    else jar.set(pair.split('=')[0]!, pair);
  }
  return { ok: res.ok, status: res.status, cookie: [...jar.values()].join('; '), text: await res.text() };
}
const email = `e2e-${Date.now()}@example.com`;
const password = 'hippo-bridge-1234';
const guestB = (await me(cookieB)).user!;
check((await authPost('sign-up/email', { name: '비', email, password: 'short' }, cookieB)).ok === false, '짧은 비밀번호로 가입됨');
const signedUp = await authPost('sign-up/email', { name: '비', email, password, agreedAt: Date.now() }, cookieB);
check(signedUp.ok, `회원가입 실패: ${signedUp.status} ${signedUp.text}`);
const member = await me(signedUp.cookie);
check(member.user?.isAnonymous === false && member.user.id !== guestB.id, `가입 후에도 게스트임: ${JSON.stringify(member.user)}`);
check(member.records?.played === 2, `게스트 때의 전적이 옮겨지지 않음: ${member.records?.played}`);
check((await authPost('sign-up/email', { name: '또', email, password }, '')).ok === false, '같은 이메일로 두 번 가입됨');

// 7-3. 로그인: 틀린 비밀번호는 거절, 맞으면 같은 계정으로 들어간다
check((await authPost('sign-in/email', { email, password: 'wrong-password-1' })).ok === false, '틀린 비밀번호로 로그인됨');
const signedIn = await authPost('sign-in/email', { email, password });
check(signedIn.ok && (await me(signedIn.cookie)).user?.id === member.user?.id, `로그인 실패: ${signedIn.status} ${signedIn.text}`);

// 7-4. 의견 보내기: 회원만, 하루 다섯 번까지
const feedback = (text: string, cookie: string) =>
  fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie }, body: JSON.stringify({ text, page: 'home', mode: 'game' }) });
check((await feedback('게스트가 보내는 의견입니다', cookieA)).status === 401, '게스트가 의견을 보냄');
check((await feedback('짧음', signedIn.cookie)).status === 400, '너무 짧은 의견이 저장됨');
const note = `점검용 의견 ${Date.now()}`;
check((await feedback(note, signedIn.cookie)).status === 200, '회원의 의견이 저장되지 않음');
for (let i = 0; i < 4; i++) await feedback(`점검용 의견 반복 ${i}`, signedIn.cookie);
check((await feedback('여섯 번째 의견입니다', signedIn.cookie)).status === 429, '하루 한도를 넘겨도 의견이 저장됨');
const inbox = ((await (await fetch(`${base}/api/admin/feedback`, { headers: admin })).json()) as { feedback: { text: string; name: string }[] }).feedback;
check(inbox.some((x) => x.text === note && x.name === '비'), '보낸 의견이 운영자 목록에 없음');
check((await fetch(`${base}/api/admin/feedback`)).status === 403, '토큰 없이 의견 목록이 보임');

// 7-5. 탈퇴: 계정과 내가 보낸 채팅·의견이 지워지고, 그 이메일로는 더 로그인할 수 없다
check((await authPost('delete-user', { password: 'wrong-password-1' }, signedIn.cookie)).ok === false, '틀린 비밀번호로 탈퇴됨');
const left = await authPost('delete-user', { password }, signedIn.cookie);
check(left.ok, `탈퇴 실패: ${left.status} ${left.text}`);
check((await authPost('sign-in/email', { email, password })).ok === false, '탈퇴한 계정으로 로그인됨');
const afterLeave = ((await (await fetch(`${base}/api/admin/feedback`, { headers: admin })).json()) as { feedback: { text: string }[] }).feedback;
check(!afterLeave.some((x) => x.text === note), '탈퇴했는데 의견이 남아 있음');
console.log('회원가입 · 로그인 · 의견 · 탈퇴 확인');

// 8. 빠른 매칭: 두 명이 대기열에 서면 같은 방 코드를 받고, 준비 없이 바로 시작한다
/** got: 지금까지 받은 메시지, done: 연결이 닫힐 때 끝나는 약속. */
function queue(cookie: string): { got: MatchMessage[]; done: Promise<MatchMessage[]> } {
  const got: MatchMessage[] = [];
  const done = new Promise<MatchMessage[]>((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws/match`, { headers: { Cookie: cookie, Origin: base } } as never);
    ws.onopen = () => ws.send('join');
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

// 9. 순위전: 회원끼리만, 1대1, 끝나면 점수가 바뀐다
/** 대기열에 선다. mode가 'ranked'면 순위전 줄. close로 줄에서 나온다. */
function line(cookie: string, mode = '') {
  const got: MatchMessage[] = [];
  let ws!: WebSocket;
  let leaving = false;
  const done = new Promise<MatchMessage[]>((resolve, reject) => {
    ws = new WebSocket(`${wsBase}/ws/match${mode ? `?mode=${mode}` : ''}`, { headers: { Cookie: cookie, Origin: base } } as never);
    ws.onopen = () => ws.send('join');
    ws.onmessage = (e) => got.push(JSON.parse(String(e.data)) as MatchMessage);
    ws.onclose = () => resolve(got);
    // 우리가 먼저 끊은 경우에는 서버가 닫는 인사를 돌려주지 않아 오류로 끝날 수 있다. 그건 실패가 아니다.
    ws.onerror = () => (leaving ? resolve(got) : reject(new Error('대기열 접속 실패')));
  });
  return {
    got,
    done,
    close: () => {
      leaving = true;
      ws.close();
    },
  };
}
interface RankInfo {
  rating: number;
  tier: number | null;
  games: number;
  wins: number;
  losses: number;
  place: number | null;
}
const rankOf = async (cookie: string) => ((await (await fetch(`${base}/api/me`, { headers: { Cookie: cookie } })).json()) as { rank: RankInfo | null }).rank;
const rankPassword = 'ranked-hippo-1234';
/** 점검용 회원을 만든다(게스트로 들어온 뒤 가입). */
async function newMember(name: string): Promise<{ name: string; cookie: string }> {
  const res = await authPost('sign-up/email', { name, email: `rank-${Math.random().toString(36).slice(2)}-${Date.now()}@example.com`, password: rankPassword, agreedAt: Date.now() }, await guest(name));
  if (!res.ok) throw new Error(`점검용 회원 가입 실패: ${res.status} ${res.text}`);
  return { name, cookie: res.cookie };
}

const guestRanked = await line(await guest('손님'), 'ranked').done.then(
  () => true,
  () => false,
);
check(!guestRanked, '게스트가 순위전 대기열에 들어감');
check((await rankOf(cookieA)) === null, '게스트에게 순위 정보가 내려감');

const [P, Q, R] = [await newMember('피'), await newMember('큐'), await newMember('알')];
const startRank = await rankOf(P.cookie);
check(startRank?.rating === 1000 && startRank.games === 0 && startRank.tier === null && startRank.place === null, `처음 순위 정보가 이상함: ${JSON.stringify(startRank)}`);

// 순위전 줄과 빠른 매칭 줄은 섞이지 않는다
const quickWaiter = line(await guest('빠름'));
const rankedWaiter = line(P.cookie, 'ranked');
await until(() => quickWaiter.got.length > 0 && rankedWaiter.got.length > 0, '두 줄에 각각 섬');
await sleep(400);
check(!quickWaiter.got.some((m) => m.t === 'matched') && !rankedWaiter.got.some((m) => m.t === 'matched'), '순위전과 빠른 매칭이 서로 짝지어짐');
quickWaiter.close();
rankedWaiter.close();
await Promise.all([quickWaiter.done, rankedWaiter.done]);

/** 두 회원이 순위전으로 만나 한 판을 하고(진 쪽이 바로 나간다), 이긴 쪽이 받은 결과 화면을 돌려준다. */
async function rankedGame(winner: { name: string; cookie: string }, loser: { name: string; cookie: string }): Promise<RoomView> {
  const first = line(winner.cookie, 'ranked');
  await until(() => first.got.length > 0, '순위전 줄에 섬');
  const [gotW, gotL] = await Promise.all([first.done, line(loser.cookie, 'ranked').done]);
  const matched = gotW.find((m) => m.t === 'matched');
  if (matched?.t !== 'matched' || !gotL.some((m) => m.t === 'matched' && m.code === matched.code)) throw new Error(`순위전 매칭 실패: ${JSON.stringify([gotW, gotL])}`);
  const w = await connect(matched.code, winner.name, winner.cookie);
  const l = await connect(matched.code, loser.name, loser.cookie);
  await until(() => w.room?.status === 'playing' && l.room?.status === 'playing', '순위전 자동 시작');
  check(w.room!.ranked === true && w.room!.rank === null, '순위전 방 표시가 없거나, 끝나기 전에 점수 변화가 내려감');
  send(l, { t: 'leave' });
  await until(() => w.room?.status === 'over', '순위전 종료');
  // 순위전에는 다시 하기가 없다
  send(w, { t: 'rematch' });
  await sleep(150);
  check(w.room!.status === 'over', '순위전에서 다시 하기가 시작됨');
  const room = w.room!;
  w.ws.close();
  return room;
}

// 첫 판: 둘 다 1000점, 배치 중(K=40)이므로 +20 / -20
const first = await rankedGame(P, Q);
const mine = first.rank?.[first.me];
const theirs = first.rank?.[1 - first.me];
check(mine?.delta === 20 && mine.before === 1000 && mine.after === 1020 && mine.counted && mine.won, `이긴 쪽 점수 변화가 다름: ${JSON.stringify(mine)}`);
check(theirs?.delta === -20 && theirs.after === 980 && !theirs.won, `진 쪽 점수 변화가 다름: ${JSON.stringify(theirs)}`);
const [afterP, afterQ] = [await rankOf(P.cookie), await rankOf(Q.cookie)];
check(afterP?.rating === 1020 && afterP.wins === 1 && afterP.games === 1 && afterQ?.rating === 980 && afterQ.losses === 1, `저장된 점수가 다름: ${JSON.stringify([afterP, afterQ])}`);

// 같은 두 사람은 하루 세 판까지만 점수에 반영된다
await rankedGame(P, Q);
const third = await rankedGame(P, Q);
check(third.rank?.[third.me]?.counted === true, '세 번째 판이 점수에 반영되지 않음');
const fourth = await rankedGame(P, Q);
const frozen = fourth.rank?.[fourth.me];
check(frozen?.counted === false && frozen.delta === 0 && frozen.after === frozen.before, `네 번째 판이 점수에 반영됨: ${JSON.stringify(frozen)}`);
check((await rankOf(P.cookie))?.games === 3, '점수에 반영되지 않은 판이 판 수에 들어감');

// 다른 상대와 두 판을 더 해 배치(5판)를 마치면 티어와 등수가 생기고 순위표에 오른다
await rankedGame(P, R);
const placement = await rankedGame(P, R);
check(placement.rank?.[placement.me]?.tierBefore === null && typeof placement.rank?.[placement.me]?.tier === 'number', `배치를 마쳤는데 티어가 없음: ${JSON.stringify(placement.rank?.[placement.me])}`);
const placed = await rankOf(P.cookie);
check(placed?.games === 5 && placed.wins === 5 && placed.tier !== null && placed.place !== null && placed.rating > 1080, `배치 후 순위 정보가 다름: ${JSON.stringify(placed)}`);
const board = ((await (await fetch(`${base}/api/ranking`)).json()) as { top: { name: string; rating: number; tier: number }[] }).top;
check(board.some((x) => x.name === '피' && x.rating === placed?.rating), `순위표에 없음: ${JSON.stringify(board.slice(0, 5))}`);
check(!board.some((x) => x.name === '큐'), '배치를 마치지 않은 사람이 순위표에 있음');
console.log(`순위전: 피 ${placed?.rating}점 (${placed?.place}등), 순위표 ${board.length}명`);

// 점검용 회원은 탈퇴시켜 순위표에 남기지 않는다
for (const m of [P, Q, R]) check((await authPost('delete-user', { password: rankPassword }, m.cookie)).ok, `${m.name} 탈퇴 실패`);
const boardAfter = ((await (await fetch(`${base}/api/ranking`)).json()) as { top: { name: string }[] }).top;
check(!boardAfter.some((x) => x.name === '피'), '탈퇴했는데 순위표에 남아 있음');

// 10. 관리자 페이지: 암호로 들어가고, 설정을 바꾸면 봇이 빠른 매칭에 들어온다
const adminPassword = process.env.ADMIN_PASSWORD ?? readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^ADMIN_PASSWORD=(.+)$/m)?.[1]?.trim();
const adminLogin = (password: string) =>
  fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ password }) });
check((await fetch(`${base}/api/admin/overview`)).status === 403, '로그인 없이 관리자 개요가 보임');
check((await fetch(`${base}/api/admin/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"botsEnabled":true}' })).status === 403, '로그인 없이 설정이 바뀜');
check((await adminLogin('wrong-admin-password')).status === 401, '틀린 관리자 암호로 로그인됨');
const loggedIn = await adminLogin(adminPassword ?? '');
check(loggedIn.ok, `관리자 로그인 실패: ${loggedIn.status}`);
const adminCookie = loggedIn.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
check(/HttpOnly/i.test(loggedIn.headers.getSetCookie()[0] ?? ''), '관리자 쿠키가 HttpOnly가 아님');
const asAdmin = (path: string, init: RequestInit = {}) =>
  fetch(`${base}/api/admin/${path}`, { ...init, headers: { 'Content-Type': 'application/json', Origin: base, Cookie: adminCookie, ...init.headers } });
check(((await (await asAdmin('session')).json()) as { admin: boolean }).admin === true, '관리자 세션이 확인되지 않음');
check(((await (await fetch(`${base}/api/admin/session`)).json()) as { admin: boolean }).admin === false, '쿠키 없이 관리자로 보임');
const overview = (await (await asAdmin('overview')).json()) as Record<string, number>;
check(overview.matches! > 0 && overview.users! > 0 && typeof overview.members === 'number', `개요 숫자가 이상함: ${JSON.stringify(overview)}`);
const listed = (await (await asAdmin('users?guests=1&q=' + encodeURIComponent('에이'))).json()) as { users: { name: string; guest: boolean; email: string | null }[] };
check(listed.users.some((u) => u.name === '에이' && u.guest && u.email === null), '회원 목록에서 게스트를 찾지 못함');

interface GameSettings {
  botsEnabled: boolean;
  botWaitSec: number;
  botLevel: string;
  turnSeconds: number;
  freeChat: boolean;
  notice: string;
}
const original = ((await (await asAdmin('settings')).json()) as { settings: GameSettings }).settings;
const putSettings = async (s: Partial<GameSettings>) => ((await (await asAdmin('settings', { method: 'PUT', body: JSON.stringify(s) })).json()) as { settings: GameSettings }).settings;
try {
  // 범위를 벗어난 값은 서버가 맞춰서 저장한다
  const clamped = await putSettings({ botWaitSec: 1, turnSeconds: 9999, botLevel: 'impossible' as never });
  check(clamped.botWaitSec === 3 && clamped.turnSeconds === 120 && clamped.botLevel === original.botLevel, `범위를 벗어난 설정이 그대로 저장됨: ${JSON.stringify(clamped)}`);
  const noticeText = `점검 공지 ${Date.now()}`;
  const on = await putSettings({ botsEnabled: true, botWaitSec: 3, turnSeconds: 30, notice: noticeText });
  check(on.botsEnabled && on.botWaitSec === 3, '봇 설정이 저장되지 않음');

  // 혼자 빠른 매칭 줄에 서면 잠시 뒤 봇이 있는 방으로 안내된다(설정이 퍼지는 데 최대 15초)
  const lonelyCookie = await guest('혼자');
  const lonely = line(lonelyCookie);
  const gotLonely = await Promise.race([lonely.done, sleep(40_000).then(() => lonely.got)]);
  const botMatch = gotLonely.find((m) => m.t === 'matched');
  check(!!botMatch, `봇이 켜져 있는데 혼자서는 매칭되지 않음: ${JSON.stringify(gotLonely)}`);
  if (botMatch?.t === 'matched') {
    const human = await connect(botMatch.code, '혼자', lonelyCookie);
    await until(() => human.room?.status === 'playing', '봇과의 판 시작');
    // 상대가 봇이라는 것은 브라우저로 가지 않는다. 관리자 페이지의 '진행 중인 방'에서만 알 수 있다.
    const botSeat = 1 - human.room!.me;
    check(human.room!.seats.length === 2 && !JSON.stringify(human.room).includes('bot') && !human.room!.seats[botSeat]!.name.includes('봇'), `봇이라는 표시가 브라우저로 감: ${JSON.stringify(human.room!.seats)}`);
    type LiveInfo = { queue: { quick: number; ranked: number }; rooms: { code: string; mode: string; bots: number; humans: number; names: string }[] };
    let seen: LiveInfo['rooms'][number] | undefined;
    await until(async () => {
      seen = ((await (await asAdmin('live')).json()) as LiveInfo).rooms.find((x) => x.code === botMatch.code);
      return !!seen;
    }, '진행 중인 방 목록에 나타남');
    check(seen?.mode === 'bot' && seen.bots === 1 && seen.humans === 1 && seen.names.includes('[봇]'), `관리자 목록의 봇 방 정보가 다름: ${JSON.stringify(seen)}`);
    check(human.room!.ranked === false, '봇 방이 순위전으로 표시됨');
    // 사람은 바로바로 두고, 봇이 스스로 굴리고·선언하고·응답해서 판이 여러 턴 나아가는지 본다
    autoplay(human);
    await until(() => (human.room?.game?.round ?? 0) >= 4 || human.room?.status === 'over', '봇이 수를 둠', 90_000);
    console.log(`봇 대결: ${human.room!.seats[botSeat]!.name}와 ${human.room!.game!.round}턴까지 진행`);
    human.onState = () => {};
    send(human, { t: 'leave' });
    human.ws.close();
  }
  check(((await (await fetch(`${base}/api/me`)).json()) as { notice?: string }).notice === noticeText, '공지가 첫 화면 정보에 실리지 않음');
  // 한눈에 보기용 추이: 오늘 끝난 판이 종류별로 잡히고, 활동 기록에 설정 변경이 남는다
  const trend = (await (await asAdmin('trends')).json()) as { days: Record<string, number>[]; recent: { mode: string; players: string }[] };
  const todayRow = trend.days.at(-1)!;
  check(trend.days.length === 14 && todayRow.friend! >= 1 && todayRow.ranked! >= 1 && todayRow.players! >= 4, `오늘 추이가 이상함: ${JSON.stringify(todayRow)}`);
  // 고유 인원: 오늘 값은 오늘 막대와 같고, 기간 전체는 날짜별 값을 더한 것보다 클 수 없다(같은 사람은 한 번만)
  const uniq = (trend as unknown as { unique: Record<'today' | 'week' | 'period' | 'month', { all: number; members: number; guests: number }> }).unique;
  const dailySum = trend.days.reduce((n, d) => n + d.players!, 0);
  check(uniq.today.all === todayRow.players && uniq.today.all === uniq.today.members + uniq.today.guests, `오늘 고유 인원이 막대와 다름: ${JSON.stringify(uniq.today)} / ${todayRow.players}`);
  check(uniq.period.all <= dailySum && uniq.today.all <= uniq.week.all && uniq.week.all <= uniq.period.all && uniq.period.all <= uniq.month.all, `고유 인원의 크기 순서가 이상함: ${JSON.stringify(uniq)} (날짜별 합 ${dailySum})`);
  const logged = ((await (await asAdmin('log')).json()) as { log: { action: string; detail: string }[] }).log;
  check(logged.some((l) => l.action === '설정 변경' && l.detail.includes('botsEnabled')) && logged.some((l) => l.action === '로그인 실패'), '관리자 활동 기록에 설정 변경이나 로그인 실패가 없음');
  // 다른 사이트에서 보낸 것처럼 꾸민 변경 요청은 쿠키가 있어도 거절된다
  check((await asAdmin('settings', { method: 'PUT', body: '{"notice":"x"}', headers: { Origin: 'https://evil.example' } })).status === 403, '다른 사이트에서 온 관리자 요청이 통과함');
  // 욕설이 들어간 닉네임은 가려져서 보인다
  const rude = await guest('시발하마');
  check((await me(rude)).user?.name === '♥♥하마', `닉네임의 욕설이 가려지지 않음: ${(await me(rude)).user?.name}`);
  // 순위전 줄에는 봇이 오지 않는다
  const solo = await newMember('솔로');
  const soloLine = line(solo.cookie, 'ranked');
  await sleep(6_000);
  check(!soloLine.got.some((m) => m.t === 'matched'), '순위전에 봇이 들어옴');
  soloLine.close();
  await soloLine.done;
  await authPost('delete-user', { password: rankPassword }, solo.cookie);
} finally {
  // 점검 전의 설정으로 되돌린다
  const restored = await putSettings(original);
  check(JSON.stringify(restored) === JSON.stringify(original), '설정을 원래대로 되돌리지 못함');
}
check((await asAdmin('logout', { method: 'POST' })).ok, '관리자 로그아웃 실패');

if (failures.length) {
  console.error(`\n실패 ${failures.length}건:`);
  for (const f of new Set(failures)) console.error(' - ' + f);
  process.exit(1);
}
console.log('모든 확인 통과');
process.exit(0);

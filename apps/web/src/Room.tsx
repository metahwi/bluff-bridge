import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { BLANK, RULES, canRespond, pending, responders } from '@bluff-bridge/engine';
import type { GameEvent, PlayerView } from '@bluff-bridge/engine';
import { MAX_SEATS, MIN_SEATS } from '@bluff-bridge/protocol/types';
import type { RoomView } from '@bluff-bridge/protocol/types';
import { Die, Pawn } from './pixel.tsx';
import { sound } from './sound.ts';
import { Result } from './Result.tsx';
import { SettingsButton } from './Settings.tsx';
import { ThrowButton } from './ThrowButton.tsx';
import { StageView } from './stage/StageView.tsx';
import type { ChompCue, StageControls } from './stage/StageView.tsx';
import type { StageState } from './stage/Stage.ts';
import type { DiceState } from './stage/dice.ts';
import { useRoom } from './useRoom.ts';
import { settings, useChat, useWork } from './settings.ts';
import { Chat } from './Chat.tsx';
import { ReplyOrder } from './ReplyOrder.tsx';
import { WorkRoom, describeWork } from './work/WorkRoom.tsx';
import { WorkChrome } from './work/WorkChrome.tsx';

type Challenged = Extract<GameEvent, { type: 'challenged' }>;

/** 주사위가 쟁반 위에서 구르다 멈출 때까지 기다리는 시간. 그 전에 눈을 글자로 먼저 보여 주지 않는다. */
const DICE_SETTLE_MS = 1700;

const face = (die: number | null) => (die === null ? '?' : die === BLANK ? '꽝' : String(die));

function Countdown({ deadline }: { deadline: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (deadline === null) return null;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <span className={'timer' + (left <= 5 ? ' urgent' : '')}>남은 시간 {left}초</span>;
}

/**
 * 셋 이상일 때 의심이 어떤 순서로 반영됐는지: "① 디 믿기 → ② 에이 의심!" 과, 순서가 오지 않아 반영되지 않은 사람.
 * 둘이서 할 때는 빈 글을 돌려준다.
 */
function replyTrail(e: Extract<GameEvent, { type: 'challenged' }>, n: (i: number) => string, words: { accept: string; doubt: string; skipped: (names: string) => string }) {
  const order = e.order ?? [];
  if (order.length < 2) return { lead: '', tail: '' };
  const at = order.indexOf(e.challenger);
  const mark = (k: number) => '①②③④'[k] ?? `${k + 1}`;
  const lead = order.slice(0, at + 1).map((i, k) => `${mark(k)} ${n(i)} ${i === e.challenger ? words.doubt : words.accept}`).join(' → ') + ' → ';
  const rest = order.slice(at + 1).map(n).join(', ');
  return { lead, tail: rest ? ' ' + words.skipped(rest) : '' };
}

function describe(e: GameEvent, g: PlayerView): string | null {
  const n = (i: number) => g.players[i]?.name ?? '?';
  switch (e.type) {
    case 'claimed':
      return `${n(e.player)}: "${e.value}칸!"`;
    case 'accepted':
      return g.players.length > 2 ? `모두 믿었어요. ${n(e.roller)} ${e.steps}칸 전진.` : `${n(e.player)}가 믿었어요. ${n(e.roller)} ${e.steps}칸 전진.`;
    case 'challenged': {
      const trail = replyTrail(e, n, { accept: '믿기', doubt: '의심!', skipped: (names) => `(${names}의 선택은 순서가 오지 않아 반영되지 않았어요.)` });
      return trail.lead + (e.truth
        ? `${n(e.challenger)}의 의심 실패! 실제 눈은 ${face(e.die)}. ${n(e.challenger)}의 ${e.revoked ? '완주한 말이 끌려와' : '말이'} 하마 밥이 됐어요.`
        : `${n(e.challenger)}의 의심 성공! 실제 눈은 ${face(e.die)}. ${n(e.roller)}의 말이 하마 밥이 됐어요.`) + trail.tail;
    }
    case 'finished':
      return `${n(e.player)} 완주!`;
    case 'out':
      return `${n(e.player)}의 말이 모두 떨어졌어요. 이제 의심만 할 수 있어요.`;
    case 'forfeit':
      return `${n(e.player)} 님이 기권했어요.`;
    default:
      return null;
  }
}

/** 점수판 이름 옆의 한마디: 지금 무엇을 하는 중인지. */
function plateStatus(game: PlayerView, i: number): string {
  const p = game.players[i]!;
  if (p.gone) return '나감';
  if (p.out) return canRespond(p) && game.phase !== 'over' ? (game.phase === 'respond' ? (game.replies?.[i] ? '골랐음' : '고르는 중') : '말 없음') : '탈락';
  if (game.phase === 'over') return '';
  if (game.turn === i) return game.phase === 'respond' ? '선언함' : '차례';
  if (game.phase !== 'respond') return '';
  const no = game.players.length > 2 ? `${responders(game).indexOf(i) + 1}번 · ` : '';
  // 셋 이상이면 칸이 좁으므로 번호와 표시만: "2번 ✓"(골랐음), "2번 …"(고르는 중)
  if (no) return responders(game).indexOf(i) + 1 + (game.replies?.[i] ? '번 ✓' : '번 …');
  return game.replies?.[i] ? '골랐음' : '고르는 중';
}

function Plates({ game, me }: { game: PlayerView; me: number }) {
  return (
    <section className={'plates n' + game.players.length}>
      {game.players.map((p, i) => (
        <div key={i} className={'plate' + (game.phase !== 'over' && game.turn === i ? ' active' : '') + (p.out && !canRespond(p) ? ' out' : '')}>
          <div className="plateName">
            <Pawn player={i} scale={2} />
            <b>{p.name}</b>
            {i === me && <small>나</small>}
            <em>{plateStatus(game, i)}</em>
          </div>
          <dl>
            <div>
              <dt>완주</dt>
              <dd>
                {p.finished}/{game.rules.finishesToWin}
              </dd>
            </div>
            <div>
              <dt>대기</dt>
              <dd>{p.reserve}</dd>
            </div>
            <div>
              <dt>먹힘</dt>
              <dd>{p.lost}</dd>
            </div>
          </dl>
        </div>
      ))}
    </section>
  );
}

function Actions({
  room,
  game,
  send,
  controls,
  settled,
}: {
  room: RoomView;
  game: PlayerView;
  send: ReturnType<typeof useRoom>['send'];
  controls: RefObject<StageControls | null>;
  /** 방금 던진 주사위가 멈췄는지. */
  settled: boolean;
}) {
  const me = room.me;
  const myTurn = game.turn === me;
  const name = (i: number) => game.players[i]?.name ?? '?';
  /** 이번 턴에 이미 던졌는지(서버 응답을 기다리는 짧은 동안 단추를 잠근다). */
  const [thrownRound, setThrownRound] = useState(-1);
  const many = game.players.length > 2;

  // 굴릴 말이 없으면 굴리지 못한다. 완주한 말이 있으면 의심은 할 수 있고, 그것도 없으면 구경만 한다.
  const mePlayer = game.players[me];
  const pawnless = !!mePlayer?.out;
  if (mePlayer && pawnless && !canRespond(mePlayer)) return <h2>말을 모두 잃었어요. 구경하는 중…</h2>;
  if (pawnless && game.phase !== 'respond') {
    return (
      <>
        <h2>{name(game.turn)}의 차례예요.</h2>
        <small>굴릴 말이 없어서 의심만 할 수 있어요. 의심이 틀리면 완주한 말을 잃어요.</small>
      </>
    );
  }

  if (game.phase === 'roll') {
    return myTurn ? (
      <>
        <h2>내 차례예요.</h2>
        <ThrowButton
          disabled={thrownRound === game.round}
          onCharge={(p) => controls.current?.charge(p)}
          onThrow={(p) => {
            setThrownRound(game.round);
            controls.current?.throwDice(p);
            send({ t: 'act', action: { type: 'roll' } });
          }}
        />
      </>
    ) : (
      <h2>{name(game.turn)}가 주사위를 던지려는 중…</h2>
    );
  }

  if (!settled) return <h2>주사위가 구르는 중…</h2>;

  if (game.phase === 'claim') {
    if (!myTurn) return <h2>{name(game.turn)}가 선언할 숫자를 고르는 중…</h2>;
    const claims = Array.from({ length: game.rules.maxClaim }, (_, i) => i + 1);
    return (
      <>
        <Die value={game.die} />
        <h2>{game.die === BLANK ? '꽝! 뻥을 쳐야 해요.' : '몇 칸이라고 선언할까요?'}</h2>
        <small>이 주사위는 나만 볼 수 있어요.</small>
        <div className="row claims">
          {claims.map((v) => (
            <button
              key={v}
              className={v === game.die ? '' : 'ghost'}
              onClick={() => send({ t: 'act', action: { type: 'claim', value: v } })}
            >
              {v}
            </button>
          ))}
        </div>
      </>
    );
  }

  if (game.phase === 'respond') {
    const waitingFor = pending(game).map(name).join(', ');
    const mine = game.replies?.[me];
    if (myTurn || mine) {
      return (
        <>
          {myTurn && <Die value={game.die} />}
          <h2>
            {myTurn ? `"${game.claim}칸!"` : mine === 'challenge' ? '의심하기로 했어요.' : '믿기로 했어요.'} {waitingFor}의 선택을 기다리는 중…
          </h2>
          {many && <ReplyOrder game={game} me={me} />}
        </>
      );
    }
    return (
      <>
        <h2>
          {name(game.turn)}: "{game.claim}칸!"
        </h2>
        {pawnless && <small>의심이 틀리면 완주한 말 하나를 잃어요.</small>}
        <div className="row">
          <button className="ghost" onClick={() => send({ t: 'act', action: { type: 'accept' } })}>
            믿기
          </button>
          <button className="danger" onClick={() => send({ t: 'act', action: { type: 'challenge' } })}>
            의심하기
          </button>
        </div>
        {many && <ReplyOrder game={game} me={me} />}
      </>
    );
  }

  return null;
}

export function Room({ code, userId, onExit }: { code: string; userId: string; onExit: () => void }) {
  const { room, deadline, conn, error, fatal, chat, send } = useRoom(code, userId);
  const chatOn = useChat();
  /** 무대에서 재생 중인 추락 연출. 끝날 때까지 조작을 막는다. */
  const [cue, setCue] = useState<ChompCue | null>(null);
  /** 기록은 게임 말투와 업무 말투 두 가지로 함께 쌓아 둔다(도중에 모드를 바꿔도 이어지게). */
  const [log, setLog] = useState<{ game: string; work: string }[]>([]);
  const work = useWork();
  const endCue = useCallback(() => setCue(null), []);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [settled, setSettled] = useState(true);
  const seenSeq = useRef(-1);
  const controls = useRef<StageControls | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /** 연출이 시작되기 직전의 게임 상태(점수판용)와, 직전 렌더링에서 그렸던 게임 상태. */
  const platesBefore = useRef<PlayerView | null>(null);
  const prevGame = useRef<PlayerView | null>(null);

  // 추락 연출은 '새 상태를 그리기 전에' 시작해야 한다. 그래야 게임판이 말이 먹히기 전의 자리
  // (다리 위 몇 번째 칸이었는지)를 기준으로 장면을 만든다. 그래서 다음 화면을 그릴 때까지 기다리는
  // useEffect가 아니라, 새 상태를 받은 바로 그 렌더링에서 연출을 켠다.
  const [cueSeq, setCueSeq] = useState<number | null>(null);
  if (room && room.seq !== cueSeq) {
    setCueSeq(room.seq);
    const hit = cueSeq === null ? undefined : room.events.find((e): e is Challenged => e.type === 'challenged');
    if (hit && room.game) {
      platesBefore.current = prevGame.current;
      setCue({
        id: room.seq,
        fallen: hit.fallen,
        other: hit.fallen === hit.roller ? hit.challenger : hit.roller,
        claim: hit.claim,
        die: hit.die,
        truth: hit.truth,
        victimName: room.game.players[hit.fallen]?.name ?? '?',
        revoked: hit.revoked,
      });
    }
  }

  // 새 상태를 받아들인 뒤의 렌더링에서만 '직전 상태'를 갱신한다(위 블록이 옛 값을 읽을 수 있게).
  if (room && room.seq === cueSeq) prevGame.current = room.game;

  // 새 상태(seq)가 올 때마다 한 번만 기록을 처리한다.
  useEffect(() => {
    if (!room || room.seq === seenSeq.current) return;
    const first = seenSeq.current === -1;
    seenSeq.current = room.seq;
    const game = room.game;
    if (!game || first) return;
    const lines = room.events.flatMap((e) => {
      const text = describe(e, game);
      return text ? [{ game: text, work: describeWork(e, game) ?? text }] : [];
    });
    if (lines.length) setLog((l) => [...lines.reverse(), ...l].slice(0, 40));
    // 방금 주사위가 던져졌으면 멈출 때까지 잠깐 기다린다(업무 모드에는 구르는 주사위가 없다).
    if (!settings.work && room.events.some((e) => e.type === 'rolled')) {
      setSettled(false);
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => setSettled(true), DICE_SETTLE_MS);
    }
  }, [room]);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  useEffect(() => {
    if (room?.status === 'lobby') setLog([]);
  }, [room?.status]);

  // 승패가 화면에 드러나는 순간(추락 연출이 있었다면 그 뒤)에 짧은 음악을 낸다.
  const resultShown = room?.status === 'over' && !cue;
  const iWon = room?.game?.winner === room?.me;
  useEffect(() => {
    if (resultShown) sound.play(iWon ? 'win' : 'lose');
  }, [resultShown, iWon]);

  // 게임이 시작되는 순간: 가늘던 게임판이 위아래로 열리고 카메라가 물러난다.
  const [opening, setOpening] = useState(0);
  const started = room?.status === 'playing';
  useEffect(() => {
    if (started) setOpening((n) => n + 1);
  }, [started]);

  // 배경 음악: 대기실은 마을 곡, 대결 중은 신나는 곡, 누군가 한 번만 더 건너면 이길 때는 조여 오는 곡.
  const inPlay = room?.status === 'playing';
  const matchPoint = inPlay && !!room?.game?.players.some((p) => p.finished >= room.game!.rules.finishesToWin - 1);
  useEffect(() => {
    sound.setMusic(inPlay ? (matchPoint ? 'tense' : 'bridge') : 'village');
    return () => sound.setMusic('village');
  }, [inPlay, matchPoint]);

  // 무대에 넘길 상태. 내용이 같으면 같은 객체를 유지해 무대가 불필요하게 다시 그리지 않게 한다.
  const game = room?.game ?? null;
  const playing = room?.status === 'playing';
  const dice: DiceState =
    !game || !playing
      ? { mode: 'hidden', face: null }
      : game.phase === 'roll'
        ? { mode: 'ready', face: null }
        : { mode: 'shown', face: game.turn === room?.me ? game.die : null };
  const stageKey = JSON.stringify(
    game && room?.status !== 'lobby'
      ? [game.rules.bridgeLength, game.players.map((p) => [p.pos, p.reserve, p.finished]), playing ? game.turn : null, dice]
      : [RULES.bridgeLength, (room?.seats ?? []).map(() => [0, 0, 0]), null, dice],
  );
  const stageState = useMemo<StageState>(() => {
    const [length, players, active, d] = JSON.parse(stageKey) as [number, [number | null, number, number][], number | null, DiceState];
    return {
      length,
      pawns: players.map((p) => p[0]),
      crowd: players.map((p) => ({ reserve: p[1], finished: p[2] })),
      active,
      dice: d,
    };
  }, [stageKey]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 복사 권한이 없으면 주소창에서 직접 복사
    }
  }

  function leave() {
    send({ t: 'leave' });
    onExit();
  }

  if (fatal || !room) {
    const body = fatal ? (
      <div className="panel">
        <h2>{work ? '시트를 열 수 없습니다' : '입장할 수 없어요'}</h2>
        <p className="error" role="alert">
          {fatal}
        </p>
        <button onClick={onExit}>처음으로</button>
      </div>
    ) : (
      <div className="panel">{work ? '여는 중…' : '연결 중…'}</div>
    );
    return work ? (
      <WorkChrome cell={code} formula="">
        {body}
      </WorkChrome>
    ) : (
      <main className="home">{body}</main>
    );
  }

  const leaveDialog = confirmLeave && (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="leave-title">
      <div className="panel">
        <h2 id="leave-title">{work ? '시트를 닫을까요?' : '나갈까요?'}</h2>
        <p>{work ? '지금 닫으면 이번 분기는 상대의 실적으로 처리됩니다.' : '지금 나가면 이 판은 패배로 처리돼요.'}</p>
        <div className="row">
          <button className="ghost" autoFocus onClick={() => setConfirmLeave(false)}>
            {work ? '취소' : '계속 하기'}
          </button>
          <button className="danger" onClick={leave}>
            {work ? '닫기' : '나가기'}
          </button>
        </div>
      </div>
    </div>
  );

  // 업무 모드: 같은 방, 같은 상태를 표 계산 화면으로 보여 준다.
  if (work) {
    return (
      <>
        <div inert={confirmLeave ? true : undefined}>
          <WorkRoom
            code={code}
            room={room}
            deadline={deadline}
            conn={conn}
            error={error}
            log={log.map((l) => l.work)}
            chat={chatOn ? chat : null}
            cue={cue}
            before={platesBefore.current}
            copied={copied}
            send={send}
            onCueDone={endCue}
            onCopy={copyLink}
            onLeave={() => (room.status === 'playing' ? setConfirmLeave(true) : leave())}
          />
        </div>
        {leaveDialog}
      </>
    );
  }

  const me = room.seats[room.me];
  /** 방장(첫 번째 자리)을 뺀 모두가 준비했는지. */
  const othersReady = room.seats.every((s, i) => i === 0 || s.ready);
  const winner = game?.winner ?? null;
  const inGame = game && room.status !== 'lobby';
  // 상대가 나가거나 접속이 끊겨 끝난 판이면 결과 화면에 따로 알린다.
  const forfeitEvent = room.status === 'over' ? room.events.find((e) => e.type === 'forfeit') : undefined;
  const forfeiter = forfeitEvent?.type === 'forfeit' ? forfeitEvent.player : null;

  // 넓은 화면: 왼쪽에 게임판, 오른쪽에 점수·행동·기록. 좁은 화면: 위에서 아래로 쌓는다(순서는 CSS에서 정한다).
  // 팝업은 main 밖에 둔다. main이 inert가 되면 그 안의 버튼도 눌리지 않기 때문.
  return (
    <>
      <main className={'room' + (room.status === 'lobby' ? ' lobby' : '')} inert={confirmLeave ? true : undefined}>
        <header>
          <span>
            방 <b>{code}</b>
            <span className={'conn ' + conn}>{conn === 'open' ? '연결됨' : '재연결 중…'}</span>
          </span>
          <span className="row">
            {!room.auto && (
              <button className="ghost small" onClick={copyLink}>
                {copied ? '복사됨' : '초대 링크 복사'}
              </button>
            )}
            <button
              className="ghost small"
              onClick={() => (room.status === 'playing' ? setConfirmLeave(true) : leave())}
            >
              나가기
            </button>
            <SettingsButton />
          </span>
        </header>

        {/* 판이 시작될 때마다 클래스 이름이 바뀌어 열리는 애니메이션이 다시 재생된다 */}
        <div className={'board' + (opening > 0 && inGame ? ` opening opening${opening % 2}` : '')}>
          <StageView state={stageState} cue={cue} onCueDone={endCue} controls={controls} intro={opening} />
          {game && room.status === 'over' && !cue && (
            <Result
              game={game}
              me={room.me}
              waiting={!!me?.rematch}
              note={
                forfeiter === null
                  ? null
                  : forfeiter === room.me
                    ? '내가 기권해서 패배로 기록됐어요.'
                    : `${game.players[forfeiter]?.name} 님이 기권했어요.`
              }
              onRematch={() => send({ t: 'rematch' })}
              onLeave={leave}
            />
          )}
        </div>

        <aside className="side">
          {/* 연출이 끝나기 전에 점수판이 먼저 바뀌어 결말이 드러나지 않게, 연출 중에는 직전 점수판을 보여 준다. */}
          {inGame && <Plates game={cue && platesBefore.current ? platesBefore.current : game} me={room.me} />}

          {room.status === 'lobby' && (
            <section className="panel">
              <h2>
                {room.auto
                  ? '상대가 들어오는 중…'
                  : room.seats.length < MIN_SEATS
                    ? '친구를 기다리는 중…'
                    : !othersReady
                      ? '모두 준비하면 방장이 시작해요.'
                      : room.me === 0
                        ? `${room.seats.length}명으로 시작할 수 있어요.`
                        : '방장이 시작하기를 기다리는 중…'}
              </h2>
              <ul className="seats">
                {Array.from({ length: room.auto ? room.seats.length : MAX_SEATS }, (_, i) => {
                  const s = room.seats[i];
                  return (
                    <li key={i} className={s ? '' : 'vacant'}>
                      <Pawn player={i} scale={2} />
                      {s ? s.name : '빈자리'}
                      {i === room.me && <small> (나)</small>}
                      <em>{!s ? '' : !s.online ? '접속 끊김' : i === 0 && !room.auto ? '방장' : s.ready ? '준비 완료' : '준비 전'}</em>
                    </li>
                  );
                })}
              </ul>
              {room.auto ? (
                <small>상대가 오지 않으면 나가서 다시 매칭해 주세요.</small>
              ) : room.me === 0 ? (
                <>
                  <button disabled={room.seats.length < MIN_SEATS || !othersReady} onClick={() => send({ t: 'start' })}>
                    게임 시작
                  </button>
                  <small>2~{MAX_SEATS}명이 할 수 있어요. 초대 링크를 보내 친구를 불러 주세요.</small>
                </>
              ) : (
                <button className={me?.ready ? 'ghost' : ''} onClick={() => send({ t: 'ready', ready: !me?.ready })}>
                  {me?.ready ? '준비 취소' : '준비 완료'}
                </button>
              )}
            </section>
          )}

          {inGame && (
            <>
              {/* 추락 연출이 끝날 때까지는 결과와 다음 행동을 가려 둔다(연출보다 먼저 결말이 보이지 않게). */}
              <section className="panel actions" aria-live="polite" inert={cue ? true : undefined}>
                {cue ? (
                  <h2>하마가 입맛을 다시는 중…</h2>
                ) : room.status === 'playing' ? (
                  <>
                    <Countdown deadline={deadline} />
                    <Actions room={room} game={game} send={send} controls={controls} settled={settled} />
                    {room.seats.some((s, i) => !s.online && !game.players[i]?.gone) && (
                      <p className="notice" role="status">
                        접속이 끊긴 사람이 있어요. 1분 안에 돌아오지 않으면 기권으로 처리돼요.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <h2>{winner === room.me ? '승리!' : `${game.players[winner ?? 0]?.name} 승리`}</h2>
                    <small>점수표에서 다시 하기를 누르면 한 판 더 해요.</small>
                  </>
                )}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
              </section>
              <section className="log" aria-label="기록">
                <h3>기록</h3>
                {/* 연출 중에는 방금 일어난 일(첫 줄)을 가려 결말이 먼저 보이지 않게 한다. */}
                {(cue ? log.slice(1) : log).map((line, i, shown) => (
                  <p key={shown.length - i}>{line.game}</p>
                ))}
                {log.length === 0 && <p className="empty">아직 아무 일도 없어요.</p>}
              </section>
            </>
          )}
          {chatOn && <Chat lines={chat} me={room.me} presetsOnly={room.auto} send={send} />}
        </aside>
      </main>

      {leaveDialog}
    </>
  );
}

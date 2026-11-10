import { useEffect, useRef, useState } from 'react';
import { BLANK } from '@bluff-bridge/engine';
import type { GameEvent, PlayerView } from '@bluff-bridge/engine';
import type { RoomView } from '@bluff-bridge/protocol/types';
import { useRoom } from './useRoom.ts';

type Challenged = Extract<GameEvent, { type: 'challenged' }>;
type RevealStage = 'suspense' | 'reveal' | 'fall' | 'done';

const face = (die: number | null) => (die === null ? '?' : die === BLANK ? '꽝' : String(die));

function Countdown({ deadline }: { deadline: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (deadline === null) return null;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <span className={'timer' + (left <= 5 ? ' urgent' : '')}>{left}초</span>;
}

function describe(e: GameEvent, g: PlayerView): string | null {
  const n = (i: number) => g.players[i]?.name ?? '?';
  switch (e.type) {
    case 'claimed':
      return `${n(e.player)}: "${e.value}칸!"`;
    case 'accepted':
      return `${n(e.player)}가 믿었어요. ${n(e.roller)} ${e.steps}칸 전진.`;
    case 'challenged':
      return e.truth
        ? `${n(e.challenger)}의 의심 실패! 실제 눈은 ${face(e.die)}. ${n(e.challenger)}의 말 추락.`
        : `${n(e.challenger)}의 의심 성공! 실제 눈은 ${face(e.die)}. ${n(e.roller)}의 말 추락.`;
    case 'finished':
      return `${n(e.player)} 완주!`;
    case 'out':
      return `${n(e.player)}의 말이 모두 떨어졌어요.`;
    case 'forfeit':
      return `${n(e.player)}가 나갔어요.`;
    default:
      return null;
  }
}

/** 의심 결과 연출: 긴장 → 주사위 공개 → 추락. */
function Reveal({ event, game, onDone }: { event: Challenged; game: PlayerView; onDone: () => void }) {
  const [stage, setStage] = useState<RevealStage>('suspense');
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timers = [
      setTimeout(() => setStage('reveal'), 900),
      setTimeout(() => setStage('fall'), 2100),
      setTimeout(() => setStage('done'), 3400),
    ];
    return () => timers.forEach(clearTimeout);
  }, [event]);
  useEffect(() => {
    if (stage === 'done') button.current?.focus();
  }, [stage]);

  const shown = stage !== 'suspense';
  const falling = stage === 'fall' || stage === 'done';
  const victim = game.players[event.fallen]?.name ?? '?';

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="reveal-title">
      <div className={'reveal ' + stage}>
        <h2 id="reveal-title">{!shown ? '진실일까?' : event.truth ? '진실!' : '뻥이야!'}</h2>
        <div className={'die big' + (shown ? '' : ' shaking')}>{shown ? face(event.die) : '?'}</div>
        <p>
          선언 <b>{event.claim}</b> → 실제 <b>{shown ? face(event.die) : '?'}</b>
        </p>
        <div className="drop">
          <span className={`pawn p${event.fallen}` + (falling ? ' falling' : '')} />
        </div>
        <p className="victim">{falling ? `${victim}의 말 추락` : ' '}</p>
        <button ref={button} disabled={stage !== 'done'} onClick={onDone}>
          계속
        </button>
      </div>
    </div>
  );
}

function Board({ game, me }: { game: PlayerView; me: number }) {
  const cells = Array.from({ length: game.rules.bridgeLength + 1 }, (_, i) => i);
  return (
    <section className="board">
      {game.players.map((p, i) => (
        <div key={i} className={'lane' + (game.phase !== 'over' && game.turn === i ? ' active' : '')}>
          <div className="laneHead">
            <b>
              <span className={`pawn small p${i}`} /> {p.name}
              {i === me && <small> (나)</small>}
            </b>
            <span>
              완주 {p.finished}/{game.rules.finishesToWin} · 대기 {p.reserve} · 추락 {p.lost}
            </span>
          </div>
          <div className="track">
            {cells.map((c) => (
              <div key={c} className={'cell' + (c === 0 ? ' start' : '')}>
                <span className="num">{c === 0 ? '출발' : c}</span>
                {p.pos === c && <span className={`pawn p${i}`} />}
              </div>
            ))}
            <div className="cell goal">도착</div>
          </div>
        </div>
      ))}
    </section>
  );
}

function Actions({ room, game, send }: { room: RoomView; game: PlayerView; send: ReturnType<typeof useRoom>['send'] }) {
  const me = room.me;
  const myTurn = game.turn === me;
  const name = (i: number) => game.players[i]?.name ?? '?';

  if (game.phase === 'roll') {
    return myTurn ? (
      <>
        <h2>내 차례예요.</h2>
        <button onClick={() => send({ t: 'act', action: { type: 'roll' } })}>주사위 굴리기</button>
      </>
    ) : (
      <h2>{name(game.turn)}가 주사위를 굴리는 중…</h2>
    );
  }

  if (game.phase === 'claim') {
    if (!myTurn) return <h2>{name(game.turn)}가 선언할 숫자를 고르는 중…</h2>;
    const claims = Array.from({ length: game.rules.maxClaim }, (_, i) => i + 1);
    return (
      <>
        <div className="die">{face(game.die)}</div>
        <h2>{game.die === BLANK ? '꽝! 뻥을 쳐야 해요.' : '몇 칸이라고 선언할까요?'}</h2>
        <small>이 주사위는 나만 볼 수 있어요.</small>
        <div className="row">
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
    if (game.responder !== me) {
      return (
        <>
          {myTurn && <div className="die">{face(game.die)}</div>}
          <h2>
            "{game.claim}칸!" — {name(game.responder)}의 선택을 기다리는 중…
          </h2>
        </>
      );
    }
    return (
      <>
        <h2>
          {name(game.turn)}: "{game.claim}칸!"
        </h2>
        <div className="row">
          <button className="ghost" onClick={() => send({ t: 'act', action: { type: 'accept' } })}>
            믿기
          </button>
          <button onClick={() => send({ t: 'act', action: { type: 'challenge' } })}>의심하기</button>
        </div>
      </>
    );
  }

  return null;
}

export function Room({ code, userId, onExit }: { code: string; userId: string; onExit: () => void }) {
  const { room, deadline, conn, error, fatal, send } = useRoom(code, userId);
  const [reveal, setReveal] = useState<Challenged | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const seenSeq = useRef(-1);

  // 새 상태(seq)가 올 때마다 한 번만 기록과 연출을 처리한다.
  useEffect(() => {
    if (!room || room.seq === seenSeq.current) return;
    const first = seenSeq.current === -1;
    seenSeq.current = room.seq;
    const game = room.game;
    if (!game || first) return;
    const lines = room.events.flatMap((e) => describe(e, game) ?? []);
    if (lines.length) setLog((l) => [...lines.reverse(), ...l].slice(0, 12));
    const challenged = room.events.find((e): e is Challenged => e.type === 'challenged');
    if (challenged) setReveal(challenged);
  }, [room]);

  useEffect(() => {
    if (room?.status === 'lobby') setLog([]);
  }, [room?.status]);

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

  if (fatal) {
    return (
      <main className="home">
        <h1>입장할 수 없어요</h1>
        <p className="error" role="alert">
          {fatal}
        </p>
        <button onClick={onExit}>처음으로</button>
      </main>
    );
  }
  if (!room) return <main className="home">연결 중…</main>;

  const game = room.game;
  const me = room.seats[room.me];
  const winner = game?.winner ?? null;

  // 팝업은 main 밖에 둔다. main이 inert가 되면 그 안의 버튼도 눌리지 않기 때문.
  return (
    <>
    <main className="room" inert={reveal || confirmLeave ? true : undefined}>
      <header>
        <span>
          방 <b>{code}</b>
          <span className={'conn ' + conn}>{conn === 'open' ? '연결됨' : '재연결 중…'}</span>
        </span>
        <span className="row">
          {!room.auto && (
            <button className="ghost" onClick={copyLink}>
              {copied ? '복사됨' : '초대 링크 복사'}
            </button>
          )}
          <button className="ghost" onClick={() => (room.status === 'playing' ? setConfirmLeave(true) : leave())}>
            나가기
          </button>
        </span>
      </header>

      {room.status === 'lobby' && (
        <section className="panel">
          <h2>
            {room.auto
              ? '상대가 들어오는 중…'
              : room.seats.length < 2
                ? '친구를 기다리는 중…'
                : '둘 다 준비하면 시작해요.'}
          </h2>
          <ul className="seats">
            {[0, 1].map((i) => {
              const s = room.seats[i];
              return (
                <li key={i}>
                  <span className={`pawn small p${i}`} />
                  {s ? s.name : '빈자리'}
                  {i === room.me && <small> (나)</small>}
                  <em>{!s ? '' : !s.online ? '접속 끊김' : s.ready ? '준비 완료' : '준비 전'}</em>
                </li>
              );
            })}
          </ul>
          {room.auto ? (
            <small>상대가 오지 않으면 나가서 다시 매칭해 주세요.</small>
          ) : (
            <button className={me?.ready ? 'ghost' : ''} onClick={() => send({ t: 'ready', ready: !me?.ready })}>
              {me?.ready ? '준비 취소' : '준비 완료'}
            </button>
          )}
        </section>
      )}

      {game && room.status !== 'lobby' && (
        <>
          <Board game={game} me={room.me} />
          <section className="panel" aria-live="polite">
            {room.status === 'playing' ? (
              <>
                <Countdown deadline={deadline} />
                <Actions room={room} game={game} send={send} />
                {room.seats.some((s) => !s.online) && <small>상대의 접속이 끊겼어요. 잠시 기다리는 중…</small>}
              </>
            ) : (
              <>
                <h2>{winner === room.me ? '승리!' : `${game.players[winner ?? 0]?.name} 승리`}</h2>
                <button disabled={me?.rematch} onClick={() => send({ t: 'rematch' })}>
                  {me?.rematch ? '상대를 기다리는 중…' : '다시 하기'}
                </button>
              </>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
          <section className="log">
            {log.map((line, i) => (
              <p key={log.length - i}>{line}</p>
            ))}
          </section>
        </>
      )}
    </main>

      {reveal && game && <Reveal event={reveal} game={game} onDone={() => setReveal(null)} />}
      {confirmLeave && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="leave-title">
          <div className="reveal">
            <h2 id="leave-title">나갈까요?</h2>
            <p>지금 나가면 이 판은 패배로 처리돼요.</p>
            <div className="row">
              <button className="ghost" autoFocus onClick={() => setConfirmLeave(false)}>
                계속 하기
              </button>
              <button onClick={leave}>나가기</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { BLANK } from '@bluff-bridge/engine';
import type { GameEvent, PlayerView } from '@bluff-bridge/engine';
import type { RoomView } from '@bluff-bridge/protocol/types';
import { Die, Pawn } from './pixel.tsx';
import { sound } from './sound.ts';
import { StageView } from './stage/StageView.tsx';
import type { ChompCue } from './stage/StageView.tsx';
import type { StageState } from './stage/Stage.ts';
import { useRoom } from './useRoom.ts';

type Challenged = Extract<GameEvent, { type: 'challenged' }>;

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

function describe(e: GameEvent, g: PlayerView): string | null {
  const n = (i: number) => g.players[i]?.name ?? '?';
  switch (e.type) {
    case 'claimed':
      return `${n(e.player)}: "${e.value}칸!"`;
    case 'accepted':
      return `${n(e.player)}가 믿었어요. ${n(e.roller)} ${e.steps}칸 전진.`;
    case 'challenged':
      return e.truth
        ? `${n(e.challenger)}의 의심 실패! 실제 눈은 ${face(e.die)}. ${n(e.challenger)}의 말이 하마 밥이 됐어요.`
        : `${n(e.challenger)}의 의심 성공! 실제 눈은 ${face(e.die)}. ${n(e.roller)}의 말이 하마 밥이 됐어요.`;
    case 'finished':
      return `${n(e.player)} 완주!`;
    case 'out':
      return `${n(e.player)}의 말이 모두 떨어졌어요.`;
    case 'forfeit':
      return `${n(e.player)} 님이 기권했어요.`;
    default:
      return null;
  }
}

function Plates({ game, me }: { game: PlayerView; me: number }) {
  return (
    <section className="plates">
      {game.players.map((p, i) => (
        <div key={i} className={'plate' + (game.phase !== 'over' && game.turn === i ? ' active' : '')}>
          <div className="plateName">
            <Pawn player={i} scale={2} />
            <b>{p.name}</b>
            {i === me && <small>나</small>}
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

function Actions({ room, game, send }: { room: RoomView; game: PlayerView; send: ReturnType<typeof useRoom>['send'] }) {
  const me = room.me;
  const myTurn = game.turn === me;
  const name = (i: number) => game.players[i]?.name ?? '?';

  if (game.phase === 'roll') {
    return myTurn ? (
      <>
        <h2>내 차례예요.</h2>
        <button
          onClick={() => {
            sound.play('roll');
            send({ t: 'act', action: { type: 'roll' } });
          }}
        >
          주사위 굴리기
        </button>
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
    if (game.responder !== me) {
      return (
        <>
          {myTurn && <Die value={game.die} />}
          <h2>
            "{game.claim}칸!" {name(game.responder)}의 선택을 기다리는 중…
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
          <button className="danger" onClick={() => send({ t: 'act', action: { type: 'challenge' } })}>
            의심하기
          </button>
        </div>
      </>
    );
  }

  return null;
}

export function Room({ code, userId, onExit }: { code: string; userId: string; onExit: () => void }) {
  const { room, deadline, conn, error, fatal, send } = useRoom(code, userId);
  /** 무대에서 재생 중인 추락 연출. 끝날 때까지 조작을 막는다. */
  const [cue, setCue] = useState<ChompCue | null>(null);
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
    const hit = room.events.find((e): e is Challenged => e.type === 'challenged');
    if (hit) {
      setCue({
        id: room.seq,
        fallen: hit.fallen,
        other: hit.fallen === hit.roller ? hit.challenger : hit.roller,
        claim: hit.claim,
        die: hit.die,
        truth: hit.truth,
        victimName: game.players[hit.fallen]?.name ?? '?',
      });
    }
  }, [room]);

  useEffect(() => {
    if (room?.status === 'lobby') setLog([]);
  }, [room?.status]);

  // 승패가 화면에 드러나는 순간(추락 연출이 있었다면 그 뒤)에 짧은 음악을 낸다.
  const resultShown = room?.status === 'over' && !cue;
  const iWon = room?.game?.winner === room?.me;
  useEffect(() => {
    if (resultShown) sound.play(iWon ? 'win' : 'lose');
  }, [resultShown, iWon]);

  // 무대에 넘길 상태. 내용이 같으면 같은 객체를 유지해 무대가 불필요하게 다시 그리지 않게 한다.
  const game = room?.game ?? null;
  const stageKey = JSON.stringify(
    game && room?.status !== 'lobby'
      ? [game.rules.bridgeLength, game.players.map((p) => [p.pos, p.reserve, p.finished]), room?.status === 'playing' ? game.turn : null]
      : [10, (room?.seats ?? []).map(() => [0, 0, 0]), null],
  );
  const stageState = useMemo<StageState>(() => {
    const [length, players, active] = JSON.parse(stageKey) as [number, [number | null, number, number][], number | null];
    return {
      length,
      pawns: players.map((p) => p[0]),
      crowd: players.map((p) => ({ reserve: p[1], finished: p[2] })),
      active,
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

  if (fatal) {
    return (
      <main className="home">
        <div className="panel">
          <h2>입장할 수 없어요</h2>
          <p className="error" role="alert">
            {fatal}
          </p>
          <button onClick={onExit}>처음으로</button>
        </div>
      </main>
    );
  }
  if (!room) {
    return (
      <main className="home">
        <div className="panel">연결 중…</div>
      </main>
    );
  }

  const me = room.seats[room.me];
  const winner = game?.winner ?? null;
  const inGame = game && room.status !== 'lobby';
  // 상대가 나가거나 접속이 끊겨 끝난 판이면 결과 화면에 따로 알린다.
  const forfeitEvent = room.status === 'over' ? room.events.find((e) => e.type === 'forfeit') : undefined;
  const forfeiter = forfeitEvent?.type === 'forfeit' ? forfeitEvent.player : null;

  // 팝업은 main 밖에 둔다. main이 inert가 되면 그 안의 버튼도 눌리지 않기 때문.
  return (
    <>
      <main className="room" inert={confirmLeave ? true : undefined}>
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
          </span>
        </header>

        {inGame && <Plates game={game} me={room.me} />}
        <StageView state={stageState} cue={cue} onCueDone={() => setCue(null)} />

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
                    <Pawn player={i} scale={2} />
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

        {inGame && (
          <>
            {/* 추락 연출이 끝날 때까지는 결과와 다음 행동을 가려 둔다(연출보다 먼저 결말이 보이지 않게). */}
            <section className="panel" aria-live="polite" inert={cue ? true : undefined}>
              {cue ? (
                <h2>하마가 입맛을 다시는 중…</h2>
              ) : room.status === 'playing' ? (
                <>
                  <Countdown deadline={deadline} />
                  <Actions room={room} game={game} send={send} />
                  {room.seats.some((s) => !s.online) && (
                    <p className="notice" role="status">
                      상대의 접속이 끊겼어요. 1분 안에 돌아오지 않으면 기권으로 처리돼요.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <h2 className="result">
                    {winner === room.me ? '승리!' : `${game.players[winner ?? 0]?.name} 승리`}
                  </h2>
                  {forfeiter !== null && (
                    <p className="notice" role="status">
                      {forfeiter === room.me
                        ? '내가 기권해서 패배로 기록됐어요.'
                        : `${game.players[forfeiter]?.name} 님이 기권했어요.`}
                    </p>
                  )}
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
            {log.length > 0 && !cue && (
              <section className="log">
                {log.map((line, i) => (
                  <p key={log.length - i}>{line}</p>
                ))}
              </section>
            )}
          </>
        )}
      </main>

      {confirmLeave && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="leave-title">
          <div className="panel">
            <h2 id="leave-title">나갈까요?</h2>
            <p>지금 나가면 이 판은 패배로 처리돼요.</p>
            <div className="row">
              <button className="ghost" autoFocus onClick={() => setConfirmLeave(false)}>
                계속 하기
              </button>
              <button className="danger" onClick={leave}>
                나가기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

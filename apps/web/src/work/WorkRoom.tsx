// 업무 모드의 게임 화면. 규칙과 서버는 그대로이고, 보이는 모습과 용어만 스프레드시트·결재 업무처럼 바꾼다.
//   말 = 안건, 다리 = 결재 라인(1~N단계), 완주 = 최종 승인, 먹힘 = 반려,
//   주사위 = =RANDBETWEEN(), 꽝 = #N/A, 선언 = 보고, 믿기 = 승인, 의심 = 감사 요청, 뻥 = 허위 보고.
import { useEffect, useState } from 'react';
import { BLANK, POINTS, emptyStats, scoreOf } from '@bluff-bridge/engine';
import type { GameEvent, PlayerView } from '@bluff-bridge/engine';
import type { ClientMessage, RoomView } from '@bluff-bridge/protocol/types';
import type { ChompCue } from '../stage/StageView.tsx';
import { WorkChrome, columnName } from './WorkChrome.tsx';

/** 결재 라인 위의 안건 한 건. 좁은 화면에서는 네모 하나로 줄여 보인다. */
const ITEM = (
  <>
    <span className="long">안건</span>
    <span className="short">■</span>
  </>
);

const value = (die: number | null) => (die === null ? '?' : die === BLANK ? '#N/A' : String(die));

/** 게임에서 일어난 일을 업무 용어로 적는다(변경 내역). */
export function describeWork(e: GameEvent, g: PlayerView): string | null {
  const n = (i: number) => g.players[i]?.name ?? '?';
  switch (e.type) {
    case 'claimed':
      return `${n(e.player)}: ${e.value}단계 진행 보고`;
    case 'accepted':
      return `${n(e.player)} 승인 → ${n(e.roller)} 안건 ${e.steps}단계 진행`;
    case 'challenged':
      return e.truth
        ? `${n(e.challenger)} 감사 요청 → 정상 보고(실제 값 ${value(e.die)}). ${n(e.challenger)} 안건 반려`
        : `${n(e.challenger)} 감사 요청 → 허위 보고 적발(실제 값 ${value(e.die)}). ${n(e.roller)} 안건 반려`;
    case 'finished':
      return `${n(e.player)} 안건 최종 승인`;
    case 'out':
      return `${n(e.player)} 잔여 안건 없음`;
    case 'forfeit':
      return `${n(e.player)} 자리 비움`;
    default:
      return null;
  }
}

function Countdown({ deadline }: { deadline: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (deadline === null) return null;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <span className={left <= 5 ? 'wbDue soon' : 'wbDue'}>마감까지 {left}초</span>;
}

export interface WorkRoomProps {
  code: string;
  room: RoomView;
  deadline: number | null;
  conn: string;
  error: string;
  log: string[];
  cue: ChompCue | null;
  /** 감사 결과를 알리는 동안 표에 보여 줄, 반려되기 직전의 상태. */
  before: PlayerView | null;
  copied: boolean;
  send: (msg: ClientMessage) => void;
  onCueDone: () => void;
  onCopy: () => void;
  onLeave: () => void;
}

export function WorkRoom({ code, room, deadline, conn, error, log, cue, before, copied, send, onCueDone, onCopy, onLeave }: WorkRoomProps) {
  const game = room.game;
  const me = room.me;
  const seat = room.seats[me];
  const inGame = game && room.status !== 'lobby';
  const playing = room.status === 'playing' && game;
  const myTurn = !!playing && game.turn === me;
  const canRoll = myTurn && game.phase === 'roll' && !cue;

  // 감사 결과는 게임 화면의 추락 연출 대신 붉은 알림 한 줄로 잠깐 보여 준다.
  useEffect(() => {
    if (!cue) return;
    const t = setTimeout(onCueDone, 2800);
    return () => clearTimeout(t);
  }, [cue, onCueDone]);

  // F9 = 다시 계산(주사위 굴리기)
  useEffect(() => {
    if (!canRoll) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F9') return;
      e.preventDefault();
      send({ t: 'act', action: { type: 'roll' } });
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [canRoll, send]);

  const name = (i: number) => game?.players[i]?.name ?? '?';
  const steps = game ? Array.from({ length: game.rules.bridgeLength }, (_, i) => i + 1) : [];

  // 수식 입력줄: 지금 무엇을 할 차례인지
  let formula = '=COUNTA(참여자!A:A)';
  if (cue) formula = `=IF(${cue.die === BLANK ? 'NA()' : cue.die}=${cue.claim},"정상 보고","허위 보고")`;
  else if (room.status === 'over' && game) formula = '=SUM(승인,허위보고통과,감사적중,반려,우승)';
  else if (playing) {
    if (game.phase === 'roll') formula = myTurn ? `=RANDBETWEEN(1,${game.rules.maxClaim})` : `=WAIT("${name(game.turn)}")`;
    else if (game.phase === 'claim') formula = myTurn ? `=${value(game.die)}` : `=WAIT("${name(game.turn)}")`;
    else formula = `=VLOOKUP("${name(game.turn)}",보고!A:B,2,FALSE)  →  ${game.claim}`;
  }

  const mine = game?.players[me];
  const status = mine && game ? `승인: ${mine.finished}/${game.rules.finishesToWin}    반려: ${mine.lost}    대기: ${mine.reserve}` : `참여자: ${room.seats.length}/2`;

  const tools = (
    <>
      {!room.auto && (
        <button className="wbBtn" onClick={onCopy}>
          {copied ? '복사됨' : '공유 링크 복사'}
        </button>
      )}
      <button className="wbBtn" onClick={onLeave}>
        닫기
      </button>
      <span className="wbSep" />
      {canRoll && (
        <button className="wbBtn primary" onClick={() => send({ t: 'act', action: { type: 'roll' } })}>
          다시 계산 (F9)
        </button>
      )}
      {playing && !cue && <Countdown deadline={deadline} />}
      {conn !== 'open' && <span className="wbDue soon">다시 연결하는 중…</span>}
    </>
  );

  return (
    <WorkChrome cell={code} formula={formula} tools={tools} status={status} sheet={inGame ? '결재라인' : '실적'}>
      {/* ── 대기실 ── */}
      {room.status === 'lobby' && (
        <table className="sheet">
          <thead>
            <tr>
              <th className="corner" />
              {['A', 'B', 'C'].map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>1</th>
              <td className="head">참여자</td>
              <td className="head">상태</td>
              <td className="head">비고</td>
            </tr>
            {[0, 1].map((i) => {
              const s = room.seats[i];
              return (
                <tr key={i}>
                  <th>{i + 2}</th>
                  <td className={`who p${i}`}>
                    {s ? s.name : '(미배정)'}
                    {i === me && ' (나)'}
                  </td>
                  <td>{!s ? '-' : !s.online ? '연결 끊김' : s.ready ? '검토 준비 완료' : '준비 전'}</td>
                  <td>{i === me && !room.auto && <button className="wbBtn primary" onClick={() => send({ t: 'ready', ready: !seat?.ready })}>{seat?.ready ? '준비 취소' : '준비 완료'}</button>}</td>
                </tr>
              );
            })}
            <tr>
              <th>4</th>
              <td colSpan={3} className="note">
                {room.auto ? '상대가 들어오는 중입니다.' : room.seats.length < 2 ? '공유 링크를 보내 참여자를 초대하세요.' : '두 사람 모두 준비되면 시작합니다.'}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {/* ── 결재 라인(게임판) ── */}
      {inGame && (
        <>
          <div className="sheetScroll">
            <table className="sheet line">
              <thead>
                <tr>
                  <th className="corner" />
                  {Array.from({ length: steps.length + 5 }, (_, i) => (
                    <th key={i}>{columnName(i)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>1</th>
                  <td className="head">담당자</td>
                  <td className="head">대기<span className="long"> 안건</span></td>
                  <td className="head">접수</td>
                  {steps.map((s) => (
                    <td key={s} className={'lane top' + (s === 1 ? ' first' : '') + (s === steps.length ? ' last' : '')}>
                      {s}<span className="long">단계</span>
                    </td>
                  ))}
                  <td className="head"><span className="long">최종 </span>승인</td>
                  <td className="head">반려</td>
                </tr>
                {(cue && before ? before : game).players.map((p, i) => {
                  const turn = playing && game.turn === i;
                  const flagged = cue?.fallen === i;
                  return (
                    <tr key={i} className={(turn ? 'turn ' : '') + (flagged ? 'flagged' : '')}>
                      <th>{i + 2}</th>
                      <td className={`who p${i}`}>
                        {p.name}
                        {i === me && ' (나)'}
                      </td>
                      <td className="num">{p.reserve}</td>
                      <td className={p.pos === 0 ? `item p${i}` : ''}>{p.pos === 0 && ITEM}</td>
                      {/* 굵은 테두리로 묶인 이 칸들이 다리(결재 라인)다 */}
                      {steps.map((s) => (
                        <td key={s} className={'lane' + (i === game.players.length - 1 ? ' bottom' : '') + (s === 1 ? ' first' : '') + (s === steps.length ? ' last' : '') + (p.pos === s ? ` item p${i}` : '')}>
                          {p.pos === s && ITEM}
                        </td>
                      ))}
                      <td className="num ok">
                        {p.finished}/{game.rules.finishesToWin}
                      </td>
                      <td className="num bad">{p.lost}</td>
                    </tr>
                  );
                })}
                <tr>
                  <th>{game.players.length + 2}</th>
                  <td colSpan={steps.length + 5} className="note">
                    ※ 감사팀 상시 대기 중. 허위 보고가 적발되면 해당 안건은 즉시 반려됩니다.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── 이번 건: 지금 할 일 ── */}
          <div className="wbTask" aria-live="polite">
            {cue ? (
              <p className={'audit ' + (cue.truth ? 'clean' : 'fraud')}>
                감사 결과: {cue.truth ? '정상 보고' : '허위 보고 적발'} (보고 {cue.claim} / 실제 {value(cue.die)}) → {cue.victimName} 안건 반려
              </p>
            ) : room.status === 'over' ? (
              <Summary game={game} me={me} waiting={!!seat?.rematch} onRematch={() => send({ t: 'rematch' })} onLeave={onLeave} />
            ) : game.phase === 'roll' ? (
              myTurn ? (
                <p>
                  내 차례입니다. <b>다시 계산 (F9)</b>을 눌러 이번 값을 확인하세요.
                </p>
              ) : (
                <p>{name(game.turn)} 계산 중…</p>
              )
            ) : game.phase === 'claim' ? (
              myTurn ? (
                <>
                  <p>
                    계산 결과: <b className={game.die === BLANK ? 'na' : ''}>{value(game.die)}</b>
                    {game.die === BLANK ? ' (값이 없습니다. 임의의 값을 보고해야 합니다.)' : ' (나만 볼 수 있습니다.)'}
                  </p>
                  <p className="choices">
                    보고할 값:
                    {Array.from({ length: game.rules.maxClaim }, (_, i) => i + 1).map((v) => (
                      <button key={v} className={'wbBtn' + (v === game.die ? ' primary' : '')} onClick={() => send({ t: 'act', action: { type: 'claim', value: v } })}>
                        {v}
                      </button>
                    ))}
                  </p>
                </>
              ) : (
                <p>{name(game.turn)} 보고서 작성 중…</p>
              )
            ) : game.responder === me ? (
              <p className="choices">
                {name(game.turn)}의 보고: <b>{game.claim}단계 진행</b>
                <button className="wbBtn primary" onClick={() => send({ t: 'act', action: { type: 'accept' } })}>
                  승인
                </button>
                <button className="wbBtn danger" onClick={() => send({ t: 'act', action: { type: 'challenge' } })}>
                  감사 요청
                </button>
              </p>
            ) : (
              <p>
                {game.claim}단계 진행으로 보고했습니다{myTurn ? ` (실제 값 ${value(game.die)})` : ''}. {name(game.responder)} 검토 중…
              </p>
            )}
            {room.seats.some((s) => !s.online) && room.status === 'playing' && <p className="na">상대의 연결이 끊겼습니다. 1분 안에 돌아오지 않으면 자리 비움으로 처리됩니다.</p>}
            {error && <p className="na">{error}</p>}
          </div>

          {/* ── 변경 내역(기록) ── */}
          <table className="sheet history">
            <tbody>
              <tr>
                <th>1</th>
                <td className="head">변경 내역</td>
              </tr>
              {(cue ? log.slice(1) : log).slice(0, 8).map((line, i) => (
                <tr key={log.length - i}>
                  <th>{i + 2}</th>
                  <td>{line}</td>
                </tr>
              ))}
              {log.length === 0 && (
                <tr>
                  <th>2</th>
                  <td className="note">아직 변경 내역이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </WorkChrome>
  );
}

/** 판이 끝난 뒤의 결산표. 게임 화면의 점수표와 같은 내용이다. */
function Summary({ game, me, waiting, onRematch, onLeave }: { game: PlayerView; me: number; waiting: boolean; onRematch: () => void; onLeave: () => void }) {
  const winner = game.winner ?? -1;
  const rows = game.players.map((p, i) => {
    const s = game.stats?.[i] ?? emptyStats();
    return { p, i, s, line: scoreOf(p, s, i === winner) };
  });
  return (
    <>
      <p>
        <b>분기 결산</b> — {winner === me ? '이번 분기 우수 담당자로 선정되었습니다.' : `우수 담당자: ${game.players[winner]?.name ?? '?'}`}
      </p>
      <div className="sheetScroll">
      <table className="sheet summary">
        <tbody>
          <tr>
            <td className="head">담당자</td>
            <td className="head">최종 승인 (×{POINTS.finish})</td>
            <td className="head">통과된 허위 보고 (×{POINTS.bluffPassed})</td>
            <td className="head">적중한 감사 (×{POINTS.challengeWon})</td>
            <td className="head">반려 (×{POINTS.eaten})</td>
            <td className="head">우수 담당자</td>
            <td className="head">=SUM()</td>
          </tr>
          {rows.map(({ p, i, s, line }) => (
            <tr key={i}>
              <td className={`who p${i}`}>
                {p.name}
                {i === me && ' (나)'}
              </td>
              <td className="num">{p.finished}</td>
              <td className="num">
                {s.bluffsPassed} / {s.bluffs}
              </td>
              <td className="num">
                {s.challengesWon} / {s.challenges}
              </td>
              <td className="num bad">{p.lost}</td>
              <td className="num">{i === winner ? `+${POINTS.win}` : '-'}</td>
              <td className="num sum">{line.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="choices">
        <button className="wbBtn primary" disabled={waiting} onClick={onRematch}>
          {waiting ? '상대를 기다리는 중…' : '다음 분기 시작'}
        </button>
        <button className="wbBtn" onClick={onLeave}>
          시트 닫기
        </button>
      </p>
    </>
  );
}

import { useEffect, useState } from 'react';
import { POINTS, emptyStats, scoreOf } from '@bluff-bridge/engine';
import type { PlayerView } from '@bluff-bridge/engine';
import { Pawn } from './pixel.tsx';
import { sound } from './sound.ts';

/** 점수가 0에서 목표까지 올라가는 숫자. 올라가는 동안 딸깍 소리가 난다. */
function CountUp({ to, delay }: { to: number; delay: number }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setValue(to);
    let raf = 0;
    let lastTick = 0;
    const start = performance.now() + delay;
    const frame = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / 1100));
      setValue(Math.round(to * (1 - (1 - k) ** 3)));
      if (k > 0 && k < 1 && now - lastTick > 55) {
        lastTick = now;
        sound.play('count');
      }
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [to, delay]);
  return <>{value}</>;
}

/**
 * 판이 끝난 뒤의 점수표. 게임 중에는 비밀이던 '뻥 횟수'가 여기서 처음 공개된다.
 * 점수 = 완주 + 안 들킨 뻥 + 맞힌 의심 − 먹힌 말 + 승리 보너스.
 */
export function Result({
  game,
  me,
  note,
  waiting,
  onRematch,
  onLeave,
}: {
  game: PlayerView;
  me: number;
  /** 기권 등으로 끝났을 때의 안내. */
  note?: string | null;
  /** 내가 이미 다시 하기를 눌렀는지. */
  waiting: boolean;
  onRematch: () => void;
  onLeave: () => void;
}) {
  const winner = game.winner ?? -1;
  const rows = game.players.map((p, i) => {
    const stats = game.stats?.[i] ?? emptyStats();
    return { p, i, stats, line: scoreOf(p, stats, i === winner) };
  });

  return (
    <div className="resultCard" role="dialog" aria-labelledby="result-title">
      <h2 id="result-title" className={winner === me ? 'won' : 'lost'}>
        {winner === me ? '승리!' : `${game.players[winner]?.name ?? '?'} 승리`}
      </h2>
      {note && (
        <p className="notice" role="status">
          {note}
        </p>
      )}

      <div className="scores">
        {rows.map(({ p, i, stats, line }) => (
          <section key={i} className={'scoreCard' + (i === winner ? ' winner' : '')}>
            <header>
              <Pawn player={i} scale={3} />
              <b>{p.name}</b>
              {i === me && <small>나</small>}
              {i === winner && <span className="crown">우승</span>}
            </header>
            <p className="total">
              <CountUp to={line.total} delay={300 + i * 250} />
              <small>점</small>
            </p>
            <dl>
              <div>
                <dt>완주 {p.finished}번</dt>
                <dd>+{line.finish}</dd>
              </div>
              <div>
                <dt>
                  안 들킨 뻥 {stats.bluffsPassed}번 <small>(뻥 {stats.bluffs}번 중)</small>
                </dt>
                <dd>+{line.bluff}</dd>
              </div>
              <div>
                <dt>
                  맞힌 의심 {stats.challengesWon}번 <small>(의심 {stats.challenges}번 중)</small>
                </dt>
                <dd>+{line.challenge}</dd>
              </div>
              <div>
                <dt>하마 밥이 된 말 {p.lost}마리</dt>
                <dd className={line.eaten < 0 ? 'minus' : ''}>{line.eaten}</dd>
              </div>
              {i === winner && (
                <div>
                  <dt>승리 보너스</dt>
                  <dd>+{POINTS.win}</dd>
                </div>
              )}
            </dl>
          </section>
        ))}
      </div>

      <div className="row">
        <button disabled={waiting} onClick={onRematch}>
          {waiting ? '상대를 기다리는 중…' : '다시 하기'}
        </button>
        <button className="ghost" onClick={onLeave}>
          나가기
        </button>
      </div>
    </div>
  );
}

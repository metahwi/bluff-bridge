// 디자인 작업용 화면. 주소에 ?stage=… 를 붙이면 게임 없이 무대만 볼 수 있다.
//   idle            평소 모습
//   chomp|push      다리 위에서 먹힘(널빤지가 꺼짐 | 옆 칸의 상대가 밀침)
//   kick|rope       출발 지점에서 먹힘(상대가 달려와 참 | 다리 위에서 올가미를 던짐)
//   dice|cup        주사위(내가 던짐 | 상대가 던져 컵으로 덮임)
//   result          결과 점수표
// &at=2.4 를 붙이면 연출 시작 2.4초 뒤의 장면에서 멈춘다(스크린샷용).
import { useEffect, useRef, useState } from 'react';
import { createGame, viewFor } from '@bluff-bridge/engine';
import { Result } from '../Result.tsx';
import { ThrowButton } from '../ThrowButton.tsx';
import { StageView } from './StageView.tsx';
import type { ChompCue, StageControls } from './StageView.tsx';
import type { StageState } from './Stage.ts';

const BASE: StageState = {
  length: 10,
  pawns: [4, 7],
  crowd: [
    { reserve: 5, finished: 1 },
    { reserve: 6, finished: 0 },
  ],
  active: 0,
  dice: { mode: 'ready', face: null },
};

/** 연출별로, 먹히기 직전에 두 말이 서 있던 칸. 먹히는 쪽은 항상 0번(주황). */
const SCENES: Record<string, [number, number]> = { chomp: [4, 8], push: [4, 5], kick: [0, 1], rope: [0, 6] };

/** 결과 화면에 넣을 가짜 판. */
function finishedGame() {
  const g = createGame(['에이', '비']);
  Object.assign(g.players[0]!, { finished: 3, lost: 2, reserve: 1 });
  Object.assign(g.players[1]!, { finished: 1, lost: 4, reserve: 1 });
  g.stats = [
    { bluffs: 7, bluffsPassed: 5, challenges: 4, challengesWon: 3 },
    { bluffs: 4, bluffsPassed: 1, challenges: 6, challengesWon: 2 },
  ];
  g.phase = 'over';
  g.winner = 0;
  return viewFor(g, 0);
}

export function StageDemo({ mode }: { mode: string }) {
  const [state, setState] = useState(BASE);
  const [cue, setCue] = useState<ChompCue | null>(null);
  const controls = useRef<StageControls | null>(null);

  function scene(name: string) {
    const [a, b] = SCENES[name] ?? SCENES.chomp!;
    setState({ ...BASE, pawns: [a, b] });
    setTimeout(() => {
      setCue({ id: Date.now(), fallen: 0, other: 1, claim: 5, die: 2, truth: false, victimName: '에이' });
      setState({ ...BASE, pawns: [0, b], crowd: [{ reserve: 4, finished: 1 }, BASE.crowd[1]!], active: 1 });
    }, 100);
  }
  const land = (face: number | null) => setState((s) => ({ ...s, dice: { mode: 'shown', face } }));

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (mode in SCENES) {
      const at = Number(query.get('at'));
      timers.push(
        setTimeout(() => {
          scene(mode);
          if (at > 0) setTimeout(() => (window as unknown as { __stage?: { debugSeek(s: number): void } }).__stage?.debugSeek(at), 500);
        }, 600),
      );
    }
    if (mode === 'dice' || mode === 'cup') {
      timers.push(
        setTimeout(() => {
          controls.current?.throwDice(0.9);
          setTimeout(() => land(mode === 'cup' ? null : Number(query.get('face') ?? 4)), 120);
        }, 700),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [mode]);

  return (
    <main className="room">
      <header>
        <span>무대 시험</span>
      </header>
      <div className="board">
        <StageView state={state} cue={cue} onCueDone={() => setCue(null)} controls={controls} />
        {mode === 'result' && <Result game={finishedGame()} me={0} waiting={false} onRematch={() => {}} onLeave={() => {}} />}
      </div>
      <aside className="side">
        <section className="panel actions">
          <ThrowButton
            disabled={state.dice?.mode !== 'ready'}
            onCharge={(p) => controls.current?.charge(p)}
            onThrow={(p) => {
              controls.current?.throwDice(p);
              setTimeout(() => land(Math.floor(Math.random() * 6)), 150);
            }}
          />
          <div className="row">
            <button className="ghost small" onClick={() => land(null)}>
              상대가 던짐
            </button>
            <button className="ghost small" onClick={() => setState(BASE)}>
              다시
            </button>
            {Object.keys(SCENES).map((name) => (
              <button key={name} className="ghost small" onClick={() => scene(name)}>
                {{ chomp: '널빤지', push: '밀치기', kick: '걷어차기', rope: '올가미' }[name]}
              </button>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}

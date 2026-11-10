// 디자인 작업용 화면. 주소에 ?stage=idle 또는 ?stage=chomp 를 붙이면 게임 없이 무대만 볼 수 있다.
// ?stage=dice 는 주사위(내가 던짐), ?stage=cup 은 상대가 던져 컵으로 덮인 모습.
import { useEffect, useRef, useState } from 'react';
import { ThrowButton } from '../ThrowButton.tsx';
import { StageView } from './StageView.tsx';
import type { ChompCue, StageControls } from './StageView.tsx';
import type { StageState } from './Stage.ts';

const BEFORE: StageState = {
  length: 10,
  pawns: [4, 7],
  crowd: [
    { reserve: 5, finished: 1 },
    { reserve: 6, finished: 0 },
  ],
  active: 0,
  dice: { mode: 'ready', face: null },
};
const AFTER: StageState = { ...BEFORE, pawns: [0, 7], crowd: [{ reserve: 4, finished: 1 }, BEFORE.crowd[1]!], active: 1 };

export function StageDemo({ mode }: { mode: string }) {
  const [state, setState] = useState(BEFORE);
  const [cue, setCue] = useState<ChompCue | null>(null);
  const controls = useRef<StageControls | null>(null);

  function chomp() {
    setCue({ id: Date.now(), fallen: 0, other: 1, claim: 5, die: 2, truth: false, victimName: '에이' });
    setState(AFTER);
  }
  const land = (face: number | null) => setState((s) => ({ ...s, dice: { mode: 'shown', face } }));
  const reset = () => setState(BEFORE);

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (mode === 'chomp') {
      // ?stage=chomp&at=2.4 → 연출 시작 2.4초 뒤의 장면에서 멈춘다(스크린샷용)
      const at = Number(query.get('at'));
      timers.push(
        setTimeout(() => {
          chomp();
          if (at > 0) setTimeout(() => (window as unknown as { __stage?: { debugSeek(s: number): void } }).__stage?.debugSeek(at), 60);
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
            <button className="ghost small" onClick={reset}>
              다시
            </button>
            <button className="ghost small" onClick={chomp}>
              추락 연출
            </button>
          </div>
        </section>
      </aside>
    </main>
  );
}

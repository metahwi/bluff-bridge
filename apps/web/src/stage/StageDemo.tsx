// 디자인 작업용 화면. 주소에 ?stage=idle 또는 ?stage=chomp 를 붙이면 게임 없이 무대만 볼 수 있다.
import { useEffect, useState } from 'react';
import { StageView } from './StageView.tsx';
import type { ChompCue } from './StageView.tsx';
import type { StageState } from './Stage.ts';

const BEFORE: StageState = {
  length: 10,
  pawns: [4, 7],
  crowd: [
    { reserve: 3, finished: 1 },
    { reserve: 4, finished: 0 },
  ],
  active: 0,
};
const AFTER: StageState = { ...BEFORE, pawns: [0, 7], crowd: [{ reserve: 2, finished: 1 }, BEFORE.crowd[1]!], active: 1 };

export function StageDemo({ mode }: { mode: string }) {
  const [state, setState] = useState(BEFORE);
  const [cue, setCue] = useState<ChompCue | null>(null);

  function chomp() {
    setCue({ id: Date.now(), fallen: 0, other: 1, claim: 5, die: 2, truth: false, victimName: '에이' });
    setState(AFTER);
  }

  useEffect(() => {
    if (mode !== 'chomp') return;
    // ?stage=chomp&at=2.4 → 연출 시작 2.4초 뒤의 장면에서 멈춘다(스크린샷용)
    const at = Number(new URLSearchParams(location.search).get('at'));
    const t = setTimeout(() => {
      chomp();
      if (at > 0) setTimeout(() => (window as unknown as { __stage?: { debugSeek(s: number): void } }).__stage?.debugSeek(at), 60);
    }, 600);
    return () => clearTimeout(t);
  }, [mode]);

  return (
    <main className="room">
      <StageView state={state} cue={cue} onCueDone={() => setCue(null)} />
      <div className="row">
        <button onClick={chomp}>추락 연출 보기</button>
        <button className="ghost" onClick={() => setState((s) => ({ ...s, pawns: [((s.pawns[0] ?? 0) % 10) + 2, s.pawns[1] ?? 7] }))}>
          말 전진
        </button>
        <button className="ghost" onClick={() => setState(BEFORE)}>
          처음 상태
        </button>
      </div>
    </main>
  );
}

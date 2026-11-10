import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Die } from '../pixel.tsx';
import { sound } from '../sound.ts';
import { Stage } from './Stage.ts';
import type { ChompPhase, StageLabel, StageState } from './Stage.ts';

/** 의심 결과를 무대에서 보여 달라는 요청. id가 바뀔 때마다 한 번 재생한다. */
export interface ChompCue {
  id: number;
  fallen: number;
  other: number | null;
  claim: number;
  /** 실제 주사위 눈. 0은 꽝. */
  die: number;
  truth: boolean;
  victimName: string;
}

/** 3D 게임판 + 그 위에 얹는 글자(번호, 표지판, 연출 자막). */
export function StageView({
  state,
  cue,
  onCueDone,
  children,
}: {
  state: StageState;
  cue?: ChompCue | null;
  onCueDone?: () => void;
  /** 무대 위에 얹을 것(첫 화면의 로고 등). 연출 중에는 숨긴다. */
  children?: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const [labels, setLabels] = useState<StageLabel[]>([]);
  const [phase, setPhase] = useState<ChompPhase>('done');
  const [failed, setFailed] = useState(false);
  const played = useRef(-1);
  const done = useRef(onCueDone);
  done.current = onCueDone;
  const truth = useRef(false);
  if (cue) truth.current = cue.truth;

  useEffect(() => {
    if (!canvas.current) return;
    let s: Stage;
    try {
      s = new Stage(canvas.current);
    } catch {
      setFailed(true); // WebGL을 못 쓰는 기기
      return;
    }
    stage.current = s;
    if (import.meta.env.DEV) (window as unknown as { __stage?: Stage }).__stage = s; // 디자인 작업용
    s.onLabels = setLabels;
    s.onSfx = (name) => sound.play(name);
    s.onPhase = (p) => {
      setPhase(p);
      // 연출 단계에 맞춘 소리. 연출 동안에는 배경 음악을 줄인다.
      if (p === 'suspense') {
        sound.duck(true);
        sound.play('suspense');
      } else if (p === 'reveal') sound.play(truth.current ? 'truth' : 'lie');
      else if (p === 'fall') sound.play('whoosh');
      else if (p === 'chomp') sound.play('crunch');
      else if (p === 'burp') setTimeout(() => sound.play('burp'), 300);
      else if (p === 'done') sound.duck(false);
    };
    const observer = new ResizeObserver(() => s.resize());
    observer.observe(canvas.current);
    return () => {
      observer.disconnect();
      s.dispose();
      stage.current = null;
    };
  }, []);

  // 연출을 먼저 시작해야 한다: 그래야 무대가 '떨어지기 전' 위치를 기준으로 그린다.
  useEffect(() => {
    if (!cue || cue.id === played.current) return;
    played.current = cue.id;
    const s = stage.current;
    if (!s) return void done.current?.();
    void s.playChomp({ fallen: cue.fallen, other: cue.other }).then(() => done.current?.());
  }, [cue]);

  useEffect(() => {
    stage.current?.setState(state);
  }, [state]);

  const playing = phase !== 'done';
  const shown = playing && phase !== 'suspense';
  const eaten = phase === 'chomp' || phase === 'chew' || phase === 'burp';

  return (
    <div className={`stage ${playing ? 'cinema is-' + phase : ''}`}>
      <canvas ref={canvas} aria-label="다리와 강. 물 위로 하마들이 머리를 내밀고 있다." role="img" />
      {failed && <p className="stageFallback">이 기기에서는 게임판을 그릴 수 없어요. 아래 기록으로 진행 상황을 확인해 주세요.</p>}

      {!playing &&
        labels.map((l) => (
          <span key={l.key} className={`stageLabel ${l.kind}`} style={{ left: l.x, top: l.y }}>
            {l.text}
          </span>
        ))}

      {!playing && children}

      {playing && cue && (
        <>
          <div className="letterbox top" />
          <div className="letterbox bottom" />
          <div className="verdict" role="status" aria-live="assertive">
            <span className="said">
              선언 <b>{cue.claim}</b>
            </span>
            <Die value={shown ? cue.die : null} shaking={!shown} />
            <strong className={shown ? (cue.truth ? 'truth' : 'lie') : ''}>
              {!shown ? '진실일까?' : cue.truth ? '진실!' : '뻥이야!'}
            </strong>
          </div>
          {phase === 'chomp' && <span className="sfx sfxCrunch">콰직!</span>}
          {phase === 'chew' && <span className="sfx sfxMunch">우적우적</span>}
          {phase === 'burp' && <span className="sfxBurp">꺼억</span>}
          {eaten && <p className="epitaph">{cue.victimName}의 말이 하마에게 먹혔어요.</p>}
        </>
      )}
    </div>
  );
}

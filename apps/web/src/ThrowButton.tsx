import { useEffect, useRef, useState } from 'react';
import { sound } from './sound.ts';

/** 게이지가 한 번 차오르는 데 걸리는 시간(초). 끝까지 차면 다시 내려온다. */
const SWEEP = 0.85;

/**
 * 주사위 던지기 단추. 꾹 누르면 게이지가 오르내리고, 놓는 순간의 힘으로 던진다.
 * 힘은 던지는 모습(높이, 구르는 횟수)만 바꾼다. 나오는 눈은 서버가 뽑는다.
 */
export function ThrowButton({
  disabled,
  onCharge,
  onThrow,
}: {
  disabled?: boolean;
  onCharge: (power: number | null) => void;
  onThrow: (power: number) => void;
}) {
  const fill = useRef<HTMLElement>(null);
  const holding = useRef(false);
  const power = useRef(0);
  const raf = useRef(0);
  const [held, setHeld] = useState(false);
  const [word, setWord] = useState('');

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  function begin() {
    if (disabled || holding.current) return;
    holding.current = true;
    setHeld(true);
    setWord('');
    const t0 = performance.now();
    let lastTick = 0;
    const loop = (now: number) => {
      if (!holding.current) return;
      const cycle = ((now - t0) / 1000 / SWEEP) % 2;
      power.current = cycle < 1 ? cycle : 2 - cycle; // 0 → 1 → 0 → …
      if (fill.current) fill.current.style.transform = `scaleX(${power.current})`;
      onCharge(power.current);
      if (now - lastTick > 70) {
        lastTick = now;
        sound.charge(power.current);
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  }

  function release() {
    if (!holding.current) return;
    holding.current = false;
    setHeld(false);
    cancelAnimationFrame(raf.current);
    const p = power.current;
    setWord(p > 0.85 ? '힘껏!' : p > 0.45 ? '적당히' : '살살');
    onCharge(null);
    onThrow(p);
  }

  return (
    <div className="throw">
      <div className={'gauge' + (held ? ' live' : '')} aria-hidden="true">
        <i ref={fill} />
      </div>
      <button
        className={held ? 'held' : ''}
        disabled={disabled}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          begin();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && begin()}
        onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && release()}
        onBlur={release}
        onContextMenu={(e) => e.preventDefault()}
      >
        {disabled ? `던졌어요 ${word}` : held ? '놓으면 던져요!' : '꾹 눌러 주사위 던지기'}
      </button>
      <small>누르고 있으면 힘이 차올라요. 힘은 던지는 모습만 바꾸고, 눈은 서버가 공정하게 뽑아요.</small>
    </div>
  );
}

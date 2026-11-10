import type { CSSProperties } from 'react';
import { HIPPO_PEEK_ROWS, Hippo, Pawn } from './pixel.tsx';

export interface ScenePawn {
  player: number;
  /** 0 = 출발 지점(왼쪽 언덕), 1~length = 널빤지, null = 다리 위에 없음. */
  pos: number | null;
}

/**
 * 강에 득실거리는 하마들: [왼쪽 위치 %, 강 위쪽에서의 거리(px), 크기, 까딱거림 시작 지연(초)]
 * 멀리 있는 하마는 작게, 가까운 하마는 크게 그린다.
 */
const HERD: [number, number, number, number][] = [
  [3, 6, 2, 0],
  [27, 2, 2, 1.1],
  [52, 10, 2, 0.5],
  [77, 4, 2, 1.6],
  [12, 44, 3, 0.8],
  [41, 54, 3, 0.2],
  [69, 46, 3, 1.3],
];

/** 물 위로 머리만 내민 하마. 물에 잠긴 부분은 잘라 내고 잔물결을 그린다. */
export function Swimmer({ scale, style, className = '' }: { scale: number; style?: CSSProperties; className?: string }) {
  return (
    <div className={`swimmer ${className}`} style={style}>
      <div className="peek" style={{ height: HIPPO_PEEK_ROWS * scale }}>
        <Hippo scale={scale} />
      </div>
      <i className="ripple" />
    </div>
  );
}

/** 다리 장면. 첫 화면의 그림과 게임판이 같은 장면을 쓴다. */
export function Scene({ length, pawns, active }: { length: number; pawns: ScenePawn[]; active?: number | null }) {
  const planks = Array.from({ length }, (_, i) => i + 1);
  const at = (pos: number) => pawns.filter((p) => p.pos === pos);

  return (
    <div className="scene">
      <div className="cloud c1" />
      <div className="cloud c2" />

      <div className="bank left">
        <div className="standing">
          {at(0).map((p) => (
            <Pawn key={p.player} player={p.player} className={active === p.player ? 'hop' : ''} />
          ))}
        </div>
        <span className="sign">출발</span>
      </div>

      <div className="bridge" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
        {planks.map((n) => (
          <div key={n} className="plank">
            <div className="standing">
              {at(n).map((p) => (
                <Pawn key={p.player} player={p.player} className={active === p.player ? 'hop' : ''} />
              ))}
            </div>
            <span>{n}</span>
          </div>
        ))}
      </div>

      <div className="bank right">
        <span className="sign">도착</span>
      </div>

      <div className="river">
        {HERD.map(([left, top, scale, delay], i) => (
          <Swimmer key={i} scale={scale} style={{ left: `${left}%`, top, zIndex: top, animationDelay: `${delay}s` }} />
        ))}
      </div>
    </div>
  );
}

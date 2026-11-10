import type { CSSProperties } from 'react';
import { HIPPO_PEEK_ROWS, Hippo, Pawn, Tree } from './pixel.tsx';

export interface ScenePawn {
  player: number;
  /** 0 = 출발 지점(왼쪽 언덕), 1~length = 널빤지, null = 다리 위에 없음. */
  pos: number | null;
}

export interface SceneCrowd {
  /** 왼쪽 언덕에서 차례를 기다리는 말 수. */
  reserve: number;
  /** 오른쪽 언덕에 도착한 말 수. */
  finished: number;
}

/**
 * 강에 득실거리는 하마들: [강 안에서의 왼쪽 위치 %, 위쪽에서의 거리(px), 크기, 까딱거림 시작 지연(초)]
 * 위에서 비스듬히 내려다보는 장면이라 화면 위쪽이 멀다. 먼 하마는 작게, 가까운 하마는 크게 그린다.
 * 다리(90~190px)에 가려지는 자리는 비워 둔다.
 */
const HERD: [number, number, number, number][] = [
  [8, 12, 2, 0],
  [38, 28, 2, 1.1],
  [68, 8, 2, 0.5],
  [84, 46, 2, 1.6],
  [22, 56, 2, 0.9],
  [55, 60, 2, 0.3],
  [5, 206, 3, 0.8],
  [36, 232, 3, 0.2],
  [66, 202, 3, 1.3],
  [86, 250, 2, 0.6],
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

/** 언덕 위에 줄지어 선 작은 말들. */
function Crowd({ counts, className }: { counts: number[]; className: string }) {
  return (
    <div className={`crowd ${className}`}>
      {counts.flatMap((n, player) =>
        Array.from({ length: n }, (_, i) => <Pawn key={`${player}-${i}`} player={player} scale={2} />),
      )}
    </div>
  );
}

/**
 * 다리 장면. 위에서 비스듬히 내려다본 모습이다.
 * 겹치는 순서(뒤 → 앞): 강 → 하마 → 다리 그림자 → 언덕 → 뒤 난간 → 널빤지 → 말 → 앞 난간.
 */
export function Scene({
  length,
  pawns,
  active,
  crowd = [],
}: {
  length: number;
  pawns: ScenePawn[];
  active?: number | null;
  crowd?: SceneCrowd[];
}) {
  const planks = Array.from({ length }, (_, i) => i + 1);
  const at = (pos: number) => pawns.filter((p) => p.pos === pos);
  const standing = (pos: number) => (
    <div className="standing">
      {at(pos).map((p) => (
        <Pawn key={p.player} player={p.player} className={active === p.player ? 'hop' : ''} />
      ))}
    </div>
  );

  return (
    <div className="scene">
      <div className="river">
        {HERD.map(([left, top, scale, delay], i) => (
          <Swimmer key={i} scale={scale} style={{ left: `${left}%`, top, zIndex: top, animationDelay: `${delay}s` }} />
        ))}
      </div>
      <div className="bridgeShadow" />

      <div className="bank left">
        <Tree className="tree t1" />
        <i className="flowers f1" />
        <span className="sign">출발</span>
        <div className="spot">{standing(0)}</div>
        <Crowd className="waiting" counts={crowd.map((c) => c.reserve)} />
      </div>
      <div className="bank right">
        <Tree className="tree t2" />
        <span className="sign">도착</span>
        <Crowd className="arrived" counts={crowd.map((c) => c.finished)} />
        <i className="flowers f2" />
        <Tree className="tree t3" scale={2} />
      </div>

      <div className="rail back" />
      <div className="bridge" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
        {planks.map((n) => (
          <div key={n} className="plank">
            <span>{n}</span>
            {standing(n)}
          </div>
        ))}
      </div>
      <div className="rail front" />
    </div>
  );
}

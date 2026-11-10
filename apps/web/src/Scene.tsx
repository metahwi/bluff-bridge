import { Hippo, Pawn } from './pixel.tsx';

export interface ScenePawn {
  player: number;
  /** 0 = 출발 지점(왼쪽 언덕), 1~length = 널빤지, null = 다리 위에 없음. */
  pos: number | null;
}

/** 강에 떠 있는 하마들: [왼쪽 위치 %, 물 위로 나온 정도, 까딱거림 시작 지연(초)] */
const HERD: [number, number, number][] = [
  [6, 0, 0],
  [24, 6, 1.1],
  [43, 2, 0.4],
  [62, 7, 1.7],
  [80, 1, 0.8],
];

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
        {HERD.map(([left, rise, delay], i) => (
          <div key={i} className="swimmer" style={{ left: `${left}%`, bottom: `${rise}px`, animationDelay: `${delay}s` }}>
            <Hippo scale={2} />
          </div>
        ))}
        <div className="waves" />
      </div>
    </div>
  );
}

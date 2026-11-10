// 픽셀 그림. 글자 한 칸이 픽셀 하나이고, 글자마다 색이 정해져 있다. '.'은 투명.
// 그림을 고치려면 아래 격자의 글자만 바꾸면 된다.
import type { ReactNode } from 'react';

type Palette = Record<string, string>;

export function Sprite({
  rows,
  palette,
  scale = 3,
  className,
}: {
  rows: readonly string[];
  palette: Palette;
  scale?: number;
  className?: string;
}) {
  const width = Math.max(...rows.map((r) => r.length));
  const rects: ReactNode[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      let run = 1;
      while (row[x + run] === ch) run++;
      const fill = palette[ch];
      if (fill) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={run} height={1} fill={fill} />);
      x += run;
    }
  });
  return (
    <svg
      className={className}
      width={width * scale}
      height={rows.length * scale}
      viewBox={`0 0 ${width} ${rows.length}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {rects}
    </svg>
  );
}

const INK = '#3a2414';

/** 다리를 건너는 꼬마. 몸 색(b)은 CSS의 color를 따른다. */
const PAWN = [
  '.oo..oo.',
  'oboooobo',
  'obbbbbbo',
  'obwkbwko',
  'obbbbbbo',
  'obllllbo',
  '.obbbbo.',
  '.oo..oo.',
] as const;

export function Pawn({ player, scale = 3, className = '' }: { player: number; scale?: number; className?: string }) {
  return (
    <Sprite
      rows={PAWN}
      scale={scale}
      className={`pawn p${player} ${className}`}
      palette={{ o: INK, b: 'currentColor', w: '#ffffff', k: '#1b1210', l: 'rgb(255 255 255 / 0.35)' }}
    />
  );
}

/** o 외곽선, h 몸, m 주둥이(밝은 색), p 귓속, k 눈, w 눈빛·이빨, n 콧구멍 */
const HIPPO = { o: '#3a2a33', h: '#8f6f7a', m: '#bfa0a6', p: '#f29bb0', k: '#1b1210', w: '#ffffff', n: '#5e4650' };

/** 물 위로 내미는 줄 수. 귀, 눈, 콧구멍까지 보이고 그 아래는 물에 잠긴다. */
export const HIPPO_PEEK_ROWS = 11;

/** 하마 머리(위턱): 분홍 귀, 까만 눈, 밝은 주둥이와 콧구멍. 정면에서 본 모습. */
const HIPPO_TOP = [
  '..ooo............ooo..',
  '.ohpho.oooooooo.ohpho.',
  '.ohpphhhhhhhhhhhhppho.',
  '..ohhhhhhhhhhhhhhhho..',
  '.ohhhhhhhhhhhhhhhhhho.',
  '.ohhhkkhhhhhhhhkkhhho.',
  '.ohhhkwhhhhhhhhkwhhho.',
  'ohhhhhhhhhhhhhhhhhhhho',
  'ohmmmmmmmmmmmmmmmmmmho',
  'ommmmnnmmmmmmmmnnmmmmo',
  'ommmmmmmmmmmmmmmmmmmmo',
  'ommmmmmmmmmmmmmmmmmmmo',
  '.oooooooooooooooooooo.',
] as const;

/** 하마 아래턱: 양쪽에 송곳니. */
const HIPPO_JAW = [
  'ow.ww............ww.wo',
  'ommmmmmmmmmmmmmmmmmmmo',
  'ommmmmmmmmmmmmmmmmmmmo',
  '.ommmmmmmmmmmmmmmmmmo.',
  '..oooooooooooooooooo..',
] as const;

/**
 * 하마. open이면 위턱이 올라가 분홍 입속이 보인다.
 * 입이 닫힐 때의 속도는 CSS(.hippo .mouth)에서 정한다.
 */
export function Hippo({ scale = 2, open = false, className = '' }: { scale?: number; open?: boolean; className?: string }) {
  return (
    <div className={`hippo ${open ? 'open' : ''} ${className}`} style={{ ['--s' as string]: `${scale}px` }} aria-hidden="true">
      <Sprite rows={HIPPO_TOP} palette={HIPPO} scale={scale} />
      <div className="mouth" />
      <Sprite rows={HIPPO_JAW} palette={HIPPO} scale={scale} />
    </div>
  );
}

const BONE = ['ww...ww', '.wwwww.', 'ww...ww'] as const;

export function Bone({ scale = 3, className = '' }: { scale?: number; className?: string }) {
  return <Sprite rows={BONE} scale={scale} className={className} palette={{ w: '#fff8e7' }} />;
}

/** 주사위 눈 위치 (3×3 격자의 칸 번호). */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
};

/** value: 1~5는 눈, 0은 꽝, null은 가려진 주사위. */
export function Die({ value, big = false, shaking = false }: { value: number | null; big?: boolean; shaking?: boolean }) {
  const label = value === null ? '가려진 주사위' : value === 0 ? '꽝' : `주사위 ${value}`;
  return (
    <div className={`die${big ? ' big' : ''}${shaking ? ' shaking' : ''}${value === 0 ? ' blank' : ''}`} role="img" aria-label={label}>
      {value === null ? (
        <span className="dieText">?</span>
      ) : value === 0 ? (
        <span className="dieText">꽝</span>
      ) : (
        Array.from({ length: 9 }, (_, i) => <i key={i} className={PIPS[value]?.includes(i) ? 'on' : ''} />)
      )}
    </div>
  );
}

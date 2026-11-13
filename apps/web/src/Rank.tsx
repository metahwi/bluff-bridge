// 순위전 표시: 티어 이름표, 내 순위 한 줄, 판이 끝난 뒤의 점수 변화, 순위표.
// 점수 규칙은 packages/engine/src/rating.ts에 있다.
import { useEffect, useState } from 'react';
import { PLACEMENT_GAMES, toNextTier } from '@bluff-bridge/engine';
import type { RankChange } from '@bluff-bridge/protocol/types';
import type { Me } from './auth.ts';

/** 티어 이름(낮은 것부터). 업무 모드에서는 직급으로 보인다. */
const TIER_NAMES = ['아기 하마', '꼬마 하마', '날쌘 하마', '대장 하마', '하마왕'];
const TIER_NAMES_WORK = ['사원', '대리', '과장', '부장', '임원'];

export const tierName = (tier: number, work: boolean) => (work ? TIER_NAMES_WORK : TIER_NAMES)[tier] ?? '?';

/** 티어 이름표. 배치 중(tier가 null)이면 몇 판 했는지를 보여 준다. */
export function TierBadge({ tier, games, work = false }: { tier: number | null; games?: number; work?: boolean }) {
  if (tier === null) {
    return <span className="tier placing">{work ? `수습 ${games ?? 0}/${PLACEMENT_GAMES}` : `배치 ${games ?? 0}/${PLACEMENT_GAMES}`}</span>;
  }
  return <span className={`tier t${tier}`}>{tierName(tier, work)}</span>;
}

/** 첫 화면의 내 순위 한 줄. */
export function MyRank({ rank, work = false }: { rank: NonNullable<Me['rank']>; work?: boolean }) {
  const next = rank.tier === null ? null : toNextTier(rank.rating);
  return (
    <p className="myRank">
      <TierBadge tier={rank.tier} games={rank.games} work={work} />
      <b>{rank.rating}점</b>
      <span>
        {rank.wins}승 {rank.losses}패{rank.place !== null && ` · ${rank.place}등`}
        {next !== null && ` · 다음 ${work ? '직급' : '티어'}까지 ${next}점`}
      </span>
    </p>
  );
}

/** 0에서 목표까지 올라가는(또는 내려가는) 숫자. */
function Slide({ from, to }: { from: number; to: number }) {
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) return setValue(to);
    let raf = 0;
    const start = performance.now() + 500;
    const frame = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / 900));
      setValue(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [from, to]);
  return <>{value}</>;
}

/** 순위전이 끝난 뒤 내 점수가 어떻게 바뀌었는지. */
export function RankResult({ change, work = false }: { change: RankChange; work?: boolean }) {
  const sign = change.delta > 0 ? '+' : '';
  const moved = change.tier !== null && change.tierBefore !== null && change.tier !== change.tierBefore;
  const placedNow = change.tier !== null && change.tierBefore === null;
  return (
    <div className={'rankResult' + (change.delta > 0 ? ' up' : change.delta < 0 ? ' down' : '')}>
      <p className="rankLine">
        <span>{work ? '평가 점수' : '순위전 점수'}</span>
        <b>
          <Slide from={change.before} to={change.after} />점
        </b>
        <em>{change.counted ? `${sign}${change.delta}` : '변동 없음'}</em>
        <TierBadge tier={change.tier} games={change.games} work={work} />
      </p>
      {!change.counted && <small>같은 상대와는 하루 세 판까지만 점수에 반영돼요.</small>}
      {placedNow && (
        <small>
          {work ? `수습이 끝났습니다. 직급: ${tierName(change.tier!, true)}` : `배치가 끝났어요! 첫 티어는 ${tierName(change.tier!, false)}`}
        </small>
      )}
      {moved && (
        <small className={change.tier! > change.tierBefore! ? 'promoted' : 'demoted'}>
          {change.tier! > change.tierBefore!
            ? work
              ? `${tierName(change.tier!, true)}(으)로 승진했습니다.`
              : `${tierName(change.tier!, false)}(으)로 올라갔어요!`
            : work
              ? `${tierName(change.tier!, true)}(으)로 내려갔습니다.`
              : `${tierName(change.tier!, false)}(으)로 내려갔어요.`}
        </small>
      )}
    </div>
  );
}

interface Entry {
  name: string;
  rating: number;
  tier: number;
  wins: number;
  losses: number;
}

/** 순위표를 불러온다. 실패하면 빈 목록. */
export function useRanking(): Entry[] | null {
  const [top, setTop] = useState<Entry[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/ranking')
      .then((r) => r.json() as Promise<{ top: Entry[] }>)
      .then((body) => live && setTop(body.top))
      .catch(() => live && setTop([]));
    return () => {
      live = false;
    };
  }, []);
  return top;
}

/** 첫 화면의 순위표(상위 20명). 배치를 마친 사람만 오른다. */
export function Leaderboard({ myPlace }: { myPlace: number | null }) {
  const top = useRanking();
  if (!top) return null;
  return (
    <section className="panel ranking">
      <h2>순위표</h2>
      {top.length === 0 ? (
        <small>아직 순위에 오른 사람이 없어요. 순위전 {PLACEMENT_GAMES}판을 하면 첫 번째로 이름을 올릴 수 있어요.</small>
      ) : (
        <ol>
          {top.map((e, i) => (
            <li key={i} className={myPlace === i + 1 ? 'me' : ''}>
              <i>{i + 1}</i>
              <b>{e.name}</b>
              <TierBadge tier={e.tier} />
              <span>{e.rating}점</span>
              <small>
                {e.wins}승 {e.losses}패
              </small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

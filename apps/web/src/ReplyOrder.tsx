import { responders } from '@bluff-bridge/engine';
import type { PlayerView } from '@bluff-bridge/engine';

/**
 * 셋 이상이 할 때, 선언에 대한 응답이 어떤 순서로 반영되는지 보여 주는 줄.
 *   선언한 사람 → ① → ② → ③
 * 모두 동시에 고르지만 판정은 번호 순서대로 한다: 앞 번호부터 보다가 처음 만난 의심에서 주사위를 공개한다.
 * 남의 선택은 '골랐음'으로만 보이고, 지금 판정이 기다리고 있는 사람(아직 안 고른 가장 앞 번호)을 강조한다.
 */
export function ReplyOrder({ game, me, work = false }: { game: PlayerView; me: number; work?: boolean }) {
  const order = responders(game);
  const waiting = order.find((i) => !game.replies?.[i]);
  const name = (i: number) => game.players[i]?.name ?? '?';

  function status(i: number): string {
    const reply = game.replies?.[i];
    if (!reply) return work ? '검토 중' : '고르는 중';
    if (i !== me) return work ? '완료' : '골랐음';
    return reply === 'challenge' ? (work ? '감사 요청' : '의심') : work ? '승인' : '믿기';
  }

  return (
    <div className={'replyOrder' + (work ? ' work' : '')}>
      <ol aria-label={work ? '검토 순서' : '의심 순서'}>
        <li className="claimer">
          <b>{name(game.turn)}</b>
          <span>{work ? `${game.claim}단계 보고` : `"${game.claim}칸!"`}</span>
        </li>
        {order.map((i, k) => (
          <li key={i} className={(game.replies?.[i] ? 'done' : i === waiting ? 'next' : '') + (i === me ? ' me' : '')}>
            <i>{k + 1}</i>
            <b>
              {name(i)}
              {i === me && (work ? ' (나)' : ' (나)')}
            </b>
            <span>{status(i)}</span>
          </li>
        ))}
      </ol>
      <small>
        {work
          ? '동시에 검토하고 번호 순서로 판정합니다. 처음 나온 감사 요청에서 실제 값을 공개하며, 그 뒤 번호의 선택은 반영하지 않습니다.'
          : '동시에 고르고, 번호 순서로 판정해요. 처음 나온 의심에서 주사위 공개! 그 뒤 번호의 선택은 없던 일이 돼요.'}
      </small>
    </div>
  );
}

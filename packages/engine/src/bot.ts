import { BLANK } from './rules.ts';
import type { Rng } from './reduce.ts';
import type { PlayerView } from './view.ts';
import type { Action } from './state.ts';

export interface BotConfig {
  /** 진짜 눈이 나왔을 때도 더 큰 숫자로 거짓말할 확률. */
  bluffRate: number;
  /** 선언 1에 대한 의심 확률. */
  challengeBase: number;
  /** 선언이 1 커질 때마다 늘어나는 의심 확률. */
  challengeSlope: number;
}

export const DEFAULT_BOT: BotConfig = { bluffRate: 0.25, challengeBase: 0.05, challengeSlope: 0.08 };

/** 밸런스 시뮬레이션용 단순 봇. 자신의 뷰만 보고 결정한다. */
export function botAction(view: PlayerView, rng: Rng, cfg: BotConfig = DEFAULT_BOT): Action {
  const max = view.rules.maxClaim;
  switch (view.phase) {
    case 'roll':
      return { type: 'roll' };
    case 'claim': {
      const die = view.die!;
      if (die === BLANK) return { type: 'claim', value: 1 + Math.floor(rng() * max) };
      if (die < max && rng() < cfg.bluffRate) {
        return { type: 'claim', value: die + 1 + Math.floor(rng() * (max - die)) };
      }
      return { type: 'claim', value: die };
    }
    case 'respond': {
      const p = cfg.challengeBase + cfg.challengeSlope * (view.claim! - 1);
      return { type: rng() < p ? 'challenge' : 'accept' };
    }
    default:
      throw new Error('game over');
  }
}

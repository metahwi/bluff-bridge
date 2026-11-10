/** 주사위의 "꽝" 면. 이 눈이 나오면 반드시 거짓말해야 한다. */
export const BLANK = 0;

export interface Rules {
  /** 다리 널빤지 수. 위치가 이 값을 넘으면 완주. */
  bridgeLength: number;
  /** 주사위 면. BLANK(0)는 꽝. */
  dieFaces: readonly number[];
  /** 선언할 수 있는 최대 숫자 (1..maxClaim). */
  maxClaim: number;
  /** 플레이어당 말 개수. */
  runners: number;
  /** 승리에 필요한 완주 수. */
  finishesToWin: number;
  minPlayers: number;
  maxPlayers: number;
}

/**
 * 봇 시뮬레이션(scripts/sim.ts) 결과를 보고 정한 값.
 * 완주 3번이 목표일 때 말이 5개면 네 판 중 세 판이 아무도 3번을 못 채우고 끝난다(말이 먼저 떨어짐).
 * 말 7개면 그 비율이 셋 중 하나로 내려가고 한 판이 평균 26턴쯤 된다.
 */
export const RULES: Rules = {
  bridgeLength: 10,
  dieFaces: [1, 2, 3, 4, 5, BLANK],
  maxClaim: 5,
  runners: 7,
  finishesToWin: 3,
  minPlayers: 2,
  maxPlayers: 4,
};

// 운영 중에 관리자 페이지에서 바꾸는 게임 설정 (D1). 배포 없이 바뀐다.
// 서버 여러 곳(일반 요청, 방, 대기열)이 따로 떠 있어서, 각자 CACHE_MS 동안 기억했다가 다시 읽는다.
// 그래서 바꾼 설정이 모든 곳에 퍼지는 데 최대 CACHE_MS가 걸린다.
import type { BotConfig } from '@bluff-bridge/engine';
import { DEFAULT_BOT } from '@bluff-bridge/engine';

export type BotLevel = 'easy' | 'normal' | 'hard';

export interface Settings {
  /** 빠른 매칭에서 상대가 없으면 봇을 붙여 준다. 순위전에는 봇이 들어가지 않는다. 플레이어에게는 봇이라고 알리지 않는다. */
  botsEnabled: boolean;
  /** 봇을 붙이기 전에 사람을 기다리는 시간(초). */
  botWaitSec: number;
  botLevel: BotLevel;
  /** 한 행동의 제한 시간(초). 새로 만들어지는 방부터 적용된다. */
  turnSeconds: number;
  /** 친구 방에서 직접 쓴 채팅을 허용할지. 끄면 어디서나 정해진 말만 보낼 수 있다. */
  freeChat: boolean;
  /** 첫 화면 위에 띄우는 공지. 비우면 띄우지 않는다. */
  notice: string;
  /**
   * Cloudflare Web Analytics의 사이트 토큰(32자리). 넣으면 화면에 방문 집계 스크립트를 붙인다. 비우면 붙이지 않는다.
   * 페이지 소스에 그대로 보이는 공개 값이라 비밀이 아니다.
   */
  analyticsToken: string;
}

export const DEFAULT_SETTINGS: Settings = { botsEnabled: false, botWaitSec: 12, botLevel: 'normal', turnSeconds: 30, freeChat: true, notice: '', analyticsToken: '' };

export const SETTINGS_TABLES = [
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
];

const CACHE_MS = 15_000;
let cache: { at: number; value: Settings } | null = null;

const clamp = (n: unknown, min: number, max: number, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback);

/** 들어온 값을 믿지 않고 형식과 범위를 맞춘다. 빠진 항목은 base의 값을 쓴다. */
export function normalize(input: Partial<Record<keyof Settings, unknown>>, base: Settings = DEFAULT_SETTINGS): Settings {
  return {
    botsEnabled: typeof input.botsEnabled === 'boolean' ? input.botsEnabled : base.botsEnabled,
    botWaitSec: clamp(input.botWaitSec, 3, 120, base.botWaitSec),
    botLevel: input.botLevel === 'easy' || input.botLevel === 'normal' || input.botLevel === 'hard' ? input.botLevel : base.botLevel,
    turnSeconds: clamp(input.turnSeconds, 10, 120, base.turnSeconds),
    freeChat: typeof input.freeChat === 'boolean' ? input.freeChat : base.freeChat,
    notice: typeof input.notice === 'string' ? input.notice.trim().slice(0, 200) : base.notice,
    // 토큰 모양이 아니면 받지 않는다(이 값이 스크립트 태그에 들어가므로 엉뚱한 글이 섞이지 않게).
    analyticsToken: typeof input.analyticsToken === 'string' && /^([a-f0-9]{32})?$/i.test(input.analyticsToken.trim()) ? input.analyticsToken.trim().toLowerCase() : base.analyticsToken,
  };
}

export async function getSettings(db: D1Database, fresh = false): Promise<Settings> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value = DEFAULT_SETTINGS;
  try {
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'game'").first<{ value: string }>();
    if (row) value = normalize(JSON.parse(row.value) as Partial<Settings>);
  } catch {
    // 표가 아직 없거나 값이 깨졌으면 기본값으로 돌린다(게임은 멈추지 않는다).
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function saveSettings(db: D1Database, input: Partial<Record<keyof Settings, unknown>>): Promise<Settings> {
  const value = normalize(input, await getSettings(db, true));
  await db
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('game', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(JSON.stringify(value), Date.now())
    .run();
  cache = { at: Date.now(), value };
  return value;
}

/** 봇의 난이도별 성향. 쉬운 봇은 큰 숫자를 자주 뻥치고 잘 속으며, 어려운 봇은 뻥을 아끼고 큰 선언을 잘 의심한다. */
export const BOT_LEVELS: Record<BotLevel, BotConfig> = {
  easy: { bluffRate: 0.45, challengeBase: 0.02, challengeSlope: 0.03 },
  normal: DEFAULT_BOT,
  hard: { bluffRate: 0.15, challengeBase: 0.08, challengeSlope: 0.13 },
};

/**
 * 봇이 쓰는 닉네임. 다른 사람들이 쓰는 닉네임처럼 보이게 한다(봇인지는 관리자 페이지에서만 알 수 있다).
 */
export const BOT_NAMES = [
  '콩이', '민트초코', '감자튀김', '라면왕', '초코송이', '하늘이', '도토리', '주말엔게임', '뻥튀기', '달고나',
  '곰돌이', '수박바', '떡볶이킹', '졸린고양이', '바나나우유', '김밥천국', '눈사람', '호두과자', '참새', '보리차',
  '월요병', '칼퇴요정', '점심뭐먹지', '야근싫어', '커피한잔', '산책가자', '귤까는중', '솜사탕', '찹쌀떡', '나무늘보',
];

import type { Env } from './index.ts';

// 헷갈리는 글자(I, L, O, 0, 1)를 뺀 방 코드용 글자.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function roomStub(env: Env, code: string) {
  return env.ROOM.get(env.ROOM.idFromName(code));
}

export interface RoomOptions {
  /** 두 명이 모이면 준비 버튼 없이 바로 시작한다 (빠른 매칭). */
  auto?: boolean;
  /** 이 계정들만 들어올 수 있다 (빠른 매칭). */
  reserved?: string[];
}

/** 새 방을 만들고 코드를 돌려준다. 코드가 겹치면 다시 뽑는다. 실패하면 null. */
export async function createRoom(env: Env, options: RoomOptions = {}): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const res = await roomStub(env, code).fetch('https://room/create', {
      method: 'POST',
      body: JSON.stringify({ code, ...options }),
    });
    if (res.ok) return code;
  }
  return null;
}

import { useCallback, useEffect, useState } from 'react';
import { createAuthClient } from 'better-auth/react';
import { anonymousClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({ plugins: [anonymousClient()] });

export interface Me {
  user: { id: string; name: string; isAnonymous: boolean } | null;
  /** 서버에 키가 등록된 소셜 로그인 ('google', 'kakao'). */
  providers: string[];
  records: {
    played: number;
    won: number;
    recent: { endedAt: number; won: boolean; opponents: string; rounds: number; reason: string }[];
  } | null;
}

async function fetchMe(): Promise<Me> {
  const res = await fetch('/api/me');
  if (!res.ok) throw new Error('서버에 연결하지 못했어요.');
  return (await res.json()) as Me;
}

/** 내 계정과 전적. 로그인·닉네임 변경·게임 종료 뒤에는 reload로 다시 불러온다. */
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      const next = await fetchMe();
      setMe(next);
      setError('');
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : '서버에 연결하지 못했어요.');
      return null;
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  return { me, error, reload };
}

/** 계정이 없으면 게스트로 만들고, 닉네임이 다르면 바꾼다. */
export async function ensureGuest(me: Me | null, name: string): Promise<void> {
  if (!me?.user) {
    const { error } = await authClient.signIn.anonymous();
    if (error) throw new Error(error.message ?? '입장하지 못했어요.');
  }
  if (me?.user?.name !== name) {
    const { error } = await authClient.updateUser({ name });
    if (error) throw new Error(error.message ?? '닉네임을 저장하지 못했어요.');
  }
}

export function socialLogin(provider: string): void {
  // 로그인 후 지금 보던 주소(초대 링크 포함)로 돌아온다.
  void authClient.signIn.social({ provider, callbackURL: location.pathname });
}

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

async function signInAs(me: Me | null, name: string): Promise<void> {
  if (!me?.user) {
    const { error } = await authClient.signIn.anonymous();
    if (error) throw new Error(error.message ?? '입장하지 못했어요.');
  }
  if (me?.user?.name !== name) {
    const { error } = await authClient.updateUser({ name });
    if (error) throw new Error(error.message ?? '닉네임을 저장하지 못했어요.');
  }
}

/**
 * 계정이 없으면 게스트로 만들고, 닉네임이 다르면 바꾼다.
 * 화면이 알고 있는 로그인 상태가 실제와 어긋났을 수 있다(다른 탭에서 로그인했거나, 로그인이 만료됨).
 * 그래서 실패하면 서버에 실제 상태를 다시 물어보고 한 번 더 시도한다.
 */
export async function ensureGuest(me: Me | null, name: string): Promise<void> {
  try {
    await signInAs(me, name);
  } catch {
    try {
      await signInAs(await fetchMe(), name);
    } catch {
      // 두 번 다 실패하면 이 브라우저가 로그인 쿠키를 저장하지 못하는 것이다.
      throw new CookieError();
    }
  }
}

/** 이 브라우저(주로 메신저 앱 안의 창)가 로그인 쿠키를 저장하지 못할 때. */
export class CookieError extends Error {
  constructor() {
    super('입장 정보를 저장하지 못했어요. 브라우저의 쿠키 차단을 끄거나, 메신저 안의 창 대신 크롬·사파리 같은 브라우저로 열어 주세요.');
  }
}

/** 카카오톡 앱 안의 창에서 열렸는지. */
export const inKakaoTalk = typeof navigator !== 'undefined' && /KAKAOTALK/i.test(navigator.userAgent);

/** 카카오톡 앱 안의 창에서 지금 주소를 기기의 기본 브라우저로 다시 연다. */
export function openInBrowser(): void {
  location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href);
}

export function socialLogin(provider: string): void {
  // 로그인 후 지금 보던 주소(초대 링크 포함)로 돌아온다.
  void authClient.signIn.social({ provider, callbackURL: location.pathname });
}

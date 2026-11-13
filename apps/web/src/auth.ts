import { useCallback, useEffect, useState } from 'react';
import { createAuthClient } from 'better-auth/react';
import { anonymousClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({ plugins: [anonymousClient()] });

export interface Me {
  user: { id: string; name: string; isAnonymous: boolean } | null;
  /** 서버에 키가 등록된 소셜 로그인 ('google', 'kakao'). */
  providers: string[];
  /** 관리자가 올린 공지. 없으면 빈 글. */
  notice?: string;
  records: {
    played: number;
    won: number;
    recent: { endedAt: number; won: boolean; opponents: string; rounds: number; reason: string }[];
  } | null;
  /** 순위전 정보. 회원만 있다(게스트는 null). */
  rank: {
    rating: number;
    /** 티어 번호(0 = 가장 낮음). 배치 중이면 null. */
    tier: number | null;
    games: number;
    wins: number;
    losses: number;
    best: number;
    place: number | null;
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

/** 로그인 라이브러리가 돌려주는 오류를 우리말 안내로 바꾼다. */
function authMessage(error: { code?: string; message?: string; status?: number }): string {
  switch (error.code) {
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return '이미 가입한 이메일이에요. 로그인해 주세요.';
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_PASSWORD':
      return '이메일이나 비밀번호가 맞지 않아요.';
    case 'INVALID_EMAIL':
      return '이메일 주소를 확인해 주세요.';
    case 'PASSWORD_TOO_SHORT':
      return '비밀번호는 8자 이상이어야 해요.';
    case 'PASSWORD_TOO_LONG':
      return '비밀번호가 너무 길어요.';
    case 'SESSION_EXPIRED':
      return '로그인한 지 오래됐어요. 비밀번호를 넣거나, 로그아웃했다가 다시 로그인한 뒤 시도해 주세요.';
    default:
      return error.status === 429 ? '시도가 너무 많아요. 잠시 뒤에 다시 해 주세요.' : '처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.';
  }
}

/** 이메일로 가입한다. 게스트였다면 그동안의 전적이 새 계정으로 옮겨진다. */
export async function emailSignUp(name: string, email: string, password: string): Promise<void> {
  // agreedAt: 가입 화면에서 약관 동의와 만 14세 이상 확인에 체크한 시각
  const body = { name: name.trim(), email: email.trim(), password, agreedAt: Date.now() };
  const { error } = await authClient.signUp.email(body as Parameters<typeof authClient.signUp.email>[0]);
  if (error) throw new Error(authMessage(error));
}

export async function emailSignIn(email: string, password: string): Promise<void> {
  const { error } = await authClient.signIn.email({ email: email.trim(), password });
  if (error) throw new Error(authMessage(error));
}

/** 회원 탈퇴. 이메일로 가입한 사람은 비밀번호로 본인임을 확인한다. */
export async function deleteAccount(password: string): Promise<void> {
  const { error } = await authClient.deleteUser(password ? { password } : {});
  if (error) throw new Error(authMessage(error));
}
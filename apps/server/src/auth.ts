import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';
import { NAME_MAX } from '@bluff-bridge/protocol';
import { moveRecords } from './records.ts';
import type { Env } from './index.ts';

export interface SessionUser {
  id: string;
  name: string;
  isAnonymous: boolean;
}

/** 키가 등록된 소셜 로그인만 켠다. 화면도 이 목록을 보고 버튼을 보여준다. */
export function enabledProviders(env: Env): string[] {
  const list: string[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) list.push('google');
  if (env.KAKAO_CLIENT_ID && env.KAKAO_CLIENT_SECRET) list.push('kakao');
  return list;
}

function build(env: Env, baseURL: string) {
  const providers = enabledProviders(env);
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    // 로컬 개발(BETTER_AUTH_URL 없음)에서는 라이브 화면 서버(5173)와 로컬 서버(8787) 주소를 모두 허용한다.
    // 운영에서는 BETTER_AUTH_URL 한 곳만 허용된다.
    trustedOrigins: env.BETTER_AUTH_URL
      ? []
      : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8787', 'http://127.0.0.1:8787'],
    socialProviders: {
      ...(providers.includes('google') && {
        google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! },
      }),
      ...(providers.includes('kakao') && {
        kakao: {
          clientId: env.KAKAO_CLIENT_ID!,
          clientSecret: env.KAKAO_CLIENT_SECRET!,
          // 카카오 이메일은 사업자 인증(비즈 앱)을 해야 받을 수 있다.
          // 닉네임만 받고, 이메일 자리는 카카오 회원번호로 만든 값으로 채운다.
          disableDefaultScope: true,
          scope: ['profile_nickname'],
          mapProfileToUser: (profile: { id: number | string; kakao_account?: { email?: string } }) => ({
            email: profile.kakao_account?.email ?? `kakao-${profile.id}@users.invalid`,
          }),
        },
      }),
    },
    plugins: [
      anonymous({
        emailDomainName: 'guest.invalid',
        generateName: () => '손님',
        // 게스트가 소셜 로그인을 하면 게스트 때의 전적을 새 계정으로 옮긴다.
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await moveRecords(env.DB, anonymousUser.user.id, newUser.user.id);
        },
      }),
    ],
  });
}

type Auth = ReturnType<typeof build>;
const cache = new Map<string, Auth>();

/**
 * 운영에서는 BETTER_AUTH_URL(예: https://도메인)을 반드시 설정한다.
 * 설정이 없으면 요청 주소를 쓴다(로컬 개발용: localhost와 127.0.0.1 모두 동작).
 */
export function getAuth(env: Env, request: Request): Auth {
  const baseURL = env.BETTER_AUTH_URL || new URL(request.url).origin;
  let auth = cache.get(baseURL);
  if (!auth) cache.set(baseURL, (auth = build(env, baseURL)));
  return auth;
}

export async function getUser(env: Env, request: Request): Promise<SessionUser | null> {
  const session = await getAuth(env, request).api.getSession({ headers: request.headers });
  if (!session) return null;
  const user = session.user as typeof session.user & { isAnonymous?: boolean | null };
  return {
    id: user.id,
    name: user.name.trim().slice(0, NAME_MAX) || '손님',
    isAnonymous: !!user.isAnonymous,
  };
}

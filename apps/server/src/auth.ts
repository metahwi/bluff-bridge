import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';
import { NAME_MAX } from '@bluff-bridge/protocol';
import { cleanName } from './chat.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { moveRecords } from './records.ts';
import { eraseUser, moveChat } from './store.ts';
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
    // 로그인·가입을 마구 두드리지 못하게 주소별로 횟수를 센다. 서버가 여러 곳에 떠 있으므로 DB에 적는다.
    // 학교·회사처럼 여럿이 한 주소를 쓰는 곳이 있어 게스트 입장은 넉넉하게, 비밀번호 대입은 빡빡하게 잡았다.
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 120,
      customRules: {
        '/sign-in/email': { window: 60, max: 8 },
        '/sign-up/email': { window: 3600, max: 30 },
        '/sign-in/anonymous': { window: 3600, max: 200 },
        '/delete-user': { window: 60, max: 10 },
      },
    },
    // Cloudflare가 알려 주는 접속 주소만 믿는다(요청이 스스로 적어 보내는 다른 헤더는 꾸밀 수 있다).
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    // 이메일 + 비밀번호 가입. 메일을 보내는 기능이 아직 없어서 이메일 인증과 비밀번호 재설정은 하지 않는다.
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    user: {
      additionalFields: {
        /** 가입 화면에서 약관·개인정보 처리방침에 동의하고 만 14세 이상임을 확인한 시각. */
        agreedAt: { type: 'number', required: false },
      },
      // 회원 탈퇴. 계정을 지우기 전에 그 사람의 채팅·의견을 지우고 전적과의 연결을 끊는다.
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          await eraseUser(env.DB, user.id);
        },
      },
    },
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
        // 게스트가 가입하거나 로그인하면 게스트 때의 참가 표시와 채팅 기록을 그 계정 것으로 바꾼다
        // (같은 사람이 두 명으로 세어지지 않게). 게스트 때의 판은 전적으로는 보이지 않는다.
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await moveRecords(env.DB, anonymousUser.user.id, newUser.user.id);
          await moveChat(env.DB, anonymousUser.user.id, newUser.user.id);
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
    name: [...cleanName(user.name)].slice(0, NAME_MAX).join('') || '손님',
    isAnonymous: !!user.isAnonymous,
  };
}

import { useEffect, useRef, useState } from 'react';
import { NAME_MAX } from '@bluff-bridge/protocol/types';
import { authClient, deleteAccount, emailSignIn, emailSignUp, inKakaoTalk, socialLogin } from './auth.ts';
import type { Me } from './auth.ts';

const PROVIDER_LABEL: Record<string, string> = { google: 'Google로 계속하기', kakao: '카카오로 계속하기' };

/**
 * 첫 화면의 계정 칸. 게스트는 여기서 가입하거나 로그인하고(게스트 때의 전적은 계정으로 옮겨진다),
 * 회원은 로그아웃하거나 탈퇴한다.
 */
export function Account({
  me,
  draftName,
  reload,
  intent,
}: {
  me: Me;
  draftName: string;
  reload: () => Promise<unknown>;
  /** 다른 곳의 '가입하기' 단추를 눌러 이 칸을 열라는 신호. n이 바뀔 때마다 그 양식을 열고 화면을 이리로 옮긴다. */
  intent?: { mode: 'login' | 'signup'; n: number } | null;
}) {
  const user = me.user;
  const member = !!user && !user.isAnonymous;
  // 구글은 앱 속 브라우저(카카오톡 등)에서의 로그인을 막으므로, 거기서는 단추를 내놓지 않는다.
  const providers = me.providers
    .filter((p) => !(p === 'google' && inKakaoTalk))
    .sort((a, b) => Number(b === 'kakao') - Number(a === 'kakao')); // 카카오를 맨 위에
  const [mode, setMode] = useState<'closed' | 'login' | 'signup' | 'leave'>('closed');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function open(next: 'login' | 'signup' | 'leave') {
    setMode(next);
    setError('');
    setPassword('');
    if (next === 'signup' && !name) setName(draftName || (user && user.name !== '손님' ? user.name : ''));
  }

  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!intent) return;
    open(intent.mode);
    // 양식이 그려진 뒤에 그쪽으로 옮긴다.
    requestAnimationFrame(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    // intent가 바뀔 때만 반응한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.n]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await task();
      await reload();
      setMode('closed');
      setPassword('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '문제가 생겼어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  if (member) {
    return (
      <section className="panel account">
        <div className="row">
          <span>{user.name} 님으로 로그인됨</span>
          <button className="ghost small" onClick={() => run(async () => void (await authClient.signOut()))}>
            로그아웃
          </button>
        </div>
        {mode === 'leave' ? (
          <form
            className="authForm"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => deleteAccount(password));
            }}
          >
            <p>탈퇴하면 계정과 내가 보낸 채팅·의견이 지워지고, 전적에서는 내 계정과의 연결이 끊겨요. 되돌릴 수 없어요.</p>
            <label htmlFor="leave-password">비밀번호 (이메일로 가입한 경우)</label>
            <input id="leave-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="row">
              <button type="button" className="ghost" onClick={() => setMode('closed')}>
                취소
              </button>
              <button className="danger" disabled={busy}>
                {busy ? '처리하는 중…' : '탈퇴하기'}
              </button>
            </div>
          </form>
        ) : (
          <button className="linkish" onClick={() => open('leave')}>
            회원 탈퇴
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="panel account join" ref={box}>
      <h2>가입하면 더 재미있어요</h2>
      <ul className="perks">
        <li>이긴 판, 진 판이 내 전적으로 쌓여요</li>
        <li>순위전에 나가 티어를 올리고 순위표에 이름을 올려요</li>
        <li>휴대폰과 컴퓨터에서 같은 계정으로 이어서 해요</li>
      </ul>
      <small>가입하지 않아도 빠른 매칭과 친구 방은 할 수 있어요.</small>
      {providers.length > 0 && (
        <div className="social">
          {providers.map((p) =>
            p === 'kakao' ? (
              <button key={p} className="kakaoBtn" onClick={() => socialLogin(p)}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path
                    fill="#000"
                    d="M12 3C6.48 3 2 6.54 2 10.9c0 2.82 1.87 5.29 4.69 6.69l-.96 3.53c-.08.31.27.56.54.38l4.2-2.78c.5.05 1.01.08 1.53.08 5.52 0 10-3.54 10-7.9S17.52 3 12 3z"
                  />
                </svg>
                <span>{PROVIDER_LABEL[p]}</span>
              </button>
            ) : p === 'google' ? (
              <button key={p} className="googleBtn" onClick={() => socialLogin(p)}>
                <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
                <span>{PROVIDER_LABEL[p]}</span>
              </button>
            ) : (
              <button key={p} className="ghost" onClick={() => socialLogin(p)}>
                {PROVIDER_LABEL[p] ?? p}
              </button>
            ),
          )}
          <small>
            계속하면 <a href="/terms">이용약관</a>과 <a href="/privacy">개인정보 처리방침</a>에 동의하고 만 14세 이상임을 확인하는 것으로 봐요.
          </small>
          <span className="or">또는 이메일로</span>
        </div>
      )}
      <div className="row tabs">
        <button className={mode === 'login' ? '' : 'ghost'} onClick={() => open('login')}>
          로그인
        </button>
        <button className={mode === 'signup' ? '' : 'ghost'} onClick={() => open('signup')}>
          회원가입
        </button>
      </div>

      {mode === 'login' && (
        <form
          className="authForm"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => emailSignIn(email, password));
          }}
        >
          <label htmlFor="login-email">이메일</label>
          <input id="login-email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="login-password">비밀번호</label>
          <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy}>{busy ? '로그인하는 중…' : '이메일로 로그인'}</button>
        </form>
      )}

      {mode === 'signup' && (
        <form
          className="authForm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!adult || !agree) return setError('두 항목에 모두 체크해 주세요.');
            void run(() => emailSignUp(name, email, password));
          }}
        >
          <label htmlFor="signup-name">닉네임</label>
          <input id="signup-name" autoComplete="nickname" required maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="signup-email">이메일</label>
          <input id="signup-email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="signup-password">비밀번호 (8자 이상)</label>
          <input id="signup-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={adult} onChange={(e) => (setAdult(e.target.checked), setError(''))} />
            <span>만 14세 이상이에요.</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => (setAgree(e.target.checked), setError(''))} />
            <span>
              <a href="/terms" target="_blank" rel="noreferrer">
                이용약관
              </a>
              과{' '}
              <a href="/privacy" target="_blank" rel="noreferrer">
                개인정보 처리방침
              </a>
              에 동의해요.
            </span>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy}>{busy ? '가입하는 중…' : '가입하기'}</button>
          <small>만 14세 미만은 가입 없이 게스트로 즐겨 주세요.</small>
        </form>
      )}

    </section>
  );
}

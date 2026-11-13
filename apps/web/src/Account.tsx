import { useEffect, useRef, useState } from 'react';
import { NAME_MAX } from '@bluff-bridge/protocol/types';
import { authClient, deleteAccount, emailSignIn, emailSignUp, socialLogin } from './auth.ts';
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

      {mode !== 'closed' && me.providers.length > 0 && (
        <>
          <div className="row">
            {me.providers.map((p) => (
              <button key={p} className="ghost" onClick={() => socialLogin(p)}>
                {PROVIDER_LABEL[p] ?? p}
              </button>
            ))}
          </div>
          <small>
            계속하면 <a href="/terms">이용약관</a>과 <a href="/privacy">개인정보 처리방침</a>에 동의하고 만 14세 이상임을 확인하는 것으로 봐요.
          </small>
        </>
      )}
    </section>
  );
}

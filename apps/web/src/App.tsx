import { useEffect, useState } from 'react';
import { NAME_MAX, ROOM_CODE } from '@bluff-bridge/protocol/types';
import { CookieError, authClient, ensureGuest, inKakaoTalk, openInBrowser, socialLogin, useMe } from './auth.ts';
import type { Me } from './auth.ts';
import { Matching } from './Matching.tsx';
import { Room } from './Room.tsx';
import { RULES } from '@bluff-bridge/engine';
import { sound } from './sound.ts';
import { SoundControl } from './SoundToggle.tsx';
import { StageView } from './stage/StageView.tsx';
import type { StageState } from './stage/Stage.ts';

/** 첫 화면에 보여 줄 게임 한 장면. */
const HERO: StageState = {
  length: RULES.bridgeLength,
  pawns: [3, 6],
  crowd: [
    { reserve: 4, finished: 1 },
    { reserve: 5, finished: 0 },
  ],
  active: 0,
};

const PROVIDER_LABEL: Record<string, string> = { google: 'Google로 로그인', kakao: '카카오로 로그인' };
const REASON_LABEL: Record<string, string> = { finish: '완주', elimination: '말 소진', forfeit: '기권' };

function codeFromPath(): string {
  const m = location.pathname.match(/^\/r\/([^/]+)/);
  const code = m?.[1]?.toUpperCase() ?? '';
  return ROOM_CODE.test(code) ? code : '';
}

function Records({ me }: { me: Me }) {
  const r = me.records;
  if (!r || r.played === 0) return null;
  return (
    <section className="panel records">
      <h2>
        전적 {r.played}전 {r.won}승 {r.played - r.won}패
      </h2>
      <ul>
        {r.recent.map((m, i) => (
          <li key={i}>
            <b className={m.won ? 'win' : 'loss'}>{m.won ? '승' : '패'}</b>
            <span>vs {m.opponents || '?'}</span>
            <small>
              {m.rounds}턴 · {REASON_LABEL[m.reason] ?? m.reason} · {new Date(m.endedAt).toLocaleDateString('ko-KR')}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function App() {
  const { me, error: loadError, reload } = useMe();
  const [code, setCode] = useState(codeFromPath);
  /** 닉네임을 확인하고 방에 들어가기로 했는지. 로그인된 사람은 초대 링크로 바로 들어간다. */
  const [entered, setEntered] = useState(false);
  const [matching, setMatching] = useState(false);
  const [draft, setDraft] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cookieBlocked, setCookieBlocked] = useState(false);

  // 방 밖(첫 화면, 매칭 대기)에서는 마을 곡을 튼다.
  useEffect(() => {
    if (!code) sound.setMusic('village');
  }, [code]);

  useEffect(() => {
    const onPop = () => setCode(codeFromPath());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  // 저장된 닉네임을 입력란에 채운다.
  const savedName = me?.user && me.user.name !== '손님' ? me.user.name : '';
  useEffect(() => {
    if (savedName) setDraft((d) => d || savedName);
  }, [savedName]);

  function go(next: string) {
    history.pushState(null, '', next ? `/r/${next}` : '/');
    setCode(next);
    setError('');
    if (!next) {
      setEntered(false);
      void reload(); // 방에서 나오면 전적을 새로 불러온다.
    }
  }

  /** 닉네임을 확정하고(필요하면 게스트 계정을 만들고) 다음 동작을 한다. */
  async function withName(next: () => Promise<void> | void) {
    const name = draft.trim().slice(0, NAME_MAX);
    if (!name) return setError('닉네임을 먼저 입력해 주세요.');
    setBusy(true);
    setError('');
    try {
      await ensureGuest(me, name);
      await reload();
      await next();
    } catch (e) {
      setCookieBlocked(e instanceof CookieError);
      setError(e instanceof Error ? e.message : '문제가 생겼어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  const createRoom = () =>
    withName(async () => {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const body = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !body.code) throw new Error(body.error ?? '방을 만들지 못했어요.');
      setEntered(true);
      go(body.code);
    });

  function joinRoom() {
    const raw = invite.trim();
    const target = (raw.match(/\/r\/([^/?#]+)/)?.[1] ?? raw).toUpperCase();
    if (!ROOM_CODE.test(target)) return setError('초대 링크나 방 코드를 확인해 주세요.');
    void withName(() => {
      setEntered(true);
      go(target);
    });
  }

  async function logout() {
    await authClient.signOut();
    setDraft('');
    await reload();
  }

  if (!me) {
    return (
      <main className="home">
        <div className="panel">{loadError || '불러오는 중…'}</div>
      </main>
    );
  }

  const user = me.user;
  if (matching && user) {
    return (
      <Matching
        onCancel={() => setMatching(false)}
        onMatched={(matched) => {
          setMatching(false);
          setEntered(true);
          go(matched);
        }}
      />
    );
  }
  if (code && user && (entered || savedName)) {
    return <Room code={code} userId={user.id} onExit={() => go('')} />;
  }

  const member = user && !user.isAnonymous;
  return (
    <main className="home">
      <SoundControl floating />
      <h1 className="logo">하마하마</h1>
      <StageView state={HERO} />

      <section className="panel form">
      <label htmlFor="name">닉네임</label>
      <input
        id="name"
        value={draft}
        maxLength={NAME_MAX}
        placeholder="이름"
        onChange={(e) => setDraft(e.target.value)}
      />

      {code ? (
        <>
          <button disabled={busy || !draft.trim()} onClick={() => withName(() => setEntered(true))}>
            {busy ? '들어가는 중…' : `방 ${code} 입장`}
          </button>
          <button className="ghost" onClick={() => go('')}>
            처음으로
          </button>
        </>
      ) : (
        <>
          <button disabled={busy || !draft.trim()} onClick={() => withName(() => setMatching(true))}>
            빠른 매칭
          </button>
          <button className="ghost" disabled={busy || !draft.trim()} onClick={createRoom}>
            친구와 하기 (방 만들기)
          </button>
          <button className="ghost soon" disabled>
            4인 대결 <span className="badge">Coming Soon</span>
          </button>
          <label htmlFor="invite">초대받았나요?</label>
          <div className="row">
            <input
              id="invite"
              value={invite}
              placeholder="초대 링크 또는 방 코드"
              onChange={(e) => setInvite(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
            />
            <button className="ghost" disabled={busy || !invite.trim()} onClick={joinRoom}>
              입장
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {/* 카카오톡 앱 안의 창이 로그인 정보를 저장하지 못하면, 기기의 브라우저로 다시 열게 한다. */}
      {cookieBlocked && inKakaoTalk && (
        <button className="ghost" onClick={openInBrowser}>
          다른 브라우저로 열기
        </button>
      )}

      </section>

      <section className="panel rules">
        <h2>게임 방법</h2>
        <ol>
          <li>주사위를 던져요. 눈은 나만 볼 수 있어요. 여섯 면 중 둘은 꽝이에요.</li>
          <li>
            1~{RULES.maxClaim} 중 하나를 외쳐요. 뻥이어도 돼요. <b className="blankWord">꽝</b>이 나오면 무조건 뻥을 쳐야 해요.
          </li>
          <li>상대가 믿으면 외친 만큼 다리를 건너요.</li>
          <li>상대가 의심하면 주사위를 공개해요. 뻥이었으면 내 말이, 진실이었으면 상대 말이 하마 밥이 돼요.</li>
          <li>
            말 {RULES.runners}개 중 {RULES.finishesToWin}개를 먼저 건너보내면 이겨요.
          </li>
        </ol>
      </section>

      <section className="panel account">
        {member ? (
          <div className="row">
            <span>{user.name} 님으로 로그인됨</span>
            <button className="ghost" onClick={logout}>
              로그아웃
            </button>
          </div>
        ) : me.providers.length > 0 ? (
          <>
            <small>
              로그인하면 다른 기기에서도 전적이 유지돼요.
              {user ? ' 지금까지의 전적도 그대로 옮겨져요.' : ''}
            </small>
            <div className="row">
              {me.providers.map((p) => (
                <button key={p} className="ghost" onClick={() => socialLogin(p)}>
                  {PROVIDER_LABEL[p] ?? p}
                </button>
              ))}
            </div>
          </>
        ) : (
          <small>지금은 게스트로 플레이해요. 전적은 이 브라우저에 연결돼요.</small>
        )}
      </section>

      <Records me={me} />
    </main>
  );
}

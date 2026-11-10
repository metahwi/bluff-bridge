import { useEffect, useState } from 'react';
import { NAME_MAX, ROOM_CODE } from '@bluff-bridge/protocol/types';
import { loadName, saveName } from './identity.ts';
import { Room } from './Room.tsx';

function codeFromPath(): string {
  const m = location.pathname.match(/^\/r\/([^/]+)/);
  const code = m?.[1]?.toUpperCase() ?? '';
  return ROOM_CODE.test(code) ? code : '';
}

export function App() {
  const [code, setCode] = useState(codeFromPath);
  const [name, setName] = useState(loadName);
  const [draft, setDraft] = useState(name);
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onPop = () => setCode(codeFromPath());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  function go(next: string) {
    history.pushState(null, '', next ? `/r/${next}` : '/');
    setCode(next);
    setError('');
  }

  function commitName(): string {
    const n = draft.trim().slice(0, NAME_MAX);
    if (n) {
      saveName(n);
      setName(n);
    }
    return n;
  }

  async function createRoom() {
    if (!commitName()) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const body = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !body.code) throw new Error(body.error ?? '방을 만들지 못했어요.');
      go(body.code);
    } catch (e) {
      setError(e instanceof Error ? e.message : '방을 만들지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  function joinRoom() {
    const raw = invite.trim();
    const target = (raw.match(/\/r\/([^/?#]+)/)?.[1] ?? raw).toUpperCase();
    if (!ROOM_CODE.test(target)) return setError('초대 링크나 방 코드를 확인해 주세요.');
    if (!commitName()) return setError('닉네임을 먼저 입력해 주세요.');
    go(target);
  }

  if (code && name) return <Room code={code} name={name} onExit={() => go('')} />;

  return (
    <main className="home">
      <h1>뻥다리</h1>
      <p className="sub">주사위를 숨기고, 뻥치고, 다리를 건너세요.</p>

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
          <button disabled={!draft.trim()} onClick={commitName}>
            방 {code} 입장
          </button>
          <button className="ghost" onClick={() => go('')}>
            처음으로
          </button>
        </>
      ) : (
        <>
          <button disabled={busy || !draft.trim()} onClick={createRoom}>
            {busy ? '만드는 중…' : '방 만들기'}
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
            <button className="ghost" disabled={!invite.trim()} onClick={joinRoom}>
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
    </main>
  );
}

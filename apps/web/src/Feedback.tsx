import { useEffect, useState } from 'react';
import { settings } from './settings.ts';

const MAX = 1000;

/** 설정 창 안의 '의견 보내기'. 가입한 회원만 보낼 수 있다. */
export function Feedback({ work }: { work: boolean }) {
  const [open, setOpen] = useState(false);
  /** null = 확인 중, true = 보낼 수 있음, false = 로그인 필요 */
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open || allowed !== null) return;
    fetch('/api/me')
      .then((r) => r.json() as Promise<{ user: { isAnonymous: boolean } | null }>)
      .then((me) => setAllowed(!!me.user && !me.user.isAnonymous))
      .catch(() => setAllowed(false));
  }, [open, allowed]);

  async function submit() {
    setBusy(true);
    setNote('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, page: location.pathname.startsWith('/r/') ? 'room' : 'home', mode: settings.work ? 'work' : 'game' }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setNote(body.error ?? '보내지 못했어요. 잠시 뒤에 다시 시도해 주세요.');
      setSent(true);
      setText('');
    } catch {
      setNote('보내지 못했어요. 인터넷 연결을 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="feedback">
      <div className="settingRow">
        <span>
          의견 보내기
          <small>{work ? '불편한 점이나 바라는 점을 알려 주세요.' : '불편한 점이나 바라는 점을 알려 주세요.'}</small>
        </span>
        <button className={'small ' + (open ? '' : 'ghost')} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '닫기' : '쓰기'}
        </button>
      </div>
      {open &&
        (allowed === null ? (
          <small>확인하는 중…</small>
        ) : !allowed ? (
          <small>
            로그인한 뒤에 보낼 수 있어요. <a href="/">첫 화면</a> 아래의 계정 칸에서 가입하거나 로그인해 주세요.
          </small>
        ) : sent ? (
          <>
            <small>잘 받았어요. 고맙습니다!</small>
            <button className="ghost small" onClick={() => setSent(false)}>
              하나 더 쓰기
            </button>
          </>
        ) : (
          <>
            <textarea aria-label="의견" rows={4} maxLength={MAX} value={text} placeholder="예: 휴대폰에서 단추가 잘 안 눌려요." onChange={(e) => setText(e.target.value)} />
            {note && (
              <small className="error" role="alert">
                {note}
              </small>
            )}
            <button className="small" disabled={busy || text.trim().length < 5} onClick={submit}>
              {busy ? '보내는 중…' : '보내기'}
            </button>
          </>
        ))}
    </div>
  );
}

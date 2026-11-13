// 관리자 페이지 (/admin). 관리자 암호로 들어오며, 게임 계정과는 별개다.
// 데이터는 모두 /api/admin/* 에서 오고, 서버가 요청마다 관리자인지 다시 확인한다.
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { BirdsEye } from './BirdsEye.tsx';
import { Forbidden, api, useLoad, when } from './api.ts';
import './admin.css';

const TIERS = ['아기 하마', '꼬마 하마', '날쌘 하마', '대장 하마', '하마왕'];

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('login', { method: 'POST', body: JSON.stringify({ password }) });
      onDone();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : '암호가 맞지 않아요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="admLogin" onSubmit={submit}>
      <h1>하마하마 관리자</h1>
      <label htmlFor="adm-password">관리자 암호</label>
      <input id="adm-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && (
        <p className="admError" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy || !password}>{busy ? '확인하는 중…' : '들어가기'}</button>
    </form>
  );
}

interface SettingsData {
  botsEnabled: boolean;
  botWaitSec: number;
  botLevel: 'easy' | 'normal' | 'hard';
  turnSeconds: number;
  freeChat: boolean;
  notice: string;
}

function Switch({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="admRow">
      <div>
        <b>{label}</b>
        <small>{hint}</small>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={'admSwitch' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
        {on ? '켜짐' : '꺼짐'}
      </button>
    </div>
  );
}

function Settings({ onForbidden }: { onForbidden: () => void }) {
  const { data, error, setData } = useLoad<{ settings: SettingsData }>('settings', onForbidden);
  const [draft, setDraft] = useState<SettingsData | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data && !draft) setDraft(data.settings);
  }, [data, draft]);

  /** 바꾼 값을 저장한다. 스위치는 누르자마자, 나머지는 '저장'을 눌렀을 때. */
  async function save(next: SettingsData) {
    setDraft(next);
    setBusy(true);
    setNote('');
    try {
      const saved = await api<{ settings: SettingsData }>('settings', { method: 'PUT', body: JSON.stringify(next) });
      setData(saved);
      setDraft(saved.settings);
      setNote('저장했어요. 진행 중인 방과 대기열에는 최대 15초 뒤에 반영돼요.');
    } catch (e) {
      if (e instanceof Forbidden) return onForbidden();
      setNote(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="admError">{error}</p>;
  if (!draft) return <p>불러오는 중…</p>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data?.settings);
  return (
    <div className="admSettings">
      <h2>봇</h2>
      <Switch
        label="봇 상대"
        hint="빠른 매칭에서 아래 시간 동안 사람을 못 만나면 봇이 상대로 들어옵니다. 플레이어에게는 봇이라고 표시되지 않고(평범한 닉네임을 씁니다), 이 관리자 페이지에서만 알 수 있습니다. 순위전에는 들어가지 않습니다."
        on={draft.botsEnabled}
        onChange={(on) => save({ ...draft, botsEnabled: on })}
      />
      <div className="admRow">
        <div>
          <b>봇을 붙이기 전에 기다리는 시간</b>
          <small>3~120초. 짧을수록 바로 봇과 붙고, 길수록 사람을 만날 기회가 늘어납니다.</small>
        </div>
        <label className="admUnit">
          <input type="number" min={3} max={120} value={draft.botWaitSec} onChange={(e) => setDraft({ ...draft, botWaitSec: Number(e.target.value) })} />초
        </label>
      </div>
      <div className="admRow">
        <div>
          <b>봇 난이도</b>
          <small>쉬움: 큰 숫자를 자주 뻥치고 잘 속음 / 어려움: 뻥을 아끼고 큰 선언을 잘 의심함</small>
        </div>
        <select aria-label="봇 난이도" value={draft.botLevel} onChange={(e) => setDraft({ ...draft, botLevel: e.target.value as SettingsData['botLevel'] })}>
          <option value="easy">쉬움</option>
          <option value="normal">보통</option>
          <option value="hard">어려움</option>
        </select>
      </div>

      <h2>게임</h2>
      <div className="admRow">
        <div>
          <b>한 행동의 제한 시간</b>
          <small>10~120초. 새로 만들어지는 방부터 적용됩니다.</small>
        </div>
        <label className="admUnit">
          <input type="number" min={10} max={120} value={draft.turnSeconds} onChange={(e) => setDraft({ ...draft, turnSeconds: Number(e.target.value) })} />초
        </label>
      </div>
      <Switch
        label="자유 채팅"
        hint="끄면 친구 방에서도 정해진 말만 보낼 수 있습니다(빠른 매칭·순위전은 원래 정해진 말만)."
        on={draft.freeChat}
        onChange={(on) => save({ ...draft, freeChat: on })}
      />
      <div className="admRow wide">
        <div>
          <b>공지</b>
          <small>첫 화면 맨 위에 띄웁니다. 비우면 띄우지 않습니다. (200자까지)</small>
        </div>
        <textarea aria-label="공지" rows={2} maxLength={200} value={draft.notice} onChange={(e) => setDraft({ ...draft, notice: e.target.value })} />
      </div>

      <div className="admActions">
        <button disabled={busy || !dirty} onClick={() => save(draft)}>
          {busy ? '저장하는 중…' : '저장'}
        </button>
        {note && <small>{note}</small>}
      </div>
    </div>
  );
}

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  guest: boolean;
  createdAt: unknown;
  played: number;
  rating: number | null;
  games: number;
  wins: number;
  losses: number;
  tier: number | null;
}

function Users({ onForbidden }: { onForbidden: () => void }) {
  const [q, setQ] = useState('');
  const [guests, setGuests] = useState(false);
  const [query, setQuery] = useState('users');
  const { data, error, reload } = useLoad<{ users: UserRow[] }>(query, onForbidden);
  const search = (e: FormEvent) => {
    e.preventDefault();
    setQuery(`users?q=${encodeURIComponent(q)}${guests ? '&guests=1' : ''}`);
  };

  async function setRating(u: UserRow) {
    const input = prompt(`${u.name}의 순위전 점수 (비우면 기록을 지우고 처음 상태로)`, u.rating === null ? '' : String(u.rating));
    if (input === null) return;
    try {
      await api(`users/${encodeURIComponent(u.id)}/rating`, { method: 'POST', body: JSON.stringify({ rating: input.trim() === '' ? null : Number(input) }) });
      reload();
    } catch (e) {
      if (e instanceof Forbidden) return onForbidden();
      alert(e instanceof Error ? e.message : '고치지 못했어요.');
    }
  }

  return (
    <>
      <form className="admSearch" onSubmit={search}>
        <input aria-label="닉네임 또는 이메일" placeholder="닉네임 또는 이메일" value={q} onChange={(e) => setQ(e.target.value)} />
        <label>
          <input type="checkbox" checked={guests} onChange={(e) => setGuests(e.target.checked)} /> 게스트 포함
        </label>
        <button>찾기</button>
      </form>
      {error && <p className="admError">{error}</p>}
      {data && (
        <Table
          empty="해당하는 사람이 없어요."
          head={['닉네임', '이메일', '가입', '판 수', '순위전', '']}
          rows={data.users.map((u) => [
            <>
              {u.name} {u.guest && <span className="admTag">게스트</span>}
            </>,
            u.email ?? '-',
            when(u.createdAt),
            u.played,
            u.rating === null ? '-' : `${u.rating}점 · ${u.tier === null ? `배치 ${u.games}판` : TIERS[u.tier]} · ${u.wins}승 ${u.losses}패`,
            u.guest ? null : (
              <button className="admGhost" onClick={() => setRating(u)}>
                점수 고치기
              </button>
            ),
          ])}
        />
      )}
      {data && data.users.length >= 200 && <small>최근 200명까지만 보여요. 찾기로 좁혀 주세요.</small>}
    </>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="admEmpty">{empty}</p>;
  return (
    <div className="admScroll">
      <table className="admTable">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface FeedbackRow {
  id: number;
  name: string;
  text: string;
  page: string | null;
  mode: string | null;
  agent: string | null;
  created_at: number;
}

function Feedback({ onForbidden }: { onForbidden: () => void }) {
  const { data, error, reload } = useLoad<{ feedback: FeedbackRow[] }>('feedback', onForbidden);
  async function remove(id: number) {
    if (!confirm('이 의견을 지울까요? 되돌릴 수 없어요.')) return;
    await api(`feedback/${id}`, { method: 'DELETE' }).catch((e) => e instanceof Forbidden && onForbidden());
    reload();
  }
  if (error) return <p className="admError">{error}</p>;
  if (!data) return <p>불러오는 중…</p>;
  return (
    <Table
      empty="아직 받은 의견이 없어요."
      head={['받은 때', '보낸 사람', '내용', '화면', '']}
      rows={data.feedback.map((f) => [
        when(f.created_at),
        f.name,
        <span className="admText">{f.text}</span>,
        <span title={f.agent ?? ''}>{[f.page, f.mode === 'work' ? '업무 모드' : null].filter(Boolean).join(' · ') || '-'}</span>,
        <button className="admGhost" onClick={() => remove(f.id)}>
          지우기
        </button>,
      ])}
    />
  );
}

interface ChatRow {
  id: number;
  room_code: string;
  name: string;
  text: string | null;
  preset: number | null;
  quick_match: number;
  created_at: number;
}

function ChatLog({ onForbidden }: { onForbidden: () => void }) {
  const [room, setRoom] = useState('');
  const [query, setQuery] = useState('chat');
  const { data, error, reload } = useLoad<{ chat: ChatRow[] }>(query, onForbidden);
  async function remove(id: number) {
    if (!confirm('이 채팅 기록을 지울까요?')) return;
    await api(`chat/${id}`, { method: 'DELETE' }).catch((e) => e instanceof Forbidden && onForbidden());
    reload();
  }
  return (
    <>
      <form
        className="admSearch"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(room.trim() ? `chat?room=${encodeURIComponent(room.trim())}` : 'chat');
        }}
      >
        <input aria-label="방 코드" placeholder="방 코드 (비우면 최근 200줄)" value={room} onChange={(e) => setRoom(e.target.value)} />
        <button>찾기</button>
      </form>
      {error && <p className="admError">{error}</p>}
      {data && (
        <Table
          empty="보관 중인 채팅이 없어요."
          head={['때', '방', '보낸 사람', '내용', '']}
          rows={data.chat.map((m) => [
            when(m.created_at),
            <>
              {m.room_code} {m.quick_match === 1 && <span className="admTag">매칭</span>}
            </>,
            m.name,
            m.text ?? <span className="admMuted">(정해진 말 {m.preset}번)</span>,
            <button className="admGhost" onClick={() => remove(m.id)}>
              지우기
            </button>,
          ])}
        />
      )}
    </>
  );
}

/** 관리자가 한 일의 기록: 로그인(성공·실패), 설정 변경, 점수 수정, 삭제. */
function ActivityLog({ onForbidden }: { onForbidden: () => void }) {
  const { data, error } = useLoad<{ log: { id: number; at: number; ip: string; action: string; detail: string }[] }>('log', onForbidden);
  if (error) return <p className="admError">{error}</p>;
  if (!data) return <p>불러오는 중…</p>;
  return (
    <>
      <small>최근 200건. 90일이 지나면 지워집니다. 내가 하지 않은 로그인이나 로그인 실패가 많으면 암호를 바꿔 주세요.</small>
      <Table
        empty="아직 기록이 없어요."
        head={['때', '한 일', '내용', '접속 주소']}
        rows={data.log.map((l) => [when(l.at), l.action === '로그인 실패' ? <b className="admError">{l.action}</b> : l.action, <span className="admText">{l.detail || '-'}</span>, l.ip])}
      />
    </>
  );
}

const TABS = [
  ['overview', '한눈에 보기'],
  ['settings', '게임 설정'],
  ['users', '회원'],
  ['feedback', '의견'],
  ['chat', '채팅'],
  ['log', '활동 기록'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function Admin() {
  /** null = 확인 중 */
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const kick = useCallback(() => setSignedIn(false), []);

  useEffect(() => {
    document.title = '하마하마 관리자';
    document.documentElement.dataset.mode = 'admin';
    api<{ admin: boolean }>('session')
      .then((s) => setSignedIn(s.admin))
      .catch(() => setSignedIn(false));
  }, []);

  if (signedIn === null) return <main className="adm">확인하는 중…</main>;
  if (!signedIn) {
    return (
      <main className="adm">
        <Login onDone={() => setSignedIn(true)} />
      </main>
    );
  }
  return (
    <main className={'adm' + (tab === 'overview' ? ' wide' : '')}>
      <header className="admHead">
        <h1>하마하마 관리자</h1>
        <nav>
          {TABS.map(([key, label]) => (
            <button key={key} className={tab === key ? 'on' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
        <button
          className="admGhost"
          onClick={async () => {
            await api('logout', { method: 'POST' }).catch(() => null);
            setSignedIn(false);
          }}
        >
          나가기
        </button>
      </header>
      <section className="admBody">
        {tab === 'overview' && <BirdsEye onForbidden={kick} />}
        {tab === 'settings' && <Settings onForbidden={kick} />}
        {tab === 'users' && <Users onForbidden={kick} />}
        {tab === 'feedback' && <Feedback onForbidden={kick} />}
        {tab === 'chat' && <ChatLog onForbidden={kick} />}
        {tab === 'log' && <ActivityLog onForbidden={kick} />}
      </section>
    </main>
  );
}

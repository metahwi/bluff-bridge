// 관리자 페이지의 채팅 탭. 보관 중인 채팅을 방별 대화로 묶어 보여 준다.
// 정해진 말은 번호가 아니라 실제 문구로 보이고, 그 방에서 끝난 판이 대화 사이에 끼어 흐름을 알 수 있다.
import { useMemo, useState } from 'react';
import { CHAT_PRESETS } from '@bluff-bridge/protocol/types';
import { Forbidden, api, useLoad, when } from './api.ts';

interface Message {
  id: number;
  at: number;
  name: string;
  text: string | null;
  preset: number | null;
  test: boolean;
}
interface Game {
  endedAt: number;
  mode: string | null;
  rounds: number;
  reason: string;
  players: string;
}
interface Room {
  code: string;
  quickMatch: boolean;
  firstAt: number;
  lastAt: number;
  typed: number;
  testOnly: boolean;
  people: string[];
  games: Game[];
  messages: Message[];
}

const REASONS: Record<string, string> = { finish: '완주로 승리', elimination: '말 소진', forfeit: '기권·끊김' };
const MODES: Record<string, string> = { friend: '친구 방', quick: '빠른 매칭', ranked: '순위전', bot: '봇과' };
const clock = (at: number) => new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
/** 방 안에서 말한 사람마다 다른 색(이름 구분용). 사람 순서대로 고정한다. */
const INK = ['#1c5cab', '#b8430f', '#0f7a55', '#7b2fc4', '#8a6100', '#b02e5c'];

/** 대화와 그 방에서 끝난 판을 시간순으로 섞은 한 줄. */
type Line = { kind: 'chat'; at: number; message: Message } | { kind: 'game'; at: number; game: Game };

function Thread({ room, onDelete }: { room: Room; onDelete: (id: number) => void }) {
  const lines = useMemo<Line[]>(
    () =>
      [...room.messages.map((m): Line => ({ kind: 'chat', at: m.at, message: m })), ...room.games.map((g): Line => ({ kind: 'game', at: g.endedAt, game: g }))].sort(
        (a, b) => a.at - b.at,
      ),
    [room],
  );
  return (
    <ol className="admThread">
      {lines.map((line, i) =>
        line.kind === 'game' ? (
          <li key={`g${i}`} className="game">
            <span>
              판 종료 · {line.game.players} · {line.game.rounds}턴 · {REASONS[line.game.reason] ?? line.game.reason}
            </span>
            <time>{clock(line.at)}</time>
          </li>
        ) : (
          <li key={line.message.id} className={line.message.text === null ? 'preset' : ''}>
            <time>{clock(line.at)}</time>
            <b style={{ color: INK[room.people.indexOf(line.message.name) % INK.length] }}>{line.message.name}</b>
            <span className="say">
              {line.message.text ?? CHAT_PRESETS[line.message.preset ?? -1] ?? `(정해진 말 ${line.message.preset}번)`}
              {line.message.text === null && <em>정해진 말</em>}
            </span>
            <button className="admGhost" aria-label="이 채팅 지우기" title="이 채팅 지우기" onClick={() => onDelete(line.message.id)}>
              지우기
            </button>
          </li>
        ),
      )}
    </ol>
  );
}

export function ChatRooms({ onForbidden }: { onForbidden: () => void }) {
  const { data, error, reload } = useLoad<{ rooms: Room[] }>('chat/rooms', onForbidden);
  const [q, setQ] = useState('');
  const [presetRooms, setPresetRooms] = useState(false);
  const [testRooms, setTestRooms] = useState(false);

  async function remove(id: number) {
    if (!confirm('이 채팅 기록을 지울까요? 되돌릴 수 없어요.')) return;
    await api(`chat/${id}`, { method: 'DELETE' }).catch((e) => e instanceof Forbidden && onForbidden());
    reload();
  }

  const all = data?.rooms ?? [];
  const word = q.trim().toLowerCase();
  const matches = (r: Room) =>
    !word || r.code.toLowerCase().includes(word) || r.people.some((p) => p.toLowerCase().includes(word)) || r.messages.some((m) => m.text?.toLowerCase().includes(word));
  // 찾는 말이 있으면 숨김 조건과 상관없이 찾아 준다.
  const shown = all.filter((r) => matches(r) && (word !== '' || ((presetRooms || r.typed > 0) && (testRooms || !r.testOnly))));
  const hiddenPreset = all.filter((r) => r.typed === 0 && !r.testOnly).length;
  const hiddenTest = all.filter((r) => r.testOnly).length;

  if (error) return <p className="admError">{error}</p>;
  if (!data) return <p>불러오는 중…</p>;
  return (
    <>
      <div className="admSearch">
        <input aria-label="방 코드, 닉네임, 내용으로 찾기" placeholder="방 코드, 닉네임, 내용으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        <label>
          <input type="checkbox" checked={presetRooms} onChange={(e) => setPresetRooms(e.target.checked)} /> 정해진 말만 오간 방도 보기 ({hiddenPreset})
        </label>
        <label>
          <input type="checkbox" checked={testRooms} onChange={(e) => setTestRooms(e.target.checked)} /> 점검용 계정의 방도 보기 ({hiddenTest})
        </label>
      </div>
      <small>
        채팅은 7일 동안 보관됩니다. 방마다 한 묶음으로, 마지막으로 말이 오간 방이 위에 옵니다. 지금 {shown.length}개 방 / 전체 {all.length}개 방.
      </small>
      {shown.length === 0 ? (
        <p className="admEmpty">
          {all.length === 0 ? '보관 중인 채팅이 없어요.' : word ? '찾는 내용이 없어요.' : '직접 쓴 글이 오간 방이 아직 없어요. 위의 체크를 켜면 정해진 말만 오간 방도 볼 수 있어요.'}
        </p>
      ) : (
        <div className="admRooms">
          {shown.map((r) => (
            <article key={r.code} className="admRoom">
              <header>
                <b>{r.code}</b>
                <span className="admTag">{r.games[0]?.mode ? (MODES[r.games[0].mode] ?? r.games[0].mode) : r.quickMatch ? '매칭 방' : '친구 방'}</span>
                {r.testOnly && <span className="admTag warn">점검용</span>}
                <span className="who">{r.people.join(', ')}</span>
                <small>
                  {when(r.firstAt)}
                  {r.lastAt - r.firstAt > 60_000 && ` ~ ${clock(r.lastAt)}`} · {r.messages.length}줄 (직접 쓴 글 {r.typed}) · 끝난 판 {r.games.length}
                </small>
              </header>
              <Thread room={r} onDelete={remove} />
            </article>
          ))}
        </div>
      )}
    </>
  );
}

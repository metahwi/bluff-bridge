import { useEffect, useRef, useState } from 'react';
import { CHAT_GAP_MS, CHAT_MAX, CHAT_PRESETS, CHAT_PRESETS_WORK } from '@bluff-bridge/protocol/types';
import type { ClientMessage } from '@bluff-bridge/protocol/types';
import { Pawn } from './pixel.tsx';
import type { ChatLine } from './useRoom.ts';

/**
 * 방 안 채팅. 글은 서버에 남지 않고 지금 방에 있는 사람에게만 보인다.
 * presetsOnly(빠른 매칭 방)이면 정해진 말만 보낼 수 있다.
 * work(업무 모드)이면 같은 내용을 문서의 '메모'처럼 보여 준다.
 */
export function Chat({
  lines,
  me,
  presetsOnly,
  work = false,
  send,
}: {
  lines: ChatLine[];
  me: number;
  presetsOnly: boolean;
  work?: boolean;
  send: (msg: ClientMessage) => void;
}) {
  const [draft, setDraft] = useState('');
  const [cooling, setCooling] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const presets = work ? CHAT_PRESETS_WORK : CHAT_PRESETS;

  // 새 글이 오면 맨 아래로 내린다.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  /** 서버가 도배를 막으려고 간격을 두므로, 그동안은 단추를 잠가 보낸 글이 사라지지 않게 한다. */
  function post(msg: ClientMessage) {
    if (cooling) return;
    send(msg);
    setCooling(true);
    setTimeout(() => setCooling(false), CHAT_GAP_MS + 100);
  }

  function submit() {
    const text = draft.trim();
    if (!text || cooling) return;
    post({ t: 'chat', text });
    setDraft('');
  }

  return (
    <section className={'chat' + (work ? ' memo' : '')} aria-label={work ? '메모' : '채팅'}>
      <h3>{work ? '메모' : '채팅'}</h3>
      <div className="chatList" ref={list} role="log" aria-live="polite">
        {lines.length === 0 && <p className="empty">{work ? '메모가 없습니다.' : '아직 아무 말도 없어요.'}</p>}
        {lines.map((l) => (
          <p key={l.id} className={l.from === me ? 'mine' : ''}>
            {!work && <Pawn player={l.from} scale={1} />}
            <b className={`who p${l.from}`}>{l.name}</b>
            <span>{l.preset !== undefined ? (presets[l.preset] ?? '') : l.text}</span>
          </p>
        ))}
      </div>
      <div className="chatPresets">
        {presets.map((text, i) => (
          <button key={i} className="ghost small" disabled={cooling} onClick={() => post({ t: 'chat', preset: i })}>
            {text}
          </button>
        ))}
      </div>
      {presetsOnly ? (
        <small>{work ? '자동 배정에서는 정해진 문구만 남길 수 있습니다.' : '빠른 매칭에서는 정해진 말만 보낼 수 있어요.'}</small>
      ) : (
        <div className="chatInput">
          <input
            aria-label={work ? '메모 입력' : '채팅 입력'}
            value={draft}
            maxLength={CHAT_MAX}
            placeholder={work ? '메모 입력' : '하고 싶은 말'}
            enterKeyHint="send"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 한글 조합 중의 Enter는 글자를 확정하는 것이므로 보내지 않는다.
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
            }}
          />
          <button className="small" disabled={cooling || !draft.trim()} onClick={submit}>
            {work ? '입력' : '보내기'}
          </button>
        </div>
      )}
    </section>
  );
}

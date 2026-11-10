import { useEffect, useState } from 'react';
import type { MatchMessage } from '@bluff-bridge/protocol/types';
import { StageView } from './stage/StageView.tsx';
import type { StageState } from './stage/Stage.ts';

/** 대기 중: 내 말 하나가 출발 지점에서 기다린다. */
const WAITING: StageState = { length: 10, pawns: [0], crowd: [{ reserve: 4, finished: 0 }], active: 0 };

/** 빠른 매칭 대기 화면. 대기열에 연결해 두었다가 짝이 정해지면 방 코드를 받는다. */
export function Matching({ onMatched, onCancel }: { onMatched: (code: string) => void; onCancel: () => void }) {
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let stopped = false;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${proto}://${location.host}/ws/match`);
      ws = socket;
      socket.onopen = () => {
        setError('');
        pingTimer = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('ping'), 20_000);
      };
      socket.onmessage = (e) => {
        if (e.data === 'pong') return;
        const msg = JSON.parse(String(e.data)) as MatchMessage;
        if (msg.t === 'matched') {
          stopped = true;
          onMatched(msg.code);
        } else if (msg.t === 'error') {
          stopped = true;
          setError(msg.message);
        }
      };
      socket.onclose = (e) => {
        clearInterval(pingTimer);
        if (stopped) return;
        if (e.code === 4000) {
          stopped = true;
          return setError('다른 창에서 매칭을 시작했어요.');
        }
        // 연결이 끊기면 대기열에서 빠지므로 다시 줄을 선다.
        setError('연결이 끊겨 다시 시도하는 중…');
        retryTimer = setTimeout(open, 1500);
      };
    };
    open();

    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      clearInterval(tick);
      ws?.close();
    };
    // 화면이 떠 있는 동안 한 번만 연결한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="home">
      <StageView state={WAITING} />
      <section className="panel">
        <h2>상대를 찾는 중…</h2>
        <p>{seconds}초 지남</p>
        <small>다른 사람이 빠른 매칭을 누르면 바로 시작해요. 기다리기 지루하면 친구에게 초대 링크를 보내 보세요.</small>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="ghost" onClick={onCancel}>
          취소
        </button>
      </section>
    </main>
  );
}

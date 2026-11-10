import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, RoomView, ServerMessage } from '@bluff-bridge/protocol/types';
import { playerId } from './identity.ts';

export type Connection = 'connecting' | 'open' | 'lost' | 'closed';

export interface RoomState {
  room: RoomView | null;
  /** 현재 행동의 마감 시각(이 브라우저 시계 기준). */
  deadline: number | null;
  conn: Connection;
  /** 방금 한 행동이 거절된 이유. */
  error: string;
  /** 더 진행할 수 없는 이유(방 없음, 가득 참 등). */
  fatal: string;
  send: (msg: ClientMessage) => void;
}

export function useRoom(code: string, name: string): RoomState {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [conn, setConn] = useState<Connection>('connecting');
  const [error, setError] = useState('');
  const [fatal, setFatal] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(
        `${proto}://${location.host}/ws/room/${code}?pid=${playerId}&name=${encodeURIComponent(name)}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setConn('open');
        pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 20_000);
      };
      ws.onmessage = (e) => {
        if (e.data === 'pong') return;
        const msg = JSON.parse(String(e.data)) as ServerMessage;
        if (msg.t === 'state') {
          setRoom(msg.room);
          setDeadline(msg.room.remainingMs === null ? null : Date.now() + msg.room.remainingMs);
        } else if (msg.fatal) {
          setFatal(msg.message);
        } else {
          setError(msg.message);
        }
      };
      ws.onclose = (e) => {
        clearInterval(pingTimer);
        if (stopped) return;
        // 1000: 정상 종료, 4000: 다른 창에서 접속, 4003: 입장 거절 → 다시 시도하지 않는다.
        if (e.code === 1000 || e.code === 4000 || e.code === 4003) {
          setConn('closed');
          if (e.code === 4000) setFatal('다른 창에서 이 방에 접속했어요.');
          if (e.code === 1000) setFatal((f) => f || '방이 닫혔어요.');
          return;
        }
        setConn('lost');
        retryTimer = setTimeout(open, Math.min(5000, 500 * 2 ** retry++));
      };
    };
    open();

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      wsRef.current?.close();
    };
  }, [code, name]);

  const send = useCallback((msg: ClientMessage) => {
    setError('');
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { room, deadline, conn, error, fatal, send };
}

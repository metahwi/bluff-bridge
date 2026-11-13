// 관리자 페이지의 공통 도구: 서버 호출, 시각 표시, 목록 불러오기.
import { useCallback, useEffect, useState } from 'react';

/** 로그인이 풀렸거나 관리자가 아닐 때. 화면은 로그인으로 돌아간다. */
export class Forbidden extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 403) throw new Forbidden();
  if (!res.ok) throw new Error(body.error ?? `요청이 실패했어요 (${res.status}).`);
  return body;
}

export const when = (value: unknown) => {
  const d = new Date(typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : (value as string | number));
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
};

/** "3분 전"처럼 지금으로부터 얼마나 됐는지. */
export function ago(at: number, now: number): string {
  const sec = Math.max(0, Math.round((now - at) / 1000));
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86400)}일 전`;
}

/**
 * 목록을 불러오는 공통 틀: 불러오는 중, 오류, 다시 불러오기.
 * everyMs를 주면 그 간격으로 저절로 다시 불러온다(탭이 보일 때만).
 */
export function useLoad<T>(path: string, onForbidden: () => void, everyMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    api<T>(path)
      .then((next) => {
        setData(next);
        setError('');
      })
      .catch((e) => (e instanceof Forbidden ? onForbidden() : setError(e instanceof Error ? e.message : '불러오지 못했어요.')));
  }, [path, onForbidden]);
  useEffect(() => {
    reload();
    if (!everyMs) return;
    const t = setInterval(() => document.visibilityState === 'visible' && reload(), everyMs);
    return () => clearInterval(t);
  }, [reload, everyMs]);
  return { data, error, reload, setData };
}

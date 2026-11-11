// 이 브라우저에 기억되는 화면 설정. (소리 설정은 sound.ts가 따로 기억한다.)
import { useSyncExternalStore } from 'react';

const GORE_KEY = 'hama:gore';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(GORE_KEY) !== 'off';
  } catch {
    return true;
  }
}

let gore = read();

export const settings = {
  /** 피 연출을 보여 줄지. 끄면 덜 잔인한 연출(어린이용)이 나온다. */
  get gore(): boolean {
    return gore;
  },
  setGore(on: boolean): void {
    gore = on;
    try {
      localStorage.setItem(GORE_KEY, on ? 'on' : 'off');
    } catch {
      // 저장소를 못 쓰면 이번 방문 동안만 유지된다
    }
    for (const fn of listeners) fn();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useGore(): boolean {
  return useSyncExternalStore(settings.subscribe, () => settings.gore);
}

// 이 브라우저에 기억되는 화면 설정. (소리 설정은 sound.ts가 따로 기억한다.)
import { useSyncExternalStore } from 'react';
import { sound } from './sound.ts';

const GORE_KEY = 'hama:gore';
const WORK_KEY = 'hama:work';
const CHAT_KEY = 'hama:chat';
const listeners = new Set<() => void>();

function read(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'on';
  } catch {
    return fallback;
  }
}

function write(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // 저장소를 못 쓰면 이번 방문 동안만 유지된다
  }
}

let gore = read(GORE_KEY, true);
let work = read(WORK_KEY, false);
let chat = read(CHAT_KEY, true);

/** 업무 모드를 문서 전체에 알린다: CSS가 이 표시를 보고 화면을 바꾸고, 소리는 꺼진다. */
function applyWork(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.mode = work ? 'work' : 'game';
    document.title = work ? '4분기 실적집계.xlsx' : '하마하마';
    // 브라우저 탭의 그림과 주소창 색도 표 문서처럼 바꾼다.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', work ? '#1d6b45' : '#7cc25b');
    let icon = document.querySelector<HTMLLinkElement>('link[data-work-icon]');
    if (work && !icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      icon.dataset.workIcon = '';
      icon.href =
        'data:image/svg+xml,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="#1d6b45"/><path d="M4 5h8M4 8h8M4 11h8M8 5v6" stroke="#fff" stroke-width="1.2"/></svg>',
        );
      document.head.append(icon);
    } else if (!work) icon?.remove();
  }
  sound.setWorkMute(work);
}
applyWork();

export const settings = {
  /** 피 연출을 보여 줄지. 끄면 덜 잔인한 연출(어린이용)이 나온다. */
  get gore(): boolean {
    return gore;
  },
  setGore(on: boolean): void {
    gore = on;
    write(GORE_KEY, on);
    for (const fn of listeners) fn();
  },
  /** 업무 모드: 같은 게임을 스프레드시트처럼 보이는 화면으로 한다(회사·학교용). 소리가 나지 않는다. */
  get work(): boolean {
    return work;
  },
  setWork(on: boolean): void {
    work = on;
    write(WORK_KEY, on);
    applyWork();
    for (const fn of listeners) fn();
  },
  /** 채팅을 보여 줄지. 끄면 남의 글도 보이지 않고 나도 보낼 수 없다. */
  get chat(): boolean {
    return chat;
  },
  setChat(on: boolean): void {
    chat = on;
    write(CHAT_KEY, on);
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

export function useChat(): boolean {
  return useSyncExternalStore(settings.subscribe, () => settings.chat);
}

export function useWork(): boolean {
  return useSyncExternalStore(settings.subscribe, () => settings.work);
}

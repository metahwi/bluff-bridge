import { useSyncExternalStore } from 'react';
import { sound } from './sound.ts';

/** 화면 오른쪽 위에 늘 떠 있는 소리 켜기/끄기 단추. 선택은 이 브라우저에 기억된다. */
export function SoundToggle() {
  const on = useSyncExternalStore(
    (fn) => sound.subscribe(fn),
    () => sound.enabled,
  );
  return (
    <button className="ghost small soundToggle" aria-pressed={on} onClick={() => sound.setEnabled(!on)}>
      {on ? '소리 켜짐' : '소리 꺼짐'}
    </button>
  );
}

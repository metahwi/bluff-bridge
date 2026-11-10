import { useSyncExternalStore } from 'react';
import { sound } from './sound.ts';

/** 소리 켜기/끄기 단추와 음량 막대. 선택은 이 브라우저에 기억된다. */
export function SoundControl({ floating = false }: { floating?: boolean }) {
  // 켜짐 여부와 음량을 한 값으로 묶어 구독한다(음량은 0~100, 꺼져 있으면 음수).
  const snapshot = useSyncExternalStore(
    (fn) => sound.subscribe(fn),
    () => (sound.enabled ? 1 : -1) * (Math.round(sound.volume * 100) + 1),
  );
  const on = snapshot > 0;
  const volume = Math.abs(snapshot) - 1;

  return (
    <div className={'soundControl' + (floating ? ' floating' : '')}>
      <button className="ghost small" aria-pressed={on} onClick={() => sound.setEnabled(!on)}>
        {on ? '소리 켜짐' : '소리 꺼짐'}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={on ? volume : 0}
        aria-label="음량"
        onChange={(e) => sound.setVolume(Number(e.target.value) / 100)}
      />
    </div>
  );
}

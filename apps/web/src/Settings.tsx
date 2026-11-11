import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Sprite } from './pixel.tsx';
import { settings, useGore, useWork } from './settings.ts';
import { sound } from './sound.ts';

const GEAR = ['...ooo...', '.o.ooo.o.', '.ooooooo.', 'ooo...ooo', 'ooo...ooo', 'ooo...ooo', '.ooooooo.', '.o.ooo.o.', '...ooo...'] as const;

/** 켜짐/꺼짐을 바꾸는 한 줄. */
function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="settingRow">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <button className={'small ' + (on ? '' : 'ghost')} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
        {on ? '켜짐' : '꺼짐'}
      </button>
    </div>
  );
}

/**
 * 화면 오른쪽 위의 톱니바퀴. 누르면 설정 창이 열린다: 소리, 음량, 배경 음악, 피 연출.
 * 설정은 모두 이 브라우저에 기억된다.
 */
export function SettingsButton({ floating = false }: { floating?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // 소리 설정 세 가지를 한 값으로 묶어 구독한다.
  const snapshot = useSyncExternalStore(
    (fn) => sound.subscribe(fn),
    () => `${sound.enabled}|${Math.round(sound.volume * 100)}|${sound.musicOn}`,
  );
  const [enabled, volume, musicOn] = snapshot.split('|');
  const gore = useGore();
  const work = useWork();

  // 바깥을 누르거나 Esc를 누르면 닫는다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', onDown);
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('pointerdown', onDown);
      removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={'settings' + (floating ? ' floating' : '')} ref={box}>
      <button className="ghost small gear" aria-label="설정" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Sprite rows={GEAR} palette={{ o: work ? '#ffffff' : '#3a2414' }} scale={2} />
      </button>
      {open && (
        <div className="settingsPanel" role="dialog" aria-label="설정">
          <h3>{work ? '옵션' : '설정'}</h3>
          <Toggle
            label="업무 모드"
            hint={work ? '끄면 원래 게임 화면으로 돌아갑니다.' : '표 계산 화면처럼 보여요. 소리도 꺼져요.'}
            on={work}
            onChange={(on) => settings.setWork(on)}
          />
          {!work && (
            <>
              <Toggle label="소리" on={enabled === 'true'} onChange={(on) => sound.setEnabled(on)} />
              <div className="settingRow">
                <label htmlFor="volume">음량</label>
                <input
                  id="volume"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={enabled === 'true' ? Number(volume) : 0}
                  onChange={(e) => sound.setVolume(Number(e.target.value) / 100)}
                />
              </div>
              <Toggle label="배경 음악" hint="끄면 효과음만 나와요." on={musicOn === 'true'} onChange={(on) => sound.setMusicEnabled(on)} />
              <Toggle label="피 연출" hint="끄면 덜 잔인하게 보여요(어린이용)." on={gore} onChange={(on) => settings.setGore(on)} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

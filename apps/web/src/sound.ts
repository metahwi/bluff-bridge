// 배경 음악과 효과음. 음원 파일 없이 Web Audio로 직접 소리를 만든다(8비트풍).
// 브라우저는 사용자가 한 번 누르기 전에는 소리를 못 내게 하므로, 첫 클릭·키 입력 때 시작한다.

export type Sfx =
  | 'hop'
  | 'step'
  | 'kick'
  | 'roll'
  | 'throw'
  | 'dice'
  | 'cup'
  | 'suspense'
  | 'lie'
  | 'truth'
  | 'whoosh'
  | 'splash'
  | 'crunch'
  | 'munch'
  | 'bone'
  | 'burp'
  | 'win'
  | 'lose';

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'C5' 같은 음 이름을 주파수로. */
function hz(name: string): number {
  const midi = 12 * (Number(name.slice(-1)) + 1) + NOTE[name[0]!]! + (name[1] === '#' ? 1 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
}

// 8마디 반복곡. 한 마디에 8분음표 8개, '.'은 쉼표.
// 화음: C | Am | F | G | C | Am | F G | C
const MELODY = [
  'E5 G5 C6 G5 E5 G5 C6 .',
  'E5 A5 C6 A5 E5 A5 C6 .',
  'F5 A5 C6 A5 F5 A5 D6 C6',
  'B5 G5 D5 G5 B5 D6 B5 .',
  'C6 . G5 E5 G5 . C6 E6',
  'D6 C6 A5 E5 A5 . C6 A5',
  'F5 A5 C6 F6 D6 B5 G5 B5',
  'C6 . G5 . C5 . . .',
].flatMap((bar) => bar.split(' '));
// 뒤뚱거리는 하마 같은 저음: 4분음표로 근음과 5음을 오간다.
const BASS = ['C3 G3 C3 G3', 'A2 E3 A2 E3', 'F2 C3 F2 C3', 'G2 D3 G2 D3', 'C3 G3 C3 G3', 'A2 E3 A2 E3', 'F2 C3 G2 D3', 'C3 G3 C3 .'].flatMap(
  (bar) => bar.split(' '),
);
const STEP = 60 / 116 / 2; // 8분음표 하나의 길이(초). 빠르기 116.

const STORAGE_KEY = 'hama:sound';
const VOLUME_KEY = 'hama:volume';

class Sound {
  private ctx: AudioContext | null = null;
  private music: GainNode | null = null;
  private fx: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private step = 0;
  private nextTime = 0;
  private noiseBuffer: AudioBuffer | null = null;
  private listeners = new Set<() => void>();
  private master: GainNode | null = null;
  enabled = true;
  /** 전체 음량 0~1. */
  volume = 0.7;

  constructor() {
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
      const saved = Number(localStorage.getItem(VOLUME_KEY) ?? NaN);
      if (saved >= 0 && saved <= 1) this.volume = saved;
    } catch {
      // 저장소를 못 쓰면 기본값(켬)
    }
    if (typeof window === 'undefined') return;
    const unlock = () => this.unlock();
    addEventListener('pointerdown', unlock, { passive: true });
    addEventListener('keydown', unlock);
    // 탭을 가리면 음악을 멈추고, 돌아오면 다시 튼다.
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (this.enabled) void this.ctx.resume();
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      // 무시
    }
    if (on) this.unlock();
    else void this.ctx?.suspend();
    for (const fn of this.listeners) fn();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    try {
      localStorage.setItem(VOLUME_KEY, String(this.volume));
    } catch {
      // 무시
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.volume ** 2, this.ctx.currentTime, 0.03);
    if (this.volume > 0 && !this.enabled) return this.setEnabled(true); // 끈 상태에서 올리면 켠다
    for (const fn of this.listeners) fn();
  }

  /** 주사위 힘을 모으는 동안 나는 소리. 힘이 셀수록 높은 음. */
  charge(power: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.fx || !this.enabled || ctx.state !== 'running') return;
    this.tone(ctx, this.fx, 'square', 260 + power * 900, ctx.currentTime + 0.005, 0.045, 0.09);
  }

  /** 사용자의 첫 입력 때 호출된다. 오디오를 만들고 음악을 시작한다. */
  private unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.build(this.ctx);
      this.nextTime = this.ctx.currentTime + 0.1;
      this.timer = setInterval(() => this.schedule(), 60);
    }
    if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
  }

  private build(ctx: BaseAudioContext): void {
    // 갑자기 큰 소리가 나도 찢어지지 않게 눌러 준다.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 8;
    limiter.connect(ctx.destination);
    // 전체 음량(사용자가 조절). 귀에 들리는 크기는 제곱에 가깝게 느껴져서 값을 제곱해 쓴다.
    this.master = ctx.createGain();
    this.master.gain.value = this.volume ** 2;
    this.master.connect(limiter);
    this.music = ctx.createGain();
    this.music.gain.value = 0.5;
    this.music.connect(this.master);
    this.fx = ctx.createGain();
    this.fx.gain.value = 1.4;
    this.fx.connect(this.master);

    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
  }

  /** 한 음. slideTo를 주면 그 주파수로 미끄러진다. */
  private tone(ctx: BaseAudioContext, out: AudioNode, type: OscillatorType, freq: number, at: number, dur: number, vol: number, slideTo?: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(vol, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** 잡음 한 덩이(타악기, 물소리, 씹는 소리). */
  private hiss(ctx: BaseAudioContext, out: AudioNode, at: number, dur: number, vol: number, filter: BiquadFilterType, freq: number, sweepTo?: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, at);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(gain).connect(out);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.02);
  }

  /** 음악의 한 칸(8분음표)을 예약한다. */
  private playStep(ctx: BaseAudioContext, out: AudioNode, i: number, at: number): void {
    const note = MELODY[i % MELODY.length]!;
    if (note !== '.') this.tone(ctx, out, 'square', hz(note), at, STEP * 0.92, 0.1);
    if (i % 2 === 0) {
      const bass = BASS[(i / 2) % BASS.length]!;
      if (bass !== '.') this.tone(ctx, out, 'triangle', hz(bass), at, STEP * 1.7, 0.3);
    }
    if (i % 4 === 0) this.tone(ctx, out, 'sine', 150, at, 0.12, 0.3, 45); // 쿵
    if (i % 2 === 1) this.hiss(ctx, out, at, 0.04, 0.07, 'highpass', 7000); // 칙
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.music || ctx.state !== 'running') return;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05; // 탭을 오래 가렸다 돌아온 경우
    while (this.nextTime < ctx.currentTime + 0.25) {
      this.playStep(ctx, this.music, this.step++, this.nextTime);
      this.nextTime += STEP;
    }
  }

  /** 추락 연출 동안 음악을 줄였다가 되돌린다. */
  duck(on: boolean): void {
    if (!this.ctx || !this.music) return;
    this.music.gain.cancelScheduledValues(this.ctx.currentTime);
    this.music.gain.linearRampToValueAtTime(on ? 0.08 : 0.5, this.ctx.currentTime + 0.4);
  }

  play(name: Sfx): void {
    const ctx = this.ctx;
    if (!ctx || !this.fx || !this.enabled || ctx.state !== 'running') return;
    this.render(ctx, this.fx, name, ctx.currentTime + 0.01);
  }

  private render(ctx: BaseAudioContext, out: AudioNode, name: Sfx, t: number): void {
    switch (name) {
      case 'hop':
        this.tone(ctx, out, 'square', 520, t, 0.09, 0.34, 880);
        break;
      case 'roll':
        for (let i = 0; i < 6; i++) this.hiss(ctx, out, t + i * 0.055 + Math.random() * 0.02, 0.035, 0.35, 'bandpass', 1800 + Math.random() * 2600);
        break;
      case 'step':
        // 나무 널빤지를 밟는 소리: 낮은 통 + 살짝 삐걱
        this.tone(ctx, out, 'triangle', 190 + Math.random() * 50, t, 0.09, 0.55, 95);
        this.hiss(ctx, out, t, 0.03, 0.35, 'bandpass', 1100 + Math.random() * 500);
        this.tone(ctx, out, 'sawtooth', 620 + Math.random() * 180, t + 0.03, 0.06, 0.05, 480);
        break;
      case 'kick':
        // 뻥!
        this.tone(ctx, out, 'sine', 210, t, 0.2, 0.9, 48);
        this.hiss(ctx, out, t, 0.06, 0.8, 'lowpass', 2200);
        this.tone(ctx, out, 'square', 900, t + 0.02, 0.07, 0.15, 300);
        break;
      case 'throw':
        this.tone(ctx, out, 'sine', 300, t, 0.22, 0.3, 1100);
        break;
      case 'dice':
        // 주사위가 나무판에 부딪히는 소리
        this.hiss(ctx, out, t, 0.05, 1.0, 'bandpass', 2400 + Math.random() * 1200);
        this.tone(ctx, out, 'triangle', 420 + Math.random() * 160, t, 0.07, 0.5, 200);
        break;
      case 'cup':
        this.tone(ctx, out, 'sine', 160, t, 0.16, 0.6, 60);
        this.hiss(ctx, out, t, 0.05, 0.4, 'lowpass', 900);
        break;
      case 'suspense':
        // 점점 빨라지는 심장 소리
        for (let i = 0, at = 0; i < 9; i++, at += 0.2 - i * 0.014) this.tone(ctx, out, 'sine', 110, t + at, 0.11, 0.5, 55);
        break;
      case 'lie':
        this.tone(ctx, out, 'sawtooth', hz('G4'), t, 0.2, 0.22, hz('F#4'));
        this.tone(ctx, out, 'sawtooth', hz('C#4'), t + 0.2, 0.42, 0.24, hz('C4') * 0.94);
        break;
      case 'truth':
        this.tone(ctx, out, 'square', hz('C5'), t, 0.12, 0.16);
        this.tone(ctx, out, 'square', hz('G5'), t + 0.12, 0.3, 0.16);
        break;
      case 'whoosh':
        this.tone(ctx, out, 'sine', 1200, t, 0.45, 0.4, 180);
        break;
      case 'splash':
        this.hiss(ctx, out, t, 0.5, 0.6, 'lowpass', 3200, 500);
        this.hiss(ctx, out, t + 0.03, 0.22, 0.3, 'highpass', 4500);
        break;
      case 'crunch':
        // 뼈가 부서지는 소리: 날카로운 잡음 두 번 + 낮게 떨어지는 쿵
        this.hiss(ctx, out, t, 0.09, 1.0, 'bandpass', 1400);
        this.hiss(ctx, out, t + 0.07, 0.16, 0.8, 'bandpass', 700, 250);
        this.tone(ctx, out, 'square', 110, t, 0.3, 0.5, 36);
        this.tone(ctx, out, 'sine', 70, t, 0.4, 0.7, 30);
        break;
      case 'munch':
        this.hiss(ctx, out, t, 0.07, 0.5, 'bandpass', 900, 400);
        this.tone(ctx, out, 'sine', 95, t, 0.1, 0.4, 50);
        break;
      case 'bone':
        this.tone(ctx, out, 'sine', 900, t, 0.1, 0.2, 1500);
        this.tone(ctx, out, 'sine', 1300, t + 0.62, 0.08, 0.14, 700); // 물에 퐁당
        break;
      case 'burp': {
        // 낮게 떨리며 내려가는 소리
        const osc = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        const gain = ctx.createGain();
        const lowpass = ctx.createBiquadFilter();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(62, t + 0.55);
        lfo.frequency.value = 23;
        depth.gain.value = 0.16;
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 520;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.34, t + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        lfo.connect(depth).connect(gain.gain);
        osc.connect(lowpass).connect(gain).connect(out);
        osc.start(t);
        lfo.start(t);
        osc.stop(t + 0.65);
        lfo.stop(t + 0.65);
        break;
      }
      case 'win':
        ['C5', 'E5', 'G5', 'C6', 'E6'].forEach((n, i) => this.tone(ctx, out, 'square', hz(n), t + i * 0.1, i === 4 ? 0.5 : 0.12, 0.16));
        break;
      case 'lose':
        ['G4', 'E4', 'C4', 'A3'].forEach((n, i) => this.tone(ctx, out, 'triangle', hz(n), t + i * 0.18, i === 3 ? 0.6 : 0.2, 0.3));
        break;
    }
  }

  /**
   * 개발용 점검: 소리를 실제로 재생하지 않고 계산만 해서 음량을 잰다.
   * peak가 1에 가까우면 찢어지고, rms가 0에 가까우면 안 들린다.
   */
  async measure(what: 'music' | Sfx): Promise<{ peak: number; rms: number; seconds: number }> {
    const seconds = what === 'music' ? STEP * 64 : 1.5;
    const ctx = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
    const saved = { music: this.music, fx: this.fx, noise: this.noiseBuffer, master: this.master };
    this.build(ctx);
    if (what === 'music') for (let i = 0; i < 64; i++) this.playStep(ctx, this.music!, i, i * STEP);
    else this.render(ctx, this.fx!, what, 0.01);
    const data = (await ctx.startRendering()).getChannelData(0);
    this.music = saved.music;
    this.fx = saved.fx;
    this.noiseBuffer = saved.noise;
    this.master = saved.master;
    let peak = 0;
    let sum = 0;
    for (const v of data) {
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
    }
    return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / data.length).toFixed(4), seconds: +seconds.toFixed(2) };
  }
}

export const sound = new Sound();
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __sound?: Sound }).__sound = sound;

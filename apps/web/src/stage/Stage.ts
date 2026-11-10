// 게임판을 그리는 3D 무대. React와 무관하게 동작하고, StageView.tsx가 이 클래스를 감싼다.
// 장면을 낮은 해상도로 그린 뒤 확대해서 픽셀 아트처럼 보이게 한다.
import * as THREE from 'three';
import { BANK_TOP, BRIDGE_HALF, box, deckY, toon, makeBanks, makeBone, makeBridge, makeFlag, makeHippo, makeLilies, makePawn, plankX } from './models.ts';
import type { HippoRig } from './models.ts';
import { MAX_RIPPLES, makeWater } from './water.ts';
import { DiceHud } from './dice.ts';
import type { DiceState } from './dice.ts';

export interface StageState {
  length: number;
  /** pawns[i] = i번 플레이어의 말 위치. 0 = 출발 지점, 1~length = 널빤지, null = 다리 위에 없음. */
  pawns: (number | null)[];
  crowd: { reserve: number; finished: number }[];
  /** 지금 차례인 플레이어(말이 콩콩 뛴다). */
  active: number | null;
  /** 화면 아래 쟁반의 주사위. 없으면 그리지 않는다. */
  dice?: DiceState;
}

export interface ChompInfo {
  /** 떨어지는 말의 주인. */
  fallen: number;
  /** 같이 긴장하는 상대(의심한 사람 또는 굴린 사람). */
  other: number | null;
}

/** 추락 연출의 단계. 화면 위 글자(HTML)를 바꾸는 데 쓴다. */
export type ChompPhase = 'suspense' | 'reveal' | 'fall' | 'kick' | 'rope' | 'push' | 'chomp' | 'chew' | 'burp' | 'done';

export interface StageLabel {
  key: string;
  text: string;
  kind: 'plank' | 'sign';
  /** 캔버스 왼쪽 위에서의 위치(px). */
  x: number;
  y: number;
}

interface Task {
  start: number;
  dur: number;
  fn: (k: number) => void;
  ease: (k: number) => number;
}

interface Hippo {
  rig: HippoRig;
  home: THREE.Vector3;
  scale: number;
  phase: number;
  yaw: number;
  blinkAt: number;
  open: number;
  /** 연출에 뽑혀 직접 조종되는 중이면 true(평소 움직임을 멈춘다). */
  acting: boolean;
}

interface Pawn {
  group: THREE.Group;
  pos: number | null;
  /** 깡충 이동이나 연출 중이면 true(제자리 움직임을 멈춘다). */
  moving: boolean;
  base: THREE.Vector3;
}

interface View {
  x: number;
  y: number;
  z: number;
  zoom: number;
}

const linear = (k: number) => k;
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeIn = (k: number) => k * k * k;
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * 화면에 가로로 보이는 범위의 절반(세계 단위).
 * 좁은 화면(휴대폰)에서는 다리와 그 양옆만, 넓은 화면에서는 마을까지 보이게 화면 비율에 따라 정한다.
 */
const HALF_WIDTH_MIN = 8.3;
const HALF_WIDTH_MAX = 11.2;
const halfWidthFor = (aspect: number) => Math.min(HALF_WIDTH_MAX, Math.max(HALF_WIDTH_MIN, 6.6 * aspect));
const CAMERA_ELEVATION = (40 * Math.PI) / 180;
/** 카메라를 살짝 옆으로 돌려 물체의 옆면이 보이게 한다. */
const CAMERA_YAW = -0.13;
/** 가로 시야각의 절반. 좁게 잡아 원근이 과하지 않게 한다. */
const HALF_FOV = (13 * Math.PI) / 180;
const VIEW: View = { x: 0, y: 0.5, z: 0.7, zoom: 1 };
/** 햇빛 방향. 왼쪽 뒤 위에서 비춰 그림자가 카메라 쪽 오른쪽으로 떨어진다. */
const SUN = new THREE.Vector3(-6, 12, -3.4);

/** 강에 떠 있는 하마들의 자리: [x, z, 크기]. 다리에 가려지는 곳은 비워 둔다. */
const HERD: [number, number, number][] = [
  // 다리 바로 밑의 세 마리: 머리 위로 지나가는 말을 올려다보다가, 떨어지면 가장 가까운 녀석이 문다
  [-3.0, 1.5, 1.0],
  [0.1, 1.62, 1.05],
  [3.0, 1.45, 0.95],
  // 다리 뒤쪽(먼 곳)
  [-2.2, -5.2, 0.95],
  [2.4, -4.4, 1.0],
  // 앞쪽(가까운 곳)
  [-1.9, 5.0, 1.05],
  [2.6, 4.7, 1.0],
];
/** 다리 밑 하마인지(자리의 z로 판단). */
const isUnderBridge = (home: THREE.Vector3) => Math.abs(home.z - 1.5) < 0.8;

const PARTICLES = 220;
/** 다리 위 말의 크기. 4인이 같은 칸에 서도 들어가도록 작게. */
const PAWN_SIZE = 1.15;
/** 언덕에서 기다리거나 도착한 말의 크기. */
const CROWD_SIZE = 0.8;
/** 추락 연출에서 하마가 솟구치는 자리(다리 앞쪽). 다리에 가려지지 않아야 한다. */
const LUNGE_Z = 1.5;

export class Stage {
  onPhase: (phase: ChompPhase) => void = () => {};
  onLabels: (labels: StageLabel[]) => void = () => {};
  /** 장면 속 움직임에 맞춰 낼 효과음. */
  onSfx: (name: 'hop' | 'step' | 'kick' | 'rope' | 'push' | 'splash' | 'munch' | 'bone' | 'throw' | 'dice' | 'cup') => void = () => {};
  private dice = new DiceHud();

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(20, 1, 1, 200);
  private water = makeWater();
  private planks: THREE.Mesh[] = [];
  private bridge: THREE.Group | null = null;
  private signs: THREE.Group[];
  private hippos: Hippo[] = [];
  private pawns: Pawn[] = [];
  private crowdGroup = new THREE.Group();
  private crowdKey = '';
  private bone = makeBone();

  private particles: THREE.InstancedMesh;
  private pPos = new Float32Array(PARTICLES * 3);
  private pVel = new Float32Array(PARTICLES * 3);
  private pLife = new Float32Array(PARTICLES);
  private pSize = new Float32Array(PARTICLES);
  private pNext = 0;

  private state: StageState | null = null;
  private pending: StageState | null = null;
  private busy = false;
  private tasks: Task[] = [];
  private time = 0;
  private last = 0;
  private freeze = 0;
  private shake = 0;
  private paused = false;
  /** 카메라와 장면 사이의 거리. 화면 비율에 따라 resize에서 정한다. */
  private distance = HALF_WIDTH_MIN / Math.tan(HALF_FOV);
  private view: View = { ...VIEW };
  private yawnAt = 4;
  private raf = 0;
  private cssW = 1;
  private cssH = 1;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private dummy = new THREE.Object3D();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false; // 게임 장면 위에 주사위 장면을 덧그리기 위해 직접 지운다
    this.dice.onSfx = (name) => this.onSfx(name);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap; // 번지지 않는 각진 그림자
    this.scene.background = new THREE.Color('#2f8aa6');

    this.scene.add(new THREE.HemisphereLight('#fff6dc', '#3f6f86', 1.25));
    const sun = new THREE.DirectionalLight('#ffe9bf', 2.2);
    sun.position.copy(SUN);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -18;
    sc.right = 18;
    sc.top = 16;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 40;
    sun.shadow.bias = -0.002;
    this.scene.add(sun);

    this.scene.add(this.water.mesh);
    const banks = makeBanks();
    this.signs = banks.signs;
    this.scene.add(banks.group, makeLilies(), this.crowdGroup);

    // 다리 그림자가 물에 떨어지는 자리(햇빛 방향으로 밀린다)
    const dx = (-SUN.x / SUN.y) * 0.9;
    const dz = (-SUN.z / SUN.y) * 0.9;
    this.water.uniforms.uShadow.value.set(-BRIDGE_HALF + dx - 0.2, BRIDGE_HALF + dx, -0.86 + dz, 0.86 + dz);

    HERD.forEach(([x, z, scale], i) => {
      const rig = makeHippo();
      rig.root.scale.setScalar(scale);
      rig.root.position.set(x, -0.2 * scale, z);
      this.scene.add(rig.root);
      this.hippos.push({ rig, home: new THREE.Vector3(x, -0.2 * scale, z), scale, phase: i * 1.7, yaw: 0, blinkAt: 1 + i * 0.6, open: 0, acting: false });
    });

    this.bone.visible = false;
    this.scene.add(this.bone);

    this.particles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), PARTICLES);
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles.frustumCulled = false;
    for (let i = 0; i < PARTICLES; i++) this.particles.setColorAt(i, new THREE.Color('#ffffff'));
    this.scene.add(this.particles);

    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }

  // ───────── 크기와 카메라 ─────────

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.cssW = w;
    this.cssH = h;
    // 그림 한 점이 화면의 정수 배 크기가 되도록 내부 해상도를 정한다(가로 약 400점).
    const device = w * Math.min(devicePixelRatio || 1, 3);
    const k = Math.max(1, Math.round(device / 400));
    this.renderer.setSize(Math.round(device / k), Math.round((device / k) * (h / w)), false);
    // 가로로 보이는 범위를 고정하고, 세로 시야각을 화면 비율에 맞춘다.
    this.camera.aspect = w / h;
    this.camera.fov = (2 * Math.atan(Math.tan(HALF_FOV) * (h / w)) * 180) / Math.PI;
    this.distance = halfWidthFor(w / h) / Math.tan(HALF_FOV);
    this.dice.resize(w / h);
    this.placeCamera(0, 0);
    this.emitLabels();
  }

  private placeCamera(sx: number, sy: number): void {
    const target = new THREE.Vector3(this.view.x + sx, this.view.y + sy, this.view.z);
    const flat = Math.cos(CAMERA_ELEVATION) * this.distance;
    this.camera.position.set(
      target.x + Math.sin(CAMERA_YAW) * flat,
      target.y + Math.sin(CAMERA_ELEVATION) * this.distance,
      target.z + Math.cos(CAMERA_YAW) * flat,
    );
    this.camera.lookAt(target);
    this.camera.zoom = this.view.zoom;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private project(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.cssW, y: ((1 - v.y) / 2) * this.cssH };
  }

  /** 널빤지 번호와 표지판 글자의 화면 위치. 카메라가 기본 자리에 있을 때만 맞는다. */
  private emitLabels(): void {
    if (!this.state) return;
    const save = { ...this.view };
    this.view = { ...VIEW };
    this.placeCamera(0, 0);
    const labels: StageLabel[] = [];
    for (let n = 1; n <= this.state.length; n++) {
      const x = plankX(n, this.state.length);
      labels.push({ key: 'p' + n, text: String(n), kind: 'plank', ...this.project(x, deckY(x) + 0.08, 0.62) });
    }
    const [start, goal] = this.signs;
    labels.push({ key: 'start', text: '출발', kind: 'sign', ...this.project(start!.position.x, BANK_TOP + 0.95, start!.position.z + 0.1) });
    labels.push({ key: 'goal', text: '도착', kind: 'sign', ...this.project(goal!.position.x, BANK_TOP + 0.95, goal!.position.z + 0.1) });
    this.view = save;
    this.placeCamera(0, 0);
    this.onLabels(labels);
  }

  // ───────── 시간 ─────────

  private tween(delay: number, dur: number, fn: (k: number) => void, ease: (k: number) => number = linear): void {
    this.tasks.push({ start: this.time + delay, dur: Math.max(dur, 0.0001), fn, ease });
  }

  private at(delay: number, fn: () => void): void {
    this.tasks.push({ start: this.time + delay, dur: 0.0001, fn: (k) => k >= 1 && fn(), ease: linear });
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.paused ? 0 : Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
    this.dice.update(dt, this.time);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (!this.busy) this.dice.render(this.renderer); // 추락 연출 중에는 주사위를 치운다
  };

  /** 주사위 힘을 모으는 중(0~1). null이면 멈춘다. */
  chargeDice(power: number | null): void {
    this.dice.setCharge(power);
  }

  /** 주사위를 던진다. 나온 눈은 다음 setState의 dice.face로 들어온다. */
  throwDice(power: number): void {
    this.dice.throw(power);
  }

  private step(elapsed: number): void {
    let dt = elapsed;
    if (this.freeze > 0) {
      // 타격 순간 잠깐 멈춤
      this.freeze -= dt;
      dt = 0;
    }
    this.time += dt;

    for (let i = this.tasks.length - 1; i >= 0; i--) {
      const task = this.tasks[i]!;
      if (this.time < task.start) continue;
      const k = Math.min(1, (this.time - task.start) / task.dur);
      task.fn(task.ease(k));
      if (k >= 1) this.tasks.splice(this.tasks.indexOf(task), 1);
    }

    this.updateHippos(dt);
    this.updatePawns();
    this.updateParticles(dt);
    this.water.uniforms.uT.value = this.time;
    const blood = this.water.uniforms.uBlood.value;
    if (!this.busy && blood.w > 0) blood.w = Math.max(0, blood.w - dt / 16);

    let sx = 0;
    let sy = 0;
    if (this.shake > 0.001 && !this.paused) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.004, dt);
    }
    this.placeCamera(sx, sy);
  }

  /** 디자인 작업용: 지금부터 seconds초 뒤의 장면으로 건너뛰고 멈춘다(스크린샷을 찍기 위해). */
  debugSeek(seconds: number): void {
    const end = this.time + seconds;
    while (this.time < end) this.step(1 / 60);
    this.paused = true;
  }

  // ───────── 하마 ─────────

  private updateHippos(dt: number): void {
    const t = this.reduced ? 0 : this.time;
    const rip = this.water.uniforms.uRip.value;

    // 가끔 한 마리가 하품을 한다
    if (!this.busy && !this.reduced && this.time > this.yawnAt) {
      this.yawnAt = this.time + 5 + Math.random() * 5;
      const idle = this.hippos.filter((h) => !h.acting);
      const h = idle[Math.floor(Math.random() * idle.length)];
      if (h) {
        this.tween(0, 0.7, (k) => (h.open = 0.85 * k), easeOut);
        this.tween(1.3, 0.35, (k) => (h.open = 0.85 * (1 - k)), easeIn);
      }
    }

    // 다리 위의 말(차례인 말 우선)을 눈으로 쫓는다
    const watched = this.pawns.find((p, i) => p.pos && this.state?.active === i) ?? this.pawns.find((p) => p.pos);

    this.hippos.forEach((h, i) => {
      const root = h.rig.root;
      if (!h.acting) {
        const bob = Math.sin(t * 1.3 + h.phase) * 0.035;
        root.position.x = lerp(root.position.x, h.home.x + Math.sin(t * 0.21 + h.phase) * 0.25, Math.min(1, dt * 1.5));
        root.position.z = lerp(root.position.z, h.home.z + Math.cos(t * 0.17 + h.phase) * 0.2, Math.min(1, dt * 1.5));
        root.position.y = lerp(root.position.y, h.home.y + bob + h.open * 0.22, Math.min(1, dt * 4));
        let want = 0;
        let lookUp = 0;
        if (watched) {
          const dx = watched.group.position.x - root.position.x;
          const dz = watched.group.position.z - root.position.z;
          // 다리 밑 하마는 바로 위의 말을 고개 들어 올려다본다
          if (isUnderBridge(h.home) && Math.abs(dx) < 1.6) lookUp = 0.4 * (1 - Math.abs(dx) / 1.6);
          want = THREE.MathUtils.clamp(Math.atan2(dx, dz), -1.1, 1.1);
          if (dz < 0) want = THREE.MathUtils.clamp(dx * 0.12, -0.5, 0.5); // 다리 앞쪽 하마는 카메라를 본 채 살짝만
        }
        h.yaw = lerp(h.yaw, want, Math.min(1, dt * 1.2));
        root.rotation.y = h.yaw;
        root.rotation.x = lerp(root.rotation.x, -h.open * 0.25 - lookUp, Math.min(1, dt * 4));
      }
      h.rig.setOpen(h.open);

      if (this.time > h.blinkAt) {
        const k = (this.time - h.blinkAt) / 0.16;
        h.rig.setBlink(k < 1 ? Math.sin(k * Math.PI) : 0);
        if (k >= 1) h.blinkAt = this.time + 2 + Math.random() * 4;
      }
      for (const [e, ear] of h.rig.ears.entries()) ear.rotation.z = Math.sin(t * 9 + h.phase + e) > 0.96 ? (e ? -0.5 : 0.5) : 0;

      // 머리가 물 위에 나와 있을 때만 물결을 그린다
      if (i < MAX_RIPPLES) {
        const out = root.position.y > -0.9 * h.scale && root.position.y < 0.2;
        rip[i]!.set(root.position.x, root.position.z + 0.45 * h.scale, out ? 1.05 * h.scale : 0, h.phase * 0.13);
      }
    });
  }

  // ───────── 말 ─────────

  private spot(player: number, pos: number, length: number): THREE.Vector3 {
    // 같은 칸에 서도 겹치지 않게 앞뒤로 벌려 세운다(널빤지 깊이 1.7 안에서)
    const lane = (player - (this.pawns.length - 1) / 2) * Math.min(0.9, 1.3 / Math.max(1, this.pawns.length - 1));
    if (pos <= 0) return new THREE.Vector3(-BRIDGE_HALF - 0.75, BANK_TOP, lane);
    if (pos > length) return new THREE.Vector3(BRIDGE_HALF + 0.75, BANK_TOP, lane);
    const x = plankX(pos, length);
    return new THREE.Vector3(x, deckY(x) + 0.07, lane);
  }

  private hop(p: Pawn, from: THREE.Vector3, to: THREE.Vector3, delay: number, dur: number): void {
    this.at(delay, () => this.onSfx('hop'));
    // 다리 널빤지에 내려앉으면 나무 소리
    if (Math.abs(to.x) < BRIDGE_HALF) this.at(delay + dur, () => this.onSfx('step'));
    this.tween(delay, dur, (k) => {
      p.group.position.lerpVectors(from, to, k);
      p.group.position.y += Math.sin(k * Math.PI) * 0.55;
      p.group.scale.set(1, 1 + Math.sin(k * Math.PI) * 0.18, 1);
    });
  }

  private updatePawns(): void {
    const t = this.reduced ? 0 : this.time;
    this.pawns.forEach((p, i) => {
      if (p.moving || p.pos === null) return;
      const active = this.state?.active === i && !this.busy;
      const bounce = active ? Math.abs(Math.sin(t * 6)) * 0.16 : 0;
      p.group.position.set(p.base.x, p.base.y + bounce, p.base.z);
      const squash = active ? 1 + Math.sin(t * 12) * 0.06 : 1 + Math.sin(t * 2.4 + i) * 0.03;
      p.group.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    });
    for (const [i, m] of this.crowdGroup.children.entries()) {
      if (m.userData.happy) m.position.y = BANK_TOP + Math.abs(Math.sin(t * 5 + i)) * 0.22;
    }
  }

  setState(next: StageState): void {
    if (this.busy) {
      this.pending = next;
      return;
    }
    const first = !this.state;
    const prev = this.state;
    this.state = next;
    this.dice.set(next.dice ?? { mode: 'hidden', face: null });

    if (!this.bridge || prev?.length !== next.length) {
      if (this.bridge) this.scene.remove(this.bridge);
      const b = makeBridge(next.length);
      this.bridge = b.group;
      this.planks = b.planks;
      this.scene.add(b.group);
    }

    while (this.pawns.length < next.pawns.length) {
      const body = makePawn(this.pawns.length);
      body.scale.setScalar(PAWN_SIZE);
      const group = new THREE.Group(); // 크기는 안쪽에 두고, 바깥 그룹으로 찌그러뜨리기·튀기기를 한다
      group.add(body);
      group.rotation.y = 0.35;
      group.visible = false;
      this.scene.add(group);
      this.pawns.push({ group, pos: null, moving: false, base: new THREE.Vector3() });
    }

    this.pawns.forEach((p, i) => {
      const pos = next.pawns[i] ?? null;
      const from = p.pos;
      p.pos = pos;
      if (pos === null) {
        p.group.visible = false;
        return;
      }
      p.base.copy(this.spot(i, pos, next.length));
      p.group.visible = true;
      if (first || this.reduced || from === pos) {
        p.group.position.copy(p.base);
      } else if (from !== null && pos > from) {
        // 한 칸씩 깡충깡충
        p.moving = true;
        for (let s = from; s < pos; s++) this.hop(p, this.spot(i, s, next.length), this.spot(i, s + 1, next.length), (s - from) * 0.17, 0.17);
        this.at((pos - from) * 0.17 + 0.02, () => (p.moving = false));
      } else {
        // 새 말이 출발 지점에 나타난다
        p.moving = true;
        p.group.position.copy(p.base);
        this.tween(0, 0.3, (k) => p.group.scale.setScalar(Math.max(0.001, k)), easeOut);
        this.at(0.32, () => (p.moving = false));
      }
    });

    this.buildCrowd(next);
    if (first || prev?.length !== next.length) this.emitLabels();
  }

  /**
   * 팀이 줄 서는 자리. side -1 = 출발 쪽(대기), +1 = 도착 쪽(완주).
   * 팀 0·2는 길 뒤쪽(z < 0), 팀 1·3은 앞쪽(z > 0)에 세 마리씩 줄을 선다. 다리에 가까운 자리부터 채운다.
   */
  private campSpot(player: number, index: number, side: -1 | 1): THREE.Vector3 {
    const dir = player % 2 === 0 ? -1 : 1;
    const zBase = dir * (1.75 + Math.floor(player / 2) * 1.75);
    return new THREE.Vector3(side * (BRIDGE_HALF + 0.7 + (index % 3) * 0.66), BANK_TOP, zBase + dir * Math.floor(index / 3) * 0.7);
  }

  /** 언덕 위에 줄지어 선 말들과 팀 깃발. 먹히거나 출발하면 그만큼 줄어든다. */
  private buildCrowd(s: StageState): void {
    const key = JSON.stringify(s.crowd);
    if (key === this.crowdKey) return;
    this.crowdKey = key;
    this.crowdGroup.clear();
    s.crowd.forEach((c, player) => {
      for (const side of [-1, 1] as const) {
        const count = side === -1 ? c.reserve : c.finished;
        for (let i = 0; i < count; i++) {
          const m = makePawn(player);
          m.scale.setScalar(CROWD_SIZE);
          m.position.copy(this.campSpot(player, i, side));
          m.rotation.y = side === -1 ? 0.8 : -0.5;
          m.userData.happy = side === 1; // 완주한 말은 신나서 뛴다
          this.crowdGroup.add(m);
        }
        const flag = makeFlag(player);
        const at = this.campSpot(player, 2, side);
        flag.position.set(at.x + side * 0.6, BANK_TOP, at.z + (player % 2 === 0 ? -0.35 : 0.35));
        this.crowdGroup.add(flag);
      }
    });
  }

  // ───────── 입자(물보라, 피) ─────────

  private burst(at: THREE.Vector3, count: number, colors: string[], speed: number, up: number, size: number): void {
    const color = new THREE.Color();
    for (let n = 0; n < count; n++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const r = speed * (0.35 + Math.random() * 0.65);
      this.pPos.set([at.x, at.y, at.z], i * 3);
      this.pVel.set([Math.cos(a) * r, up * (0.5 + Math.random() * 0.7), Math.sin(a) * r * 0.8], i * 3);
      this.pLife[i] = 0.7 + Math.random() * 0.7;
      this.pSize[i] = size * (0.6 + Math.random() * 0.8);
      this.particles.setColorAt(i, color.set(colors[Math.floor(Math.random() * colors.length)]!));
    }
    this.particles.instanceColor!.needsUpdate = true;
  }

  private updateParticles(dt: number): void {
    for (let i = 0; i < PARTICLES; i++) {
      const o = i * 3;
      if (this.pLife[i]! > 0) {
        this.pLife[i]! -= dt;
        this.pVel[o + 1]! -= 16 * dt;
        this.pPos[o]! += this.pVel[o]! * dt;
        this.pPos[o + 1]! += this.pVel[o + 1]! * dt;
        this.pPos[o + 2]! += this.pVel[o + 2]! * dt;
        if (this.pPos[o + 1]! < 0) this.pLife[i] = 0; // 물에 닿으면 사라진다
      }
      const s = this.pLife[i]! > 0 ? this.pSize[i]! : 0;
      this.dummy.position.set(this.pPos[o]!, this.pPos[o + 1]!, this.pPos[o + 2]!);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.particles.setMatrixAt(i, this.dummy.matrix);
    }
    this.particles.instanceMatrix.needsUpdate = true;
  }

  // ───────── 추락 연출 ─────────

  private moveCamera(delay: number, dur: number, to: View): void {
    let from: View | null = null;
    this.tween(delay, dur, (k) => {
      from ??= { ...this.view };
      this.view.x = lerp(from.x, to.x, k);
      this.view.y = lerp(from.y, to.y, k);
      this.view.z = lerp(from.z, to.z, k);
      this.view.zoom = lerp(from.zoom, to.zoom, k);
    }, easeInOut);
  }

  /**
   * 뻥이 걸렸을 때(또는 의심이 틀렸을 때)의 장면. 말이 어디 있었느냐에 따라 두 가지다.
   *  - 다리 위: 널빤지가 앞으로 꺼지며 말이 난간 너머로 튕겨 나간다.
   *  - 출발 지점(육지): 상대 팀 말이 달려와 뻥 차서 강으로 날려 보낸다.
   * 어느 쪽이든 다리 밑 세 마리 중 가장 가까운 하마가 헤엄쳐 와 솟구쳐 물고, 씹고, 뼈를 뱉는다.
   * 끝나면 그동안 밀려 있던 최신 상태를 반영한다.
   */
  playChomp(info: ChompInfo): Promise<void> {
    const state = this.state;
    const victim = this.pawns[info.fallen];
    if (!state || !victim || this.busy) return Promise.resolve();

    if (this.reduced) {
      this.onPhase('reveal');
      return new Promise((resolve) =>
        setTimeout(() => {
          this.onPhase('done');
          resolve();
        }, 1600),
      );
    }

    this.busy = true;
    this.dice.set({ mode: 'hidden', face: null });
    this.onPhase('suspense');
    this.bone.visible = false;
    const other = info.other !== null ? this.pawns[info.other] : undefined;

    const onLand = !victim.pos || victim.pos < 1;
    const plankNo = onLand ? 0 : Math.min(victim.pos!, state.length);
    const stand = this.spot(info.fallen, plankNo, state.length);
    victim.moving = true;
    victim.group.visible = true;
    victim.group.position.copy(stand);

    const X = stand.x;
    /** 하마가 솟구치는 가로 위치. 언덕에 파묻히지 않게 강 안쪽으로 당긴다. */
    const HX = THREE.MathUtils.clamp(X, -3.3, 3.3);
    /** 하마가 입을 벌렸을 때 입 한가운데(말이 빨려 들어가는 곳). */
    const mouth = new THREE.Vector3(HX, 0.95, LUNGE_Z + 0.45);
    const focus = other && other.pos !== null ? (X + other.base.x) / 2 : X;

    // 1. 긴장: 두 말이 떨고 카메라가 다가간다
    this.moveCamera(0, 0.8, { x: THREE.MathUtils.clamp(focus * 0.8, -4, 4), y: 0.5, z: 1.0, zoom: 1.4 });
    this.tween(0.45, 1.5, () => {
      const j = Math.sin(this.time * 70) * 0.03;
      victim.group.position.x = X + j;
      if (other && !other.moving && other.pos !== null) other.group.position.x = other.base.x - j;
    });

    // 다리 밑 하마 중 가장 가까운 녀석이 물속으로 사라졌다가, 말 바로 앞 물에서 눈만 내밀고 기다린다
    const under = this.hippos.filter((h) => isUnderBridge(h.home));
    const hippo = [...(under.length ? under : this.hippos)].sort((a, b) => Math.abs(a.home.x - HX) - Math.abs(b.home.x - HX))[0]!;
    hippo.acting = true;
    const hr = hippo.rig.root;
    const peekY = -0.32 * hippo.scale;
    const from = hr.position.clone();
    this.tween(0.15, 0.45, (k) => (hr.position.y = lerp(from.y, -2.4, k)), easeIn);
    this.tween(0.6, 0.3, (k) => {
      // 물 밑으로 헤엄쳐 온다
      hr.position.x = lerp(from.x, HX, k);
      hr.position.z = lerp(from.z, LUNGE_Z, k);
      hr.rotation.set(0, 0, 0);
      hippo.yaw = 0;
    }, easeInOut);
    this.tween(0.9, 0.55, (k) => (hr.position.y = lerp(-2.4, peekY, k)), easeOut);

    // 2. 공개
    this.at(1.15, () => this.onPhase('reveal'));
    this.moveCamera(1.2, 0.55, { x: HX * 0.9 + (onLand ? -0.9 : 0), y: 0.45, z: 1.5, zoom: onLand ? 1.5 : 1.65 });

    const T = 2.05;
    /**
     * 상황에 맞는 장면을 고른다.
     *  육지: 상대 말이 다리 위 멀리(3칸 이상) 있으면 거기서 올가미를 던지고(rope), 가까이 있으면 달려와 찬다(kick).
     *  다리: 상대 말이 바로 옆 칸(또는 같은 칸)에 있으면 밀치고(push), 아니면 널빤지가 꺼진다(plank).
     */
    const rivalPos = other?.pos ?? null;
    const variant: 'kick' | 'rope' | 'push' | 'plank' = onLand
      ? rivalPos !== null && rivalPos >= 3
        ? 'rope'
        : 'kick'
      : rivalPos !== null && rivalPos >= 1 && Math.abs(rivalPos - plankNo) <= 1
        ? 'push'
        : 'plank';
    /** 말이 공중에 떠 있는 시간과 포물선의 높이. */
    const flight = { kick: 0.66, rope: 0.72, push: 0.56, plank: 0.52 }[variant];
    const arcHeight = { kick: 2.4, rope: 1.25, push: 1.5, plank: 1.05 }[variant];
    let kicker: THREE.Group | null = null;
    /** 장면이 끝나면 치울 소품(밧줄 등). */
    const props: THREE.Object3D[] = [];

    if (variant === 'rope' && other) {
      // 3-다. 다리 위의 상대 말이 올가미를 던져 홱 잡아당긴다
      const rival = other;
      rival.moving = true;
      // 다리 난간 밧줄과 헷갈리지 않게 더 밝고 굵게
      const rope = box([0.1, 0.1, 1], '#fff8e7');
      rope.castShadow = false;
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.07, 6, 12), toon('#fff8e7'));
      loop.rotation.x = Math.PI / 2;
      rope.visible = loop.visible = false;
      this.scene.add(rope, loop);
      props.push(rope, loop);
      const hand = () => rival.group.position.clone().setY(rival.group.position.y + 0.85);
      const stretch = (to: THREE.Vector3) => {
        const a = hand();
        rope.position.copy(a).add(to).multiplyScalar(0.5);
        rope.scale.set(0.1, 0.1, Math.max(0.01, a.distanceTo(to)));
        rope.lookAt(to);
        loop.position.copy(to);
      };
      // 머리 위로 빙빙 돌린 뒤 던진다
      this.tween(T - 0.8, 0.5, (k) => (rival.group.rotation.y = 0.35 + k * Math.PI * 4));
      this.at(T - 0.3, () => {
        this.onSfx('rope');
        rope.visible = loop.visible = true;
        rival.group.rotation.y = -Math.PI / 2; // 출발 지점 쪽을 본다
      });
      const neck = stand.clone().setY(stand.y + 0.6);
      this.tween(T - 0.3, 0.28, (k) => {
        const tip = hand().lerp(neck, k);
        tip.y += Math.sin(k * Math.PI) * 1.3;
        stretch(tip);
      });
      this.at(T, () => {
        this.onPhase('rope');
        this.shake = 0.25;
      });
      // 당기는 동안 밧줄이 끌려오는 말을 따라 줄어든다(말의 위치는 아래 포물선에서 먼저 갱신된다)
      this.tween(T, flight, (k) => {
        stretch(victim.group.position.clone().setY(victim.group.position.y + 0.75));
        rival.group.rotation.z = -0.4 * Math.sin(k * Math.PI);
      });
      this.at(T + flight, () => (rope.visible = loop.visible = false));
    } else if (variant === 'push' && other) {
      // 3-라. 바로 옆에 있던 상대 말이 다가와 난간 너머로 밀친다
      const rival = other;
      rival.moving = true;
      const home = rival.base.clone();
      const side = Math.sign(X - home.x) || 1;
      const beside = new THREE.Vector3(X - side * 0.6, stand.y, stand.z - 0.15);
      this.hop(rival, home, beside, T - 0.34, 0.28);
      this.at(T, () => {
        this.onPhase('push');
        this.onSfx('push');
        this.shake = 0.3;
      });
      this.tween(T - 0.03, 0.1, (k) => {
        rival.group.position.x = beside.x + side * 0.3 * k;
        rival.group.position.z = beside.z + 0.3 * k;
      }, easeOut);
      this.hop(rival, beside.clone().add(new THREE.Vector3(side * 0.3, 0, 0.3)), home, T + 0.4, 0.28);
    } else if (onLand) {
      // 3-가. 상대 팀 말이 뒤에서 달려와 뻥 찬다
      const rival = info.other ?? (info.fallen + 1) % Math.max(2, this.pawns.length);
      const body = makePawn(rival);
      body.scale.setScalar(PAWN_SIZE);
      kicker = new THREE.Group();
      kicker.add(body);
      kicker.rotation.y = Math.PI / 2; // 강 쪽을 본다
      this.scene.add(kicker);
      const k0 = new THREE.Vector3(X - 3.0, BANK_TOP, stand.z);
      const k1 = new THREE.Vector3(X - 0.75, BANK_TOP, stand.z);
      kicker.position.copy(k0);
      const k = kicker;
      // 도움닫기 세 걸음
      for (let n = 0; n < 3; n++) {
        const a = k0.clone().lerp(k1, n / 3);
        const b = k0.clone().lerp(k1, (n + 1) / 3);
        this.at(T - 0.55 + n * 0.17, () => this.onSfx('hop'));
        this.tween(T - 0.55 + n * 0.17, 0.17, (q) => {
          k.position.lerpVectors(a, b, q);
          k.position.y += Math.sin(q * Math.PI) * 0.35;
        });
      }
      this.at(T, () => {
        this.onPhase('kick');
        this.onSfx('kick');
        this.shake = 0.35;
      });
      // 발을 내지르며 몸이 앞으로 쏠렸다가 돌아온다
      this.tween(T - 0.04, 0.12, (q) => {
        k.position.x = k1.x + 0.45 * q;
        k.rotation.z = -0.5 * q;
      }, easeOut);
      this.tween(T + 0.1, 0.25, (q) => {
        k.position.x = k1.x + 0.45 * (1 - q);
        k.rotation.z = -0.5 * (1 - q);
      });
      // 찬 뒤에 좋아서 폴짝폴짝
      for (let n = 0; n < 4; n++) {
        this.tween(T + 0.5 + n * 0.3, 0.3, (q) => (k.position.y = BANK_TOP + Math.sin(q * Math.PI) * 0.4));
      }
    } else {
      // 3-나. 널빤지가 앞으로 꺼지고 말이 난간 너머로 튕겨 나간다
      const plank = this.planks[plankNo - 1]!;
      this.at(T, () => this.onPhase('fall'));
      this.tween(T, 0.18, (k) => (plank.rotation.x = k * 1.15), easeIn);
      this.tween(T + 3.6, 0.3, (k) => (plank.rotation.x = 1.15 * (1 - k)), easeOut);
    }

    // 말이 포물선을 그리며 하마 입으로
    this.tween(T + 0.02, flight - 0.02, (k) => {
      const arc = Math.sin(k * Math.PI) * arcHeight;
      victim.group.position.set(lerp(X, HX, k), lerp(stand.y, mouth.y, k) + arc, lerp(stand.z, mouth.z, k));
      // 차이거나 떨어질 때는 빙글빙글 돌고, 올가미에 끌려갈 때는 목이 당겨진 채 버둥거린다
      if (variant === 'rope') victim.group.rotation.set(0.5 * k, 0.35, -0.8 * Math.sin(k * Math.PI));
      else victim.group.rotation.set(k * 7, 0.35, k * (variant === 'kick' ? 9 : 2.5));
      victim.group.scale.setScalar(1);
    });

    // 하마가 물을 가르며 솟구쳐 입을 쩍 벌린다
    const C = T + flight;
    this.at(C - 0.32, () => {
      this.onSfx('splash');
      this.burst(new THREE.Vector3(HX, 0.1, LUNGE_Z + 0.4), 38, ['#ffffff', '#d2f4fb', '#8fd6e6'], 3.4, 7, 0.17);
    });
    this.tween(C - 0.32, 0.3, (k) => {
      hr.position.y = lerp(peekY, 0.55, k);
      hr.rotation.x = -0.75 * k;
      hippo.open = k;
    }, easeOut);

    // 4. 콰직: 턱이 닫히고, 순간 멈추고, 화면이 흔들리고, 피가 튄다
    this.at(C, () => {
      this.onPhase('chomp');
      hippo.open = 0;
      victim.group.visible = false;
      this.freeze = 0.13;
      this.shake = 0.9;
      this.burst(mouth, 70, ['#c1121f', '#e01e37', '#8a0b16', '#c1121f'], 4.4, 6.4, 0.16);
      this.water.uniforms.uBlood.value.set(HX, LUNGE_Z + 0.75, 0, 0.96);
    });
    this.tween(C, 1.8, (k) => (this.water.uniforms.uBlood.value.z = 1.55 * k), easeOut);
    // 물속으로 도로 떨어지며 두 번째 물보라
    this.tween(C + 0.14, 0.42, (k) => {
      hr.position.y = lerp(0.55, -0.2 * hippo.scale, k);
      hr.rotation.x = -0.75 * (1 - k);
    }, easeIn);
    this.at(C + 0.52, () => {
      this.onSfx('splash');
      this.burst(new THREE.Vector3(HX, 0.1, LUNGE_Z + 0.6), 28, ['#ffffff', '#d2f4fb', '#e8a0a8'], 3.6, 5, 0.15);
      this.shake = 0.35;
    });
    this.moveCamera(C + 0.3, 0.5, { x: HX * 0.9, y: 0.3, z: 1.9, zoom: 1.8 });

    // 5. 우적우적 씹는다. 닫을 때마다 피가 튄다.
    const W = C + 0.85;
    this.at(W, () => this.onPhase('chew'));
    for (let n = 0; n < 3; n++) {
      this.tween(W + n * 0.34, 0.17, (k) => (hippo.open = 0.32 * k), easeOut);
      this.tween(W + n * 0.34 + 0.17, 0.09, (k) => (hippo.open = 0.32 * (1 - k)), easeIn);
      this.at(W + n * 0.34 + 0.26, () => {
        this.onSfx('munch');
        this.burst(new THREE.Vector3(HX, 0.3, LUNGE_Z + 0.95), 10, ['#c1121f', '#e01e37'], 1.7, 3.2, 0.12);
        this.shake = 0.16;
      });
    }

    // 6. 뼈다귀를 뱉고 트림
    const B = W + 1.15;
    this.at(B, () => {
      this.onPhase('burp');
      this.onSfx('bone');
      this.bone.visible = true;
    });
    this.tween(B, 0.14, (k) => (hippo.open = 0.6 * k), easeOut);
    this.tween(B + 0.5, 0.3, (k) => (hippo.open = 0.6 * (1 - k)), easeIn);
    const land = new THREE.Vector3(HX + (HX > 2 ? -1.3 : 1.3), 0.06, LUNGE_Z + 2.0);
    this.tween(B, 0.7, (k) => {
      this.bone.position.set(lerp(HX, land.x, k), 0.5 + Math.sin(k * Math.PI) * 1.5 - k * 0.44, lerp(LUNGE_Z + 0.9, land.z, k));
      this.bone.rotation.set(k * 9, k * 4, 0.3);
    });
    this.at(B + 0.7, () => this.burst(land, 8, ['#ffffff', '#d2f4fb'], 1.2, 2.4, 0.09));

    // 7. 제자리로
    const E = B + 1.1;
    this.moveCamera(E, 0.6, { ...VIEW });

    return new Promise((resolve) => {
      this.at(E + 0.65, () => {
        hippo.acting = false;
        hippo.home.x = HX; // 먹은 자리 근처에 눌러앉는다(다리 밑은 그대로)
        if (kicker) this.scene.remove(kicker);
        for (const p of props) this.scene.remove(p);
        if (other) {
          // 올가미를 던지거나 밀쳤던 상대 말을 제자리로
          other.group.rotation.set(0, 0.35, 0);
          other.moving = false;
        }
        victim.group.rotation.set(0, 0.35, 0);
        victim.moving = false;
        this.busy = false;
        this.view = { ...VIEW };
        this.onPhase('done');
        const next = this.pending;
        this.pending = null;
        if (next) {
          victim.pos = null; // 새 말이 출발 지점에 '나타나는' 것으로 그린다
          this.setState(next);
        }
        resolve();
      });
    });
  }
}

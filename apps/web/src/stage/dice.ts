// 화면 아래쪽 나무 쟁반 위에서 구르는 3D 주사위.
// 게임 장면과 별개의 작은 장면으로, 게임 장면 위에 덧그린다(카메라가 움직여도 항상 같은 자리에 보인다).
import * as THREE from 'three';
import { box, toon } from './models.ts';

/** hidden: 안 보임 / ready: 던지기를 기다림 / shown: 던져진 뒤 쟁반에 놓여 있음 */
export type DiceMode = 'hidden' | 'ready' | 'shown';

export interface DiceState {
  mode: DiceMode;
  /** 나온 눈(0은 꽝). 상대의 주사위라 볼 수 없으면 null: 물음표 주사위가 구르고 컵이 덮는다. */
  face: number | null;
}

const ELEVATION = (52 * Math.PI) / 180;
/** 쟁반의 자리. 이 값이 클수록 화면 아래쪽에 그려진다. */
const TRAY_Z = 4.15;
const SIZE = 0.95;
const REST_Y = 0.05 + SIZE / 2;

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
};

/** 주사위 한 면의 그림. face: 1~5는 눈, 0은 꽝, null은 물음표. */
function faceTexture(face: number | null): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9c9a0';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#fffaf0';
  g.fillRect(2, 2, 28, 28);
  if (face && PIPS[face]) {
    g.fillStyle = '#3a2414';
    for (const [x, y] of PIPS[face]) g.fillRect(5 + x * 8, 5 + y * 8, 6, 6);
  } else {
    g.fillStyle = face === 0 ? '#d9433b' : '#7c4a26';
    g.font = 'bold 22px Galmuri11, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(face === 0 ? '꽝' : '?', 16, 17);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 상자의 면 순서(+X, -X, +Y, -Y, +Z, -Z)에 놓인 눈. 규칙의 주사위와 같다: 1, 2, 3, 4, 꽝, 꽝. */
const LAYOUT = [2, 0, 1, 0, 3, 4];

/** 그 눈이 위(+Y)를 보게 하는 회전. 꽝은 두 면 중 아랫면(-Y)을 위로 올린다. */
function faceUp(face: number): THREE.Quaternion {
  const e = new THREE.Euler();
  const q = Math.PI / 2;
  if (face === 2) e.z = q;
  else if (face === 3) e.x = -q;
  else if (face === 4) e.x = q;
  else if (face === 0) e.x = Math.PI;
  return new THREE.Quaternion().setFromEuler(e);
}

const easeOut = (k: number) => 1 - (1 - k) ** 3;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export class DiceHud {
  onSfx: (name: 'throw' | 'dice' | 'cup') => void = () => {};

  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  private group = new THREE.Group();
  private die: THREE.Mesh;
  private cup = new THREE.Group();
  private shadow: THREE.Mesh;
  private real: THREE.Material[];
  private mystery: THREE.Material[];

  private mode: DiceMode = 'hidden';
  private phase: 'idle' | 'air' | 'land' | 'rest' = 'idle';
  private t = 0;
  private power = 0.5;
  private charge: number | null = null;
  /** 던진 뒤 서버에서 온 결과. undefined = 아직 모름. */
  private pending: number | null | undefined;
  private peak = 2;
  private spin = 0;
  private bounces = 0;
  private from = new THREE.Quaternion();
  private target = new THREE.Quaternion();
  private rest = new THREE.Vector3();
  private covered = false;
  private cupT = 0;

  constructor() {
    this.scene.add(new THREE.HemisphereLight('#fff6dc', '#8a6a4a', 1.5));
    const sun = new THREE.DirectionalLight('#fff1cf', 2.2);
    sun.position.set(-4, 10, 6);
    this.scene.add(sun);
    this.camera.position.set(0, Math.sin(ELEVATION) * 40, Math.cos(ELEVATION) * 40);
    this.camera.lookAt(0, 0, 0);

    // 쟁반: 나무 테두리와 초록 깔개
    const tray = new THREE.Group();
    tray.add(box([3.7, 0.3, 2.6], '#8a5527', [0, -0.15, 0]));
    tray.add(box([3.3, 0.06, 2.2], '#3f8f58', [0, 0.02, 0]));
    for (const s of [-1, 1]) {
      tray.add(box([3.7, 0.34, 0.2], '#d39a55', [0, 0.1, s * 1.2]));
      tray.add(box([0.2, 0.34, 2.6], '#d39a55', [s * 1.75, 0.1, 0]));
    }
    this.group.add(tray);

    const make = (faces: (number | null)[]) =>
      faces.map((f) => new THREE.MeshToonMaterial({ map: faceTexture(f), gradientMap: toon('#ffffff').gradientMap }));
    this.real = make(LAYOUT);
    this.mystery = make(LAYOUT.map(() => null));
    this.die = new THREE.Mesh(new THREE.BoxGeometry(SIZE, SIZE, SIZE), this.real);
    this.group.add(this.die);
    // 글꼴이 늦게 도착하면 '꽝'과 '?'를 다시 그린다.
    void document.fonts?.ready.then(() => {
      [...this.real, ...this.mystery].forEach((m, i) => {
        const face = i < 6 ? LAYOUT[i]! : null;
        if (face === 0 || face === null) (m as THREE.MeshToonMaterial).map = faceTexture(face);
      });
    });

    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.62, 12), new THREE.MeshBasicMaterial({ color: '#12301e', transparent: true, opacity: 0.4 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.06;
    this.group.add(this.shadow);

    // 상대의 주사위를 덮는 나무 컵
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.92, 1.35, 10), toon('#c98f4c'));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.97, 0.22, 10), toon('#7a4a26'));
    band.position.y = -0.5;
    this.cup.add(body, band);
    this.cup.visible = false;
    this.group.add(this.cup);

    this.group.position.set(0, 0, TRAY_Z);
    this.group.visible = false;
    this.scene.add(this.group);
  }

  /** 화면 비율에 맞춘다. 세로를 10칸으로 고정하고 가로를 늘린다. */
  resize(aspect: number): void {
    this.camera.left = -5 * aspect;
    this.camera.right = 5 * aspect;
    this.camera.updateProjectionMatrix();
  }

  set(state: DiceState): void {
    const prev = this.mode;
    this.mode = state.mode;
    if (state.mode === 'hidden') return;

    if (state.mode === 'ready') {
      if (prev !== 'ready') {
        this.phase = 'idle';
        this.pending = undefined;
        this.covered = false;
        this.cup.visible = false;
        this.die.material = this.real;
        this.die.position.set(0, 1.15, 0);
      }
      return;
    }

    // shown
    this.die.material = state.face === null ? this.mystery : this.real;
    if (this.phase === 'air') {
      this.pending = state.face; // 내가 방금 던졌고, 서버가 결과를 알려 줬다
    } else if (prev === 'ready') {
      // 상대가 던졌거나 시간이 다 돼 자동으로 굴려졌다
      this.throw(0.5);
      this.pending = state.face;
    } else if (prev === 'hidden') {
      // 다시 접속했거나 연출이 끝난 뒤: 이미 놓여 있는 상태로 보여 준다
      this.phase = 'rest';
      this.die.position.set(0.3, REST_Y, 0.1);
      this.die.quaternion.copy(faceUp(state.face ?? 1));
      this.covered = state.face === null;
      this.cup.visible = this.covered;
      this.cup.position.set(0.3, 0.72, 0.1);
      this.cupT = 1;
    }
  }

  /** 힘을 모으는 중(0~1). 주사위가 떠올라 떨린다. null이면 멈춘다. */
  setCharge(power: number | null): void {
    this.charge = power;
  }

  /** 던진다. 결과는 나중에 set()으로 들어오고, 그때까지 공중에서 돈다. */
  throw(power: number): void {
    if (this.phase !== 'idle') return;
    this.power = power;
    this.phase = 'air';
    this.t = 0;
    this.charge = null;
    this.pending = undefined;
    this.peak = 2.1 + power * 2.0;
    this.onSfx('throw');
  }

  update(dt: number, time: number): void {
    this.group.visible = this.mode !== 'hidden';
    if (!this.group.visible) return;
    const die = this.die;

    if (this.phase === 'idle') {
      const c = this.charge ?? 0;
      this.spin += dt * (0.9 + c * 16);
      die.rotation.set(0.5 + this.spin * 0.7, this.spin, 0.35);
      const jitter = c * 0.07;
      die.position.set((Math.random() - 0.5) * jitter, 1.15 + Math.sin(time * 2.2) * 0.1 + c * 0.55, (Math.random() - 0.5) * jitter);
    } else if (this.phase === 'air') {
      this.t += dt;
      const w = 10 + this.power * 18;
      die.rotateX(dt * w);
      die.rotateZ(dt * w * 0.7);
      die.position.y = lerp(die.position.y, this.peak, Math.min(1, dt * 9));
      const minAir = 0.3 + this.power * 0.35;
      if (this.pending !== undefined && this.t >= minAir) {
        // 결과가 왔다: 그 눈이 위로 오게 내려앉는다
        this.phase = 'land';
        this.t = 0;
        this.bounces = 0;
        this.from.copy(die.quaternion);
        const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.9);
        this.target.copy(yaw).multiply(faceUp(this.pending ?? 1));
        this.rest.set((Math.random() - 0.5) * 1.6, REST_Y, (Math.random() - 0.5) * 0.7);
      } else if (this.t > 4) {
        this.phase = 'idle'; // 서버 응답이 없으면 원래대로
      }
    } else if (this.phase === 'land') {
      const dur = 0.7 + this.power * 0.45;
      this.t += dt;
      const k = Math.min(1, this.t / dur);
      const hops = 2 + Math.round(this.power * 2);
      const wave = k * (hops + 0.5);
      die.position.set(lerp(0, this.rest.x, k), REST_Y + (this.peak - REST_Y) * (1 - k) ** 2 * Math.abs(Math.cos(wave * Math.PI)), lerp(0, this.rest.z, k));
      // 바닥에 닿을 때마다 딱 소리
      const hit = Math.floor(wave + 0.5);
      if (hit > this.bounces && hit <= hops) {
        this.bounces = hit;
        this.onSfx('dice');
      }
      const tumble = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0.4).normalize(), (1 - k) ** 2 * Math.PI * (3 + this.power * 4));
      die.quaternion.slerpQuaternions(this.from, this.target, easeOut(k)).multiply(tumble);
      if (k >= 1) {
        this.phase = 'rest';
        die.position.copy(this.rest);
        die.quaternion.copy(this.target);
        if (this.pending === null) {
          // 상대의 주사위는 컵으로 덮는다
          this.covered = true;
          this.cupT = 0;
          this.cup.visible = true;
        }
      }
    }

    if (this.covered && this.cupT < 1) {
      this.cupT = Math.min(1, this.cupT + dt / 0.16);
      this.cup.position.set(die.position.x, lerp(4.2, 0.72, this.cupT ** 2), die.position.z);
      if (this.cupT >= 1) this.onSfx('cup');
    }

    // 높이 뜰수록 그림자가 작고 옅어진다
    const height = Math.max(0, die.position.y - REST_Y);
    this.shadow.position.set(die.position.x, 0.06, die.position.z);
    this.shadow.scale.setScalar(Math.max(0.35, 1 - height * 0.18));
    this.shadow.visible = !this.covered || this.cupT < 1;
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.group.visible) return;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}

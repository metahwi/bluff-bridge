// 3D 모델. 전부 기본 도형(구, 상자, 원기둥)을 조합해 만든다.
// 낮은 해상도로 그려 픽셀로 보이게 하므로 모양은 단순하고 덩어리가 커야 잘 읽힌다.
import * as THREE from 'three';

/** 명암을 네 단계로 끊어 픽셀 아트처럼 보이게 하는 그라데이션. */
const gradient = new THREE.DataTexture(new Uint8Array([95, 150, 205, 255]), 4, 1, THREE.RedFormat);
gradient.minFilter = THREE.NearestFilter;
gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

const materials = new Map<string, THREE.MeshToonMaterial>();
export function toon(color: string): THREE.MeshToonMaterial {
  let m = materials.get(color);
  if (!m) materials.set(color, (m = new THREE.MeshToonMaterial({ color, gradientMap: gradient })));
  return m;
}

function lit<T extends THREE.Mesh>(mesh: T, cast = true): T {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

const sphere = new THREE.SphereGeometry(1, 14, 10);
const cube = new THREE.BoxGeometry(1, 1, 1);

/** 반지름 r인 공. squash로 눌러 타원체를 만든다. */
export function ball(r: number, color: string, at: [number, number, number], squash: [number, number, number] = [1, 1, 1]) {
  const m = lit(new THREE.Mesh(sphere, toon(color)));
  m.scale.set(r * squash[0], r * squash[1], r * squash[2]);
  m.position.set(...at);
  return m;
}

export function box(size: [number, number, number], color: string, at: [number, number, number] = [0, 0, 0]) {
  const m = lit(new THREE.Mesh(cube, toon(color)));
  m.scale.set(...size);
  m.position.set(...at);
  return m;
}

/** 그림자를 드리우지 않는 납작한 바닥 조각(길, 풀 얼룩). */
function flat(size: [number, number, number], color: string, at: [number, number, number]) {
  const m = box(size, color, at);
  m.castShadow = false;
  return m;
}

// ───────── 하마 ─────────

export interface HippoRig {
  root: THREE.Group;
  /** 0 = 입 다묾, 1 = 쩍 벌림. 위턱은 뒤로 젖혀지고 아래턱은 내려간다. */
  setOpen(v: number): void;
  /** 0 = 눈 뜸, 1 = 감음. */
  setBlink(v: number): void;
  ears: THREE.Group[];
}

const HIDE = '#8f6f7a';
const HIDE_DARK = '#75596a';
const MUZZLE = '#c4a3a8';
const JAW = '#a98990';
const EAR_PINK = '#f29bb0';
const MOUTH = '#c63c5a';
const TONGUE = '#f58ea6';
const TOOTH = '#fffbee';
const EYE = '#1b1210';

/** 머리가 +z(카메라 쪽)를 향하는 하마. 원점은 머리 가운데의 물 높이. */
export function makeHippo(): HippoRig {
  const root = new THREE.Group();

  // 몸통과 목: 평소에는 물에 잠겨 있고, 솟구칠 때만 보인다.
  root.add(ball(0.85, HIDE, [0, -0.95, -1.15], [1.25, 0.9, 1.7]));
  root.add(ball(0.62, HIDE, [0, -0.42, -0.45], [1.15, 0.95, 1.0]));

  // 위턱(머리 전체). 뒤통수 쪽 경첩을 축으로 젖혀진다.
  const skull = new THREE.Group();
  skull.position.set(0, 0, -0.45);
  skull.add(ball(0.56, HIDE, [0, 0.22, 0.42], [1.12, 0.84, 1.0]));
  skull.add(ball(0.5, MUZZLE, [0, 0.1, 1.06], [1.4, 0.6, 1.05]));
  skull.add(ball(0.46, MOUTH, [0, -0.07, 1.02], [1.3, 0.22, 0.98]));
  for (const s of [-1, 1]) {
    skull.add(ball(0.08, HIDE_DARK, [0.27 * s, 0.37, 1.34]));
    skull.add(ball(0.18, HIDE, [0.37 * s, 0.58, 0.44]));
    skull.add(box([0.13, 0.24, 0.13], TOOTH, [0.44 * s, -0.2, 1.3]));
  }
  const eyes = [-1, 1].map((s) => {
    const eye = ball(0.095, EYE, [0.38 * s, 0.65, 0.57]);
    eye.add(ball(0.32, '#ffffff', [-0.35 * s, 0.45, 0.75]));
    skull.add(eye);
    return eye;
  });
  const ears = [-1, 1].map((s) => {
    const ear = new THREE.Group();
    ear.position.set(0.5 * s, 0.6, 0.02);
    ear.add(ball(0.16, HIDE, [0, 0.06, 0], [1, 1, 0.6]));
    ear.add(ball(0.095, EAR_PINK, [0, 0.06, 0.07], [1, 1, 0.5]));
    skull.add(ear);
    return ear;
  });
  root.add(skull);

  // 아래턱: 혀와 송곳니.
  const jaw = new THREE.Group();
  jaw.position.copy(skull.position);
  jaw.add(ball(0.5, JAW, [0, -0.2, 1.02], [1.34, 0.46, 1.05]));
  jaw.add(ball(0.44, MOUTH, [0, -0.06, 1.0], [1.26, 0.22, 0.98]));
  jaw.add(ball(0.3, TONGUE, [0, -0.01, 0.86], [1.1, 0.32, 1.3]));
  for (const s of [-1, 1]) jaw.add(box([0.14, 0.32, 0.14], TOOTH, [0.5 * s, 0.1, 1.32]));
  root.add(jaw);

  return {
    root,
    ears,
    setOpen(v) {
      skull.rotation.x = -v * 0.85;
      jaw.rotation.x = v * 0.5;
    },
    setBlink(v) {
      for (const e of eyes) e.scale.y = 0.095 * (1 - 0.88 * v);
    },
  };
}

// ───────── 말 ─────────

export const PLAYER_COLORS = ['#f0622d', '#3b82f6', '#a855f7', '#22c55e'];

function shade(color: string, toward: string, amount: number): string {
  return '#' + new THREE.Color(color).lerp(new THREE.Color(toward), amount).getHexString();
}

/**
 * 다리를 건너는 꼬마. 원점은 발바닥, +z를 본다. 키는 약 1.05.
 * 큰 머리, 흰자와 눈동자, 볼터치, 짧은 팔다리로 귀엽게.
 */
export function makePawn(player: number): THREE.Group {
  const color = PLAYER_COLORS[player % PLAYER_COLORS.length]!;
  const light = shade(color, '#ffffff', 0.62);
  const dark = shade(color, '#000000', 0.35);
  const g = new THREE.Group();

  // 몸과 배
  g.add(ball(0.27, color, [0, 0.27, 0], [1, 1, 0.92]));
  g.add(ball(0.17, light, [0, 0.24, 0.15], [1, 1.05, 0.5]));
  g.add(ball(0.07, light, [0, 0.2, -0.26])); // 꼬리
  // 머리, 주둥이, 코
  g.add(ball(0.3, color, [0, 0.66, 0.02], [1.08, 0.95, 1]));
  g.add(ball(0.15, light, [0, 0.57, 0.24], [1.15, 0.8, 0.6]));
  g.add(ball(0.04, EYE, [0, 0.61, 0.335]));

  for (const s of [-1, 1]) {
    // 귀
    g.add(ball(0.11, color, [0.23 * s, 0.93, 0]));
    g.add(ball(0.06, light, [0.23 * s, 0.93, 0.06], [1, 1, 0.5]));
    // 눈: 흰자 → 눈동자 → 눈빛
    g.add(ball(0.09, '#ffffff', [0.125 * s, 0.73, 0.245], [1, 1.12, 0.55]));
    g.add(ball(0.052, EYE, [0.13 * s, 0.725, 0.288], [1, 1.12, 0.6]));
    g.add(ball(0.02, '#ffffff', [0.112 * s, 0.752, 0.322]));
    // 볼터치
    g.add(ball(0.05, '#ff9db0', [0.215 * s, 0.6, 0.215], [1, 0.7, 0.4]));
    // 팔과 발
    g.add(ball(0.08, color, [0.27 * s, 0.33, 0.05], [0.8, 1.3, 0.8]));
    g.add(ball(0.09, dark, [0.12 * s, 0.05, 0.06], [1, 0.6, 1.3]));
  }
  return g;
}

// ───────── 배경 ─────────

export const BRIDGE_HALF = 5;
export const BANK_TOP = 1;
/** 언덕이 바깥으로 뻗는 거리. 넓은 화면에서도 빈 곳이 보이지 않게 넉넉히. */
const BANK_WIDTH = 11;

/** 다리 바닥의 높이. 밧줄 다리라 가운데가 살짝 처진다. */
export function deckY(x: number): number {
  const k = x / BRIDGE_HALF;
  return 0.98 - 0.24 * (1 - k * k);
}

export function plankX(n: number, length: number): number {
  return (-length / 2 + n - 0.5) * ((BRIDGE_HALF * 2) / length);
}

/** 두 점 사이를 잇는 가는 막대(밧줄, 들보). */
function beam(a: THREE.Vector3, b: THREE.Vector3, thick: number, color: string) {
  const m = box([thick, thick, a.distanceTo(b)], color);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.lookAt(b);
  return m;
}

export function makeBridge(length: number) {
  const group = new THREE.Group();
  const planks: THREE.Mesh[] = [];
  const step = (BRIDGE_HALF * 2) / length;

  for (let n = 1; n <= length; n++) {
    const x = plankX(n, length);
    const plank = box([step * 0.88, 0.13, 1.72], n % 2 ? '#d9a35c' : '#c98f4c', [x, deckY(x), 0]);
    plank.rotation.z = Math.atan((0.24 * 2 * x) / (BRIDGE_HALF * BRIDGE_HALF));
    group.add(plank);
    planks.push(plank);
  }

  // 들보, 난간 밧줄, 세로 줄
  for (const z of [-0.78, 0.78]) {
    for (let i = 0; i < length; i++) {
      const x0 = -BRIDGE_HALF + i * step;
      const x1 = x0 + step;
      const a = new THREE.Vector3(x0, deckY(x0), z);
      const b = new THREE.Vector3(x1, deckY(x1), z);
      group.add(beam(a.clone().setY(a.y - 0.1), b.clone().setY(b.y - 0.1), 0.1, '#6b3f1a'));
      group.add(beam(a.clone().setY(a.y + 0.72), b.clone().setY(b.y + 0.72), 0.07, '#ead29b'));
      if (i > 0) group.add(box([0.04, 0.72, 0.04], '#c9a56a', [x0, a.y + 0.36, z])); // 난간을 받치는 가는 줄
    }
    for (const s of [-1, 1]) {
      // 언덕에 박은 굵은 말뚝
      group.add(box([0.22, 1.25, 0.22], '#7a4a26', [s * (BRIDGE_HALF + 0.12), BANK_TOP + 0.55, z]));
      group.add(box([0.3, 0.1, 0.3], '#5a3418', [s * (BRIDGE_HALF + 0.12), BANK_TOP + 1.2, z]));
    }
  }
  return { group, planks };
}

function tree(x: number, z: number, s = 1) {
  const g = new THREE.Group();
  const trunk = lit(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.9, 6), toon('#7a4a26')));
  trunk.position.y = 0.45;
  g.add(trunk);
  const leaf = (r: number, color: string, at: [number, number, number]) => {
    const m = lit(new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), toon(color)));
    m.position.set(...at);
    g.add(m);
  };
  leaf(0.66, '#4a9f4b', [0, 1.3, 0]);
  leaf(0.48, '#6cc45a', [0.34, 1.68, 0.14]);
  leaf(0.42, '#3b8744', [-0.36, 1.58, -0.1]);
  leaf(0.36, '#7fd266', [-0.05, 1.95, 0.05]);
  g.position.set(x, BANK_TOP, z);
  g.scale.setScalar(s);
  return g;
}

function bush(x: number, z: number, color = '#4a9f4b') {
  const m = lit(new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), toon(color)));
  m.position.set(x, BANK_TOP + 0.2, z);
  m.scale.set(1.2, 0.8, 1);
  return m;
}

function rock(x: number, y: number, z: number, r: number) {
  const m = lit(new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), toon('#9a9aa6')));
  m.position.set(x, y, z);
  m.rotation.set(x, z, x * z);
  m.scale.y = 0.7;
  return m;
}

/** 표지판. 글자는 화면 위에 HTML로 얹는다(낮은 해상도에서도 또렷하게). */
function signpost(x: number, z: number) {
  const g = new THREE.Group();
  g.add(box([0.1, 0.9, 0.1], '#5a3418', [0, 0.45, 0]));
  g.add(box([0.95, 0.45, 0.1], '#d9a35c', [0, 0.95, 0.04]));
  g.position.set(x, BANK_TOP, z);
  return g;
}

/** 둥근 지붕 오두막. 문과 둥근 창이 카메라 쪽(+z)을 본다. */
function hut(x: number, z: number, roof: string, s = 1, yaw = 0) {
  const g = new THREE.Group();
  const wall = lit(new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.88, 0.75, 12), toon('#f0dcae')));
  wall.position.y = 0.375;
  g.add(wall);
  g.add(ball(1.0, roof, [0, 0.72, 0], [1, 0.72, 1]));
  g.add(ball(0.16, shade(roof, '#000000', 0.3), [0, 1.44, 0], [1, 0.8, 1])); // 지붕 꼭지
  // 지붕의 줄무늬 한 줄
  const ring = lit(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.02, 0.1, 14), toon(shade(roof, '#ffffff', 0.35))));
  ring.position.y = 0.74;
  g.add(ring);
  g.add(box([0.36, 0.52, 0.1], '#7a4a26', [0, 0.26, 0.84]));
  g.add(box([0.44, 0.08, 0.12], '#5a3418', [0, 0.55, 0.84]));
  for (const sx of [-1, 1]) {
    g.add(ball(0.15, '#5a3418', [0.5 * sx, 0.45, 0.68], [1, 1, 0.4]));
    g.add(ball(0.1, '#ffe08a', [0.5 * sx, 0.45, 0.72], [1, 1, 0.4])); // 불 켜진 창
  }
  g.position.set(x, BANK_TOP, z);
  g.rotation.y = yaw;
  g.scale.setScalar(s);
  return g;
}

/** z 방향으로 놓인 나무 울타리. */
function fence(x: number, z0: number, z1: number) {
  const g = new THREE.Group();
  const n = Math.max(2, Math.round(Math.abs(z1 - z0) / 0.8) + 1);
  for (let i = 0; i < n; i++) {
    const z = z0 + ((z1 - z0) * i) / (n - 1);
    g.add(box([0.1, 0.5, 0.1], '#8a5527', [x, BANK_TOP + 0.25, z]));
  }
  for (const y of [0.18, 0.38]) g.add(box([0.06, 0.07, Math.abs(z1 - z0)], '#c98f4c', [x, BANK_TOP + y, (z0 + z1) / 2]));
  return g;
}

function lantern(x: number, z: number) {
  const g = new THREE.Group();
  g.add(box([0.08, 0.95, 0.08], '#3a2414', [0, 0.475, 0]));
  g.add(box([0.22, 0.22, 0.22], '#ffd84d', [0, 1.02, 0]));
  g.add(box([0.3, 0.07, 0.3], '#3a2414', [0, 1.17, 0]));
  g.position.set(x, BANK_TOP, z);
  return g;
}

/** 결정적인 난수(매번 같은 풍경이 나오게). */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 양쪽 언덕과 마을. 왼쪽은 출발 마을, 오른쪽은 도착 마을.
 * 다리 끝 가까이(|z| < 5, 언덕 안쪽 3칸)는 말들이 줄 서는 자리라 비워 둔다.
 */
export function makeBanks() {
  const group = new THREE.Group();
  const rand = seeded(7);
  const FAR = 16;
  /** 말들이 서는 자리와 길 위에는 장식을 놓지 않는다. */
  const reserved = (ax: number, z: number) => (ax < BRIDGE_HALF + 3.4 && Math.abs(z) < 5.4) || Math.abs(z) < 1.1;

  for (const s of [-1, 1]) {
    // 풀밭 윗면
    group.add(flat([BANK_WIDTH, 0.4, FAR * 2], '#69ad4e', [s * (BRIDGE_HALF + BANK_WIDTH / 2), BANK_TOP - 0.2, 0]));
    // 강 쪽으로 기운 흙 비탈: 위에서 내려다봐도 면이 보여 높이가 느껴진다.
    const slope = flat([1.7, 0.5, FAR * 2], '#b0703c', [s * (BRIDGE_HALF - 0.55), 0.32, 0]);
    slope.rotation.z = s * 1.05;
    group.add(slope);
    group.add(flat([0.34, 0.16, FAR * 2], '#5fa848', [s * (BRIDGE_HALF + 0.1), BANK_TOP - 0.03, 0]));
    // 다리에서 마을로 이어지는 흙길
    group.add(flat([BANK_WIDTH - 0.4, 0.03, 1.7], '#c9a36a', [s * (BRIDGE_HALF + BANK_WIDTH / 2 + 0.2), BANK_TOP + 0.012, 0]));
    group.add(flat([BANK_WIDTH - 0.4, 0.03, 0.12], '#a98452', [s * (BRIDGE_HALF + BANK_WIDTH / 2 + 0.2), BANK_TOP + 0.014, 0.9]));

    // 풀밭의 얼룩과 꽃
    for (let i = 0; i < 46; i++) {
      const ax = BRIDGE_HALF + 0.6 + rand() * (BANK_WIDTH - 1);
      const z = (rand() - 0.5) * 22;
      if (Math.abs(z) < 1.1) continue;
      group.add(flat([0.5 + rand() * 0.7, 0.02, 0.3 + rand() * 0.5], rand() > 0.5 ? '#5c9d45' : '#7abb5a', [s * ax, BANK_TOP + 0.011, z]));
    }
    for (let i = 0; i < 34; i++) {
      const ax = BRIDGE_HALF + 0.5 + rand() * (BANK_WIDTH - 1);
      const z = (rand() - 0.5) * 21;
      if (reserved(ax, z)) continue;
      const color = ['#ffffff', '#ffd84d', '#ff8fb1', '#c9a0ff'][Math.floor(rand() * 4)]!;
      group.add(box([0.1, 0.12, 0.1], color, [s * ax, BANK_TOP + 0.14, z]));
      group.add(box([0.04, 0.12, 0.04], '#3b8744', [s * ax, BANK_TOP + 0.06, z]));
    }
    // 물가의 바위와 갈대
    for (let i = 0; i < 8; i++) {
      const z = (rand() - 0.5) * 18;
      if (Math.abs(z) < 1.5) continue;
      group.add(rock(s * (BRIDGE_HALF - 0.85 - rand() * 0.25), 0.05, z, 0.16 + rand() * 0.16));
      for (let k = 0; k < 3; k++) {
        group.add(box([0.05, 0.5 + rand() * 0.4, 0.05], '#3f8f48', [s * (BRIDGE_HALF - 0.75 - rand() * 0.3), 0.25, z + 0.5 + rand() * 0.6]));
      }
    }
    // 길가의 등불
    group.add(lantern(s * (BRIDGE_HALF + 4.2), -1.25), lantern(s * (BRIDGE_HALF + 8.2), 1.25));
  }

  // 출발 마을(왼쪽)
  group.add(hut(-10.2, -3.4, '#e0803a', 1.25, 0.25), hut(-12.8, 2.9, '#3a9a8f', 1.4, 0.4), hut(-9.6, 5.9, '#d9a03a', 1.05, 0.2), hut(-13.6, -5.4, '#8a5fd0', 1.2, 0.3));
  group.add(fence(-8.75, -6.6, -1.4), fence(-8.75, 1.4, 4.6));
  group.add(tree(-11.9, -1.9, 1.1), tree(-11.2, 6.9, 1.2), tree(-8.9, -7.6, 1.15), tree(-14.6, 0.6, 1.25), tree(-6.4, -8.4, 1), tree(-6.3, 7.4, 1.05));
  group.add(bush(-9.2, 1.9), bush(-11.6, 4.4, '#6cc45a'), bush(-10.9, -6.2, '#3b8744'), rock(-9.4, BANK_TOP + 0.12, -1.6, 0.3));

  // 도착 마을(오른쪽)
  group.add(hut(10.0, -3.6, '#8a5fd0', 1.3, -0.3), hut(12.6, 3.1, '#e0803a', 1.4, -0.4), hut(9.4, 6.1, '#3a9a8f', 1.05, -0.2), hut(13.7, -5.2, '#d9a03a', 1.2, -0.3));
  group.add(fence(8.75, -6.6, -1.4), fence(8.75, 1.4, 4.6));
  group.add(tree(11.8, -1.7, 1.1), tree(11.4, 7.0, 1.2), tree(8.8, -7.8, 1.15), tree(14.8, 0.4, 1.25), tree(6.4, -8.6, 1), tree(6.5, 7.6, 1.05));
  group.add(bush(9.3, 1.9, '#6cc45a'), bush(11.7, 4.6), bush(11.0, -6.4, '#3b8744'), rock(9.5, BANK_TOP + 0.1, -1.5, 0.26));

  // 표지판은 길 안쪽에 세운다(다리 가까이는 말들이 줄 서는 자리)
  const signs = [signpost(-8.1, -1.3), signpost(8.1, -1.3)];
  group.add(...signs);
  return { group, signs };
}

/** 팀이 모여 서는 자리를 알리는 깃발. */
export function makeFlag(player: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box([0.07, 1.25, 0.07], '#5a3418', [0, 0.625, 0]));
  g.add(box([0.5, 0.32, 0.05], PLAYER_COLORS[player % PLAYER_COLORS.length]!, [0.27, 1.06, 0]));
  g.add(ball(0.07, '#ffd84d', [0, 1.28, 0]));
  return g;
}

/** 물 위에 뜬 연잎. */
export function makeLilies() {
  const g = new THREE.Group();
  const pad = new THREE.CylinderGeometry(0.34, 0.34, 0.03, 9);
  for (const [x, z, flower] of [
    [-3.9, -1.2, 1],
    [3.7, 4.2, 0],
    [-3.6, 6.3, 1],
    [3.9, -4.4, 0],
    [0.2, -7.4, 1],
  ] as const) {
    const m = new THREE.Mesh(pad, toon('#58b860'));
    m.position.set(x, 0.02, z);
    m.receiveShadow = true;
    g.add(m);
    if (flower) g.add(box([0.14, 0.12, 0.14], '#ffc2d6', [x + 0.08, 0.1, z - 0.05]));
  }
  return g;
}

/** 하마가 뱉는 뼈다귀. */
export function makeBone() {
  const g = new THREE.Group();
  g.add(box([0.5, 0.1, 0.1], '#fff8e7'));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(ball(0.085, '#fff8e7', [0.26 * sx, 0, 0.06 * sz]));
  return g;
}

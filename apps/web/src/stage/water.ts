import * as THREE from 'three';

export const MAX_RIPPLES = 14;

/**
 * 강물. 색을 몇 단계로 끊어 칠하고, 무늬가 카메라 쪽(+z)으로 흘러온다.
 * 하마 주변의 물결 고리, 다리 그림자, 번지는 피도 여기서 그린다.
 */
export function makeWater() {
  const uniforms = {
    uT: { value: 0 },
    /** 물결 고리: (x, z, 반지름, 위상). 반지름 0이면 안 그린다. */
    uRip: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4()) },
    /** 피 웅덩이: (x, z, 반지름, 진하기). */
    uBlood: { value: new THREE.Vector4() },
    /** 다리 그림자가 떨어지는 범위: (x0, x1, z0, z1). */
    uShadow: { value: new THREE.Vector4() },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uT;
      uniform vec4 uRip[${MAX_RIPPLES}];
      uniform vec4 uBlood;
      uniform vec4 uShadow;
      varying vec3 vW;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }

      void main() {
        vec2 p = vW.xz;
        float t = floor(uT * 9.0) / 9.0; // 움직임을 뚝뚝 끊는다

        float n = (noise(p * vec2(0.7, 1.5) + vec2(0.0, -t * 0.5)) + 0.5 * noise(p * vec2(1.9, 3.7) + vec2(t * 0.15, -t * 0.9))) / 1.5;
        float shore = smoothstep(2.4, 4.4, abs(p.x)); // 가운데 0 → 물가 1

        vec3 deep = vec3(0.118, 0.412, 0.553);
        vec3 mid = vec3(0.196, 0.541, 0.682);
        vec3 lite = vec3(0.337, 0.694, 0.808);
        vec3 glint = vec3(0.820, 0.957, 0.984);

        vec3 c = mix(deep, mid, step(0.50 - shore * 0.30, n));
        c = mix(c, lite, step(0.68 - shore * 0.26, n));

        // 길쭉한 반짝임
        float g = noise(p * vec2(1.1, 6.5) + vec2(t * 0.1, -t * 1.7));
        c = mix(c, glint, step(0.84, g) * step(0.45, n));

        // 물가의 흰 거품
        float edge = abs(p.x) - (4.18 + 0.16 * noise(vec2(p.y * 1.4, t * 0.7)));
        c = mix(c, vec3(0.90, 0.97, 1.0), step(0.0, edge) * step(edge, 0.2));

        // 다리 그림자
        if (p.x > uShadow.x && p.x < uShadow.y && p.y > uShadow.z && p.y < uShadow.w) c *= vec3(0.62, 0.68, 0.74);

        // 하마 주변 물결: 안쪽 고리는 고정, 바깥 고리는 퍼져 나간다
        for (int i = 0; i < ${MAX_RIPPLES}; i++) {
          vec4 r = uRip[i];
          if (r.z <= 0.0) continue;
          float d = length((p - r.xy) * vec2(1.0, 1.2));
          float k = fract(t * 0.42 + r.w);
          c = mix(c, glint, step(abs(d - r.z * (0.85 + 0.75 * k)), 0.05) * step(k, 0.72));
          c = mix(c, lite, step(abs(d - r.z * 0.72), 0.06));
        }

        // 피: 가장자리가 울퉁불퉁하게 번진다
        if (uBlood.w > 0.0) {
          float d = length((p - uBlood.xy) * vec2(1.0, 1.15));
          float rim = uBlood.z * (0.72 + 0.5 * noise(p * 2.1 + vec2(0.0, -t * 0.35)));
          vec3 blood = mix(vec3(0.50, 0.02, 0.07), vec3(0.76, 0.06, 0.11), step(0.5, noise(p * 3.7 + t)));
          c = mix(c, blood, step(d, rim) * uBlood.w);
          c = mix(c, vec3(0.62, 0.16, 0.22), step(d, rim * 1.35) * step(rim, d) * uBlood.w * 0.55);
        }

        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), material);
  mesh.rotation.x = -Math.PI / 2;
  return { mesh, uniforms };
}

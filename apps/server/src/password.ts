// 비밀번호 해시. 비밀번호 원문은 어디에도 저장하지 않고, 되돌릴 수 없는 값(해시)만 DB에 둔다.
//
// 로그인 라이브러리의 기본 방식(scrypt)은 자바스크립트로 계산해서 Cloudflare Workers의 CPU 시간 제한에
// 걸리기 쉽다. 그래서 런타임에 내장된 암호 기능(WebCrypto)의 PBKDF2-SHA256을 쓴다.
// 반복 횟수 100,000은 Workers가 허용하는 최댓값이다.
const ITERATIONS = 100_000;
const PREFIX = 'pbkdf2-sha256';

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** 저장할 값: "pbkdf2-sha256$반복횟수$소금$해시". 소금은 사람마다 새로 뽑는다. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return [PREFIX, ITERATIONS, toBase64(salt), toBase64(hash)].join('$');
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const [prefix, iterations, salt, expected] = hash.split('$');
  if (prefix !== PREFIX || !iterations || !salt || !expected) return false;
  const want = fromBase64(expected);
  const got = await derive(password, fromBase64(salt), Number(iterations));
  if (got.length !== want.length) return false;
  // 앞에서부터 다른 곳을 찾으면 걸린 시간으로 값을 추측할 수 있으므로, 끝까지 다 비교한다.
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ want[i]!;
  return diff === 0;
}

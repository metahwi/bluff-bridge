// 실행 중인 서버에 DB 테이블 생성을 요청한다. 여러 번 실행해도 안전하다.
// 사용: node scripts/migrate.ts [서버 주소]
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const token =
  process.env.ADMIN_TOKEN ??
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^ADMIN_TOKEN=(.+)$/m)?.[1];

const res = await fetch(`${base}/api/admin/migrate`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
});
console.log(res.status, await res.text());
process.exit(res.ok ? 0 : 1);

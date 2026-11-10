// 게스트 신원. 3단계에서 로그인 계정으로 바뀐다.
function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장소를 못 쓰는 브라우저에서는 새로고침하면 자리를 잃는다.
  }
}

let pid = read('bb:pid');
if (!pid) {
  pid = crypto.randomUUID();
  write('bb:pid', pid);
}

/** 이 브라우저의 비밀 값. 방에서 내 자리를 되찾는 데 쓴다. */
export const playerId = pid;

export const loadName = () => read('bb:name');
export const saveName = (name: string) => write('bb:name', name);

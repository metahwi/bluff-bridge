// 채팅 기록과 의견(피드백) 저장 (D1).
//  - 채팅: 신고·분쟁 확인용으로 CHAT_KEEP_DAYS일 동안만 보관하고, 매일 한 번 오래된 것을 지운다.
//  - 의견: 로그인한 회원이 설정 창에서 보낸 글.

/** 채팅 보관 기간(일). 개인정보 처리방침(화면의 /privacy)에도 같은 숫자를 적어 둔다. */
export const CHAT_KEEP_DAYS = 7;
/** 한 사람이 하루에 보낼 수 있는 의견 수. */
export const FEEDBACK_PER_DAY = 5;
export const FEEDBACK_MIN = 5;
export const FEEDBACK_MAX = 1000;

export const STORE_TABLES = [
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    text TEXT,
    preset INTEGER,
    quick_match INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS chat_messages_time ON chat_messages (created_at)`,
  `CREATE INDEX IF NOT EXISTS chat_messages_room ON chat_messages (room_code, created_at)`,
  `CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    page TEXT,
    mode TEXT,
    agent TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS feedback_user ON feedback (user_id, created_at)`,
];

export interface ChatRecord {
  roomCode: string;
  userId: string;
  name: string;
  /** 직접 쓴 글(서버가 다듬은 뒤의 글). 정해진 말이면 없다. */
  text?: string;
  /** 정해진 말의 번호. */
  preset?: number;
  quickMatch: boolean;
}

export async function saveChat(db: D1Database, m: ChatRecord): Promise<void> {
  await db
    .prepare('INSERT INTO chat_messages (room_code, user_id, name, text, preset, quick_match, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(m.roomCode, m.userId, m.name, m.text ?? null, m.preset ?? null, m.quickMatch ? 1 : 0, Date.now())
    .run();
}

/** 보관 기간이 지난 채팅을 지운다. 지운 줄 수를 돌려준다. */
export async function purgeOldChat(db: D1Database, now = Date.now()): Promise<number> {
  const cutoff = now - CHAT_KEEP_DAYS * 24 * 60 * 60 * 1000;
  const res = await db.prepare('DELETE FROM chat_messages WHERE created_at < ?').bind(cutoff).run();
  return res.meta.changes ?? 0;
}

export async function recentChat(db: D1Database, room: string | null, limit = 200) {
  const stmt = room
    ? db.prepare('SELECT * FROM chat_messages WHERE room_code = ? ORDER BY id DESC LIMIT ?').bind(room, limit)
    : db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?').bind(limit);
  return (await stmt.all()).results;
}

export interface FeedbackInput {
  userId: string;
  name: string;
  text: string;
  page?: string;
  mode?: string;
  agent?: string;
}

/** 의견을 저장한다. 하루 한도를 넘었으면 저장하지 않고 false를 돌려준다. */
export async function saveFeedback(db: D1Database, f: FeedbackInput): Promise<boolean> {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const row = await db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND created_at > ?').bind(f.userId, since).first<{ n: number }>();
  if ((row?.n ?? 0) >= FEEDBACK_PER_DAY) return false;
  await db
    .prepare('INSERT INTO feedback (user_id, name, text, page, mode, agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(f.userId, f.name, f.text, f.page?.slice(0, 100) ?? null, f.mode?.slice(0, 20) ?? null, f.agent?.slice(0, 300) ?? null, Date.now())
    .run();
  return true;
}

export async function recentFeedback(db: D1Database, limit = 200) {
  return (await db.prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT ?').bind(limit).all()).results;
}

/** 게스트가 회원이 되면 게스트 때의 채팅 기록도 새 계정 것으로 바꾼다. */
export async function moveChat(db: D1Database, fromUserId: string, toUserId: string): Promise<void> {
  if (fromUserId === toUserId) return;
  await db.prepare('UPDATE chat_messages SET user_id = ? WHERE user_id = ?').bind(toUserId, fromUserId).run();
}

/** 탈퇴: 그 사람이 보낸 채팅과 의견을 지우고, 전적에서는 계정과의 연결만 끊는다(상대의 전적은 남아야 하므로). */
export async function eraseUser(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM chat_messages WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM feedback WHERE user_id = ?').bind(userId),
    db.prepare("UPDATE match_players SET user_id = 'deleted' WHERE user_id = ?").bind(userId),
  ]);
}
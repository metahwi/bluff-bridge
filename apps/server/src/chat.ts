// 채팅 글 다듬기. 어린 사용자도 쓰는 서비스라, 보내기 전에 서버에서 한 번 거른다.
import { CHAT_MAX } from '@bluff-bridge/protocol';

/** 가려 줄 말(욕설). 완벽한 차단이 아니라 흔한 것만 막는 최소한의 목록이다. */
const BANNED = [
  '시발', '씨발', '씨바', 'ㅅㅂ', 'ㅆㅂ', '병신', 'ㅂㅅ', '지랄', 'ㅈㄹ', '좆', 'ㅈ같', '존나', 'ㅈㄴ',
  '개새끼', '개새', '새끼', '미친놈', '미친년', '느금', '니애미', '창녀',
  'fuck', 'shit', 'bitch', 'asshole',
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 글자 사이에 공백이나 기호를 끼워 넣어도 걸리게 한다(예: 시 발, 시.발). */
const bannedPattern = new RegExp(BANNED.map((w) => [...w].map(escape).join('[\\s._\\-*~!1]*')).join('|'), 'gi');

/**
 * 보낼 수 있는 글로 다듬는다. 빈 글이면 ''를 돌려준다.
 *  - 줄바꿈·제어 문자를 없애고 길이를 자른다.
 *  - 욕설은 ♥로 가린다.
 *  - 링크와 전화번호처럼 보이는 긴 숫자는 가린다(모르는 사람에게 연락처를 넘기지 않게).
 */
export function cleanChat(raw: string): string {
  let text = raw
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  text = [...text].slice(0, CHAT_MAX).join('');
  text = text.replace(/(https?:\/\/|www\.)\S+/gi, '(링크)').replace(/\S+\.(com|net|kr|io|gg|me|org)\b\S*/gi, '(링크)');
  text = text.replace(/(\d[\s\-.]?){8,}/g, '(번호) ');
  text = text.replace(bannedPattern, (m) => '♥'.repeat(Math.max(2, [...m.replace(/[\s._\-*~!1]/g, '')].length)));
  return text.trim();
}

/**
 * 닉네임 다듬기. 닉네임은 방, 전적, 공개 순위표에 그대로 보이므로 채팅과 같은 기준으로 욕설을 가린다.
 * 다듬고 나서 남는 글자가 없으면 ''를 돌려준다.
 */
export function cleanName(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(bannedPattern, (m) => '♥'.repeat(Math.max(2, [...m.replace(/[\s._\-*~!1]/g, '')].length)))
    .trim();
}
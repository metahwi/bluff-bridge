import { z } from 'zod';
import type { ClientMessage } from './types.ts';

export * from './types.ts';

const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('roll') }).strict(),
  z.object({ type: z.literal('claim'), value: z.number().int().min(1).max(9) }).strict(),
  z.object({ type: z.literal('accept') }).strict(),
  z.object({ type: z.literal('challenge') }).strict(),
]);

/** 브라우저에서 온 메시지 검증. 서버는 이 검사를 통과한 것만 처리한다. */
export const clientMessage: z.ZodType<ClientMessage> = z.discriminatedUnion('t', [
  z.object({ t: z.literal('ready'), ready: z.boolean() }).strict(),
  z.object({ t: z.literal('start') }).strict(),
  z.object({ t: z.literal('act'), action }).strict(),
  z.object({ t: z.literal('rematch') }).strict(),
  z.object({ t: z.literal('chat'), text: z.string().min(1).max(200).optional(), preset: z.number().int().min(0).max(31).optional() }).strict(),
  z.object({ t: z.literal('leave') }).strict(),
]);

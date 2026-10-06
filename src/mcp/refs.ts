// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { createHash } from 'node:crypto';
import * as z from 'zod';
import { ToolError } from './errors.js';

// message_ref / thread_ref = "<account id>:<Gmail id>". The account part is
// always resolved against the local registry and the Gmail id is only ever
// fetched with that account's own token.

export const REF_PATTERN = /^(acc_[a-z2-7]{16}):([A-Za-z0-9_-]{1,256})$/;

export function makeRef(accountId: string, providerId: string): string {
  return `${accountId}:${providerId}`;
}

export function parseRef(ref: string, what: 'message_ref' | 'thread_ref'): { accountId: string; providerId: string } {
  const m = REF_PATTERN.exec(ref);
  if (!m) throw new ToolError('INVALID_ARGUMENT', `${what} is not valid. Use a ${what} returned by search_emails.`);
  return { accountId: m[1]!, providerId: m[2]! };
}

// Search cursor: which page and offset each account is at, plus a
// fingerprint of the search so a cursor can't be replayed with other filters.
const CursorSchema = z.object({
  v: z.literal(1),
  f: z.string(),
  a: z.record(z.string().regex(/^acc_[a-z2-7]{16}$/), z.object({ t: z.string().max(512).optional(), o: z.number().int().min(0).max(500) })),
});
export type CursorState = z.infer<typeof CursorSchema>['a'];

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url').slice(0, 22);
}

export function encodeCursor(fp: string, state: CursorState): string | null {
  if (Object.keys(state).length === 0) return null;
  return Buffer.from(JSON.stringify({ v: 1, f: fp, a: state })).toString('base64url');
}

export function decodeCursor(cursor: string, fp: string): CursorState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new ToolError('INVALID_CURSOR', 'The cursor is not valid. Run the search again without a cursor.');
  }
  const result = CursorSchema.safeParse(parsed);
  if (!result.success) throw new ToolError('INVALID_CURSOR', 'The cursor is not valid. Run the search again without a cursor.');
  if (result.data.f !== fp) {
    throw new ToolError('INVALID_CURSOR', 'The cursor belongs to a different search. Use the same filters, or search again without a cursor.');
  }
  return result.data.a;
}

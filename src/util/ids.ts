// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export function randomBase32(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += BASE32[bytes[i]! % 32];
  return out;
}

export const ACCOUNT_ID_PATTERN = /^acc_[a-z2-7]{16}$/;

export function newAccountId(): string {
  return `acc_${randomBase32(16)}`;
}

export function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

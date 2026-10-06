// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import type { SearchFilters } from '../types.js';

// Structured filters → Gmail search syntax. Values are quoted and stripped of
// characters that would let them escape into other operators.

const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

function quote(value: string): string {
  const cleaned = value.replace(/["(){}\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.includes(' ') ? `"${cleaned}"` : cleaned;
}

function gmailDate(iso: string): string {
  return iso.replaceAll('-', '/');
}

export function buildGmailQuery(f: SearchFilters): string {
  const parts: string[] = [];
  if (f.query) parts.push(f.query.replace(CONTROL_CHARS, ' ').trim());
  if (f.from) parts.push(`from:${quote(f.from)}`);
  if (f.to) parts.push(`to:${quote(f.to)}`);
  if (f.subject) parts.push(`subject:${quote(f.subject)}`);
  if (f.after) parts.push(`after:${gmailDate(f.after)}`);
  if (f.before) parts.push(`before:${gmailDate(f.before)}`);
  if (f.has_attachment === true) parts.push('has:attachment');
  if (f.is_unread === true) parts.push('is:unread');
  if (f.is_unread === false) parts.push('-is:unread');
  if (f.in_inbox_only === true) parts.push('in:inbox');
  return parts.filter(Boolean).join(' ');
}

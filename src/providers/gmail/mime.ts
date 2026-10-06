// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { cleanText, htmlToText } from '../../content/sanitize.js';
import type { Address, AttachmentMeta } from '../types.js';

// Minimal shapes of the Gmail API resources we read.
export interface GmailHeader {
  name?: string;
  value?: string;
}
export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailPart;
}

export const MAX_DECODED_BODY_BYTES = 2 * 1024 * 1024;
const MAX_PARTS = 200;
const MAX_DEPTH = 12;

export function header(part: GmailPart | undefined, name: string): string | null {
  const h = part?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return typeof h?.value === 'string' ? h.value : null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Splits an address-list header, respecting quotes and angle brackets. */
export function parseAddressList(value: string | null): Address[] {
  if (!value) return [];
  const out: Address[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;
  for (const ch of value) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === '<' && !inQuotes) inAngle = true;
    else if (ch === '>' && !inQuotes) inAngle = false;
    if (ch === ',' && !inQuotes && !inAngle) {
      pushAddress(current, out);
      current = '';
    } else current += ch;
    if (out.length >= 100) break;
  }
  pushAddress(current, out);
  return out;
}

function pushAddress(raw: string, out: Address[]) {
  const s = raw.trim();
  if (!s) return;
  const m = /^(.*)<([^>]+)>\s*$/.exec(s);
  if (m) {
    const name = cleanText(m[1]!.trim().replace(/^"|"$/g, '').trim()).slice(0, 200);
    const email = cleanText(m[2]!.trim()).slice(0, 320);
    out.push(name ? { name, email } : { email });
  } else {
    out.push({ email: cleanText(s).slice(0, 320) });
  }
}

export function decodeBase64Url(data: string, maxBytes = MAX_DECODED_BODY_BYTES): Buffer {
  // 4 base64 chars encode 3 bytes; cut the input before decoding huge bodies.
  const maxChars = Math.ceil(maxBytes / 3) * 4;
  return Buffer.from(data.length > maxChars ? data.slice(0, maxChars) : data, 'base64url');
}

function charsetOf(part: GmailPart): string {
  const ct = header(part, 'Content-Type') ?? '';
  const m = /charset="?([\w.-]+)"?/i.exec(ct);
  return (m?.[1] ?? 'utf-8').toLowerCase();
}

export function decodeText(part: GmailPart): string {
  const data = part.body?.data;
  if (!data) return '';
  const bytes = decodeBase64Url(data);
  try {
    return new TextDecoder(charsetOf(part), { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

export interface WalkResult {
  plain: string[];
  html: string[];
  attachments: AttachmentMeta[];
}

/** Iterative walk with depth and part-count limits so malformed or hostile MIME trees can't blow up. */
export function walkParts(root: GmailPart | undefined): WalkResult {
  const result: WalkResult = { plain: [], html: [], attachments: [] };
  if (!root) return result;
  const stack: Array<{ part: GmailPart; depth: number }> = [{ part: root, depth: 0 }];
  let seen = 0;
  while (stack.length > 0 && seen < MAX_PARTS) {
    const { part, depth } = stack.pop()!;
    seen++;
    const mime = (part.mimeType ?? '').toLowerCase();
    const isAttachment = Boolean(part.filename) || Boolean(part.body?.attachmentId && !mime.startsWith('multipart/'));
    if (isAttachment) {
      if (part.body?.attachmentId) {
        result.attachments.push({
          attachment_id: part.body.attachmentId,
          filename: cleanText(part.filename || 'unnamed').slice(0, 255),
          mime_type: mime || 'application/octet-stream',
          size_bytes: part.body.size ?? 0,
        });
      }
      continue;
    }
    if (mime === 'text/plain') result.plain.push(decodeText(part));
    else if (mime === 'text/html') result.html.push(decodeText(part));
    if (part.parts && depth < MAX_DEPTH) {
      for (let i = part.parts.length - 1; i >= 0; i--) stack.push({ part: part.parts[i]!, depth: depth + 1 });
    }
  }
  return result;
}

/** Plain text is preferred; HTML is converted (hidden text removed) when there is no plain part. */
export function bodyText(walk: WalkResult): string {
  const plain = walk.plain.join('\n\n').trim();
  if (plain) return cleanText(plain);
  const html = walk.html.join('\n');
  return html ? htmlToText(html) : '';
}

export function hasAttachmentsHint(payload: GmailPart | undefined): boolean {
  if (!payload) return false;
  if ((payload.mimeType ?? '').toLowerCase() === 'multipart/mixed') return true;
  return walkParts(payload).attachments.length > 0;
}

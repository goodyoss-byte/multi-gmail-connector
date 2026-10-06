// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { convert } from 'html-to-text';

// Email content is untrusted. Everything that reaches Claude passes through
// here: HTML becomes plain text, hidden text is dropped, invisible and
// direction-override characters are removed, and lengths are capped.

// Built from escaped strings so the source stays plain ASCII.
const INVISIBLE = new RegExp('[\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF\\u00AD]', 'g');
// C0/C1 control characters except tab and newline.
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]', 'g');

const HIDDEN_SELECTORS = [
  '[hidden]',
  '[aria-hidden="true"]',
  '[style*="display:none"]',
  '[style*="display: none"]',
  '[style*="visibility:hidden"]',
  '[style*="visibility: hidden"]',
  '[style*="font-size:0"]',
  '[style*="font-size: 0"]',
  '[style*="max-height:0"]',
  '[style*="max-height: 0"]',
  '[style*="opacity:0"]',
  '[style*="opacity: 0"]',
];

export function cleanText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(CONTROL, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One-line fields (subject, snippet, names). */
export function cleanLine(input: string, maxChars: number): string {
  const text = cleanText(input).replace(/\s+/g, ' ');
  return truncate(text, maxChars).text;
}

export function shortenUrl(raw: string): string {
  if (raw.length <= 100) return raw;
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname.slice(0, 40)}…`;
  } catch {
    return raw.slice(0, 100) + '…';
  }
}

export function htmlToText(html: string): string {
  // Strip invisible characters first: html-to-text treats some as whitespace.
  const text = convert(html.replace(INVISIBLE, ''), {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'head', format: 'skip' },
      ...HIDDEN_SELECTORS.map((selector) => ({ selector, format: 'skip' })),
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true, ignoreHref: false } },
      { selector: 'table', format: 'dataTable' },
    ],
  });
  // Keep links readable but bounded; the host stays visible.
  return cleanText(text.replace(/\[(https?:\/\/[^\]\s]+)\]/g, (_m, url: string) => `[${shortenUrl(url)}]`));
}

export interface Truncated {
  text: string;
  truncated: boolean;
  original_chars: number;
}

export function truncate(text: string, maxChars: number): Truncated {
  const chars = Array.from(text); // don't split surrogate pairs
  if (chars.length <= maxChars) return { text, truncated: false, original_chars: chars.length };
  return { text: chars.slice(0, Math.max(0, maxChars - 1)).join('') + '…', truncated: true, original_chars: chars.length };
}

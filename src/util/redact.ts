// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
// Redaction for anything that might reach logs or error messages.
// Two layers: sensitive keys are replaced wholesale, and string values are
// scrubbed for known credential shapes even under innocent-looking keys.

const SENSITIVE_KEY =
  /(token|secret|password|passwd|authorization|cookie|code_verifier|verifier|client_secret|refresh|access_token|id_token|api[-_]?key|^code$|^state$|^nonce$)/i;

const SECRET_PATTERNS: RegExp[] = [
  /ya29\.[0-9A-Za-z_\-.]+/g, // Google access tokens
  /1\/\/[0-9A-Za-z_\-]{10,}/g, // Google refresh tokens
  /GOCSPX-[0-9A-Za-z_\-]+/g, // Google OAuth client secrets
  /eyJ[0-9A-Za-z_\-]+\.[0-9A-Za-z_\-]+\.[0-9A-Za-z_\-]+/g, // JWTs (ID tokens)
  /(Bearer\s+)[0-9A-Za-z_\-.~+/]+=*/gi, // Authorization headers
  /([?&](?:code|state|access_token|refresh_token|id_token|token)=)[^&#\s]+/gi, // tokens in URLs
];

export const REDACTED = '[REDACTED]';

export function redactString(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    // For patterns with a capture group, the group is a harmless prefix
    // ("Bearer ", "?code=") that we keep; otherwise the second argument is
    // the match offset (a number) and the whole match is replaced.
    out = out.replace(pattern, (_match, prefix: unknown) =>
      typeof prefix === 'string' ? `${prefix}${REDACTED}` : REDACTED,
    );
  }
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

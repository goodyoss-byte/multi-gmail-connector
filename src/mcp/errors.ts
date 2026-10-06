// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { AccountError } from '../accounts/account-service.js';
import { NeedsReauthError, NotConfiguredError } from '../accounts/token-manager.js';
import { ProviderError } from '../providers/types.js';
import { SecretStoreError } from '../secrets/secret-store.js';
import { ConfigError } from '../config/config-store.js';
import { RateLimitedError } from '../util/rate-limit.js';
import { redactString } from '../util/redact.js';

export type ToolErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_CURSOR'
  | 'NOT_CONFIGURED'
  | 'NO_ACCOUNTS_CONNECTED'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_NEEDS_RECONNECT'
  | 'MESSAGE_NOT_FOUND'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ATTACHMENT_TOO_LARGE'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'SECRET_STORE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly extra: { retryable?: boolean; retry_after_seconds?: number; account_id?: string; how_to_fix?: string } = {},
  ) {
    super(message);
  }
}

// Hints name the installed command. `cmec` is on PATH after a global install;
// from a cloned checkout the equivalent is `npm run cmec -- <command>`.
export const CLI = 'cmec';

export function reconnectHint(label: string): string {
  return `In a terminal, run: ${CLI} fix   (or ${CLI} reconnect "${label}" for this account only)`;
}

/** Maps any error to a safe, actionable ToolError. Never leaks tokens or stack traces. */
export function toToolError(err: unknown, account?: { id: string; label: string }): ToolError {
  if (err instanceof ToolError) return err;
  const acc = account ? { account_id: account.id } : {};
  if (err instanceof NeedsReauthError) {
    return new ToolError('ACCOUNT_NEEDS_RECONNECT', `Account "${account?.label ?? err.accountId}" needs to be reconnected.`, {
      ...acc,
      retryable: false,
      how_to_fix: reconnectHint(account?.label ?? err.accountId),
    });
  }
  if (err instanceof NotConfiguredError || err instanceof ConfigError || err instanceof AccountError) {
    return new ToolError('NOT_CONFIGURED', redactString(err.message), { retryable: false, how_to_fix: `In a terminal, run: ${CLI} setup` });
  }
  if (err instanceof SecretStoreError) {
    return new ToolError('SECRET_STORE_UNAVAILABLE', 'The OS keychain could not be read.', {
      retryable: true,
      how_to_fix: `Unlock your keychain, then run: ${CLI} doctor`,
    });
  }
  if (err instanceof RateLimitedError) {
    return new ToolError('PROVIDER_RATE_LIMITED', 'Too many requests for this account; wait and try again.', {
      ...acc,
      retryable: true,
      retry_after_seconds: err.retryAfterSeconds,
    });
  }
  if (err instanceof ProviderError) {
    switch (err.code) {
      case 'NOT_FOUND':
        return new ToolError('MESSAGE_NOT_FOUND', 'That email was not found in this account (it may have been deleted).', acc);
      case 'RATE_LIMITED':
        return new ToolError('PROVIDER_RATE_LIMITED', 'Gmail rate limit reached for this account; wait and try again.', {
          ...acc,
          retryable: true,
          retry_after_seconds: err.retryAfterSeconds ?? 30,
        });
      case 'UNAUTHORIZED':
      case 'FORBIDDEN':
        return new ToolError('ACCOUNT_NEEDS_RECONNECT', 'Gmail refused access for this account.', {
          ...acc,
          how_to_fix: reconnectHint(account?.label ?? 'label'),
        });
      case 'BAD_REQUEST':
        return new ToolError('INVALID_ARGUMENT', err.message, acc);
      default:
        return new ToolError('PROVIDER_UNAVAILABLE', 'Gmail is temporarily unavailable; try again shortly.', { ...acc, retryable: true });
    }
  }
  return new ToolError('INTERNAL_ERROR', 'Unexpected error while reading email.', { ...acc, retryable: true });
}

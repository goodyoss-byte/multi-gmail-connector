// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
// Where refresh tokens and the OAuth client secret live. Implementations must
// never write secrets in plaintext to disk.

export interface SecretStore {
  readonly kind: 'keychain' | 'encrypted-file' | 'memory';
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  /** Writes, reads and deletes a throwaway entry to prove the store works. */
  probe(): Promise<void>;
}

export class SecretStoreError extends Error {}

export const SECRET_KEYS = {
  googleClientSecret: 'google-client-secret',
  refreshToken: (accountId: string) => `refresh-token:${accountId}`,
} as const;

export class MemorySecretStore implements SecretStore {
  readonly kind = 'memory' as const;
  readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async delete(key: string) {
    return this.values.delete(key);
  }
  async probe() {}
}

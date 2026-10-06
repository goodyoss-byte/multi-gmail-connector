// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import * as z from 'zod';
import { ACCOUNT_ID_PATTERN, randomBase32 } from '../util/ids.js';

// config.json holds settings and the account registry. It must never contain
// secrets: refresh tokens and the OAuth client secret live in the SecretStore.

export const AccountStatus = z.enum(['active', 'needs_reauth']);
export type AccountStatus = z.infer<typeof AccountStatus>;

export const AccountRecord = z.object({
  id: z.string().regex(ACCOUNT_ID_PATTERN),
  provider: z.literal('google'),
  provider_account_id: z.string().min(1).max(255), // Google `sub`: the permanent identity
  email: z.string().min(3).max(320), // display only
  label: z.string().min(1).max(40),
  status: AccountStatus,
  include_in_search_all: z.boolean(),
  scopes: z.array(z.string()),
  connected_at: z.string(),
  /** Last successful Google sign-in. Optional: configs written before 1.0 lack it. */
  authorized_at: z.string().optional(),
  updated_at: z.string(),
});
export type AccountRecord = z.infer<typeof AccountRecord>;

export const ConfigFile = z.object({
  version: z.literal(1),
  secret_store: z.enum(['keychain', 'encrypted-file']).default('keychain'),
  google: z
    .object({
      client_id: z.string().regex(/^[\w.-]+\.apps\.googleusercontent\.com$/),
    })
    .optional(),
  accounts: z.array(AccountRecord).default([]),
});
export type ConfigFile = z.infer<typeof ConfigFile>;

export const EMPTY_CONFIG: ConfigFile = { version: 1, secret_store: 'keychain', accounts: [] };

export class ConfigError extends Error {}

export class ConfigStore {
  // Counts writes made through THIS instance. Readers use it to notice a change
  // that the file's mtime cannot show: two writes inside the same millisecond
  // leave mtime identical on most filesystems.
  private writes = 0;

  constructor(readonly path: string) {}

  /** Increases on every successful save, so in-process caches can invalidate. */
  get generation(): number {
    return this.writes;
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.path);
      return true;
    } catch {
      return false;
    }
  }

  async mtimeMs(): Promise<number | null> {
    try {
      return (await fs.stat(this.path)).mtimeMs;
    } catch {
      return null;
    }
  }

  async load(): Promise<ConfigFile> {
    let raw: string;
    try {
      raw = await fs.readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(EMPTY_CONFIG);
      throw err;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new ConfigError(`Config file is not valid JSON: ${this.path}`);
    }
    const parsed = ConfigFile.safeParse(json);
    if (!parsed.success) {
      throw new ConfigError(`Config file is invalid (${parsed.error.issues[0]?.message ?? 'unknown'}): ${this.path}`);
    }
    assertNoSecrets(json);
    return parsed.data;
  }

  /** Atomic write with owner-only permissions. */
  async save(config: ConfigFile): Promise<void> {
    assertNoSecrets(config); // check the input: parsing would silently drop unknown keys
    const valid = ConfigFile.parse(config);
    const dir = dirname(this.path);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = join(dir, `.config.${process.pid}.${randomBase32(8)}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(valid, null, 2) + '\n', { mode: 0o600 });
    await fs.rename(tmp, this.path);
    if (process.platform !== 'win32') await fs.chmod(this.path, 0o600);
    this.writes++;
  }

  /** Read-modify-write helper. */
  async update(fn: (config: ConfigFile) => ConfigFile | void): Promise<ConfigFile> {
    const config = await this.load();
    const result = fn(config) ?? config;
    await this.save(result);
    return result;
  }
}

/** Defence in depth: refuse to read or write a config that looks like it holds credentials. */
export function assertNoSecrets(value: unknown): void {
  const text = JSON.stringify(value);
  if (/"(refresh_token|access_token|client_secret|id_token)"\s*:/.test(text) || /ya29\.|1\/\/0|GOCSPX-/.test(text)) {
    throw new ConfigError('Refusing to use a config file that contains credentials. Secrets belong in the OS keychain.');
  }
}

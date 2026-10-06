// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { type AccountRecord, type ConfigFile, ConfigStore } from '../config/config-store.js';

// Read side of the account list, used by the MCP server. Re-reads config.json
// when it changes on disk, so accounts connected with the CLI show up without
// restarting Claude.

export class AccountRegistry {
  private cached: ConfigFile | null = null;
  private cachedMtime: number | null = null;
  private cachedGeneration = -1;

  constructor(readonly store: ConfigStore) {}

  async config(): Promise<ConfigFile> {
    const mtime = await this.store.mtimeMs();
    // mtime catches writes by the CLI in another process; the store's write
    // counter catches writes in this one, which can share a millisecond.
    if (!this.cached || mtime !== this.cachedMtime || this.store.generation !== this.cachedGeneration) {
      this.cached = await this.store.load();
      this.cachedMtime = mtime;
      this.cachedGeneration = this.store.generation;
    }
    return this.cached;
  }

  async list(): Promise<AccountRecord[]> {
    return (await this.config()).accounts;
  }

  /** Resolve an account by id or (case-insensitive) label. */
  async resolve(ref: string): Promise<AccountRecord | null> {
    const accounts = await this.list();
    const needle = ref.trim().toLowerCase();
    return (
      accounts.find((a) => a.id === ref.trim()) ??
      accounts.find((a) => a.label.toLowerCase() === needle) ??
      accounts.find((a) => a.email.toLowerCase() === needle) ??
      null
    );
  }

  async markStatus(accountId: string, status: AccountRecord['status']): Promise<void> {
    await this.store.update((cfg) => {
      const acc = cfg.accounts.find((a) => a.id === accountId);
      if (acc && acc.status !== status) {
        acc.status = status;
        acc.updated_at = new Date().toISOString();
      }
    });
    this.cached = null;
  }
}

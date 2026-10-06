// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { APP_NAME, LEGACY_APP_NAME } from '../config/paths.js';
import { type SecretStore, SecretStoreError } from './secret-store.js';

// OS-native storage: macOS Keychain, Windows Credential Manager, Linux Secret
// Service (GNOME Keyring / KWallet). Values stay small (a refresh token or a
// client secret) to fit Windows' per-credential size limit.

type AsyncEntryCtor = new (service: string, username: string) => {
  setPassword(password: string): Promise<void>;
  getPassword(): Promise<string | undefined | null>;
  deletePassword(): Promise<boolean>;
};

export class KeyringSecretStore implements SecretStore {
  readonly kind = 'keychain' as const;
  private ctor: AsyncEntryCtor | null = null;

  constructor(
    private readonly service: string = APP_NAME,
    /** Pre-1.0 service name; read-only, used once to carry entries over. */
    private readonly legacyService: string | null = LEGACY_APP_NAME,
  ) {}

  private async entry(key: string, service = this.service) {
    if (!this.ctor) {
      try {
        const mod = (await import('@napi-rs/keyring')) as unknown as { AsyncEntry: AsyncEntryCtor };
        this.ctor = mod.AsyncEntry;
      } catch (err) {
        throw new SecretStoreError(`OS keychain library could not be loaded: ${(err as Error).message}`);
      }
    }
    return new this.ctor(service, key);
  }

  async get(key: string): Promise<string | null> {
    const read = async (service: string): Promise<string | null> => {
      try {
        return (await (await this.entry(key, service)).getPassword()) ?? null;
      } catch (err) {
        if (/no ?entry|not found|NoEntry/i.test((err as Error).message)) return null;
        throw new SecretStoreError(`Could not read from the OS keychain: ${(err as Error).message}`);
      }
    };
    const value = await read(this.service);
    if (value !== null || !this.legacyService || this.legacyService === this.service) return value;
    // Renamed app: carry the entry over to the current service name, once.
    const legacy = await read(this.legacyService);
    if (legacy === null) return null;
    await this.set(key, legacy);
    return legacy;
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await (await this.entry(key)).setPassword(value);
    } catch (err) {
      throw new SecretStoreError(`Could not write to the OS keychain: ${(err as Error).message}`);
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      return await (await this.entry(key)).deletePassword();
    } catch (err) {
      if (/no ?entry|not found|NoEntry/i.test((err as Error).message)) return false;
      throw new SecretStoreError(`Could not delete from the OS keychain: ${(err as Error).message}`);
    }
  }

  async probe(): Promise<void> {
    const key = `probe:${process.pid}:${Date.now()}`;
    await this.set(key, 'ok');
    const value = await this.get(key);
    await this.delete(key);
    if (value !== 'ok') throw new SecretStoreError('The OS keychain did not return the value that was written.');
  }
}

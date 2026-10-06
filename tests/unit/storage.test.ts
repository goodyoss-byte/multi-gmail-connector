import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountRegistry } from '../../src/accounts/registry.js';
import { ConfigError, ConfigStore, EMPTY_CONFIG } from '../../src/config/config-store.js';
import { configDir } from '../../src/config/paths.js';
import { EncryptedFileSecretStore } from '../../src/secrets/encrypted-file-store.js';
import { KeyringSecretStore } from '../../src/secrets/keyring-store.js';
import { SecretStoreError } from '../../src/secrets/secret-store.js';
import { QuotaLimiter, RateLimitedError } from '../../src/util/rate-limit.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cmec-unit-'));
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

describe('config paths', () => {
  it('uses the platform config directory, overridable with CMEC_CONFIG_DIR', () => {
    expect(configDir({ CMEC_CONFIG_DIR: '/x' }, 'linux')).toBe('/x');
    expect(configDir({ XDG_CONFIG_HOME: '/xdg' }, 'linux')).toBe('/xdg/multi-gmail-connector');
    expect(configDir({}, 'darwin')).toMatch(/Library\/Application Support\/multi-gmail-connector$/);
    expect(configDir({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32')).toMatch(/multi-gmail-connector$/);
  });
});

describe('ConfigStore', () => {
  it('returns an empty config when none exists, and saves atomically with 0600', async () => {
    const store = new ConfigStore(join(dir, 'sub', 'config.json'));
    expect(await store.load()).toEqual(EMPTY_CONFIG);
    await store.save({ ...EMPTY_CONFIG, google: { client_id: 'x.apps.googleusercontent.com' } });
    expect((await store.load()).google?.client_id).toBe('x.apps.googleusercontent.com');
    if (process.platform !== 'win32') expect((await stat(store.path)).mode & 0o777).toBe(0o600);
  });

  it('refuses to save or load a config containing credentials', async () => {
    const store = new ConfigStore(join(dir, 'config.json'));
    await expect(store.save({ ...EMPTY_CONFIG, refresh_token: '1//0abc' } as never)).rejects.toThrow();
    await writeFile(store.path, JSON.stringify({ version: 1, accounts: [], client_secret: 'GOCSPX-x' }));
    await expect(store.load()).rejects.toBeInstanceOf(ConfigError);
  });

  it('reports invalid JSON and invalid shapes clearly', async () => {
    const store = new ConfigStore(join(dir, 'config.json'));
    await writeFile(store.path, '{not json');
    await expect(store.load()).rejects.toThrow(/not valid JSON/);
    await writeFile(store.path, JSON.stringify({ version: 2 }));
    await expect(store.load()).rejects.toThrow(/invalid/);
  });
});

describe('EncryptedFileSecretStore', () => {
  const pass = 'correct horse battery staple';

  it('round-trips values and never writes plaintext', async () => {
    const path = join(dir, 'secrets.enc.json');
    const store = new EncryptedFileSecretStore(path, pass);
    await store.set('refresh-token:acc_1', '1//0super-secret-refresh');
    expect(await store.get('refresh-token:acc_1')).toBe('1//0super-secret-refresh');
    const raw = await readFile(path, 'utf8');
    expect(raw).not.toContain('super-secret');
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await store.delete('refresh-token:acc_1')).toBe(true);
    expect(await store.get('refresh-token:acc_1')).toBeNull();
  });

  it('fails closed on a wrong passphrase or a moved ciphertext', async () => {
    const path = join(dir, 'secrets.enc.json');
    await new EncryptedFileSecretStore(path, pass).set('a', 'value-a');
    await expect(new EncryptedFileSecretStore(path, 'wrong passphrase value!').get('a')).rejects.toBeInstanceOf(SecretStoreError);
    const file = JSON.parse(await readFile(path, 'utf8'));
    file.entries.b = file.entries.a; // copy ciphertext to another key (AAD mismatch)
    await writeFile(path, JSON.stringify(file));
    await expect(new EncryptedFileSecretStore(path, pass).get('b')).rejects.toBeInstanceOf(SecretStoreError);
  });

  it('requires a long passphrase', async () => {
    await expect(new EncryptedFileSecretStore(join(dir, 's.json'), 'short').probe()).rejects.toThrow(/16 characters/);
    await expect(new EncryptedFileSecretStore(join(dir, 's.json'), undefined).set('a', 'b')).rejects.toThrow(/CMEC_SECRET_PASSPHRASE/);
  });
});

describe('AccountRegistry cache', () => {
  it('sees a second write that lands in the same millisecond as the first', async () => {
    const store = new ConfigStore(join(dir, 'config.json'));
    const registry = new AccountRegistry(store);
    const account = {
      id: 'acc_abcdefghijklmnop',
      provider: 'google' as const,
      provider_account_id: 'sub-1',
      email: 'a@example.com',
      label: 'A',
      status: 'active' as const,
      include_in_search_all: true,
      scopes: [],
      connected_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    // Hold the file's mtime at one exact instant across both writes, so the
    // only way to notice the second one is the store's own write counter.
    // (In the wild this happens when two writes land in the same millisecond.)
    const frozen = new Date(1_700_000_000_000);
    await store.save({ ...EMPTY_CONFIG, accounts: [account] });
    await utimes(store.path, frozen, frozen);
    expect((await registry.list())[0]!.status).toBe('active'); // caches it

    await store.save({ ...EMPTY_CONFIG, accounts: [{ ...account, status: 'needs_reauth' }] });
    await utimes(store.path, frozen, frozen);
    expect((await registry.list())[0]!.status).toBe('needs_reauth');
  });
});

describe('KeyringSecretStore', () => {
  it('either works or fails with a clear SecretStoreError (no keychain in CI containers)', async () => {
    const store = new KeyringSecretStore(`cmec-test-${process.pid}`);
    try {
      await store.probe();
      await store.set('k', 'v');
      expect(await store.get('k')).toBe('v');
      await store.delete('k');
    } catch (err) {
      expect(err).toBeInstanceOf(SecretStoreError);
    }
  });
});

describe('QuotaLimiter', () => {
  it('enforces a per-account budget and refills over time', () => {
    let now = 0;
    const q = new QuotaLimiter(100, () => now);
    q.charge('a', 60);
    q.charge('b', 100); // separate bucket
    expect(() => q.charge('a', 60)).toThrow(RateLimitedError);
    try {
      q.charge('a', 60);
    } catch (e) {
      expect((e as RateLimitedError).retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
    now += 30_000; // half a minute refills 50 units
    expect(() => q.charge('a', 60)).not.toThrow();
  });
});

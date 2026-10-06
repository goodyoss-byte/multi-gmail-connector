// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { AccountRegistry } from './accounts/registry.js';
import { AccountService } from './accounts/account-service.js';
import { TokenManager } from './accounts/token-manager.js';
import { ConfigStore } from './config/config-store.js';
import { migrateLegacyConfig } from './config/migrate.js';
import { configDir, configFile } from './config/paths.js';
import { MailService } from './mcp/mail-service.js';
import type { FetchFn } from './oauth/google.js';
import { EncryptedFileSecretStore } from './secrets/encrypted-file-store.js';
import { KeyringSecretStore } from './secrets/keyring-store.js';
import type { SecretStore } from './secrets/secret-store.js';
import type { Logger } from './util/logger.js';
import { QuotaLimiter } from './util/rate-limit.js';

// Wires the pieces together. Tests build the same graph with fakes.

export interface Runtime {
  dir: string;
  store: ConfigStore;
  secrets: SecretStore;
  accounts: AccountService;
  registry: AccountRegistry;
  tokens: TokenManager;
  mail: MailService;
}

export async function createSecretStore(store: ConfigStore, dir: string): Promise<SecretStore> {
  const cfg = await store.load();
  return cfg.secret_store === 'encrypted-file'
    ? new EncryptedFileSecretStore(EncryptedFileSecretStore.defaultPath(dir))
    : new KeyringSecretStore();
}

export function createRuntime(opts: {
  store: ConfigStore;
  secrets: SecretStore;
  log: Logger;
  fetchFn?: FetchFn;
  gmailBaseUrl?: string;
  dir?: string;
}): Runtime {
  const { store, secrets, log, fetchFn = fetch } = opts;
  const accounts = new AccountService(store, secrets, fetchFn);
  const registry = new AccountRegistry(store);
  const tokens = new TokenManager(
    secrets,
    () => accounts.googleClient(),
    (id) => registry.markStatus(id, 'needs_reauth'),
    log,
    fetchFn,
  );
  const mail = new MailService({ registry, tokens, limiter: new QuotaLimiter(), fetchFn, gmailBaseUrl: opts.gmailBaseUrl });
  return { dir: opts.dir ?? '', store, secrets, accounts, registry, tokens, mail };
}

export async function createDefaultRuntime(log: Logger): Promise<Runtime> {
  const dir = configDir();
  const migratedFrom = await migrateLegacyConfig(dir).catch(() => null);
  if (migratedFrom) log.info('config migrated from the previous install', { from: migratedFrom });
  const store = new ConfigStore(configFile(dir));
  const secrets = await createSecretStore(store, dir);
  return createRuntime({ store, secrets, log, dir });
}

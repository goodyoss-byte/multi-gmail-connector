// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { promises as fs } from 'node:fs';
import { configFile, legacyConfigDir } from './paths.js';

// The project was renamed after its first release. Anyone who installed the
// pre-1.0 build keeps their accounts: the config file is copied once from the
// old directory, and KeyringSecretStore falls back to the old keychain service.

/** Copies config.json from the pre-1.0 directory if this install has none. Returns the path copied from. */
export async function migrateLegacyConfig(dir: string, legacyDir: string | null = legacyConfigDir()): Promise<string | null> {
  const target = configFile(dir);
  try {
    await fs.access(target);
    return null; // already set up here
  } catch {
    /* fall through */
  }
  if (!legacyDir || legacyDir === dir) return null;
  const source = configFile(legacyDir);
  let raw: string;
  try {
    raw = await fs.readFile(source, 'utf8');
  } catch {
    return null; // nothing to migrate
  }
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // `flag: 'wx'` keeps a concurrent first run from clobbering a fresh config.
  try {
    await fs.writeFile(target, raw, { mode: 0o600, flag: 'wx' });
  } catch {
    return null;
  }
  return source;
}

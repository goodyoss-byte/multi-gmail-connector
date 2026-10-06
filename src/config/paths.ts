// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';

export const APP_NAME = 'multi-gmail-connector';
/** Pre-1.0 name. Config and keychain entries are migrated from it on first use. */
export const LEGACY_APP_NAME = 'claude-multi-email-connector';

function appDir(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  // Join with the target platform's separator, not the host's, so the result is
  // correct (and testable) when `platform` is not the platform we run on.
  const p = platform === 'win32' ? win32 : posix;
  const home = homedir();
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', name);
  if (platform === 'win32') return p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), name);
  return p.join(env.XDG_CONFIG_HOME || p.join(home, '.config'), name);
}

/** Per-user config directory. Holds config.json (no secrets). */
export function configDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.CMEC_CONFIG_DIR) return env.CMEC_CONFIG_DIR;
  return appDir(APP_NAME, env, platform);
}

/** Where the pre-1.0 release kept its config. Never used for writing. */
export function legacyConfigDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  if (env.CMEC_CONFIG_DIR) return null; // an explicit directory is authoritative
  return appDir(LEGACY_APP_NAME, env, platform);
}

export function configFile(dir = configDir()): string {
  return join(dir, 'config.json');
}

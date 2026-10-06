// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Writes the MCP server entry into Claude's own configuration so nobody has to
// hand-edit JSON. Other servers in the file are preserved and the previous file
// is kept as a .backup next to it.

/** The key Claude shows the connector under. */
export const SERVER_KEY = 'email';

export interface ServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** How this install should be started: the Node binary running us, and our own cli.js. */
export function serverEntry(env: NodeJS.ProcessEnv = process.env): ServerEntry {
  const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
  const extra: Record<string, string> = {};
  if (env.CMEC_CONFIG_DIR) extra.CMEC_CONFIG_DIR = env.CMEC_CONFIG_DIR;
  if (env.CMEC_SECRET_PASSPHRASE) extra.CMEC_SECRET_PASSPHRASE = env.CMEC_SECRET_PASSPHRASE;
  return { command: process.execPath, args: [cli, 'serve'], ...(Object.keys(extra).length ? { env: extra } : {}) };
}

/** Claude Desktop's config file for this OS. */
export function claudeDesktopConfigPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const home = homedir();
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'claude_desktop_config.json');
}

export type MergeOutcome = 'added' | 'updated' | 'unchanged';

export interface MergeResult {
  outcome: MergeOutcome;
  config: Record<string, unknown>;
}

/**
 * Puts `entry` under mcpServers[key] in an existing Claude config object,
 * leaving every other key untouched.
 */
export function mergeServerEntry(existing: unknown, entry: ServerEntry, key = SERVER_KEY): MergeResult {
  const config: Record<string, unknown> = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...(existing as object) } : {};
  const servers: Record<string, unknown> =
    config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers) ? { ...(config.mcpServers as object) } : {};
  const before = servers[key];
  const outcome: MergeOutcome = before === undefined ? 'added' : JSON.stringify(before) === JSON.stringify(entry) ? 'unchanged' : 'updated';
  servers[key] = entry;
  config.mcpServers = servers;
  return { outcome, config };
}

export interface InstallResult {
  path: string;
  outcome: MergeOutcome;
  backup: string | null;
}

/** Merges this server into Claude Desktop's config file, backing the old one up. */
export async function installIntoClaudeDesktop(opts: { path?: string; entry?: ServerEntry; key?: string } = {}): Promise<InstallResult> {
  const path = opts.path ?? claudeDesktopConfigPath();
  const entry = opts.entry ?? serverEntry();
  let existing: unknown = {};
  let raw: string | null = null;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (raw !== null && raw.trim() !== '') {
    try {
      existing = JSON.parse(raw);
    } catch {
      throw new Error(`${path} is not valid JSON. Fix or delete it, then run this again (nothing was changed).`);
    }
  }
  const { outcome, config } = mergeServerEntry(existing, entry, opts.key);
  if (outcome === 'unchanged') return { path, outcome, backup: null };

  let backup: string | null = null;
  if (raw !== null) {
    backup = `${path}.backup`;
    await fs.writeFile(backup, raw, { mode: 0o600 });
  }
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(tmp, path);
  return { path, outcome, backup };
}

export interface ClaudeCodeResult {
  ran: boolean;
  ok: boolean;
  detail: string;
  command: string;
}

/** Registers the server with Claude Code, if its CLI is installed. */
export function installIntoClaudeCode(entry: ServerEntry = serverEntry(), key = SERVER_KEY): ClaudeCodeResult {
  const args = ['mcp', 'add', '--scope', 'user', key, '--', entry.command, ...entry.args];
  const printable = `claude ${args.join(' ')}`;
  const probe = spawnSync('claude', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' });
  if (probe.error || probe.status !== 0) {
    return { ran: false, ok: false, detail: 'The Claude Code CLI was not found on PATH; skipped.', command: printable };
  }
  const res = spawnSync('claude', args, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (res.error) return { ran: true, ok: false, detail: res.error.message, command: printable };
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim().split('\n').slice(-2).join(' ');
  return { ran: true, ok: res.status === 0, detail: output || (res.status === 0 ? 'added' : `exit code ${res.status}`), command: printable };
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Writes the MCP server entry into Claude's own configuration so nobody has to
// hand-edit JSON. Other servers in the file are preserved and the previous file
// is kept as a .backup next to it.

/** The key Claude shows the connector under. */
export const SERVER_KEY = 'email';

export interface ServerEntry {
  /** Claude Code records the transport; Claude Desktop leaves it out. */
  type?: 'stdio';
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
  path: string;
}

/** Claude Code keeps its user-scope MCP servers here. */
export function claudeCodeConfigPath(): string {
  return join(homedir(), '.claude.json');
}

/**
 * Registers the server with Claude Code by editing its config directly.
 *
 * An earlier version shelled out to `claude mcp add`. On Windows the CLI is a
 * .cmd shim, which Node can only run through a shell, and a shell does not
 * escape the arguments: the default Node path, which contains a space, was
 * split at that space and Claude Code was left with command "C:\Program".
 * Writing the JSON ourselves has no quoting to get wrong, needs no CLI on PATH,
 * and overwrites our own key instead of failing with "already exists".
 */
export async function installIntoClaudeCode(opts: { entry?: ServerEntry; key?: string; path?: string } = {}): Promise<ClaudeCodeResult> {
  const { entry = serverEntry(), key = SERVER_KEY } = opts;
  const path = opts.path ?? claudeCodeConfigPath();
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ran: false, ok: false, detail: 'Claude Code is not installed here (no ~/.claude.json); skipped.', path };
    }
    return { ran: true, ok: false, detail: (err as Error).message, path };
  }
  let existing: unknown;
  try {
    existing = JSON.parse(raw);
  } catch {
    return { ran: true, ok: false, detail: `${path} is not valid JSON; left untouched.`, path };
  }
  // Claude Code records the transport explicitly; Claude Desktop infers it.
  const { outcome, config } = mergeServerEntry(existing, { type: 'stdio', ...entry, env: entry.env ?? {} }, key);
  if (outcome === 'unchanged') return { ran: true, ok: true, detail: 'already registered', path };
  await fs.writeFile(`${path}.backup`, raw, { mode: 0o600 });
  const tmp = `${path}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(tmp, path);
  return { ran: true, ok: true, detail: outcome === 'added' ? 'added' : 'updated', path };
}

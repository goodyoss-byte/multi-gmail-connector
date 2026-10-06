import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeDesktopConfigPath, installIntoClaudeCode, installIntoClaudeDesktop, mergeServerEntry, serverEntry } from '../../src/cli/claude-install.js';
import { migrateLegacyConfig } from '../../src/config/migrate.js';
import { configFile } from '../../src/config/paths.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cmec-install-'));
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

const ENTRY = { command: '/usr/local/bin/node', args: ['/opt/app/dist/cli.js', 'serve'] };

describe('Claude config writer', () => {
  it('points at this install: the running node binary and this cli.js', () => {
    const entry = serverEntry({});
    expect(entry.command).toBe(process.execPath);
    expect(entry.args[0]).toMatch(/cli\.js$/);
    expect(entry.args[1]).toBe('serve');
    expect(entry.env).toBeUndefined();
  });

  it('carries the config directory and passphrase into Claude when they are set', () => {
    const entry = serverEntry({ CMEC_CONFIG_DIR: '/tmp/cfg', CMEC_SECRET_PASSPHRASE: 'x'.repeat(20) });
    expect(entry.env).toEqual({ CMEC_CONFIG_DIR: '/tmp/cfg', CMEC_SECRET_PASSPHRASE: 'x'.repeat(20) });
  });

  it('uses the right config path per platform', () => {
    expect(claudeDesktopConfigPath({}, 'darwin')).toMatch(/Library[\\/]Application Support[\\/]Claude[\\/]claude_desktop_config\.json$/);
    expect(claudeDesktopConfigPath({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32')).toMatch(/Claude[\\/]claude_desktop_config\.json$/);
    expect(claudeDesktopConfigPath({ XDG_CONFIG_HOME: '/xdg' }, 'linux')).toMatch(/Claude[\\/]claude_desktop_config\.json$/);
  });

  it('keeps other servers and unrelated settings when merging', () => {
    const { outcome, config } = mergeServerEntry({ mcpServers: { other: { command: 'x', args: [] } }, theme: 'dark' }, ENTRY);
    expect(outcome).toBe('added');
    expect(config).toEqual({ mcpServers: { other: { command: 'x', args: [] }, email: ENTRY }, theme: 'dark' });
  });

  it('reports unchanged when the entry is already right, and updated when it differs', () => {
    const existing = { mcpServers: { email: ENTRY } };
    expect(mergeServerEntry(existing, ENTRY).outcome).toBe('unchanged');
    expect(mergeServerEntry(existing, { ...ENTRY, command: '/other/node' }).outcome).toBe('updated');
  });

  it('survives a config file that is missing, empty or not an object', () => {
    expect(mergeServerEntry(undefined, ENTRY).config.mcpServers).toEqual({ email: ENTRY });
    expect(mergeServerEntry([], ENTRY).config.mcpServers).toEqual({ email: ENTRY });
    expect(mergeServerEntry({ mcpServers: 'nonsense' }, ENTRY).config.mcpServers).toEqual({ email: ENTRY });
  });

  it('creates the file when Claude has no config yet', async () => {
    const path = join(dir, 'nested', 'claude_desktop_config.json');
    const res = await installIntoClaudeDesktop({ path, entry: ENTRY });
    expect(res).toMatchObject({ outcome: 'added', backup: null });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ mcpServers: { email: ENTRY } });
  });

  it('backs the old file up before changing it, and leaves it alone when nothing changes', async () => {
    const path = join(dir, 'claude_desktop_config.json');
    await writeFile(path, JSON.stringify({ mcpServers: { other: { command: 'keep', args: ['me'] } } }));
    const first = await installIntoClaudeDesktop({ path, entry: ENTRY });
    expect(first.outcome).toBe('added');
    expect(JSON.parse(await readFile(first.backup!, 'utf8')).mcpServers.email).toBeUndefined();
    const after = JSON.parse(await readFile(path, 'utf8'));
    expect(after.mcpServers.other).toEqual({ command: 'keep', args: ['me'] });

    const second = await installIntoClaudeDesktop({ path, entry: ENTRY });
    expect(second).toMatchObject({ outcome: 'unchanged', backup: null });
  });

  it('refuses to touch a config file that is not valid JSON', async () => {
    const path = join(dir, 'claude_desktop_config.json');
    await writeFile(path, '{ this is not json');
    await expect(installIntoClaudeDesktop({ path, entry: ENTRY })).rejects.toThrow(/not valid JSON/);
    expect(await readFile(path, 'utf8')).toBe('{ this is not json'); // untouched
  });
});

describe('Claude Code registration', () => {
  it('writes the entry verbatim, so a path with spaces survives', async () => {
    const path = join(dir, '.claude.json');
    const spaced = { command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\Program Files\\app\\cli.js', 'serve'] };
    await writeFile(path, JSON.stringify({ mcpServers: { other: { command: 'keep', args: [] } }, projects: { a: 1 } }));

    const res = await installIntoClaudeCode({ entry: spaced, path });
    expect(res).toMatchObject({ ran: true, ok: true, detail: 'added' });

    const after = JSON.parse(await readFile(path, 'utf8'));
    expect(after.mcpServers.email).toEqual({ type: 'stdio', ...spaced, env: {} });
    expect(after.mcpServers.email.command).toBe('C:\\Program Files\\nodejs\\node.exe'); // not split at the space
    expect(after.mcpServers.other).toEqual({ command: 'keep', args: [] });
    expect(after.projects).toEqual({ a: 1 }); // unrelated state untouched
    expect(JSON.parse(await readFile(`${path}.backup`, 'utf8')).mcpServers.email).toBeUndefined();
  });

  it('replaces an entry that is already there instead of failing', async () => {
    const path = join(dir, '.claude.json');
    await writeFile(path, JSON.stringify({ mcpServers: { email: { type: 'stdio', command: 'old', args: [], env: {} } } }));
    const res = await installIntoClaudeCode({ entry: ENTRY, path });
    expect(res).toMatchObject({ ok: true, detail: 'updated' });
    expect(JSON.parse(await readFile(path, 'utf8')).mcpServers.email.command).toBe(ENTRY.command);

    const again = await installIntoClaudeCode({ entry: ENTRY, path });
    expect(again).toMatchObject({ ok: true, detail: 'already registered' });
  });

  it('skips quietly when Claude Code is not installed, and never rewrites a broken file', async () => {
    const missing = await installIntoClaudeCode({ entry: ENTRY, path: join(dir, 'absent.json') });
    expect(missing).toMatchObject({ ran: false, ok: false });

    const broken = join(dir, 'broken.json');
    await writeFile(broken, '{ not json');
    const res = await installIntoClaudeCode({ entry: ENTRY, path: broken });
    expect(res).toMatchObject({ ran: true, ok: false });
    expect(await readFile(broken, 'utf8')).toBe('{ not json');
  });
});

describe('migration from the pre-1.0 install', () => {
  const config = { version: 1, secret_store: 'keychain', accounts: [] };

  it('copies the old config once, and never over an existing one', async () => {
    const legacy = join(dir, 'old');
    const current = join(dir, 'new');
    await mkdir(legacy, { recursive: true });
    await writeFile(configFile(legacy), JSON.stringify(config));

    expect(await migrateLegacyConfig(current, legacy)).toBe(configFile(legacy));
    expect(JSON.parse(await readFile(configFile(current), 'utf8'))).toEqual(config);

    // Running again is a no-op, and the old copy stays where it was.
    expect(await migrateLegacyConfig(current, legacy)).toBeNull();
    expect(JSON.parse(await readFile(configFile(legacy), 'utf8'))).toEqual(config);
  });

  it('never overwrites a config this install already has', async () => {
    const legacy = join(dir, 'old');
    const current = join(dir, 'new');
    await mkdir(legacy, { recursive: true });
    await mkdir(current, { recursive: true });
    await writeFile(configFile(legacy), JSON.stringify(config));
    await writeFile(configFile(current), JSON.stringify({ ...config, secret_store: 'encrypted-file' }));

    expect(await migrateLegacyConfig(current, legacy)).toBeNull();
    expect(JSON.parse(await readFile(configFile(current), 'utf8')).secret_store).toBe('encrypted-file');
  });

  it('does nothing when there is no previous install', async () => {
    expect(await migrateLegacyConfig(join(dir, 'new'), join(dir, 'absent'))).toBeNull();
    expect(await migrateLegacyConfig(join(dir, 'new'), null)).toBeNull();
  });
});

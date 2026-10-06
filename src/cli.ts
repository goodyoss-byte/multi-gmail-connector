#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AccountError } from './accounts/account-service.js';
import type { AccountRecord } from './config/config-store.js';
import { configFile } from './config/paths.js';
import { buildServer } from './mcp/server.js';
import { listEmailAccounts } from './mcp/tools.js';
import { createDefaultRuntime, type Runtime } from './runtime.js';
import { EncryptedFileSecretStore } from './secrets/encrypted-file-store.js';
import { SECRET_KEYS } from './secrets/secret-store.js';
import { ask, confirm, openBrowser, openUrl } from './cli/prompt.js';
import { readGoogleClientFile } from './cli/client-file.js';
import { claudeDesktopConfigPath, installIntoClaudeCode, installIntoClaudeDesktop, serverEntry } from './cli/claude-install.js';
import { createLogger } from './util/logger.js';
import { redactString } from './util/redact.js';

const HELP = `multi-gmail-connector — read-only, local MCP server for several Gmail accounts

Usage: cmec <command>        (from a cloned checkout: npm run cmec -- <command>)

  setup                      Do everything: Google client, accounts, and add it to Claude
  add [--label NAME]         Connect another Gmail account
  list                       Show connected accounts
  fix                        Check everything and renew any sign-in that has expired
  install [--yes]            Add (or update) this server in Claude Desktop and Claude Code
  remove <account>           Revoke access at Google and delete the stored token
  uninstall                  Revoke every account and delete all local data

  label <account> <new label>        Rename an account
  include <account> on|off           Include/exclude it from "search all"
  reconnect <account>                Re-authorise one account
  set-client <client.json>           Import a Google "Desktop app" OAuth client
  google-setup                       Walk through the Google Cloud steps
  claude-config                      Print the Claude configuration instead of writing it
  doctor                             Check everything (never shows email content)
  serve                              Run the MCP server over stdio (Claude starts this)

<account> is a label (e.g. "Personal"), an email address, or an account id (acc_…).
Config: ${configFile()}`;

const out = (s = '') => process.stdout.write(s + '\n');

const CONSOLE_STEPS: Array<{ title: string; url: string; what: string }> = [
  {
    title: 'Create a project',
    url: 'https://console.cloud.google.com/projectcreate',
    what: 'Name it anything (e.g. "my-mail-connector") and click Create. Wait for it to be selected.',
  },
  {
    title: 'Enable the Gmail API',
    url: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com',
    what: 'Click Enable.',
  },
  {
    title: 'Fill in the OAuth consent screen',
    url: 'https://console.cloud.google.com/auth/overview',
    what: 'Choose External, enter an app name and your own email, and finish. Leave the logo, home page, privacy policy and domain fields empty.',
  },
  {
    title: 'Add yourself as a test user',
    url: 'https://console.cloud.google.com/auth/audience',
    what: 'Under "Test users", add every Gmail address you want to connect. Keep the app in Testing.',
  },
  {
    title: 'Create the OAuth client and download its JSON',
    url: 'https://console.cloud.google.com/auth/clients',
    what: 'Create client → Application type "Desktop app" → Create → "Download JSON". No redirect URIs are needed.',
  },
];

async function main(argv: string[]): Promise<number> {
  const [raw, ...args] = argv;
  const cmd = raw?.toLowerCase();
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    out(HELP);
    return 0;
  }
  if (cmd === 'serve') return serve();
  if (cmd === '--version' || cmd === 'version') {
    const { SERVER_VERSION } = await import('./mcp/server.js');
    out(SERVER_VERSION);
    return 0;
  }

  const log = createLogger(undefined, 'warn');
  const rt = await createDefaultRuntime(log);
  // `accounts <sub>` is the pre-1.0 form of the account commands; both work.
  const [verb, rest] = cmd === 'accounts' ? [(args[0] ?? 'list').toLowerCase(), args.slice(1)] : [cmd, args];
  switch (verb) {
    case 'setup':
      return setup(rt);
    case 'google-setup':
      return googleSetup();
    case 'set-client':
      return setClient(rt, rest[0]);
    case 'install':
      return install(rt, { ask: !rest.some((a) => a === '--yes' || a === '-y') });
    case 'claude-config':
      printClaudeConfig();
      return 0;
    case 'list':
    case 'add':
    case 'reconnect':
    case 'label':
    case 'include':
    case 'remove':
      return accounts(rt, verb, rest);
    case 'fix':
      return fix(rt);
    case 'doctor':
      return doctor(rt);
    case 'uninstall':
      return uninstall(rt);
    default:
      out(`Unknown command: ${raw}\n`);
      out(HELP);
      return 1;
  }
}

async function serve(): Promise<number> {
  const log = createLogger();
  const rt = await createDefaultRuntime(log);
  const { serveStdio } = await import('@modelcontextprotocol/server/stdio');
  serveStdio(() => buildServer(rt.mail, log), { onerror: (e) => log.error('transport error', { error: e }) });
  log.info('MCP server started', { secret_store: rt.secrets.kind, config: rt.store.path });
  return new Promise<number>(() => {}); // runs until Claude closes stdin
}

async function findAccount(rt: Runtime, ref: string | undefined): Promise<AccountRecord> {
  if (!ref) throw new AccountError('Name an account (label, email or id). See `cmec list`.');
  const acc = await rt.registry.resolve(ref);
  if (!acc) throw new AccountError(`No account matches "${ref}". See \`cmec list\`.`);
  return acc;
}

async function connectInteractive(rt: Runtime, opts: { label?: string; reconnect?: AccountRecord }) {
  out('\nOpening your browser to sign in with Google…');
  out('If it does not open, copy this link into your browser:');
  const result = await rt.accounts.connect({
    ...opts,
    openBrowser: (url) => {
      out(`\n  ${url}\n`);
      openBrowser(url);
    },
  });
  const verb = result.created ? 'Connected' : 'Reconnected';
  out(`✔ ${verb} ${result.account.email} as "${result.account.label}" (${result.account.id})`);
  await verifyGmail(rt, result.account);
  return result.account;
}

async function verifyGmail(rt: Runtime, account: AccountRecord): Promise<boolean> {
  try {
    rt.tokens.forget(account.id);
    await rt.mail.provider(account).listMessageIds({}, 1);
    out(`✔ Gmail read access works for "${account.label}"`);
    return true;
  } catch (err) {
    out(`✘ Gmail check failed for "${account.label}": ${redactString((err as Error).message)}`);
    return false;
  }
}

async function accounts(rt: Runtime, sub: string, rest: string[]): Promise<number> {
  switch (sub) {
    case 'list': {
      const { accounts: list } = await listEmailAccounts(rt.mail);
      if (list.length === 0) {
        out('No accounts connected. Run: cmec add');
        return 0;
      }
      for (const a of list) {
        const age = a.days_since_sign_in === null ? '' : `signed in ${a.days_since_sign_in}d ago`;
        out(
          `${a.account_label.padEnd(16)} ${a.email_address.padEnd(36)} ${a.status.padEnd(13)} ${
            a.included_in_search_all ? 'search-all' : 'excluded  '
          } ${age.padEnd(20)} ${a.account_id}`,
        );
      }
      if (list.some((a) => a.action_needed)) out('\nSome accounts need attention. Run: cmec fix');
      return 0;
    }
    case 'add': {
      const i = rest.indexOf('--label');
      const label = i >= 0 ? rest[i + 1] : await ask('Label for this account (e.g. Personal, Business) [optional]: ');
      await connectInteractive(rt, { label: label || undefined });
      return 0;
    }
    case 'reconnect':
      await connectInteractive(rt, { reconnect: await findAccount(rt, rest[0]) });
      return 0;
    case 'label': {
      const acc = await findAccount(rt, rest[0]);
      if (!rest[1]) throw new AccountError('Give the new label: cmec label <account> <new label>');
      const updated = await rt.accounts.relabel(acc, rest.slice(1).join(' '));
      out(`✔ "${acc.label}" is now "${updated.label}"`);
      return 0;
    }
    case 'include': {
      const acc = await findAccount(rt, rest[0]);
      const on = rest[1] === 'on' ? true : rest[1] === 'off' ? false : null;
      if (on === null) throw new AccountError('Use: cmec include <account> on|off');
      await rt.accounts.setIncludeInSearchAll(acc, on);
      out(`✔ "${acc.label}" is ${on ? 'included in' : 'excluded from'} "search all"`);
      return 0;
    }
    case 'remove': {
      const acc = await findAccount(rt, rest[0]);
      if (!(await confirm(`Remove "${acc.label}" (${acc.email})? This revokes access at Google and deletes the stored token.`, false))) return 1;
      const { revoked } = await rt.accounts.disconnect(acc);
      out(`✔ Removed "${acc.label}". ${revoked ? 'Google confirmed the token was revoked.' : 'Could not confirm revocation with Google; check https://myaccount.google.com/permissions'}`);
      return 0;
    }
    default:
      out(`Unknown command: ${sub}`);
      return 1;
  }
}

/** Opens each Google Cloud Console page in turn so nobody has to hunt for them. */
async function googleSetup(): Promise<number> {
  out('\nGoogle Cloud setup — about 5 minutes, all free.\n');
  out('You need your own OAuth client because Gmail read access is a "restricted" permission:');
  out('a shared one would ship a secret in the code and need Google\'s paid security assessment.\n');
  for (const [i, step] of CONSOLE_STEPS.entries()) {
    out(`${i + 1}/${CONSOLE_STEPS.length}  ${step.title}`);
    out(`    ${step.what}`);
    out(`    ${step.url}`);
    if (await confirm('    Open this page now?', true)) openUrl(step.url);
    await ask('    Press Enter when done. ');
    out('');
  }
  out('Keep the downloaded JSON file handy — the next step reads it.\n');
  return 0;
}

/** Finds a freshly downloaded Google client file so the user doesn't have to type a path. */
async function findDownloadedClientFile(): Promise<string | null> {
  const dirs = [join(homedir(), 'Downloads'), join(homedir(), 'Desktop'), process.cwd()];
  let best: { path: string; at: number } | null = null;
  for (const dir of dirs) {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/^client_secret.*\.json$/i.test(name)) continue;
      const path = join(dir, name);
      try {
        const stat = await fs.stat(path);
        if (!best || stat.mtimeMs > best.at) best = { path, at: stat.mtimeMs };
      } catch {
        /* ignore */
      }
    }
  }
  return best?.path ?? null;
}

const unquote = (s: string) => s.trim().replace(/^['"]|['"]$/g, '');

async function setClient(rt: Runtime, pathArg: string | undefined): Promise<number> {
  let path = pathArg ? unquote(pathArg) : null;
  if (!path) {
    const found = await findDownloadedClientFile();
    if (found && (await confirm(`Found ${found}. Use it?`, true))) path = found;
  }
  if (!path) {
    out('\nPaste the path to the downloaded client JSON, or paste the client ID itself.');
    const answer = unquote(await ask('Client JSON path or client ID: '));
    if (/\.apps\.googleusercontent\.com$/.test(answer)) {
      const secret = unquote(await ask('Client secret (starts with GOCSPX-): '));
      await rt.accounts.configureGoogleClient(answer, secret);
      out(`✔ Saved. The secret is in your ${rt.secrets.kind === 'keychain' ? 'OS keychain' : 'encrypted secret file'}, never in a file you can read.`);
      return 0;
    }
    path = answer;
  }
  const { clientId, clientSecret } = await readGoogleClientFile(path);
  await rt.accounts.configureGoogleClient(clientId, clientSecret);
  out(`✔ Saved client ID in config and client secret in your ${rt.secrets.kind === 'keychain' ? 'OS keychain' : 'encrypted secret file'}.`);
  if (await confirm('Delete the downloaded client file now? (recommended — it is no longer needed)', true)) {
    await fs.rm(path, { force: true });
    out('✔ Deleted.');
  }
  return 0;
}

async function setup(rt: Runtime): Promise<number> {
  out('Multi-Gmail Connector for Claude — setup\n');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) {
    out(`✘ Node.js ${process.versions.node} found; version 22 or newer is required. Install it from https://nodejs.org/ and run setup again.`);
    return 1;
  }
  out(`✔ Node.js ${process.versions.node}`);
  out(`• Settings file: ${rt.store.path}`);

  try {
    await rt.secrets.probe();
    out(`✔ Secret storage works (${rt.secrets.kind === 'keychain' ? 'OS keychain' : 'encrypted file'})`);
  } catch (err) {
    out(`✘ Secret storage is not available: ${(err as Error).message}`);
    if (rt.secrets.kind === 'keychain') {
      out('\nNo OS keychain is available (common on headless Linux, WSL and containers).');
      out('Options: install/unlock a Secret Service keyring (GNOME Keyring or KWallet), or use the');
      out('encrypted-file store: set CMEC_SECRET_PASSPHRASE (16+ characters) in your environment and');
      out('in your Claude MCP configuration, then run setup again. See docs/SECURITY_DESIGN.md.');
      if (process.env.CMEC_SECRET_PASSPHRASE && (await confirm('\nCMEC_SECRET_PASSPHRASE is set. Switch to the encrypted-file store?', false))) {
        const store = new EncryptedFileSecretStore(EncryptedFileSecretStore.defaultPath(dirname(rt.store.path)));
        await store.probe();
        await rt.store.update((c) => {
          c.secret_store = 'encrypted-file';
        });
        out('✔ Switched to the encrypted-file store. Run `cmec setup` again to continue.');
      }
    }
    return 1;
  }

  const cfg = await rt.store.load();
  const hasSecret = Boolean(await rt.secrets.get(SECRET_KEYS.googleClientSecret));
  if (cfg.google?.client_id && hasSecret) {
    out(`✔ Google OAuth client configured (${cfg.google.client_id.slice(0, 12)}…)`);
  } else {
    out('\nStep 1 of 3 — your own Google OAuth client.');
    if (await confirm('Walk through the Google Cloud Console steps now?', true)) await googleSetup();
    await setClient(rt, undefined);
  }

  const existing = await rt.registry.list();
  if (existing.length > 0) out(`\nConnected accounts: ${existing.map((a) => `${a.label} <${a.email}>`).join(', ')}`);
  out('\nStep 2 of 3 — connect your Gmail accounts.');
  out('Google will warn that the app is not verified; that is your own app. Choose Advanced → Go to … (unsafe),');
  out('then make sure the Gmail read permission stays ticked.');
  let count = existing.length;
  while (await confirm(count === 0 ? '\nConnect a Gmail account now?' : '\nConnect another Gmail account?', count === 0)) {
    const label = await ask('Label for this account (e.g. Personal, Business) [optional]: ');
    try {
      await connectInteractive(rt, { label: label || undefined });
      count = (await rt.registry.list()).length;
    } catch (err) {
      out(`✘ ${redactString((err as Error).message)}`);
    }
  }

  out('\nStep 3 of 3 — add the connector to Claude.');
  await install(rt, { ask: true });
  return 0;
}

/** Writes the server into Claude Desktop's config and registers it with Claude Code. */
async function install(rt: Runtime, opts: { ask: boolean }): Promise<number> {
  const entry = serverEntry();
  const path = claudeDesktopConfigPath();
  if (opts.ask && !(await confirm(`\nAdd the connector to Claude automatically? (edits ${path}; other servers are kept)`, true))) {
    out('');
    printClaudeConfig();
    return 0;
  }
  try {
    const res = await installIntoClaudeDesktop({ entry, path });
    if (res.outcome === 'unchanged') out(`✔ Claude Desktop already points at this install (${res.path})`);
    else {
      out(`✔ ${res.outcome === 'added' ? 'Added' : 'Updated'} the "email" server in ${res.path}`);
      if (res.backup) out(`  Previous file kept as ${res.backup}`);
      out('  Quit and reopen Claude Desktop for it to appear.');
    }
  } catch (err) {
    out(`✘ Could not write Claude Desktop's config: ${(err as Error).message}`);
    out('');
    printClaudeConfig();
  }
  const code = await installIntoClaudeCode({ entry });
  if (code.ran && code.ok) out(`✔ Claude Code: ${code.detail} (${code.path})`);
  else if (code.ran) out(`✘ Claude Code: ${code.detail}`);
  else out(`• ${code.detail}`);

  const list = await rt.registry.list();
  if (list.length === 0) out('\nNo accounts are connected yet. Run `cmec add` before asking Claude about your email.');
  else out(`\nReady: ${list.length} account(s) connected. Try asking Claude: "Search all my connected inboxes for …"`);
  return 0;
}

function printClaudeConfig() {
  const entry = serverEntry();
  out('Claude Code (run once in a terminal):');
  out(`  claude mcp add --scope user email -- "${entry.command}" "${entry.args[0]}" serve\n`);
  out(`Claude Desktop — merge this into ${claudeDesktopConfigPath()} (Settings → Developer → Edit Config), then restart Claude:`);
  out(
    JSON.stringify({ mcpServers: { email: entry } }, null, 2)
      .split('\n')
      .map((l) => '  ' + l)
      .join('\n'),
  );
  out('\nOr let the connector do it for you: cmec install');
}

interface CheckState {
  ok: boolean;
  stale: AccountRecord[];
}

async function runChecks(rt: Runtime): Promise<CheckState> {
  let ok = true;
  const stale: AccountRecord[] = [];
  const check = (pass: boolean, msg: string) => {
    out(`${pass ? '✔' : '✘'} ${msg}`);
    ok &&= pass;
  };
  check(Number(process.versions.node.split('.')[0]) >= 22, `Node.js ${process.versions.node} (need ≥ 22)`);
  let cfgOk = true;
  try {
    await rt.store.load();
  } catch (err) {
    cfgOk = false;
    out(`  ${(err as Error).message}`);
  }
  check(cfgOk, `Settings file readable: ${rt.store.path}`);
  try {
    await rt.secrets.probe();
    check(true, `Secret storage works (${rt.secrets.kind})`);
  } catch (err) {
    check(false, `Secret storage: ${(err as Error).message}`);
    return { ok: false, stale };
  }
  try {
    await rt.accounts.googleClient();
    check(true, 'Google OAuth client configured');
  } catch (err) {
    check(false, (err as Error).message);
    return { ok: false, stale };
  }
  const list = await rt.registry.list();
  check(list.length > 0, `${list.length} account(s) connected`);
  for (const acc of list) {
    const hasToken = Boolean(await rt.secrets.get(SECRET_KEYS.refreshToken(acc.id)));
    check(hasToken, `"${acc.label}" has a stored refresh token`);
    if (!hasToken) {
      stale.push(acc);
      continue;
    }
    const works = await verifyGmail(rt, acc);
    if (!works) stale.push(acc);
    ok = works && ok;
  }
  return { ok, stale };
}

async function doctor(rt: Runtime): Promise<number> {
  const { ok, stale } = await runChecks(rt);
  if (ok) out('\nAll checks passed.');
  else if (stale.length > 0) out(`\n${stale.length} account(s) need a new Google sign-in. Run: cmec fix`);
  else out('\nSome checks failed. See the Troubleshooting table in README.md.');
  return ok ? 0 : 1;
}

/** doctor, then re-sign-in everything that is broken, in one browser pass. */
async function fix(rt: Runtime): Promise<number> {
  const { ok, stale } = await runChecks(rt);
  if (ok) {
    out('\nNothing to fix — all accounts work.');
    return 0;
  }
  if (stale.length === 0) {
    out('\nSome checks failed but no account needs re-signing in. See the Troubleshooting table in README.md.');
    return 1;
  }
  out(`\n${stale.length} account(s) need a new Google sign-in: ${stale.map((a) => `"${a.label}"`).join(', ')}`);
  out('Google expires sign-ins after 7 days while your OAuth app is in Testing mode.');
  if (!(await confirm('Re-sign-in now? Your browser will open once per account.', true))) return 1;
  let failed = 0;
  for (const acc of stale) {
    out(`\n— ${acc.label} <${acc.email}>`);
    try {
      await connectInteractive(rt, { reconnect: acc });
    } catch (err) {
      failed++;
      out(`✘ ${redactString((err as Error).message)}`);
    }
  }
  out(failed === 0 ? '\n✔ All accounts work again.' : `\n${failed} account(s) still need attention. Try: cmec reconnect "<label>"`);
  return failed === 0 ? 0 : 1;
}

async function uninstall(rt: Runtime): Promise<number> {
  out('This revokes every connected account at Google, deletes all stored tokens and the OAuth client secret,');
  out(`and deletes ${rt.store.path}.`);
  if ((await ask('Type "remove everything" to continue: ')) !== 'remove everything') return 1;
  const { accounts: n, revoked } = await rt.accounts.removeEverything();
  await fs.rm(rt.store.path, { force: true });
  await fs.rm(EncryptedFileSecretStore.defaultPath(dirname(rt.store.path)), { force: true });
  out(`✔ Removed ${n} account(s); Google confirmed ${revoked} revocation(s).`);
  out(`Also remove the "email" server from ${claudeDesktopConfigPath()} (or run: claude mcp remove email).`);
  out('You can check https://myaccount.google.com/permissions and delete your Google Cloud project if you no longer need it.');
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    const msg = err instanceof AccountError ? err.message : redactString((err as Error)?.message ?? String(err));
    process.stderr.write(`✘ ${msg}\n`);
    process.exit(1);
  },
);

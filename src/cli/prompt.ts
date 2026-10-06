// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';

export async function ask(question: string, fallback = ''): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const answer = (await ask(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'} `)).toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

const OPENABLE = [
  /^https:\/\/accounts\.google\.com\//,
  /^https:\/\/console\.cloud\.google\.com\//,
  /^https:\/\/myaccount\.google\.com\//,
];

/** Opens a known Google URL in the default browser, without a shell (arguments are passed as an array). */
export function openUrl(url: string): void {
  if (!OPENABLE.some((re) => re.test(url))) throw new Error('Refusing to open an unexpected URL');
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* the URL is also printed for manual copy */
  }
}

/** Opens a Google sign-in URL in the default browser. */
export function openBrowser(url: string): void {
  if (!/^https:\/\/accounts\.google\.com\//.test(url)) throw new Error('Refusing to open an unexpected URL');
  openUrl(url);
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { promises as fs } from 'node:fs';

// Reads the OAuth client JSON downloaded from Google Cloud Console
// ("Download JSON" on a Desktop app client). We accept only the "installed"
// (Desktop) type: a "web" client would need registered redirect URIs.

export class ClientFileError extends Error {}

export async function readGoogleClientFile(path: string): Promise<{ clientId: string; clientSecret: string }> {
  let raw: string;
  try {
    const stat = await fs.stat(path);
    if (stat.size > 64 * 1024) throw new ClientFileError('That file is too large to be a Google OAuth client file.');
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    if (err instanceof ClientFileError) throw err;
    throw new ClientFileError(`Could not read ${path}`);
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ClientFileError('That file is not valid JSON.');
  }
  if (json.web) {
    throw new ClientFileError('This is a "Web application" client. Create an OAuth client of type "Desktop app" instead (see docs/GOOGLE_CLOUD_SETUP.md).');
  }
  const installed = json.installed as Record<string, unknown> | undefined;
  const clientId = installed?.client_id;
  const clientSecret = installed?.client_secret;
  if (typeof clientId !== 'string' || typeof clientSecret !== 'string') {
    throw new ClientFileError('This does not look like a Google "Desktop app" OAuth client file (missing installed.client_id / client_secret).');
  }
  return { clientId, clientSecret };
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import * as z from 'zod';
import { randomBase32 } from '../util/ids.js';
import { type SecretStore, SecretStoreError } from './secret-store.js';

// Opt-in fallback for machines without an OS keychain (headless Linux, WSL,
// containers). Each value is encrypted with AES-256-GCM under a key derived
// with scrypt from CMEC_SECRET_PASSPHRASE. The key name is bound as AAD so a
// ciphertext can't be moved to another entry. Weaker than a keychain because
// the passphrase must be available to the MCP server process (see
// docs/SECURITY_DESIGN.md).

export const MIN_PASSPHRASE_LENGTH = 16;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const Entry = z.object({ iv: z.string(), ct: z.string(), tag: z.string() });
const FileFormat = z.object({
  version: z.literal(1),
  kdf: z.object({ name: z.literal('scrypt'), salt: z.string(), N: z.number(), r: z.number(), p: z.number() }),
  entries: z.record(z.string(), Entry),
});
type FileFormat = z.infer<typeof FileFormat>;

export class EncryptedFileSecretStore implements SecretStore {
  readonly kind = 'encrypted-file' as const;
  private keyCache: { salt: string; key: Buffer } | null = null;

  constructor(
    readonly path: string,
    private readonly passphrase: string | undefined = process.env.CMEC_SECRET_PASSPHRASE,
  ) {}

  static defaultPath(configDirectory: string): string {
    return join(configDirectory, 'secrets.enc.json');
  }

  private requirePassphrase(): string {
    if (!this.passphrase || this.passphrase.length < MIN_PASSPHRASE_LENGTH) {
      throw new SecretStoreError(
        `Encrypted-file secret store needs CMEC_SECRET_PASSPHRASE with at least ${MIN_PASSPHRASE_LENGTH} characters.`,
      );
    }
    return this.passphrase;
  }

  private deriveKey(salt: string): Buffer {
    if (this.keyCache?.salt === salt) return this.keyCache.key;
    const key = scryptSync(this.requirePassphrase(), Buffer.from(salt, 'base64'), 32, SCRYPT);
    this.keyCache = { salt, key };
    return key;
  }

  private async read(): Promise<FileFormat> {
    try {
      const parsed = FileFormat.safeParse(JSON.parse(await fs.readFile(this.path, 'utf8')));
      if (!parsed.success) throw new SecretStoreError(`Secret file is corrupt: ${this.path}`);
      return parsed.data;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          version: 1,
          kdf: { name: 'scrypt', salt: randomBytes(16).toString('base64'), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
          entries: {},
        };
      }
      throw err;
    }
  }

  private async write(file: FileFormat): Promise<void> {
    const dir = dirname(this.path);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = join(dir, `.secrets.${process.pid}.${randomBase32(8)}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(file) + '\n', { mode: 0o600 });
    await fs.rename(tmp, this.path);
    if (process.platform !== 'win32') await fs.chmod(this.path, 0o600);
  }

  async get(key: string): Promise<string | null> {
    const file = await this.read();
    const entry = file.entries[key];
    if (!entry) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.deriveKey(file.kdf.salt), Buffer.from(entry.iv, 'base64'));
      decipher.setAAD(Buffer.from(key, 'utf8'));
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(entry.ct, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      throw new SecretStoreError('Could not decrypt a stored secret (wrong CMEC_SECRET_PASSPHRASE or tampered file).');
    }
  }

  async set(key: string, value: string): Promise<void> {
    const file = await this.read();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.deriveKey(file.kdf.salt), iv);
    cipher.setAAD(Buffer.from(key, 'utf8'));
    const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    file.entries[key] = { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
    await this.write(file);
  }

  async delete(key: string): Promise<boolean> {
    const file = await this.read();
    if (!(key in file.entries)) return false;
    delete file.entries[key];
    await this.write(file);
    return true;
  }

  async probe(): Promise<void> {
    this.requirePassphrase();
    const key = `probe:${process.pid}:${Date.now()}`;
    await this.set(key, 'ok');
    const value = await this.get(key);
    await this.delete(key);
    if (value !== 'ok') throw new SecretStoreError('Encrypted secret file round-trip failed.');
  }
}

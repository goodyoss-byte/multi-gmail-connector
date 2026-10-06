import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { ConfigStore } from '../../src/config/config-store.js';
import { buildServer } from '../../src/mcp/server.js';
import { createRuntime, type Runtime } from '../../src/runtime.js';
import { MemorySecretStore } from '../../src/secrets/secret-store.js';
import { silentLogger, type Logger } from '../../src/util/logger.js';
import { CLIENT, FakeGoogle } from './fake-google.js';

export interface Harness {
  dir: string;
  google: FakeGoogle;
  secrets: MemorySecretStore;
  rt: Runtime;
  /** Connect a mailbox through the real loopback + OAuth code path. */
  connect(sub: string, opts?: { label?: string; scope?: string; noRefresh?: boolean; reconnectLabel?: string }): ReturnType<Runtime['accounts']['connect']>;
  mcp(): Promise<Client>;
  cleanup(): Promise<void>;
}

export async function createHarness(opts: { log?: Logger } = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'cmec-test-'));
  const google = new FakeGoogle();
  const secrets = new MemorySecretStore();
  const store = new ConfigStore(join(dir, 'config.json'));
  const rt = createRuntime({ store, secrets, log: opts.log ?? silentLogger, fetchFn: google.fetch, dir });
  await rt.accounts.configureGoogleClient(CLIENT.clientId, CLIENT.clientSecret);
  const clients: Client[] = [];

  return {
    dir,
    google,
    secrets,
    rt,
    async connect(sub, o = {}) {
      const reconnect = o.reconnectLabel ? (await rt.registry.resolve(o.reconnectLabel)) ?? undefined : undefined;
      return rt.accounts.connect({
        label: o.label,
        reconnect,
        timeoutMs: 5000,
        openBrowser: async (url) => {
          // Play the browser: Google approves, then redirects to our loopback listener.
          const { code, state } = google.approve(url, sub, { scope: o.scope, noRefresh: o.noRefresh });
          const redirect = new URL(url).searchParams.get('redirect_uri')!;
          const cb = new URL(redirect);
          cb.searchParams.set('code', code);
          cb.searchParams.set('state', state);
          cb.searchParams.set('iss', 'https://accounts.google.com');
          await fetch(cb);
        },
      });
    },
    async mcp() {
      const server = buildServer(rt.mail, opts.log ?? silentLogger);
      const [a, b] = InMemoryTransport.createLinkedPair();
      await server.connect(a);
      const client = new Client({ name: 'test', version: '1.0.0' });
      await client.connect(b);
      clients.push(client);
      return client;
    },
    async cleanup() {
      for (const c of clients) await c.close().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Every credential string the fake Google has handed out, plus the client secret. */
export function allSecrets(h: Harness): string[] {
  return [...h.google.accessTokens.keys(), ...h.google.refreshTokens.keys(), ...h.google.revoked, CLIENT.clientSecret];
}

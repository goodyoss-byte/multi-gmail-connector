import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Launches the built server exactly as Claude does (node dist/cli.js serve)
// and talks MCP over stdin/stdout. Requires `npm run build` first (CI does it).

const CLI = resolve('dist/cli.js');

describe.skipIf(!existsSync(CLI))('stdio end-to-end (built server)', () => {
  let dir: string;
  let client: Client;
  let stderr = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cmec-e2e-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI, 'serve'],
      env: { ...(process.env as Record<string, string>), CMEC_CONFIG_DIR: dir, CMEC_LOG_LEVEL: 'debug' },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    client = new Client({ name: 'e2e', version: '1.0.0' });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('completes the handshake and lists five read-only tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_attachment', 'get_email', 'get_thread', 'list_email_accounts', 'search_emails']);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('answers tool calls and explains how to connect an account', async () => {
    const list = await client.callTool({ name: 'list_email_accounts', arguments: {} });
    expect(list.structuredContent).toMatchObject({ total: 0 });
    const search = await client.callTool({ name: 'search_emails', arguments: { query: 'flight' } });
    expect(search.isError).toBe(true);
    expect(JSON.stringify(search.content)).toContain('NO_ACCOUNTS_CONNECTED');
    expect(JSON.stringify(search.content)).toContain('cmec setup');
  });

  it('logs JSON to stderr only (stdout stays pure protocol)', async () => {
    expect(stderr).toContain('"msg":"MCP server started"');
    for (const line of stderr.trim().split('\n')) expect(() => JSON.parse(line)).not.toThrow();
  });
});

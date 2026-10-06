import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { allSecrets, createHarness, type Harness } from '../helpers/harness.js';
import { textMessage } from '../helpers/fake-google.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);

describe('CRITICAL: search across Account A and Account B', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    h.google.addMailbox({
      sub: 'sub-A',
      email: 'personal@gmail.com',
      messages: [
        textMessage({ id: 'a1', from: 'Emirates <do-not-reply@emirates.example>', to: 'personal@gmail.com', subject: 'Your Emirates flight confirmation EK202', body: 'Booking reference ABC123 flight', date: T0 + 3 * DAY }),
        textMessage({ id: 'a2', from: 'Mum <mum@example.com>', to: 'personal@gmail.com', subject: 'Dinner Sunday', body: 'See you then', date: T0 + 1 * DAY }),
      ],
    });
    h.google.addMailbox({
      sub: 'sub-B',
      email: 'business@gmail.com',
      messages: [
        textMessage({ id: 'b1', from: 'Emirates <do-not-reply@emirates.example>', to: 'business@gmail.com', subject: 'Emirates flight receipt EK001', body: 'Receipt for your flight', date: T0 + 2 * DAY }),
        textMessage({ id: 'b2', from: 'Accountant <acc@example.com>', to: 'business@gmail.com', subject: 'Q3 invoices', body: 'Attached', date: T0 + 4 * DAY }),
      ],
    });
    await h.connect('sub-A', { label: 'Personal' });
    await h.connect('sub-B', { label: 'Business' });
  });

  afterEach(async () => h.cleanup());

  it('labels every result with the account it came from and never leaks credentials', async () => {
    const client = await h.mcp();
    const res = await client.callTool({ name: 'search_emails', arguments: { query: 'emirates flight' } });
    expect(res.isError).toBeFalsy();
    const data = res.structuredContent as {
      results: Array<{ account_label: string; email_address: string; account_id: string; subject: string; message_ref: string }>;
      accounts_searched: Array<{ account_label: string }>;
    };

    expect(data.accounts_searched.map((a) => a.account_label).sort()).toEqual(['Business', 'Personal']);
    expect(data.results).toHaveLength(2);
    const bySubject = Object.fromEntries(data.results.map((r) => [r.subject, r]));
    expect(bySubject['Your Emirates flight confirmation EK202']).toMatchObject({ account_label: 'Personal', email_address: 'personal@gmail.com' });
    expect(bySubject['Emirates flight receipt EK001']).toMatchObject({ account_label: 'Business', email_address: 'business@gmail.com' });
    // Newest first across both accounts.
    expect(data.results[0]!.subject).toBe('Your Emirates flight confirmation EK202');
    // Each message_ref is namespaced by its own account id.
    for (const r of data.results) expect(r.message_ref.startsWith(r.account_id + ':')).toBe(true);

    // No token, refresh token or client secret anywhere in the MCP output.
    const wire = JSON.stringify(res);
    for (const secret of allSecrets(h)) expect(wire).not.toContain(secret);
    expect(wire).not.toMatch(/ya29\.|1\/\/0|GOCSPX-/);
  });

  it("uses each account's own token only for that account's mailbox", async () => {
    const client = await h.mcp();
    await client.callTool({ name: 'search_emails', arguments: { query: 'emirates' } });
    expect(h.google.gmailCalls.length).toBeGreaterThan(0);
    for (const call of h.google.gmailCalls) {
      expect(call.mailbox).not.toBeNull(); // every call carried a valid token
    }
    const aCalls = h.google.gmailCalls.filter((c) => c.path.includes('/a1') || c.path.includes('/a2'));
    const bCalls = h.google.gmailCalls.filter((c) => c.path.includes('/b1') || c.path.includes('/b2'));
    expect(aCalls.every((c) => c.mailbox === 'sub-A')).toBe(true);
    expect(bCalls.every((c) => c.mailbox === 'sub-B')).toBe(true);
  });

  it("can't read Account B's message through Account A's reference", async () => {
    const client = await h.mcp();
    const accounts = (await client.callTool({ name: 'list_email_accounts', arguments: {} })).structuredContent as {
      accounts: Array<{ account_id: string; account_label: string }>;
    };
    const aId = accounts.accounts.find((a) => a.account_label === 'Personal')!.account_id;
    const res = await client.callTool({ name: 'get_email', arguments: { message_ref: `${aId}:b1` } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('MESSAGE_NOT_FOUND');
    const call = h.google.gmailCalls.find((c) => c.path === '/messages/b1')!;
    expect(call.mailbox).toBe('sub-A'); // asked A's mailbox, which doesn't have it
    expect(h.google.gmailCalls.some((c) => c.mailbox === 'sub-B')).toBe(false);
  });

  it('searches one account by label, and selected accounts by id', async () => {
    const client = await h.mcp();
    const one = (await client.callTool({ name: 'search_emails', arguments: { accounts: ['business'], query: 'emirates' } })).structuredContent as {
      results: Array<{ account_label: string }>;
    };
    expect(one.results.map((r) => r.account_label)).toEqual(['Business']);

    const list = (await client.callTool({ name: 'list_email_accounts', arguments: {} })).structuredContent as { accounts: Array<{ account_id: string }> };
    const both = (await client.callTool({ name: 'search_emails', arguments: { accounts: list.accounts.map((a) => a.account_id) } })).structuredContent as {
      results: unknown[];
    };
    expect(both.results).toHaveLength(4);
  });

  it('rejects an unknown account and names the connected ones', async () => {
    const client = await h.mcp();
    const res = await client.callTool({ name: 'search_emails', arguments: { accounts: ['acc_zzzzzzzzzzzzzzzz'] } });
    expect(res.isError).toBe(true);
    const text = JSON.stringify(res.content);
    expect(text).toContain('ACCOUNT_NOT_FOUND');
    expect(text).toContain('Personal');
  });

  it('respects include_in_search_all', async () => {
    const b = (await h.rt.registry.resolve('Business'))!;
    await h.rt.accounts.setIncludeInSearchAll(b, false);
    const client = await h.mcp();
    const res = (await client.callTool({ name: 'search_emails', arguments: {} })).structuredContent as { results: Array<{ account_label: string }> };
    expect(new Set(res.results.map((r) => r.account_label))).toEqual(new Set(['Personal']));
  });

  it('keeps tokens out of config.json', async () => {
    const raw = await fs.readFile(h.rt.store.path, 'utf8');
    for (const secret of allSecrets(h)) expect(raw).not.toContain(secret);
    expect(raw).toContain('sub-A');
    expect(raw).toContain('sub-B');
  });

  it('returns results from the healthy account when the other needs reconnecting', async () => {
    const b = (await h.rt.registry.resolve('Business'))!;
    const rt = (await h.secrets.get(`refresh-token:${b.id}`))!;
    h.google.invalidGrantFor.add(rt);
    const client = await h.mcp();
    const res = (await client.callTool({ name: 'search_emails', arguments: { query: 'emirates' } })).structuredContent as {
      results: Array<{ account_label: string }>;
      account_errors: Array<{ account_label: string; error_code: string; how_to_fix: string | null }>;
    };
    expect(res.results.map((r) => r.account_label)).toEqual(['Personal']);
    expect(res.account_errors).toEqual([
      expect.objectContaining({ account_label: 'Business', error_code: 'ACCOUNT_NEEDS_RECONNECT', how_to_fix: expect.stringContaining('reconnect') }),
    ]);
    expect((await h.rt.registry.resolve('Business'))!.status).toBe('needs_reauth');
  });
});

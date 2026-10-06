import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/harness.js';
import { textMessage } from '../helpers/fake-google.js';

// Searching N accounts must not cost N × max_results Gmail reads. Every result
// that reaches the user is one `messages.get`; anything beyond that is waste,
// and Gmail charges 20 quota units for each one.

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

function mailbox(sub: string, email: string, count: number, startOffset: number) {
  return {
    sub,
    email,
    messages: Array.from({ length: count }, (_, i) =>
      textMessage({
        id: `${sub}-${i}`,
        from: `Sender ${i} <s${i}@example.com>`,
        to: email,
        subject: `${sub} message ${i}`,
        body: 'invoice attached',
        // Interleaved dates, so a correct merge has to take from both accounts.
        date: T0 + (count - i) * DAY - startOffset,
      }),
    ),
  };
}

describe('search cost across several accounts', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness();
    h.google.addMailbox(mailbox('sub-A', 'a@gmail.com', 30, 0));
    h.google.addMailbox(mailbox('sub-B', 'b@gmail.com', 30, DAY / 2));
    h.google.addMailbox(mailbox('sub-C', 'c@gmail.com', 30, DAY / 4));
    await h.connect('sub-A', { label: 'A' });
    await h.connect('sub-B', { label: 'B' });
    await h.connect('sub-C', { label: 'C' });
  });

  afterEach(async () => h.cleanup());

  const messageGets = () => h.google.gmailCalls.filter((c) => /\/messages\/[^/]+$/.test(c.path)).length;

  it('fetches about one message per result, not one per result per account', async () => {
    const client = await h.mcp();
    h.google.gmailCalls.length = 0;
    const res = await client.callTool({ name: 'search_emails', arguments: { query: 'invoice', max_results: 10 } });
    const data = res.structuredContent as { results: Array<{ date: string; account_label: string }> };

    expect(data.results).toHaveLength(10);
    // The pre-1.0 implementation fetched max_results for every account (30 here).
    expect(messageGets()).toBeLessThan(30);
    // One read per emitted result, plus at most one prefetch batch per account.
    expect(messageGets()).toBeLessThanOrEqual(10 + 3 * 5);
  });

  it('still returns a globally newest-first page drawn from every account', async () => {
    const client = await h.mcp();
    const res = await client.callTool({ name: 'search_emails', arguments: { query: 'invoice', max_results: 10 } });
    const data = res.structuredContent as { results: Array<{ date: string; account_label: string }> };

    const dates = data.results.map((r) => Date.parse(r.date));
    expect(dates).toEqual([...dates].sort((x, y) => y - x));
    expect(new Set(data.results.map((r) => r.account_label)).size).toBeGreaterThan(1);
  });

  it('reuses look-ahead reads on the next page instead of fetching them twice', async () => {
    const client = await h.mcp();
    const first = (await client.callTool({ name: 'search_emails', arguments: { query: 'invoice', max_results: 10 } })).structuredContent as {
      results: Array<{ message_ref: string; date: string }>;
      next_cursor: string | null;
    };
    expect(first.next_cursor).toBeTruthy();
    const afterFirst = messageGets();

    const second = (
      await client.callTool({ name: 'search_emails', arguments: { query: 'invoice', max_results: 10, cursor: first.next_cursor } })
    ).structuredContent as { results: Array<{ message_ref: string; date: string }> };

    expect(second.results).toHaveLength(10);
    // No overlap between pages, and page two keeps going backwards in time.
    const firstRefs = new Set(first.results.map((r) => r.message_ref));
    expect(second.results.some((r) => firstRefs.has(r.message_ref))).toBe(false);
    expect(Date.parse(second.results[0]!.date)).toBeLessThanOrEqual(Date.parse(first.results.at(-1)!.date));
    // Page two costs about its own ten results, not ten plus everything re-read.
    expect(messageGets() - afterFirst).toBeLessThanOrEqual(10 + 3 * 5);
  });

  it('keeps merging the healthy accounts when one needs reconnecting', async () => {
    const b = (await h.rt.registry.resolve('B'))!;
    h.google.invalidGrantFor.add((await h.secrets.get(`refresh-token:${b.id}`))!);
    const client = await h.mcp();
    const res = await client.callTool({ name: 'search_emails', arguments: { query: 'invoice', max_results: 10 } });
    const data = res.structuredContent as {
      results: Array<{ account_label: string }>;
      account_errors: Array<{ account_label: string; error_code: string }>;
    };

    expect(res.isError).toBeFalsy();
    expect(data.results).toHaveLength(10);
    expect(data.results.some((r) => r.account_label === 'B')).toBe(false);
    expect(new Set(data.results.map((r) => r.account_label))).toEqual(new Set(['A', 'C']));
    expect(data.account_errors).toEqual([expect.objectContaining({ account_label: 'B', error_code: 'ACCOUNT_NEEDS_RECONNECT' })]);
  });
});

# Email provider design (local edition)

## 1. Interface
`src/providers/types.ts`:
```ts
interface EmailProvider {
  readonly kind: 'google';
  listMessageIds(filters: SearchFilters, pageSize: number, pageToken?: string): Promise<ListPage>;
  getSummary(messageId: string): Promise<MessageSummary>;
  getMessage(messageId: string): Promise<MessageDetail>;
  getThread(threadId: string): Promise<MessageDetail[]>;
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
}
```
A provider instance is **bound to one account**: it receives an access-token function and a quota-charge function for that account only, so it can't use another account's credentials. It is kept deliberately small: only what the five tools need.

## 2. Gmail adapter (`src/providers/gmail/`)
- Plain `fetch` to `https://gmail.googleapis.com/gmail/v1/users/me/…`: `messages` (list), `messages/{id}?format=metadata` (search results), `messages/{id}?format=full`, `threads/{id}?format=full`, `messages/{id}/attachments/{aid}`.
- Ids are validated (`[A-Za-z0-9_-]`) before they're put into a URL path.
- `includeSpamTrash=false`.
- Errors: 401 → one forced refresh then `UNAUTHORIZED`; 403 rate-limit → `RATE_LIMITED`; other 403 → `FORBIDDEN` (reconnect); 404 → `NOT_FOUND`; 429 → `RATE_LIMITED` with `Retry-After`; 5xx/network → up to 3 attempts with backoff, then `UNAVAILABLE`; non-JSON → `MALFORMED`.
- MIME: iterative walk with limits of 200 parts and depth 12. `text/plain` is preferred; otherwise HTML is converted to text. Declared charsets are decoded with `TextDecoder`. Bodies are capped at 2 MB decoded. Parts with a filename or attachment id are listed as attachments.
- Search result metadata (`From`, `To`, `Subject`, `Date`, labels, snippet) is cached in memory for 5 minutes, so pagination doesn't refetch it. Nothing is written to disk.

## 3. Search filters → Gmail query
`src/providers/gmail/query.ts`: `query` (control characters removed) + `from:` `to:` `subject:` (quotes and brackets stripped, then quoted), `after:`/`before:` (`YYYY/MM/DD`), `has:attachment`, `is:unread` / `-is:unread`, `in:inbox`.

## 4. Quota
Gmail costs per call (research §3.4): list 5, get 20, thread 40, attachment 20 units. Google allows 6,000 units per user per minute. The in-memory limiter allows 4,800 per account, so a 10-result search (≈ 205 units) can run about 23 times a minute per account.

## 5. Adding Microsoft later
1. `src/providers/graph/` implementing `EmailProvider` (KQL `$search`, `Prefer: outlook.body-content-type="text"`, `conversationId` threads).
2. Extend `provider` in the config schema to `'google' | 'microsoft'`, with `provider_account_id = "<tid>:<oid>"`.
3. A Microsoft connect flow in `src/oauth/` (loopback + PKCE, `Mail.Read offline_access`).
4. Run the same integration tests against a fake Graph.

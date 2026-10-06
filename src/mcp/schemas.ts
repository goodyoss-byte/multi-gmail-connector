// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import * as z from 'zod';

// Shared zod schemas. These become the JSON Schemas Claude sees in tools/list.

export const LIMITS = {
  maxResults: 25,
  defaultResults: 10,
  maxBodyChars: 30_000,
  defaultBodyChars: 8_000,
  maxThreadMessages: 20,
  defaultThreadMessages: 10,
  defaultThreadBodyChars: 3_000,
  threadTotalBodyChars: 40_000,
  maxAttachmentChars: 30_000,
  defaultAttachmentChars: 10_000,
  maxOutputChars: 90_000,
} as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const accountRef = z.string().min(1).max(80).describe('An account id (acc_…) or label from list_email_accounts');
const refPattern = /^acc_[a-z2-7]{16}:[A-Za-z0-9_-]{1,256}$/;

export const Address = z.object({ name: z.string().optional(), email: z.string() });

export const AccountTag = {
  account_id: z.string(),
  account_label: z.string(),
  email_address: z.string(),
  provider: z.literal('google'),
};

export const ListAccountsInput = z.object({});
export const ListAccountsOutput = z.object({
  accounts: z.array(
    z.object({
      ...AccountTag,
      status: z.enum(['active', 'needs_reauth']),
      included_in_search_all: z.boolean(),
      connected_at: z.string(),
      last_signed_in: z.string(),
      days_since_sign_in: z.number().int().nullable(),
      action_needed: z.string().nullable().describe('What the user must do in a terminal, if anything. Pass it on in your own words.'),
    }),
  ),
  total: z.number().int(),
  how_to_manage: z.string(),
});

export const SearchInput = z.object({
  accounts: z
    .array(accountRef)
    .min(1)
    .max(25)
    .optional()
    .describe('Accounts to search (ids or labels). Omit to search all accounts included in "search all".'),
  query: z.string().max(500).optional().describe('Free-text search. Gmail search operators are also accepted (e.g. "from:airline.com").'),
  from: z.string().max(200).optional(),
  to: z.string().max(200).optional(),
  subject: z.string().max(200).optional(),
  after: date.optional().describe('Only emails on or after this date (YYYY-MM-DD).'),
  before: date.optional().describe('Only emails before this date (YYYY-MM-DD).'),
  has_attachment: z.boolean().optional(),
  is_unread: z.boolean().optional(),
  in_inbox_only: z.boolean().optional().describe('Only emails currently in the inbox.'),
  max_results: z.number().int().min(1).max(LIMITS.maxResults).default(LIMITS.defaultResults),
  cursor: z.string().max(4000).optional().describe('next_cursor from a previous call with the same filters.'),
});

export const SearchResultItem = z.object({
  ...AccountTag,
  message_ref: z.string(),
  thread_ref: z.string().nullable(),
  from: Address.nullable(),
  to: z.array(Address),
  subject: z.string(),
  snippet: z.string(),
  date: z.string(),
  labels: z.array(z.string()),
  has_attachments: z.boolean(),
  is_unread: z.boolean(),
  injection_warning: z.string().nullable(),
});

export const SearchOutput = z.object({
  results: z.array(SearchResultItem),
  accounts_searched: z.array(z.object(AccountTag)),
  account_errors: z.array(
    z.object({ account_id: z.string(), account_label: z.string(), error_code: z.string(), message: z.string(), how_to_fix: z.string().nullable() }),
  ),
  next_cursor: z.string().nullable(),
  content_notice: z.string(),
});

export const GetEmailInput = z.object({
  message_ref: z.string().regex(refPattern).describe('message_ref returned by search_emails'),
  max_body_chars: z.number().int().min(500).max(LIMITS.maxBodyChars).default(LIMITS.defaultBodyChars),
});

export const AttachmentOut = z.object({
  attachment_id: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
  text_extractable: z.boolean(),
});

const MessageFields = {
  message_ref: z.string(),
  thread_ref: z.string().nullable(),
  from: Address.nullable(),
  to: z.array(Address),
  cc: z.array(Address),
  subject: z.string(),
  date: z.string(),
  labels: z.array(z.string()),
  is_unread: z.boolean(),
  body_text: z.string(),
  body_truncated: z.boolean(),
  body_original_chars: z.number().int(),
  attachments: z.array(AttachmentOut),
  authentication_results: z.string().nullable(),
  injection_warning: z.string().nullable(),
  injection_flags: z.array(z.string()),
};

export const GetEmailOutput = z.object({ ...AccountTag, ...MessageFields, content_notice: z.string() });

export const GetThreadInput = z.object({
  thread_ref: z.string().regex(refPattern).describe('thread_ref returned by search_emails or get_email'),
  max_messages: z.number().int().min(1).max(LIMITS.maxThreadMessages).default(LIMITS.defaultThreadMessages),
  max_body_chars_per_message: z.number().int().min(200).max(10_000).default(LIMITS.defaultThreadBodyChars),
});

export const GetThreadOutput = z.object({
  ...AccountTag,
  thread_ref: z.string(),
  message_count: z.number().int(),
  omitted_older_messages: z.number().int(),
  messages: z.array(z.object(MessageFields)),
  content_notice: z.string(),
});

export const GetAttachmentInput = z.object({
  message_ref: z.string().regex(refPattern),
  attachment_id: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/),
  max_chars: z.number().int().min(500).max(LIMITS.maxAttachmentChars).default(LIMITS.defaultAttachmentChars),
});

export const GetAttachmentOutput = z.object({
  ...AccountTag,
  message_ref: z.string(),
  attachment_id: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
  extraction: z.enum(['full', 'truncated', 'unsupported', 'too_large']),
  text: z.string().nullable(),
  injection_warning: z.string().nullable(),
  content_notice: z.string(),
});

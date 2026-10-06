// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
// Provider-neutral model. V1 ships Gmail only; the interface is intentionally
// small so a Microsoft Graph adapter can be added without touching the tools.

export type ProviderKind = 'google';

export interface Address {
  name?: string;
  email: string;
}

export interface SearchFilters {
  query?: string; // free text or provider syntax
  from?: string;
  to?: string;
  subject?: string;
  after?: string; // YYYY-MM-DD
  before?: string; // YYYY-MM-DD
  has_attachment?: boolean;
  is_unread?: boolean;
  in_inbox_only?: boolean;
}

export interface MessageSummary {
  provider_message_id: string;
  provider_thread_id: string | null;
  from: Address | null;
  to: Address[];
  subject: string;
  snippet: string;
  date: string; // ISO 8601 UTC
  date_ms: number;
  labels: string[];
  has_attachments: boolean;
  is_unread: boolean;
}

export interface AttachmentMeta {
  attachment_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

export interface MessageDetail extends MessageSummary {
  cc: Address[];
  body_text: string; // already sanitised by the content guard, not yet truncated
  attachments: AttachmentMeta[];
  authentication_results: string | null;
}

export interface ListPage {
  ids: string[];
  next_page_token: string | null;
}

/** Everything here is scoped to ONE account; the access token is bound to it. */
export interface EmailProvider {
  readonly kind: ProviderKind;
  listMessageIds(filters: SearchFilters, pageSize: number, pageToken?: string): Promise<ListPage>;
  getSummary(messageId: string): Promise<MessageSummary>;
  getMessage(messageId: string): Promise<MessageDetail>;
  getThread(threadId: string): Promise<MessageDetail[]>;
  /** Raw attachment bytes (callers check type and size from getMessage first). */
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
}

export class ProviderError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'UNAUTHORIZED'
      | 'FORBIDDEN'
      | 'RATE_LIMITED'
      | 'UNAVAILABLE'
      | 'BAD_REQUEST'
      | 'MALFORMED',
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

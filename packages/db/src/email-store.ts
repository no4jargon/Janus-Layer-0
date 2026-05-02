import type {
  Database,
  EmailAccountRecord,
  EmailAttachmentRecord,
  EmailMessageRecord,
  EmailOutboxMessageRecord,
  EmailOutboxStatus,
  EmailThreadRecord,
} from './types.js';

const num = (value: unknown): number => Number(value ?? 0);

const mapThreadRow = (row: any): EmailThreadRecord => ({
  id: row.id,
  userId: row.user_id,
  accountId: row.account_id,
  providerThreadId: row.provider_thread_id,
  derivedThreadKey: row.derived_thread_key,
  subject: row.subject,
  participantSummary: row.participant_summary,
  lastMessageAt: num(row.last_message_at),
  lastCleanedPreview: row.last_cleaned_preview,
  unreadCount: num(row.unread_count),
  hasAttachments: num(row.has_attachments) === 1,
  sourceLabelsJson: row.source_labels_json,
  createdAt: num(row.created_at),
  updatedAt: num(row.updated_at),
});

const mapMessageRow = (row: any): EmailMessageRecord => ({
  id: row.id,
  userId: row.user_id,
  accountId: row.account_id,
  threadId: row.thread_id,
  providerMessageId: row.provider_message_id,
  gmailHistoryId: row.gmail_history_id,
  senderName: row.sender_name,
  senderEmail: row.sender_email,
  toJson: row.to_json,
  ccJson: row.cc_json,
  sentAt: num(row.sent_at),
  direction: row.direction,
  snippet: row.snippet,
  bodyRawHtml: row.body_raw_html,
  bodyRawText: row.body_raw_text,
  bodyCleanText: row.body_clean_text,
  hasAttachments: num(row.has_attachments) === 1 ? 1 : 0,
  isHiddenAutomated: num(row.is_hidden_automated) === 1 ? 1 : 0,
  createdAt: num(row.created_at),
  updatedAt: num(row.updated_at),
});

const mapAttachmentRow = (row: any): EmailAttachmentRecord => ({
  id: row.id,
  userId: row.user_id,
  accountId: row.account_id,
  messageId: row.message_id,
  providerMessageId: row.provider_message_id ?? '',
  providerAttachmentId: row.provider_attachment_id,
  filename: row.filename,
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes,
  cachedLocalPath: row.cached_local_path,
  cachedAt: row.cached_at,
  createdAt: num(row.created_at),
});

const mapOutboxRow = (row: any): EmailOutboxMessageRecord => ({
  id: row.id,
  clientRequestId: row.client_request_id,
  accountId: row.account_id,
  threadId: row.thread_id,
  providerThreadId: row.provider_thread_id,
  toJson: row.to_json,
  ccJson: row.cc_json,
  subject: row.subject,
  textBody: row.text_body,
  htmlBody: row.html_body,
  status: row.status,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  gmailMessageId: row.gmail_message_id,
  gmailThreadId: row.gmail_thread_id,
  createdAt: num(row.created_at),
  updatedAt: num(row.updated_at),
});

export const createEmailStore = (db: Database) => {
  const upsertEmailAccount = (row: EmailAccountRecord) => {
    db.prepare(
      `
      INSERT INTO email_accounts (id, user_id, provider, email_address, oauth_token_ref, sync_cursor, last_sync_at, created_at, updated_at)
      VALUES (@id, @userId, @provider, @emailAddress, @oauthTokenRef, @syncCursor, @lastSyncAt, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        email_address = excluded.email_address,
        oauth_token_ref = excluded.oauth_token_ref,
        sync_cursor = excluded.sync_cursor,
        last_sync_at = excluded.last_sync_at,
        updated_at = excluded.updated_at
      `,
    ).run(row);
  };

  const getEmailAccount = (
    userId: string,
    provider: string,
  ): EmailAccountRecord | null => {
    const row = db
      .prepare(
        'SELECT id, user_id, provider, email_address, oauth_token_ref, sync_cursor, last_sync_at, created_at, updated_at FROM email_accounts WHERE user_id = ? AND provider = ? LIMIT 1',
      )
      .get(userId, provider) as any;

    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      emailAddress: row.email_address,
      oauthTokenRef: row.oauth_token_ref,
      syncCursor: row.sync_cursor,
      lastSyncAt: row.last_sync_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  };

  const updateEmailAccountSync = (
    accountId: string,
    syncCursor: string | null,
    lastSyncAt: number,
  ) => {
    db.prepare(
      'UPDATE email_accounts SET sync_cursor = ?, last_sync_at = ?, updated_at = ? WHERE id = ?',
    ).run(syncCursor, lastSyncAt, Date.now(), accountId);
  };

  const clearEmailDataForAccount = (accountId: string) => {
    db.prepare('DELETE FROM email_accounts WHERE id = ?').run(accountId);
  };

  const upsertEmailThread = (row: EmailThreadRecord) => {
    db.prepare(
      `
      INSERT INTO email_threads (
        id, user_id, account_id, provider_thread_id, derived_thread_key, subject, participant_summary,
        last_message_at, last_cleaned_preview, unread_count, has_attachments, source_labels_json, created_at, updated_at
      )
      VALUES (
        @id, @userId, @accountId, @providerThreadId, @derivedThreadKey, @subject, @participantSummary,
        @lastMessageAt, @lastCleanedPreview, @unreadCount, @hasAttachments, @sourceLabelsJson, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        subject = excluded.subject,
        participant_summary = excluded.participant_summary,
        last_message_at = excluded.last_message_at,
        last_cleaned_preview = excluded.last_cleaned_preview,
        unread_count = excluded.unread_count,
        has_attachments = excluded.has_attachments,
        source_labels_json = excluded.source_labels_json,
        updated_at = excluded.updated_at
      `,
    ).run({
      ...row,
      hasAttachments: row.hasAttachments ? 1 : 0,
    });
  };

  const upsertEmailMessage = (row: EmailMessageRecord) => {
    db.prepare(
      `
      INSERT INTO email_messages (
        id, user_id, account_id, thread_id, provider_message_id, gmail_history_id,
        sender_name, sender_email, to_json, cc_json, sent_at, direction, snippet,
        body_raw_html, body_raw_text, body_clean_text, has_attachments, is_hidden_automated, created_at, updated_at
      )
      VALUES (
        @id, @userId, @accountId, @threadId, @providerMessageId, @gmailHistoryId,
        @senderName, @senderEmail, @toJson, @ccJson, @sentAt, @direction, @snippet,
        @bodyRawHtml, @bodyRawText, @bodyCleanText, @hasAttachments, @isHiddenAutomated, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        sender_name = excluded.sender_name,
        sender_email = excluded.sender_email,
        to_json = excluded.to_json,
        cc_json = excluded.cc_json,
        sent_at = excluded.sent_at,
        direction = excluded.direction,
        snippet = excluded.snippet,
        body_raw_html = COALESCE(excluded.body_raw_html, email_messages.body_raw_html),
        body_raw_text = COALESCE(excluded.body_raw_text, email_messages.body_raw_text),
        body_clean_text = COALESCE(excluded.body_clean_text, email_messages.body_clean_text),
        has_attachments = excluded.has_attachments,
        is_hidden_automated = excluded.is_hidden_automated,
        updated_at = excluded.updated_at
      `,
    ).run(row);
  };

  const upsertEmailAttachment = (
    row: Omit<EmailAttachmentRecord, 'providerMessageId'>,
  ) => {
    db.prepare(
      `
      INSERT INTO email_attachments (
        id, user_id, account_id, message_id, provider_attachment_id,
        filename, mime_type, size_bytes, cached_local_path, cached_at, created_at
      )
      VALUES (
        @id, @userId, @accountId, @messageId, @providerAttachmentId,
        @filename, @mimeType, @sizeBytes, @cachedLocalPath, @cachedAt, @createdAt
      )
      ON CONFLICT(id) DO UPDATE SET
        filename = COALESCE(excluded.filename, email_attachments.filename),
        mime_type = COALESCE(excluded.mime_type, email_attachments.mime_type),
        size_bytes = COALESCE(excluded.size_bytes, email_attachments.size_bytes)
      `,
    ).run(row);
  };

  const markEmailAttachmentCached = (
    attachmentId: string,
    cachedLocalPath: string,
    cachedAt: number,
  ) => {
    db.prepare(
      'UPDATE email_attachments SET cached_local_path = ?, cached_at = ? WHERE id = ?',
    ).run(cachedLocalPath, cachedAt, attachmentId);
  };

  const getEmailThreads = (userId: string, limit = 250): EmailThreadRecord[] => {
    const rows = db
      .prepare(
        `SELECT id, user_id, account_id, provider_thread_id, derived_thread_key, subject, participant_summary,
                last_message_at, last_cleaned_preview, unread_count, has_attachments, source_labels_json, created_at, updated_at
         FROM email_threads
         WHERE user_id = ?
         ORDER BY last_message_at DESC
         LIMIT ?`,
      )
      .all(userId, limit) as any[];

    return rows.map(mapThreadRow);
  };

  const getEmailThreadById = (threadId: string): EmailThreadRecord | null => {
    const row = db
      .prepare(
        `SELECT id, user_id, account_id, provider_thread_id, derived_thread_key, subject, participant_summary,
                last_message_at, last_cleaned_preview, unread_count, has_attachments, source_labels_json, created_at, updated_at
         FROM email_threads WHERE id = ? LIMIT 1`,
      )
      .get(threadId) as any;
    if (!row) return null;
    return mapThreadRow(row);
  };

  const getEmailMessagesForThread = (
    threadId: string,
    limit = 500,
  ): EmailMessageRecord[] => {
    const rows = db
      .prepare(
        `SELECT id, user_id, account_id, thread_id, provider_message_id, gmail_history_id,
                sender_name, sender_email, to_json, cc_json, sent_at, direction,
                snippet, body_raw_html, body_raw_text, body_clean_text,
                has_attachments, is_hidden_automated, created_at, updated_at
         FROM email_messages
         WHERE thread_id = ?
         ORDER BY sent_at ASC, created_at ASC
         LIMIT ?`,
      )
      .all(threadId, limit) as any[];

    return rows.map(mapMessageRow);
  };

  const getEmailMessageById = (
    messageId: string,
  ): EmailMessageRecord | null => {
    const row = db
      .prepare(
        `SELECT id, user_id, account_id, thread_id, provider_message_id, gmail_history_id,
                sender_name, sender_email, to_json, cc_json, sent_at, direction,
                snippet, body_raw_html, body_raw_text, body_clean_text,
                has_attachments, is_hidden_automated, created_at, updated_at
         FROM email_messages WHERE id = ? LIMIT 1`,
      )
      .get(messageId) as any;
    if (!row) return null;
    return mapMessageRow(row);
  };

  const getEmailAttachmentById = (
    attachmentId: string,
  ): EmailAttachmentRecord | null => {
    const row = db
      .prepare(
        `SELECT a.id, a.user_id, a.account_id, a.message_id, a.provider_attachment_id, a.filename,
                a.mime_type, a.size_bytes, a.cached_local_path, a.cached_at, a.created_at,
                m.provider_message_id AS provider_message_id
         FROM email_attachments a
         JOIN email_messages m ON m.id = a.message_id
         WHERE a.id = ? LIMIT 1`,
      )
      .get(attachmentId) as any;
    if (!row) return null;
    return mapAttachmentRow(row);
  };

  const getEmailAttachmentsForMessage = (
    messageId: string,
  ): EmailAttachmentRecord[] => {
    const rows = db
      .prepare(
        `SELECT a.id, a.user_id, a.account_id, a.message_id, a.provider_attachment_id, a.filename,
                a.mime_type, a.size_bytes, a.cached_local_path, a.cached_at, a.created_at,
                m.provider_message_id AS provider_message_id
         FROM email_attachments a
         JOIN email_messages m ON m.id = a.message_id
         WHERE a.message_id = ? ORDER BY a.created_at ASC`,
      )
      .all(messageId) as any[];

    return rows.map(mapAttachmentRow);
  };

  const createEmailOutboxMessage = (
    row: Omit<EmailOutboxMessageRecord, 'createdAt' | 'updatedAt'> & {
      createdAt?: number;
      updatedAt?: number;
    },
  ) => {
    const createdAt = row.createdAt ?? Date.now();
    const updatedAt = row.updatedAt ?? createdAt;

    db.prepare(
      `INSERT INTO email_outbox_messages (
        id, client_request_id, account_id, thread_id, provider_thread_id, to_json, cc_json,
        subject, text_body, html_body, status, error_code, error_message,
        gmail_message_id, gmail_thread_id, created_at, updated_at
      )
      VALUES (
        @id, @clientRequestId, @accountId, @threadId, @providerThreadId, @toJson, @ccJson,
        @subject, @textBody, @htmlBody, @status, @errorCode, @errorMessage,
        @gmailMessageId, @gmailThreadId, @createdAt, @updatedAt
      )
      ON CONFLICT(client_request_id) DO NOTHING`,
    ).run({
      ...row,
      createdAt,
      updatedAt,
      threadId: row.threadId ?? null,
      providerThreadId: row.providerThreadId ?? null,
      htmlBody: row.htmlBody ?? null,
      errorCode: row.errorCode ?? null,
      errorMessage: row.errorMessage ?? null,
      gmailMessageId: row.gmailMessageId ?? null,
      gmailThreadId: row.gmailThreadId ?? null,
    });

    return getEmailOutboxMessageByClientRequestId(row.clientRequestId);
  };

  const updateEmailOutboxMessageStatus = (
    id: string,
    patch: Partial<
      Pick<
        EmailOutboxMessageRecord,
        'status' | 'errorCode' | 'errorMessage' | 'gmailMessageId' | 'gmailThreadId'
      >
    >,
  ) => {
    db.prepare(
      `UPDATE email_outbox_messages
       SET
         status = COALESCE(@status, status),
         error_code = COALESCE(@errorCode, error_code),
         error_message = COALESCE(@errorMessage, error_message),
         gmail_message_id = COALESCE(@gmailMessageId, gmail_message_id),
         gmail_thread_id = COALESCE(@gmailThreadId, gmail_thread_id),
         updated_at = @updatedAt
       WHERE id = @id`,
    ).run({
      id,
      status: (patch.status as EmailOutboxStatus | null | undefined) ?? null,
      errorCode: patch.errorCode ?? null,
      errorMessage: patch.errorMessage ?? null,
      gmailMessageId: patch.gmailMessageId ?? null,
      gmailThreadId: patch.gmailThreadId ?? null,
      updatedAt: Date.now(),
    });

    return getEmailOutboxMessageById(id);
  };

  const getEmailOutboxMessageByClientRequestId = (
    clientRequestId: string,
  ): EmailOutboxMessageRecord | null => {
    const row = db
      .prepare(
        `SELECT id, client_request_id, account_id, thread_id, provider_thread_id, to_json, cc_json,
                subject, text_body, html_body, status, error_code, error_message, gmail_message_id,
                gmail_thread_id, created_at, updated_at
         FROM email_outbox_messages WHERE client_request_id = ? LIMIT 1`,
      )
      .get(clientRequestId) as any;
    if (!row) return null;
    return mapOutboxRow(row);
  };

  const getEmailOutboxMessageById = (
    id: string,
  ): EmailOutboxMessageRecord | null => {
    const row = db
      .prepare(
        `SELECT id, client_request_id, account_id, thread_id, provider_thread_id, to_json, cc_json,
                subject, text_body, html_body, status, error_code, error_message, gmail_message_id,
                gmail_thread_id, created_at, updated_at
         FROM email_outbox_messages WHERE id = ? LIMIT 1`,
      )
      .get(id) as any;
    if (!row) return null;
    return mapOutboxRow(row);
  };

  return {
    upsertEmailAccount,
    getEmailAccount,
    updateEmailAccountSync,
    clearEmailDataForAccount,
    upsertEmailThread,
    upsertEmailMessage,
    upsertEmailAttachment,
    markEmailAttachmentCached,
    getEmailThreads,
    getEmailThreadById,
    getEmailMessagesForThread,
    getEmailMessageById,
    getEmailAttachmentById,
    getEmailAttachmentsForMessage,
    createEmailOutboxMessage,
    updateEmailOutboxMessageStatus,
    getEmailOutboxMessageByClientRequestId,
    getEmailOutboxMessageById,
  };
};

export type EmailStore = ReturnType<typeof createEmailStore>;

CREATE TABLE IF NOT EXISTS email_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  email_address TEXT NOT NULL,
  oauth_token_ref TEXT,
  sync_cursor TEXT,
  last_sync_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, provider),
  UNIQUE(user_id, email_address)
);

CREATE TABLE IF NOT EXISTS email_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  provider_thread_id TEXT NOT NULL,
  derived_thread_key TEXT,
  subject TEXT NOT NULL DEFAULT '',
  participant_summary TEXT NOT NULL DEFAULT '',
  last_message_at INTEGER NOT NULL DEFAULT 0,
  last_cleaned_preview TEXT NOT NULL DEFAULT '',
  unread_count INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  source_labels_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
  UNIQUE(account_id, provider_thread_id)
);

CREATE TABLE IF NOT EXISTS email_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  gmail_history_id TEXT,
  sender_name TEXT,
  sender_email TEXT NOT NULL,
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  sent_at INTEGER NOT NULL,
  direction TEXT NOT NULL,
  snippet TEXT,
  body_raw_html TEXT,
  body_raw_text TEXT,
  body_clean_text TEXT,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  is_hidden_automated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(thread_id) REFERENCES email_threads(id) ON DELETE CASCADE,
  UNIQUE(account_id, provider_message_id)
);

CREATE TABLE IF NOT EXISTS email_attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  provider_attachment_id TEXT NOT NULL,
  filename TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  cached_local_path TEXT,
  cached_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(message_id) REFERENCES email_messages(id) ON DELETE CASCADE,
  UNIQUE(message_id, provider_attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_email_threads_account_last_message
  ON email_threads(account_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_thread_sent_at
  ON email_messages(thread_id, sent_at ASC);
CREATE INDEX IF NOT EXISTS idx_email_messages_account_history
  ON email_messages(account_id, gmail_history_id);
CREATE INDEX IF NOT EXISTS idx_email_attachments_message
  ON email_attachments(message_id);

CREATE TABLE IF NOT EXISTS email_outbox_messages (
  id TEXT PRIMARY KEY,
  client_request_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  thread_id TEXT,
  provider_thread_id TEXT,
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  html_body TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(thread_id) REFERENCES email_threads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_status_updated
  ON email_outbox_messages(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_outbox_account_created
  ON email_outbox_messages(account_id, created_at DESC);

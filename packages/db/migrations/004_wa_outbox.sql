CREATE TABLE IF NOT EXISTS wa_outbox_messages (
  id TEXT PRIMARY KEY,
  client_request_id TEXT NOT NULL UNIQUE,
  chat_jid TEXT NOT NULL,
  text TEXT NOT NULL,
  quoted_message_key TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  wa_message_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_outbox_status_updated
  ON wa_outbox_messages(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_outbox_chat_created
  ON wa_outbox_messages(chat_jid, created_at DESC);

CREATE TABLE IF NOT EXISTS wa_contacts (
  jid TEXT PRIMARY KEY,
  name TEXT,
  notify TEXT,
  verified_name TEXT,
  username TEXT,
  phone_number TEXT,
  img_url TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_jid_map (
  source_jid TEXT PRIMARY KEY,
  target_jid TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_chats (
  jid TEXT PRIMARY KEY,
  name TEXT,
  is_group INTEGER NOT NULL DEFAULT 0,
  last_message_ts INTEGER NOT NULL DEFAULT 0,
  last_message_text TEXT NOT NULL DEFAULT '',
  last_message_type TEXT NOT NULL DEFAULT '',
  unread INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_messages (
  message_key TEXT PRIMARY KEY,
  remote_jid TEXT NOT NULL,
  key_id TEXT NOT NULL,
  from_me INTEGER NOT NULL,
  participant TEXT,
  sender_jid TEXT,
  message_timestamp INTEGER NOT NULL,
  message_type TEXT,
  text TEXT NOT NULL DEFAULT '',
  status INTEGER,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  media_type TEXT,
  media_mime TEXT,
  media_path TEXT,
  media_thumb_data_uri TEXT,
  raw_content TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_chat_time
  ON wa_messages(remote_jid, message_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_wa_chats_last_message
  ON wa_chats(last_message_ts DESC);

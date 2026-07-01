ALTER TABLE wa_messages ADD COLUMN reply_to_stanza_id TEXT;
ALTER TABLE wa_messages ADD COLUMN reply_to_participant TEXT;

CREATE INDEX IF NOT EXISTS idx_wa_messages_remote_key_id
  ON wa_messages(remote_jid, key_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_reply_to
  ON wa_messages(remote_jid, reply_to_stanza_id)
  WHERE reply_to_stanza_id IS NOT NULL;

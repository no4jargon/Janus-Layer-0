-- Viewing messages in Chai is local-only. Keep this separate from provider
-- unread counts/statuses so a later sync cannot resurrect viewed messages.
ALTER TABLE wa_messages ADD COLUMN locally_read INTEGER NOT NULL DEFAULT 0;
-- A manual WhatsApp unread marker can exist without any unread messages.
-- Keep its local acknowledgement tied to the rendered message snapshot.
ALTER TABLE wa_chats ADD COLUMN locally_read_marker_key TEXT;
ALTER TABLE email_messages ADD COLUMN locally_read INTEGER NOT NULL DEFAULT 0;
-- NULL means this message predates per-message label mirroring.
ALTER TABLE email_messages ADD COLUMN provider_unread INTEGER;

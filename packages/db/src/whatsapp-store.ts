import type {
  Database,
  WaChatRecord,
  WaContactRecord,
  WaMessageRecord,
  WaMessageWithReply,
  WaOutboxMessageRecord,
  WaOutboxStatus,
} from './types.js';

const num = (value: unknown): number => Number(value ?? 0);

const trimmedOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length ? v : null;
};

export const mkMessageKey = (key: {
  remoteJid?: string | null;
  id?: string | null;
  fromMe?: boolean | null;
  participant?: string | null;
}): string =>
  `${key.remoteJid || ''}|${key.id || ''}|${key.fromMe ? '1' : '0'}|${key.participant || ''}`;

const mapMessageRow = (row: any): WaMessageRecord => ({
  messageKey: row.message_key,
  remoteJid: row.remote_jid,
  keyId: row.key_id,
  fromMe: num(row.from_me) === 1,
  participant: row.participant,
  senderJid: row.sender_jid,
  messageTimestamp: num(row.message_timestamp),
  messageType: row.message_type,
  text: row.text || '',
  status: row.status,
  isDeleted: num(row.is_deleted) === 1,
  mediaType: row.media_type,
  mediaMime: row.media_mime,
  mediaPath: row.media_path,
  mediaThumbDataUri: row.media_thumb_data_uri,
  rawContent: row.raw_content,
  replyToStanzaId: row.reply_to_stanza_id ?? null,
  replyToParticipant: row.reply_to_participant ?? null,
});

const mapChatRow = (row: any): WaChatRecord => ({
  jid: row.jid,
  name: row.name,
  isGroup: num(row.is_group) === 1,
  lastMessageTs: num(row.last_message_ts),
  lastMessageText: row.last_message_text || '',
  lastMessageType: row.last_message_type || '',
  unread: num(row.unread),
});

const mapContactRow = (row: any): WaContactRecord => ({
  jid: row.jid,
  name: row.name,
  notify: row.notify,
  verifiedName: row.verified_name,
  username: row.username,
  phoneNumber: row.phone_number,
  imgUrl: row.img_url,
  updatedAt: num(row.updated_at),
});

const mapOutboxRow = (row: any): WaOutboxMessageRecord => ({
  id: row.id,
  clientRequestId: row.client_request_id,
  chatJid: row.chat_jid,
  text: row.text,
  quotedMessageKey: row.quoted_message_key,
  status: row.status,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  waMessageKey: row.wa_message_key,
  createdAt: num(row.created_at),
  updatedAt: num(row.updated_at),
});

export const createWhatsAppStore = (db: Database) => {
  const upsertContactStmt = db.prepare(`
    INSERT INTO wa_contacts (jid, name, notify, verified_name, username, phone_number, img_url, updated_at)
    VALUES (@jid, @name, @notify, @verifiedName, @username, @phoneNumber, @imgUrl, @updatedAt)
    ON CONFLICT(jid) DO UPDATE SET
      name = COALESCE(NULLIF(TRIM(excluded.name), ''), wa_contacts.name),
      notify = COALESCE(NULLIF(TRIM(excluded.notify), ''), wa_contacts.notify),
      verified_name = COALESCE(NULLIF(TRIM(excluded.verified_name), ''), wa_contacts.verified_name),
      username = COALESCE(NULLIF(TRIM(excluded.username), ''), wa_contacts.username),
      phone_number = COALESCE(NULLIF(TRIM(excluded.phone_number), ''), wa_contacts.phone_number),
      img_url = COALESCE(excluded.img_url, wa_contacts.img_url),
      updated_at = excluded.updated_at
  `);

  const upsertJidMapStmt = db.prepare(`
    INSERT INTO wa_jid_map (source_jid, target_jid, updated_at)
    VALUES (@sourceJid, @targetJid, @updatedAt)
    ON CONFLICT(source_jid) DO UPDATE SET
      target_jid = excluded.target_jid,
      updated_at = excluded.updated_at
  `);

  const upsertChatStmt = db.prepare(`
    INSERT INTO wa_chats (jid, name, is_group, last_message_ts, last_message_text, last_message_type, unread, updated_at)
    VALUES (@jid, @name, @isGroup, @lastMessageTs, @lastMessageText, @lastMessageType, @unread, @updatedAt)
    ON CONFLICT(jid) DO UPDATE SET
      name = COALESCE(NULLIF(TRIM(excluded.name), ''), wa_chats.name),
      is_group = CASE WHEN wa_chats.is_group = 1 THEN 1 ELSE excluded.is_group END,
      last_message_ts = MAX(wa_chats.last_message_ts, excluded.last_message_ts),
      last_message_text = CASE
        WHEN excluded.last_message_ts >= wa_chats.last_message_ts THEN excluded.last_message_text
        ELSE wa_chats.last_message_text
      END,
      last_message_type = CASE
        WHEN excluded.last_message_ts >= wa_chats.last_message_ts THEN excluded.last_message_type
        ELSE wa_chats.last_message_type
      END,
      updated_at = excluded.updated_at
  `);

  const upsertMessageStmt = db.prepare(`
    INSERT INTO wa_messages (
      message_key, remote_jid, key_id, from_me, participant, sender_jid, message_timestamp,
      message_type, text, status, is_deleted, media_type, media_mime, media_path,
      media_thumb_data_uri, raw_content, reply_to_stanza_id, reply_to_participant,
      created_at, updated_at
    )
    VALUES (
      @messageKey, @remoteJid, @keyId, @fromMe, @participant, @senderJid, @messageTimestamp,
      @messageType, @text, @status, @isDeleted, @mediaType, @mediaMime, @mediaPath,
      @mediaThumbDataUri, @rawContent, @replyToStanzaId, @replyToParticipant,
      @createdAt, @updatedAt
    )
    ON CONFLICT(message_key) DO UPDATE SET
      message_timestamp = MAX(wa_messages.message_timestamp, excluded.message_timestamp),
      message_type = COALESCE(excluded.message_type, wa_messages.message_type),
      text = CASE
        WHEN excluded.message_timestamp >= wa_messages.message_timestamp THEN excluded.text
        ELSE wa_messages.text
      END,
      status = COALESCE(excluded.status, wa_messages.status),
      is_deleted = CASE WHEN excluded.is_deleted = 1 THEN 1 ELSE wa_messages.is_deleted END,
      media_type = COALESCE(excluded.media_type, wa_messages.media_type),
      media_mime = COALESCE(excluded.media_mime, wa_messages.media_mime),
      media_path = COALESCE(excluded.media_path, wa_messages.media_path),
      media_thumb_data_uri = COALESCE(excluded.media_thumb_data_uri, wa_messages.media_thumb_data_uri),
      raw_content = COALESCE(excluded.raw_content, wa_messages.raw_content),
      reply_to_stanza_id = COALESCE(excluded.reply_to_stanza_id, wa_messages.reply_to_stanza_id),
      reply_to_participant = COALESCE(excluded.reply_to_participant, wa_messages.reply_to_participant),
      sender_jid = COALESCE(excluded.sender_jid, wa_messages.sender_jid),
      updated_at = excluded.updated_at
  `);

  const updateMessageStmt = db.prepare(`
    UPDATE wa_messages
    SET
      text = COALESCE(@text, text),
      status = COALESCE(@status, status),
      is_deleted = CASE WHEN @isDeleted IS NOT NULL THEN @isDeleted ELSE is_deleted END,
      media_type = COALESCE(@mediaType, media_type),
      media_mime = COALESCE(@mediaMime, media_mime),
      media_path = COALESCE(@mediaPath, media_path),
      media_thumb_data_uri = COALESCE(@mediaThumbDataUri, media_thumb_data_uri),
      raw_content = COALESCE(@rawContent, raw_content),
      updated_at = @updatedAt
    WHERE message_key = @messageKey
  `);

  const upsertContact = (input: Partial<WaContactRecord> & { jid: string }) => {
    const now = Date.now();
    upsertContactStmt.run({
      jid: input.jid,
      name: trimmedOrNull(input.name),
      notify: trimmedOrNull(input.notify),
      verifiedName: trimmedOrNull(input.verifiedName),
      username: trimmedOrNull(input.username),
      phoneNumber: trimmedOrNull(input.phoneNumber),
      imgUrl: input.imgUrl ?? null,
      updatedAt: now,
    });
  };

  const upsertJidMapping = (sourceJid: string, targetJid: string) => {
    if (!sourceJid || !targetJid) return;
    upsertJidMapStmt.run({
      sourceJid,
      targetJid,
      updatedAt: Date.now(),
    });
  };

  const upsertChat = (input: Partial<WaChatRecord> & { jid: string }) => {
    const now = Date.now();
    upsertChatStmt.run({
      jid: input.jid,
      name: trimmedOrNull(input.name),
      isGroup: input.isGroup ? 1 : 0,
      lastMessageTs: input.lastMessageTs ?? 0,
      lastMessageText: input.lastMessageText ?? '',
      lastMessageType: input.lastMessageType ?? '',
      unread: input.unread ?? 0,
      updatedAt: now,
    });
  };

  const upsertMessage = (input: WaMessageRecord) => {
    const now = Date.now();
    upsertMessageStmt.run({
      messageKey: input.messageKey,
      remoteJid: input.remoteJid,
      keyId: input.keyId,
      fromMe: input.fromMe ? 1 : 0,
      participant: input.participant,
      senderJid: input.senderJid,
      messageTimestamp: input.messageTimestamp,
      messageType: input.messageType,
      text: input.text,
      status: input.status,
      isDeleted: input.isDeleted ? 1 : 0,
      mediaType: input.mediaType,
      mediaMime: input.mediaMime,
      mediaPath: input.mediaPath,
      mediaThumbDataUri: input.mediaThumbDataUri,
      rawContent: input.rawContent,
      replyToStanzaId: input.replyToStanzaId,
      replyToParticipant: input.replyToParticipant,
      createdAt: now,
      updatedAt: now,
    });

    upsertChat({
      jid: input.remoteJid,
      isGroup: input.remoteJid.endsWith('@g.us'),
      lastMessageTs: input.messageTimestamp,
      lastMessageText: input.text,
      lastMessageType: input.messageType ?? '',
    });

    return getMessage(input.messageKey);
  };

  const updateMessage = (
    messageKey: string,
    patch: Partial<
      Pick<
        WaMessageRecord,
        | 'text'
        | 'status'
        | 'mediaType'
        | 'mediaMime'
        | 'mediaPath'
        | 'mediaThumbDataUri'
        | 'rawContent'
        | 'isDeleted'
      >
    >,
  ) => {
    updateMessageStmt.run({
      messageKey,
      text: patch.text ?? null,
      status: patch.status ?? null,
      isDeleted:
        patch.isDeleted === undefined ? null : patch.isDeleted ? 1 : 0,
      mediaType: patch.mediaType ?? null,
      mediaMime: patch.mediaMime ?? null,
      mediaPath: patch.mediaPath ?? null,
      mediaThumbDataUri: patch.mediaThumbDataUri ?? null,
      rawContent: patch.rawContent ?? null,
      updatedAt: Date.now(),
    });
    return getMessage(messageKey);
  };

  const markMessageDeleted = (messageKey: string) => {
    updateMessage(messageKey, {
      isDeleted: true,
      text: '[This message was deleted]',
    });
  };

  const deleteAllMessagesForChat = (jid: string) => {
    db.prepare('DELETE FROM wa_messages WHERE remote_jid = ?').run(jid);
  };

  const getMessage = (messageKey: string): WaMessageRecord | null => {
    const row = db
      .prepare('SELECT * FROM wa_messages WHERE message_key = ? LIMIT 1')
      .get(messageKey) as any;
    if (!row) return null;
    return mapMessageRow(row);
  };

  const getChats = (limit = 250): WaChatRecord[] => {
    const rows = db
      .prepare(
        `SELECT
           c.jid,
           COALESCE(
             NULLIF(TRIM(c.name), ''),
             NULLIF(TRIM(ct.name), ''),
             NULLIF(TRIM(ct.notify), ''),
             NULLIF(TRIM(ct.verified_name), ''),
             NULLIF(TRIM(ct.username), '')
           ) AS name,
           c.is_group,
           c.last_message_ts,
           c.last_message_text,
           c.last_message_type,
           c.unread
         FROM wa_chats c
         LEFT JOIN wa_contacts ct ON ct.jid = c.jid
         ORDER BY c.last_message_ts DESC
         LIMIT ?`,
      )
      .all(limit) as any[];
    return rows.map(mapChatRow);
  };

  const getMessagesForChat = (
    jid: string,
    limit = 200,
  ): WaMessageRecord[] => {
    const rows = db
      .prepare(
        `SELECT * FROM (
          SELECT * FROM wa_messages
          WHERE remote_jid = ?
          ORDER BY message_timestamp DESC, created_at DESC
          LIMIT ?
        ) recent
        ORDER BY message_timestamp ASC, created_at ASC`,
      )
      .all(jid, limit) as any[];
    return rows.map(mapMessageRow);
  };

  const getMessagesForChatWithReplies = (
    jid: string,
    limit = 200,
  ): WaMessageWithReply[] => {
    const rows = db
      .prepare(
        `SELECT * FROM (
          SELECT
            m.*,
            parent.text AS reply_to_text,
            parent.sender_jid AS reply_to_sender_jid
          FROM wa_messages m
          LEFT JOIN wa_messages parent
            ON parent.remote_jid = m.remote_jid
           AND parent.key_id = m.reply_to_stanza_id
          WHERE m.remote_jid = ?
          ORDER BY m.message_timestamp DESC, m.created_at DESC
          LIMIT ?
        ) recent
        ORDER BY message_timestamp ASC, created_at ASC`,
      )
      .all(jid, limit) as any[];
    return rows.map((row) => ({
      ...mapMessageRow(row),
      replyToText: row.reply_to_text ?? null,
      replyToSenderJid: row.reply_to_sender_jid ?? null,
    }));
  };

  const getContact = (jid: string): WaContactRecord | null => {
    const row = db
      .prepare(
        'SELECT jid, name, notify, verified_name, username, phone_number, img_url, updated_at FROM wa_contacts WHERE jid = ? LIMIT 1',
      )
      .get(jid) as any;
    if (!row) return null;
    return mapContactRow(row);
  };

  const resolveDisplayName = (jid: string | null | undefined): string | null => {
    if (!jid) return null;
    const c = getContact(jid);
    if (!c) return null;
    return (
      trimmedOrNull(c.name) ||
      trimmedOrNull(c.notify) ||
      trimmedOrNull(c.verifiedName) ||
      trimmedOrNull(c.username) ||
      null
    );
  };

  const createWaOutboxMessage = (
    row: Omit<WaOutboxMessageRecord, 'createdAt' | 'updatedAt'> & {
      createdAt?: number;
      updatedAt?: number;
    },
  ) => {
    const createdAt = row.createdAt ?? Date.now();
    const updatedAt = row.updatedAt ?? createdAt;

    db.prepare(
      `INSERT INTO wa_outbox_messages (
        id, client_request_id, chat_jid, text, quoted_message_key,
        status, error_code, error_message, wa_message_key, created_at, updated_at
      )
      VALUES (
        @id, @clientRequestId, @chatJid, @text, @quotedMessageKey,
        @status, @errorCode, @errorMessage, @waMessageKey, @createdAt, @updatedAt
      )
      ON CONFLICT(client_request_id) DO NOTHING`,
    ).run({
      ...row,
      createdAt,
      updatedAt,
      errorCode: row.errorCode ?? null,
      errorMessage: row.errorMessage ?? null,
      waMessageKey: row.waMessageKey ?? null,
    });

    return getWaOutboxMessageByClientRequestId(row.clientRequestId);
  };

  const updateWaOutboxMessageStatus = (
    id: string,
    patch: Partial<
      Pick<
        WaOutboxMessageRecord,
        'status' | 'errorCode' | 'errorMessage' | 'waMessageKey'
      >
    >,
  ) => {
    db.prepare(
      `UPDATE wa_outbox_messages
       SET
         status = COALESCE(@status, status),
         error_code = COALESCE(@errorCode, error_code),
         error_message = COALESCE(@errorMessage, error_message),
         wa_message_key = COALESCE(@waMessageKey, wa_message_key),
         updated_at = @updatedAt
       WHERE id = @id`,
    ).run({
      id,
      status: (patch.status as WaOutboxStatus | null | undefined) ?? null,
      errorCode: patch.errorCode ?? null,
      errorMessage: patch.errorMessage ?? null,
      waMessageKey: patch.waMessageKey ?? null,
      updatedAt: Date.now(),
    });
    return getWaOutboxMessageById(id);
  };

  const getWaOutboxMessageByClientRequestId = (
    clientRequestId: string,
  ): WaOutboxMessageRecord | null => {
    const row = db
      .prepare(
        `SELECT id, client_request_id, chat_jid, text, quoted_message_key, status, error_code,
                error_message, wa_message_key, created_at, updated_at
         FROM wa_outbox_messages WHERE client_request_id = ? LIMIT 1`,
      )
      .get(clientRequestId) as any;
    if (!row) return null;
    return mapOutboxRow(row);
  };

  const getWaOutboxMessageById = (
    id: string,
  ): WaOutboxMessageRecord | null => {
    const row = db
      .prepare(
        `SELECT id, client_request_id, chat_jid, text, quoted_message_key, status, error_code,
                error_message, wa_message_key, created_at, updated_at
         FROM wa_outbox_messages WHERE id = ? LIMIT 1`,
      )
      .get(id) as any;
    if (!row) return null;
    return mapOutboxRow(row);
  };

  return {
    upsertContact,
    upsertJidMapping,
    upsertChat,
    upsertMessage,
    updateMessage,
    markMessageDeleted,
    deleteAllMessagesForChat,
    getMessage,
    getChats,
    getMessagesForChat,
    getMessagesForChatWithReplies,
    getContact,
    resolveDisplayName,
    createWaOutboxMessage,
    updateWaOutboxMessageStatus,
    getWaOutboxMessageByClientRequestId,
    getWaOutboxMessageById,
  };
};

export type WhatsAppStore = ReturnType<typeof createWhatsAppStore>;

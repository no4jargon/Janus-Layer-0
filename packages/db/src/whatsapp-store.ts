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

const unreadCount = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.trunc(parsed));
};

const trimmedOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length ? v : null;
};

const contactDisplayNameSql = () => `
  COALESCE(
    NULLIF(TRIM(ct.name), ''),
    NULLIF(TRIM(ct.notify), ''),
    NULLIF(TRIM(ct.verified_name), ''),
    NULLIF(TRIM(ct.username), ''),
    NULLIF(TRIM(mapped_ct.name), ''),
    NULLIF(TRIM(mapped_ct.notify), ''),
    NULLIF(TRIM(mapped_ct.verified_name), ''),
    NULLIF(TRIM(mapped_ct.username), '')
  )
`;

const contactLookupJoinsSql = (jidSql: string) => `
  LEFT JOIN wa_contacts ct ON ct.jid = ${jidSql}
  LEFT JOIN wa_contacts mapped_ct
    ON mapped_ct.jid = COALESCE(
      (SELECT target_jid FROM wa_jid_map WHERE source_jid = ${jidSql} LIMIT 1),
      (SELECT source_jid FROM wa_jid_map WHERE target_jid = ${jidSql} LIMIT 1)
    )
`;

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
    VALUES (@jid, @name, @isGroup, @lastMessageTs, @lastMessageText, @lastMessageType, COALESCE(@unread, 0), @updatedAt)
    ON CONFLICT(jid) DO UPDATE SET
      name = COALESCE(NULLIF(TRIM(excluded.name), ''), wa_chats.name),
      is_group = CASE WHEN wa_chats.is_group = 1 THEN 1 ELSE excluded.is_group END,
      last_message_ts = MAX(wa_chats.last_message_ts, excluded.last_message_ts),
      last_message_text = CASE
        WHEN @hasLastMessageText = 1 AND excluded.last_message_ts >= wa_chats.last_message_ts
          THEN excluded.last_message_text
        ELSE wa_chats.last_message_text
      END,
      last_message_type = CASE
        WHEN @hasLastMessageType = 1 AND excluded.last_message_ts >= wa_chats.last_message_ts
          THEN excluded.last_message_type
        ELSE wa_chats.last_message_type
      END,
      unread = CASE
        WHEN @unread IS NULL THEN wa_chats.unread
        ELSE excluded.unread
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
      status = CASE
        WHEN excluded.status IS NULL THEN wa_messages.status
        WHEN wa_messages.status IS NULL THEN excluded.status
        ELSE MAX(wa_messages.status, excluded.status)
      END,
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
      status = CASE
        WHEN @status IS NULL THEN status
        WHEN status IS NULL THEN @status
        ELSE MAX(status, @status)
      END,
      is_deleted = CASE WHEN @isDeleted IS NOT NULL THEN @isDeleted ELSE is_deleted END,
      media_type = COALESCE(@mediaType, media_type),
      media_mime = COALESCE(@mediaMime, media_mime),
      media_path = COALESCE(@mediaPath, media_path),
      media_thumb_data_uri = COALESCE(@mediaThumbDataUri, media_thumb_data_uri),
      raw_content = COALESCE(@rawContent, raw_content),
      updated_at = @updatedAt
    WHERE message_key = @messageKey
  `);

  const setChatUnreadStmt = db.prepare(`
    INSERT INTO wa_chats (jid, name, is_group, last_message_ts, last_message_text, last_message_type, unread, updated_at)
    VALUES (@jid, NULL, 0, 0, '', '', @unread, @updatedAt)
    ON CONFLICT(jid) DO UPDATE SET
      unread = excluded.unread,
      updated_at = excluded.updated_at
  `);

  const incrementChatUnreadStmt = db.prepare(`
    INSERT INTO wa_chats (jid, name, is_group, last_message_ts, last_message_text, last_message_type, unread, updated_at)
    VALUES (@jid, NULL, 0, 0, '', '', @delta, @updatedAt)
    ON CONFLICT(jid) DO UPDATE SET
      unread = MAX(0, wa_chats.unread + excluded.unread),
      updated_at = excluded.updated_at
  `);

  const markChatUnreadStmt = db.prepare(`
    INSERT INTO wa_chats (jid, name, is_group, last_message_ts, last_message_text, last_message_type, unread, updated_at)
    VALUES (@jid, NULL, 0, 0, '', '', 1, @updatedAt)
    ON CONFLICT(jid) DO UPDATE SET
      unread = CASE WHEN wa_chats.unread > 0 THEN wa_chats.unread ELSE 1 END,
      updated_at = excluded.updated_at
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
      hasLastMessageText: input.lastMessageText === undefined ? 0 : 1,
      hasLastMessageType: input.lastMessageType === undefined ? 0 : 1,
      unread: unreadCount(input.unread),
      updatedAt: now,
    });
  };

  const setChatUnread = (jid: string, unread: number) => {
    setChatUnreadStmt.run({
      jid,
      unread: unreadCount(unread) ?? 0,
      updatedAt: Date.now(),
    });
  };

  const incrementChatUnread = (jid: string, delta: number) => {
    const amount = unreadCount(delta);
    if (!amount) return;
    incrementChatUnreadStmt.run({
      jid,
      delta: amount,
      updatedAt: Date.now(),
    });
  };

  const markChatRead = (jid: string, messageKeys?: string[]) => {
    // Acknowledge the displayed snapshot only: a message arriving between the
    // renderer fetch and this call must remain unread.
    const mark = db.prepare(`UPDATE wa_messages SET locally_read = 1
      WHERE remote_jid = ? AND message_key = ? AND from_me = 0 AND locally_read = 0`);
    const keys = messageKeys ?? getMessagesForChat(jid, Number.MAX_SAFE_INTEGER)
      .map((message) => message.messageKey);
    db.exec('SAVEPOINT wa_local_read');
    try {
      for (const key of keys) mark.run(jid, key);
      const latest = db.prepare(`SELECT message_key, message_timestamp FROM wa_messages
        WHERE remote_jid = ? ORDER BY message_timestamp DESC, rowid DESC LIMIT 1`)
        .get(jid) as { message_key: string; message_timestamp: number } | undefined;
      if (latest && keys.includes(latest.message_key)) {
        db.prepare(`UPDATE wa_chats SET locally_read_marker_key = ?
          WHERE jid = ? AND last_message_ts <= ?`)
          .run(latest.message_key, jid, latest.message_timestamp);
      }
      db.exec('RELEASE wa_local_read');
    } catch (error) {
      db.exec('ROLLBACK TO wa_local_read');
      db.exec('RELEASE wa_local_read');
      throw error;
    }
  };

  const markMessageRead = (messageKey: string) => {
    // Only an inbound provider receipt reaches this method. Local viewing
    // never changes WhatsApp delivery/read statuses.
    const message = getMessage(messageKey);
    if (!message || message.fromMe || (message.status ?? 0) >= 4) return;
    db.exec('SAVEPOINT wa_provider_read');
    try {
      const chat = db.prepare('SELECT unread FROM wa_chats WHERE jid = ?')
        .get(message.remoteJid) as { unread: number } | undefined;
      const counted = chat && db.prepare(`SELECT 1 FROM (
        SELECT message_key FROM wa_messages
        WHERE remote_jid = ? AND from_me = 0 AND COALESCE(status, 0) < 4
        ORDER BY message_timestamp DESC, rowid DESC LIMIT ?
      ) WHERE message_key = ?`).get(message.remoteJid, chat.unread, messageKey);
      db.prepare('UPDATE wa_messages SET status = 4, updated_at = ? WHERE message_key = ?')
        .run(Date.now(), messageKey);
      // A delayed receipt for an older, already-cleared message must not consume
      // the unread count of a newer message. Commit status and count together so
      // a failed write can be retried without losing the receipt's decrement.
      if (counted) {
        db.prepare('UPDATE wa_chats SET unread = MAX(0, unread - 1), updated_at = ? WHERE jid = ?')
          .run(Date.now(), message.remoteJid);
      }
      db.exec('RELEASE wa_provider_read');
    } catch (error) {
      db.exec('ROLLBACK TO wa_provider_read');
      db.exec('RELEASE wa_provider_read');
      throw error;
    }
  };

  const markChatUnread = (jid: string) => {
    db.prepare('UPDATE wa_messages SET locally_read = 0 WHERE remote_jid = ?').run(jid);
    db.prepare('UPDATE wa_chats SET locally_read_marker_key = NULL WHERE jid = ?').run(jid);
    markChatUnreadStmt.run({
      jid,
      updatedAt: Date.now(),
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
        `WITH unread_messages AS (
           SELECT remote_jid, locally_read,
             ROW_NUMBER() OVER (
               PARTITION BY remote_jid ORDER BY message_timestamp DESC, rowid DESC
             ) AS unread_rank
           FROM wa_messages WHERE from_me = 0 AND COALESCE(status, 0) < 4
         ), local_reads AS (
           SELECT m.remote_jid, SUM(m.locally_read) AS read_count, COUNT(*) AS pending_count
           FROM unread_messages m JOIN wa_chats c ON c.jid = m.remote_jid
           WHERE m.unread_rank <= c.unread GROUP BY m.remote_jid
         )
         SELECT
           c.jid,
           COALESCE(
             ${contactDisplayNameSql()},
             NULLIF(TRIM(c.name), '')
           ) AS name,
           c.is_group,
           c.last_message_ts,
           c.last_message_text,
           c.last_message_type,
           CASE WHEN c.unread = 1 AND COALESCE(local_reads.pending_count, 0) = 0
             AND c.locally_read_marker_key = latest.message_key
             AND c.last_message_ts <= latest.message_timestamp
             THEN 0
             ELSE MAX(0, c.unread - COALESCE(local_reads.read_count, 0))
           END AS unread
         FROM wa_chats c
         LEFT JOIN local_reads ON local_reads.remote_jid = c.jid
         LEFT JOIN wa_messages latest ON latest.message_key = (
           SELECT message_key FROM wa_messages WHERE remote_jid = c.jid
           ORDER BY message_timestamp DESC, rowid DESC LIMIT 1
         )
         ${contactLookupJoinsSql('c.jid')}
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
    const row = db
      .prepare(
        `SELECT
           ${contactDisplayNameSql()} AS name
         FROM (SELECT ? AS jid) lookup
         ${contactLookupJoinsSql('lookup.jid')}
         LIMIT 1`,
      )
      .get(jid) as any;
    return trimmedOrNull(row?.name);
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
    setChatUnread,
    incrementChatUnread,
    markChatRead,
    markMessageRead,
    markChatUnread,
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

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  bootstrapDatabase,
  closeDatabase,
  createWhatsAppStore,
  mkMessageKey,
  type WaMessageRecord,
} from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: (message: string, details?: unknown) =>
    console.error(`[db error] ${message}`, details ?? ''),
};

const CHAT_JID = '120363000000000000@g.us';
const PARENT_SENDER_JID = '15551110000@s.whatsapp.net';
const REPLY_SENDER_JID = '15552220000@s.whatsapp.net';
const LID_SENDER_JID = '54859717935330@lid';

const baseMessage = (overrides: Partial<WaMessageRecord>): WaMessageRecord => ({
  messageKey: '',
  remoteJid: CHAT_JID,
  keyId: '',
  fromMe: false,
  participant: null,
  senderJid: null,
  messageTimestamp: 0,
  messageType: 'conversation',
  text: '',
  status: null,
  isDeleted: false,
  mediaType: null,
  mediaMime: null,
  mediaPath: null,
  mediaThumbDataUri: null,
  rawContent: null,
  replyToStanzaId: null,
  replyToParticipant: null,
  ...overrides,
});

describe('WhatsApp store', () => {
  let tmpDir: string;
  let store: ReturnType<typeof createWhatsAppStore>;
  let db: ReturnType<typeof bootstrapDatabase>['db'];

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'chai-wa-reply-'));
    const result = bootstrapDatabase({
      dbPath: path.join(tmpDir, 'app.db'),
      migrationsDir,
      logger: silentLogger,
    });
    assert.equal(
      result.migrationFailure,
      null,
      `migrations failed: ${result.migrationFailure?.failedMigration}`,
    );
    db = result.db;
    store = createWhatsAppStore(db);
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const getChat = (jid: string = CHAT_JID) => {
    const chat = store.getChats(50).find((item) => item.jid === jid);
    assert.ok(chat, `chat ${jid} should exist`);
    return chat;
  };

  it('persists provider unread counts without clearing them on metadata-only updates', () => {
    store.upsertChat({
      jid: CHAT_JID,
      isGroup: true,
      lastMessageTs: 1_700_000_000,
      lastMessageText: 'first unread',
      lastMessageType: 'conversation',
      unread: 3,
    });

    assert.equal(getChat().unread, 3);

    store.upsertChat({
      jid: CHAT_JID,
      isGroup: true,
      lastMessageTs: 1_700_000_060,
      lastMessageText: 'new preview, same unread state',
      lastMessageType: 'conversation',
    });

    const updated = getChat();
    assert.equal(updated.lastMessageText, 'new preview, same unread state');
    assert.equal(updated.unread, 3);

    store.upsertChat({
      jid: CHAT_JID,
      unread: 0,
    });

    assert.equal(getChat().unread, 0);
  });

  it('increments, clears, and marks local WhatsApp unread counts', () => {
    store.incrementChatUnread(CHAT_JID, 1);
    store.incrementChatUnread(CHAT_JID, 2);

    assert.equal(getChat().unread, 3);

    store.markChatRead(CHAT_JID);
    assert.equal(getChat().unread, 0);

    store.markChatUnread(CHAT_JID);
    assert.equal(getChat().unread, 1);

    store.markChatUnread(CHAT_JID);
    assert.equal(getChat().unread, 1);
  });

  it('preserves message previews on same-timestamp metadata updates, while accepting explicit empty text', () => {
    store.upsertChat({
      jid: CHAT_JID,
      lastMessageTs: 1_700_000_000,
      lastMessageText: 'keep this preview',
      lastMessageType: 'conversation',
      unread: 2,
    });

    store.upsertChat({ jid: CHAT_JID, name: 'Renamed', lastMessageTs: 1_700_000_000 });
    assert.equal(getChat().lastMessageText, 'keep this preview');
    assert.equal(getChat().lastMessageType, 'conversation');
    assert.equal(getChat().unread, 2);

    store.upsertChat({ jid: CHAT_JID, lastMessageTs: 1_700_000_060, unread: 3 });
    assert.equal(getChat().lastMessageText, 'keep this preview');
    assert.equal(getChat().lastMessageType, 'conversation');
    assert.equal(getChat().unread, 3);

    store.upsertChat({
      jid: CHAT_JID,
      lastMessageTs: 1_700_000_060,
      lastMessageText: '',
      lastMessageType: '',
    });
    assert.equal(getChat().lastMessageText, '');
    assert.equal(getChat().lastMessageType, '');
  });

  it('does not count stored history messages as unread by itself', () => {
    store.upsertMessage(
      baseMessage({
        messageKey: mkMessageKey({
          remoteJid: CHAT_JID,
          id: 'HISTORY_MESSAGE_001',
          fromMe: false,
          participant: PARENT_SENDER_JID,
        }),
        keyId: 'HISTORY_MESSAGE_001',
        participant: PARENT_SENDER_JID,
        senderJid: PARENT_SENDER_JID,
        messageTimestamp: 1_700_000_000,
        text: 'old synced message',
      }),
    );

    assert.equal(getChat().unread, 0);
  });

  it('persists reply context on insert and surfaces parent text via the join', () => {
    const parentKeyId = 'PARENT_STANZA_ID_001';
    const replyKeyId = 'REPLY_STANZA_ID_002';

    const parentKey = {
      remoteJid: CHAT_JID,
      id: parentKeyId,
      fromMe: false,
      participant: PARENT_SENDER_JID,
    };
    const replyKey = {
      remoteJid: CHAT_JID,
      id: replyKeyId,
      fromMe: false,
      participant: REPLY_SENDER_JID,
    };

    store.upsertMessage(
      baseMessage({
        messageKey: mkMessageKey(parentKey),
        keyId: parentKeyId,
        participant: PARENT_SENDER_JID,
        senderJid: PARENT_SENDER_JID,
        messageTimestamp: 1_700_000_000,
        text: 'are we still on for 3pm?',
      }),
    );

    store.upsertMessage(
      baseMessage({
        messageKey: mkMessageKey(replyKey),
        keyId: replyKeyId,
        participant: REPLY_SENDER_JID,
        senderJid: REPLY_SENDER_JID,
        messageTimestamp: 1_700_000_060,
        text: 'sorry, can we push to 4?',
        replyToStanzaId: parentKeyId,
        replyToParticipant: PARENT_SENDER_JID,
      }),
    );

    const persistedReply = store.getMessage(mkMessageKey(replyKey));
    assert.ok(persistedReply, 'reply row should be readable');
    assert.equal(persistedReply!.replyToStanzaId, parentKeyId);
    assert.equal(persistedReply!.replyToParticipant, PARENT_SENDER_JID);

    const persistedParent = store.getMessage(mkMessageKey(parentKey));
    assert.equal(persistedParent!.replyToStanzaId, null);
    assert.equal(persistedParent!.replyToParticipant, null);

    const enriched = store.getMessagesForChatWithReplies(CHAT_JID, 100);
    assert.equal(enriched.length, 2);

    const enrichedParent = enriched.find((m) => m.keyId === parentKeyId);
    const enrichedReply = enriched.find((m) => m.keyId === replyKeyId);
    assert.ok(enrichedParent && enrichedReply);

    assert.equal(enrichedParent!.replyToText, null);
    assert.equal(enrichedParent!.replyToSenderJid, null);

    assert.equal(enrichedReply!.replyToText, 'are we still on for 3pm?');
    assert.equal(enrichedReply!.replyToSenderJid, PARENT_SENDER_JID);
  });

  it('leaves replyToText null when the parent message is not in the store', () => {
    const orphanReplyKey = {
      remoteJid: CHAT_JID,
      id: 'ORPHAN_REPLY_003',
      fromMe: false,
      participant: REPLY_SENDER_JID,
    };

    store.upsertMessage(
      baseMessage({
        messageKey: mkMessageKey(orphanReplyKey),
        keyId: 'ORPHAN_REPLY_003',
        participant: REPLY_SENDER_JID,
        senderJid: REPLY_SENDER_JID,
        messageTimestamp: 1_700_000_120,
        text: 'replying to a message that was never synced',
        replyToStanzaId: 'MISSING_PARENT_ID',
        replyToParticipant: PARENT_SENDER_JID,
      }),
    );

    const enriched = store.getMessagesForChatWithReplies(CHAT_JID, 100);
    assert.equal(enriched.length, 1);
    assert.equal(enriched[0].replyToStanzaId, 'MISSING_PARENT_ID');
    assert.equal(enriched[0].replyToText, null);
    assert.equal(enriched[0].replyToSenderJid, null);
  });

  it('resolves display names through LID-to-phone-number mappings', () => {
    store.upsertContact({
      jid: LID_SENDER_JID,
    });
    store.upsertContact({
      jid: PARENT_SENDER_JID,
      name: 'Shilpi Shah',
    });
    store.upsertJidMapping(LID_SENDER_JID, PARENT_SENDER_JID);

    assert.equal(store.resolveDisplayName(LID_SENDER_JID), 'Shilpi Shah');
  });

  it('prefers mapped contact names over chat titles for direct chats', () => {
    store.upsertChat({
      jid: LID_SENDER_JID,
      name: '+91 5551110000',
      isGroup: false,
      lastMessageTs: 1_700_000_180,
      lastMessageText: 'see you then',
      lastMessageType: 'conversation',
    });
    store.upsertContact({
      jid: PARENT_SENDER_JID,
      name: 'Shilpi Shah',
    });
    store.upsertJidMapping(LID_SENDER_JID, PARENT_SENDER_JID);

    const [chat] = store.getChats(1);
    assert.equal(chat.jid, LID_SENDER_JID);
    assert.equal(chat.name, 'Shilpi Shah');
  });
});

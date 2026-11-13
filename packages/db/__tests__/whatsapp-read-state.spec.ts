import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { bootstrapDatabase, closeDatabase, createWhatsAppStore, mkMessageKey,
  type WaMessageRecord } from '../src/index.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const jid = '15551112222@s.whatsapp.net';

const message = (id: string, timestamp: number, overrides: Partial<WaMessageRecord> = {}): WaMessageRecord => ({
  messageKey: mkMessageKey({ remoteJid: jid, id, fromMe: false }),
  remoteJid: jid,
  keyId: id,
  fromMe: false,
  participant: null,
  senderJid: jid,
  messageTimestamp: timestamp,
  messageType: 'conversation',
  text: id,
  status: 3,
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

describe('WhatsApp local and provider read state', () => {
  let directory: string;
  let db: ReturnType<typeof bootstrapDatabase>['db'];
  let store: ReturnType<typeof createWhatsAppStore>;

  const open = () => {
    const result = bootstrapDatabase({ dbPath: path.join(directory, 'app.db'), migrationsDir });
    assert.equal(result.migrationFailure, null);
    db = result.db;
    store = createWhatsAppStore(db);
  };
  const unread = () => store.getChats().find((chat) => chat.jid === jid)!.unread;
  const rawUnread = () => (db.prepare('SELECT unread FROM wa_chats WHERE jid = ?').get(jid) as { unread: number }).unread;

  beforeEach(() => { directory = mkdtempSync(path.join(tmpdir(), 'chai-wa-reads-')); open(); });
  afterEach(() => { closeDatabase(db); rmSync(directory, { recursive: true, force: true }); });

  it('persists local acknowledgement through restart and provider replay without changing provider read status', () => {
    const incoming = message('incoming', 10);
    store.upsertMessage(incoming);
    store.setChatUnread(jid, 1);
    store.markChatRead(jid, [incoming.messageKey]);
    assert.equal(unread(), 0);
    assert.equal(rawUnread(), 1);
    assert.equal(store.getMessage(incoming.messageKey)?.status, 3);

    closeDatabase(db);
    open();
    store.upsertMessage(incoming);
    store.upsertChat({ jid, unread: 1 });
    assert.equal(unread(), 0);
    assert.equal(store.getMessage(incoming.messageKey)?.status, 3);
  });

  it('acknowledges only fetched messages when a newer message arrives before local acknowledgement', () => {
    const viewed = message('viewed', 10);
    const arriving = message('arriving', 10);
    store.upsertMessage(viewed);
    store.setChatUnread(jid, 1);
    const displayedKeys = store.getMessagesForChat(jid).map((item) => item.messageKey);
    store.upsertMessage(arriving);
    store.incrementChatUnread(jid, 1);
    store.markChatRead(jid, displayedKeys);
    assert.equal(unread(), 1);
    assert.equal(rawUnread(), 2);

    // Replayed metadata/history must preserve both the original acknowledgement
    // and the newly arrived message's separate read state.
    store.upsertMessage(viewed);
    store.setChatUnread(jid, 2);
    assert.equal(unread(), 1);
  });

  it('keeps unmirrored unread messages visible and ignores cross-chat acknowledgement keys', () => {
    const viewed = message('viewed', 10);
    store.upsertMessage(viewed);
    store.setChatUnread(jid, 5);
    store.markChatRead('other@s.whatsapp.net', [viewed.messageKey]);
    assert.equal(unread(), 5);
    store.markChatRead(jid, [viewed.messageKey]);
    assert.equal(unread(), 4, 'unmirrored messages have not been displayed');
  });

  it('applies external reads once and preserves incoming status against stale message replay', () => {
    const first = message('first', 10);
    const next = message('next', 20);
    const outgoing = message('outgoing', 30, { fromMe: true,
      messageKey: mkMessageKey({ remoteJid: jid, id: 'outgoing', fromMe: true }) });
    store.upsertMessage(first);
    store.upsertMessage(next);
    store.upsertMessage(outgoing);
    store.setChatUnread(jid, 2);
    store.markMessageRead(first.messageKey);
    assert.equal(unread(), 1);
    store.upsertMessage(first);
    store.updateMessage(first.messageKey, { status: 3 });
    store.markMessageRead(first.messageKey);
    store.markMessageRead(outgoing.messageKey);
    assert.equal(unread(), 1);
    assert.equal(store.getMessage(first.messageKey)?.status, 4);
  });

  it('does not subtract a locally viewed message twice when its external read arrives', () => {
    const viewed = message('viewed', 10);
    const unseen = message('unseen', 20);
    store.upsertMessage(viewed);
    store.upsertMessage(unseen);
    store.setChatUnread(jid, 2);
    store.markChatRead(jid, [viewed.messageKey]);
    assert.equal(unread(), 1);
    store.markMessageRead(viewed.messageKey);
    assert.equal(unread(), 1);
    store.markMessageRead(unseen.messageKey);
    assert.equal(unread(), 0);
  });

  it('rolls back a provider receipt if its unread update fails, so replay can recover', () => {
    const incoming = message('incoming', 10);
    store.upsertMessage(incoming);
    store.setChatUnread(jid, 1);
    db.exec(`CREATE TRIGGER fail_unread_update BEFORE UPDATE OF unread ON wa_chats
      WHEN NEW.unread < OLD.unread
      BEGIN SELECT RAISE(ABORT, 'simulated unread write failure'); END`);
    assert.throws(() => store.markMessageRead(incoming.messageKey), /simulated unread write failure/);
    assert.equal(store.getMessage(incoming.messageKey)?.status, 3, 'status and unread must commit together');
    assert.equal(rawUnread(), 1);
    db.exec('DROP TRIGGER fail_unread_update');
    store.markMessageRead(incoming.messageKey);
    assert.equal(unread(), 0, 'replaying a rolled-back receipt should still clear its count');
  });

  it('does not let an old delayed receipt clear a message received after a provider chat read', () => {
    const old = message('old', 10);
    const current = message('current', 20);
    store.upsertMessage(old);
    store.setChatUnread(jid, 1);
    store.setChatUnread(jid, 0); // phone read the old message
    store.upsertMessage(current);
    store.incrementChatUnread(jid, 1);
    store.markMessageRead(old.messageKey); // late per-message read receipt
    assert.equal(unread(), 1, 'the new message has not been read');
  });

  it('does not decrement the provider unread count for older mirrored history outside its unread tail', () => {
    const historical = message('historical', 10);
    const current = message('current', 20);
    store.upsertMessage(historical);
    store.upsertMessage(current);
    store.setChatUnread(jid, 1);
    store.markMessageRead(historical.messageKey);
    assert.equal(unread(), 1, 'an old receipt does not acknowledge the current unread message');
  });

  it('can locally acknowledge a provider manual-unread marker on an already read chat', () => {
    const previouslyRead = message('previously-read', 10, { status: 4 });
    store.upsertMessage(previouslyRead);
    store.setChatUnread(jid, 0);
    store.markChatUnread(jid); // phone's Mark as unread action
    assert.equal(unread(), 1);
    store.markChatRead(jid, [previouslyRead.messageKey]);
    assert.equal(unread(), 0, 'opening an already read conversation clears its local attention marker');
    assert.equal(rawUnread(), 1, 'local reading does not change provider state');
  });

  it('acknowledges a manual marker on an outgoing-only chat and shows a fresh manual marker again', () => {
    const sent = message('sent', 10, { fromMe: true,
      messageKey: mkMessageKey({ remoteJid: jid, id: 'sent', fromMe: true }), status: 4 });
    store.upsertMessage(sent);
    store.markChatUnread(jid);
    store.markChatRead(jid, [sent.messageKey]);
    assert.equal(unread(), 0);
    store.upsertMessage(sent);
    store.upsertChat({ jid, unread: 1 });
    assert.equal(unread(), 0, 'replayed provider count does not revive a viewed marker');
    store.markChatUnread(jid);
    assert.equal(unread(), 1, 'a new explicit manual-unread action requires attention again');
  });

  it('does not acknowledge a manual marker from an old snapshot after a newer arrival', () => {
    const old = message('old', 10, { status: 4 });
    const newer = message('newer', 10, { status: 4 });
    store.upsertMessage(old);
    store.upsertMessage(newer);
    store.markChatUnread(jid);
    store.markChatRead(jid, [old.messageKey]);
    assert.equal(unread(), 1, 'same-second newer arrivals are distinct snapshot keys');
    store.markChatRead(jid, [newer.messageKey]);
    assert.equal(unread(), 0);

    store.upsertChat({ jid, lastMessageTs: 20, unread: 1 });
    assert.equal(unread(), 1, 'a newer provider preview without its mirrored message stays unread');
  });

  it('retains multiple unmirrored unread messages even when all mirrored messages are provider read', () => {
    const older = message('older', 10, { status: 4 });
    store.upsertMessage(older);
    store.setChatUnread(jid, 3);
    store.markChatRead(jid, [older.messageKey]);
    assert.equal(unread(), 3, 'a single attention-marker fallback cannot hide unknown messages');
  });

  it('does not commit its caller transaction when applying an external read', () => {
    const incoming = message('incoming', 10);
    store.upsertMessage(incoming);
    store.setChatUnread(jid, 1);
    db.exec('BEGIN');
    store.markMessageRead(incoming.messageKey);
    assert.equal(unread(), 0);
    db.exec('ROLLBACK');
    assert.equal(unread(), 1);
    assert.equal(store.getMessage(incoming.messageKey)?.status, 3);
  });
});

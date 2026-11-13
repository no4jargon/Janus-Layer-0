import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import {
  bootstrapDatabase, createEmailStore,
  type EmailMessageRecord, type EmailThreadRecord,
} from '../src/index.js';

const migrationsDir = new URL('../migrations/', import.meta.url).pathname;
let dir: string;
let db: ReturnType<typeof bootstrapDatabase>['db'];
let store: ReturnType<typeof createEmailStore>;
const thread = (unreadCount: number): EmailThreadRecord => ({
  id: 'thread', userId: 'local-user', accountId: 'account', providerThreadId: 'provider-thread',
  derivedThreadKey: null, subject: 'Project', participantSummary: 'Client',
  lastMessageAt: 10, lastCleanedPreview: 'Hello', unreadCount, hasAttachments: false,
  sourceLabelsJson: '["UNREAD"]', createdAt: 1, updatedAt: 1,
});
const message = (id: string, sentAt = 10, providerUnread = true): EmailMessageRecord => ({
  id, threadId: 'thread', accountId: 'account', userId: 'local-user', providerMessageId: id,
  gmailHistoryId: '100', senderName: 'Client', senderEmail: 'client@example.test',
  toJson: '[]', ccJson: '[]', sentAt, direction: 'incoming', snippet: 'Hello',
  bodyRawHtml: null, bodyRawText: 'Hello', bodyCleanText: 'Hello', hasAttachments: 0,
  isHiddenAutomated: 0, createdAt: 1, updatedAt: 1, providerUnread,
});
const unread = () => store.getEmailThreads('local-user')[0].unreadCount;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'chai-email-reads-'));
  const result = bootstrapDatabase({ dbPath: path.join(dir, 'app.db'), migrationsDir });
  assert.equal(result.migrationFailure, null);
  db = result.db;
  store = createEmailStore(db);
  store.upsertEmailAccount({
    id: 'account', userId: 'local-user', provider: 'gmail', emailAddress: 'me@example.test',
    oauthTokenRef: null, syncCursor: null, lastSyncAt: null, createdAt: 1, updatedAt: 1,
  });
  store.upsertEmailThread(thread(1));
  store.upsertEmailMessage(message('m1'));
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

test('local Gmail reads survive provider replay and reopening without changing provider labels/counts', () => {
  store.markEmailThreadRead('thread', ['m1']);
  assert.equal(unread(), 0);
  assert.equal(store.getEmailThreadById('thread')?.unreadCount, 0);
  assert.equal((db.prepare('SELECT unread_count FROM email_threads').get() as any).unread_count, 1);
  assert.equal(store.getEmailMessageById('m1')?.providerUnread, true);
  store.upsertEmailThread(thread(1));
  store.upsertEmailMessage(message('m1'));
  assert.equal(unread(), 0);
  db.close();
  db = bootstrapDatabase({ dbPath: path.join(dir, 'app.db'), migrationsDir }).db;
  store = createEmailStore(db);
  assert.equal(unread(), 0);
});

test('a new message with the same timestamp remains unread when an older rendered snapshot is acknowledged', () => {
  store.upsertEmailMessage(message('m2'));
  store.upsertEmailThread(thread(2));
  store.markEmailThreadRead('thread', ['m1', 'nonexistent']);
  assert.equal(unread(), 1);
  store.markEmailThreadRead('wrong-thread', ['m2']);
  assert.equal(unread(), 1);
  store.markEmailThreadRead('thread', ['m2']);
  assert.equal(unread(), 0);
});

test('provider read flags prevent old local reads from hiding a different unread message', () => {
  store.markEmailThreadRead('thread', ['m1']);
  store.upsertEmailMessage(message('m1', 10, false));
  store.upsertEmailMessage(message('m2', 9, true));
  store.upsertEmailThread(thread(1));
  assert.equal(unread(), 1);
  store.upsertEmailMessage(message('m2', 9, false));
  store.upsertEmailThread(thread(0));
  assert.equal(unread(), 0);
});

test('marking a previously read Gmail message unread externally restores its local badge', () => {
  store.markEmailThreadRead('thread', ['m1']);
  store.upsertEmailMessage(message('m1', 10, false));
  store.upsertEmailThread(thread(0));
  store.upsertEmailMessage(message('m1', 10, true));
  store.upsertEmailThread(thread(1));
  assert.equal(unread(), 1);
});

test('legacy messages without per-message labels retain local acknowledgements on resync', () => {
  db.exec('UPDATE email_messages SET provider_unread = NULL');
  store.markEmailThreadRead('thread', ['m1']);
  store.upsertEmailThread(thread(1));
  const legacy = message('m1');
  delete legacy.providerUnread;
  store.upsertEmailMessage(legacy);
  assert.equal(unread(), 0);
  store.upsertEmailMessage(message('m1'));
  assert.equal(unread(), 0);
});

test('Gmail messages sent to oneself can be locally read when Gmail labels them unread', () => {
  store.upsertEmailMessage({ ...message('m1'), direction: 'outgoing' });
  assert.equal(unread(), 1);
  store.markEmailThreadRead('thread', ['m1']);
  assert.equal(unread(), 0);
  assert.equal(store.getEmailMessageById('m1')?.providerUnread, true);
});

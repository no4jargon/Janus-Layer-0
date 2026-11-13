import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createGmailConnector } from '../dist/gmail-connector.js';
import { GMAIL_SCOPE } from '../dist/oauth.js';

let directory;
let originalFetch;
let originalEnv;
let calls;
let account;
let threads;
let messages;
let handleRequest;
let connector;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const storedThread = (id, unreadCount = 2) => ({
  id: `gmail_thread_${id}`,
  userId: 'local-user',
  accountId: 'account',
  providerThreadId: id,
  derivedThreadKey: 'project',
  subject: 'Project update',
  participantSummary: 'Client',
  lastMessageAt: 1_600_000_000,
  lastCleanedPreview: 'Please review the draft',
  unreadCount,
  hasAttachments: false,
  sourceLabelsJson: '["UNREAD"]',
  createdAt: 1,
  updatedAt: 1,
});
const addThread = (id, unreadCount = 2) => {
  threads.set(`gmail_thread_${id}`, storedThread(id, unreadCount));
  messages.set(`gmail_msg_${id}-message`, {
    id: `gmail_msg_${id}-message`,
    threadId: `gmail_thread_${id}`,
    providerMessageId: `${id}-message`,
    bodyCleanText: 'Cached message body',
    providerUnread: true,
  });
};

beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'chai-gmail-read-sync-'));
  writeFileSync(path.join(directory, 'gmail-token.json'), JSON.stringify({
    access_token: 'fake-token', expiry_date: Date.now() + 3_600_000,
  }));
  writeFileSync(path.join(directory, 'gmail-profile.json'), JSON.stringify({
    emailAddress: 'self@example.com', connectedAt: new Date().toISOString(),
  }));
  originalFetch = globalThis.fetch;
  originalEnv = { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  account = { id: 'account', emailAddress: 'self@example.com', syncCursor: null };
  threads = new Map();
  messages = new Map();
  calls = [];
  globalThis.fetch = async (url, init) => {
    const request = new URL(url);
    calls.push(request);
    assert.equal(init?.method || 'GET', 'GET', 'read-state synchronization must never modify Gmail');
    assert.equal(request.origin, 'https://gmail.googleapis.com');
    return handleRequest(request);
  };
  connector = createGmailConnector({
    keystoreDir: directory,
    attachmentCacheDir: path.join(directory, 'attachments'),
    logger: { info() {}, warn() {}, error() {} },
    openExternal() { assert.fail('sync must not launch OAuth'); },
    emailStore: {
      getEmailAccount: () => account,
      getEmailThreads: (_user, limit) => {
        assert.ok(limit > 250, 'initial reconciliation must include old threads beyond the UI page');
        return [...threads.values()];
      },
      getEmailMessagesForThread: (id) => [...messages.values()].filter((message) => message.threadId === id),
      upsertEmailThread: (row) => threads.set(row.id, row),
      upsertEmailMessage: (row) => messages.set(row.id, row),
      upsertEmailAttachment() { assert.fail('fixture has no attachments'); },
      updateEmailAccountSync: (_id, cursor) => { account.syncCursor = cursor; },
    },
  });
  await connector.bootstrap();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of [
    ['GOOGLE_CLIENT_ID', originalEnv.clientId],
    ['GOOGLE_CLIENT_SECRET', originalEnv.clientSecret],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(directory, { recursive: true, force: true });
});

test('initial sync clears old mirrored unread badges even outside the seven-day query', async () => {
  addThread('old');
  handleRequest = (url) => {
    if (url.pathname.endsWith('/profile')) return json({ historyId: '100' });
    if (url.pathname.endsWith('/threads')) return json({ threads: [] });
    assert.ok(url.pathname.endsWith('/threads/old'));
    assert.equal(url.searchParams.get('format'), 'minimal');
    return json({ messages: [{ id: 'old-message', labelIds: ['INBOX'] }] });
  };
  await connector.sync();
  assert.equal(threads.get('gmail_thread_old').unreadCount, 0);
  assert.equal(messages.get('gmail_msg_old-message').providerUnread, false);
  assert.equal(messages.get('gmail_msg_old-message').bodyCleanText, 'Cached message body');
  assert.equal(account.syncCursor, '100');
  assert.ok(calls[0].pathname.endsWith('/profile'), 'baseline must precede reconciliation');
  assert.ok(GMAIL_SCOPE.includes('gmail.readonly'));
  assert.ok(!GMAIL_SCOPE.includes('gmail.modify'));
});

test('history label-only changes paginate and reconcile both read and unread old threads', async () => {
  account.syncCursor = '100';
  addThread('read');
  addThread('unread', 0);
  addThread('unchanged');
  handleRequest = (url) => {
    if (url.pathname.endsWith('/history')) {
      assert.equal(url.searchParams.get('startHistoryId'), '100');
      if (!url.searchParams.get('pageToken')) return json({
        historyId: '200', nextPageToken: 'page-2', history: [{
          labelsRemoved: [{ message: { id: 'read-message', threadId: 'read' }, labelIds: ['UNREAD'] }],
        }],
      });
      assert.equal(url.searchParams.get('pageToken'), 'page-2');
      return json({ historyId: '210', history: [{
        messages: [{ threadId: 'read' }],
        labelsAdded: [{ message: { id: 'unread-message', threadId: 'unread' }, labelIds: ['UNREAD'] }],
      }] });
    }
    if (url.pathname.endsWith('/threads')) return json({ threads: [] });
    if (url.pathname.endsWith('/threads/read')) return json({ messages: [{ id: 'read-message', labelIds: [] }] });
    assert.ok(url.pathname.endsWith('/threads/unread'), 'unchanged threads need no metadata request');
    return json({ messages: [{ id: 'unread-message', labelIds: ['UNREAD'] }] });
  };
  await connector.sync();
  assert.equal(threads.get('gmail_thread_read').unreadCount, 0);
  assert.equal(threads.get('gmail_thread_unread').unreadCount, 1);
  assert.equal(messages.get('gmail_msg_unread-message').providerUnread, true);
  assert.equal(threads.get('gmail_thread_unchanged').unreadCount, 2);
  assert.equal(account.syncCursor, '210');
  assert.equal(calls.filter((url) => url.pathname.endsWith('/threads/read')).length, 1);
});

test('expired history falls back to all mirrored threads and clears a deleted thread badge', async () => {
  account.syncCursor = 'expired';
  addThread('old');
  addThread('deleted');
  handleRequest = (url) => {
    if (url.pathname.endsWith('/history')) return json({ error: 'History expired' }, 404);
    if (url.pathname.endsWith('/profile')) return json({ historyId: '300' });
    if (url.pathname.endsWith('/threads')) return json({ threads: [] });
    if (url.pathname.endsWith('/threads/deleted')) return json({ error: 'Not found' }, 404);
    return json({ messages: [{ id: 'old-message', labelIds: [] }] });
  };
  await connector.sync();
  assert.equal(threads.get('gmail_thread_old').unreadCount, 0);
  assert.equal(threads.get('gmail_thread_deleted').unreadCount, 0);
  assert.equal(messages.get('gmail_msg_deleted-message').providerUnread, false);
  assert.equal(account.syncCursor, '300');
});

test('failed read-state fetch does not advance history cursor and retries on next sync', async () => {
  account.syncCursor = '100';
  addThread('old');
  let fail = true;
  handleRequest = (url) => {
    if (url.pathname.endsWith('/history')) return json({ historyId: '200', history: [{
      labelsRemoved: [{ message: { threadId: 'old' }, labelIds: ['UNREAD'] }],
    }] });
    if (url.pathname.endsWith('/threads')) return json({ threads: [] });
    return fail ? json({ error: 'Temporary outage' }, 503) : json({ messages: [] });
  };
  await assert.rejects(connector.sync(), /Failed Gmail thread read state/);
  assert.equal(account.syncCursor, '100');
  assert.equal(connector.getStatus().lastSyncStatus, 'error');
  fail = false;
  await connector.sync();
  assert.equal(account.syncCursor, '200');
  assert.equal(threads.get('gmail_thread_old').unreadCount, 0);
});

test('recent full-message sync persists provider read flags without any Gmail mutation', async () => {
  account.syncCursor = '100';
  handleRequest = (url) => {
    if (url.pathname.endsWith('/history')) return json({ historyId: '110' });
    if (url.pathname.endsWith('/threads')) return json({ threads: [{ id: 'recent' }] });
    assert.equal(url.searchParams.get('format'), 'full');
    return json({ messages: [{
      id: 'recent-message', historyId: '105', internalDate: '1800000000000',
      labelIds: ['INBOX', 'UNREAD'],
      snippet: 'Please review the project draft',
      payload: { headers: [
        { name: 'From', value: 'Client <client@example.com>' },
        { name: 'To', value: 'self@example.com' },
        { name: 'Subject', value: 'Project draft' },
      ], mimeType: 'text/plain', body: { data: Buffer.from('Please review the project draft').toString('base64url') } },
    }] });
  };
  await connector.sync();
  assert.equal(threads.get('gmail_thread_recent').unreadCount, 1);
  assert.equal(messages.get('gmail_msg_recent-message').providerUnread, true);
  assert.equal(account.syncCursor, '110');
});

test('unchanged history skips all message fetches for already mirrored recent threads', async () => {
  account.syncCursor = '100';
  addThread('recent');
  handleRequest = (url) => {
    if (url.pathname.endsWith('/history')) return json({ historyId: '120' });
    assert.ok(url.pathname.endsWith('/threads'), 'unchanged mirrored threads must not be fetched again');
    return json({ threads: [{ id: 'recent' }] });
  };
  await connector.sync();
  assert.equal(calls.length, 2);
  assert.equal(account.syncCursor, '120');
  assert.equal(threads.get('gmail_thread_recent').unreadCount, 2);
  assert.equal(messages.get('gmail_msg_recent-message').bodyCleanText, 'Cached message body');
});

test('label-only history uses minimal fetch even when the thread is still recent', async () => {
  account.syncCursor = '100';
  addThread('recent');
  handleRequest = (url) => {
    if (url.pathname.endsWith('/history')) return json({ historyId: '120', history: [{
      labelsRemoved: [{ message: { threadId: 'recent' }, labelIds: ['UNREAD'] }],
    }] });
    if (url.pathname.endsWith('/threads')) return json({ threads: [{ id: 'recent' }] });
    assert.equal(url.searchParams.get('format'), 'minimal');
    return json({ messages: [{ id: 'recent-message', labelIds: [] }] });
  };
  await connector.sync();
  assert.equal(threads.get('gmail_thread_recent').unreadCount, 0);
  assert.equal(messages.get('gmail_msg_recent-message').providerUnread, false);
  assert.equal(account.syncCursor, '120');
});

test('new message history refetches bodies for a mirrored thread outside recent discovery', async () => {
  account.syncCursor = '100';
  addThread('old');
  handleRequest = (url) => {
    if (url.pathname.endsWith('/history')) return json({ historyId: '120', history: [{
      messagesAdded: [{ message: { threadId: 'old', id: 'new-message' } }],
    }] });
    if (url.pathname.endsWith('/threads')) return json({ threads: [] });
    assert.ok(url.pathname.endsWith('/threads/old'));
    assert.equal(url.searchParams.get('format'), 'full');
    return json({ messages: [{
      id: 'new-message', historyId: '115', internalDate: '1800000000000', labelIds: ['UNREAD'],
      snippet: 'A new project question',
      payload: { headers: [
        { name: 'From', value: 'Client <client@example.com>' },
        { name: 'To', value: 'self@example.com' },
        { name: 'Subject', value: 'New question' },
      ], mimeType: 'text/plain', body: { data: Buffer.from('A new project question').toString('base64url') } },
    }] });
  };
  await connector.sync();
  assert.equal(messages.get('gmail_msg_new-message').bodyCleanText, 'A new project question');
  assert.equal(messages.get('gmail_msg_old-message').providerUnread, false);
  assert.equal(threads.get('gmail_thread_old').unreadCount, 1);
  assert.equal(account.syncCursor, '120');
});

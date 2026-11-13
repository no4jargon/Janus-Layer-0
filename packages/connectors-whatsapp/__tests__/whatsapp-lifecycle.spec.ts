import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { WaMessageRecord } from '@chai/db';
import type { WaChatUpsert } from '../src/baileys-session-adapter.js';

// Exercise the connector's real event/lifecycle code without pairing, network
// requests, a WhatsApp send, or any real account files.
const { default: _baileysDefault, ...baileys } = await import('baileys');
const { default: fsDefault, ...fs } = await import('node:fs');
const sockets: FakeSocket[] = [];
const state = { creds: {}, keys: {} };
let loadAuth = async (_sessionDir: string) => ({ state, saveCreds: async () => {} });
let loadVersion = async () => ({ version: [2, 3000, 1] });
let renameSession = fs.renameSync;

class FakeSocket {
  handler: ((events: Record<string, unknown>) => void | Promise<void>) | null = null;
  ended = 0;
  loggedOut = 0;
  order: string[] = [];
  ev = {
    process: (handler: FakeSocket['handler']) => { this.handler = handler; },
  };
  emit(events: Record<string, unknown>) {
    return this.handler?.(events);
  }
  end() {
    this.ended += 1;
    this.order.push('end');
    void this.emit({ 'connection.update': { connection: 'close' } });
  }
  async logout() {
    this.loggedOut += 1;
    this.order.push('logout');
    void this.emit({ 'connection.update': { connection: 'close' } });
  }
  readMessages() { assert.fail('mirroring and reading must never send read receipts'); }
  chatModify() { assert.fail('local acknowledgement must never modify WhatsApp read state'); }
}

mock.module('baileys', {
  namedExports: {
    ...baileys,
    useMultiFileAuthState: (sessionDir: string) => loadAuth(sessionDir),
    fetchLatestBaileysVersion: () => loadVersion(),
    makeCacheableSignalKeyStore: (keys: unknown) => keys,
    makeWASocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  },
});

mock.module('node:fs', {
  defaultExport: fsDefault,
  namedExports: {
    ...fs,
    renameSync: (...args: Parameters<typeof fs.renameSync>) => renameSession(...args),
  },
});

const { createWhatsAppConnector } = await import('../src/whatsapp-connector.js');
type Connector = ReturnType<typeof createWhatsAppConnector>;
const logger = { info() {}, warn() {}, error() {} };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
let directory: string;
let connector: Connector;
let writes: string[];
let onChat: () => Promise<void>;
let chatUpserts: WaChatUpsert[];
let unreadUpdates: Array<{ operation: string; jid: string; count?: number }>;
let readMessages: string[];
let messages: Map<string, WaMessageRecord>;
let emittedEvents: Array<{ type: string; payload: unknown }>;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'chai-wa-lifecycle-'));
  const session = path.join(directory, 'whatsapp-session');
  mkdirSync(session);
  writeFileSync(path.join(session, 'creds.json'), 'preserved credentials');
  sockets.length = 0;
  writes = [];
  chatUpserts = [];
  unreadUpdates = [];
  readMessages = [];
  messages = new Map();
  emittedEvents = [];
  onChat = async () => {};
  loadAuth = async () => ({ state, saveCreds: async () => {} });
  loadVersion = async () => ({ version: [2, 3000, 1] });
  renameSession = fs.renameSync;
  connector = createWhatsAppConnector({
    keystoreDir: directory,
    logger,
    onEvent: (event) => { emittedEvents.push(event); },
    adapter: {
      upsertJidMapping: () => { writes.push('mapping'); },
      upsertContact: () => { writes.push('contact'); },
      upsertChat: async (chat) => { writes.push('chat'); chatUpserts.push(chat); await onChat(); },
      setChatUnread: (jid, count) => { writes.push('unread'); unreadUpdates.push({ operation: 'set', jid, count }); },
      incrementChatUnread: (jid, count) => { writes.push('unread'); unreadUpdates.push({ operation: 'increment', jid, count }); },
      markChatRead: () => { assert.fail('provider state must not set local acknowledgement'); },
      markChatUnread: (jid) => { writes.push('unread'); unreadUpdates.push({ operation: 'mark-unread', jid }); },
      markMessageRead: (key) => { readMessages.push(key); },
      upsertMessage: (message) => { writes.push('message'); messages.set(message.messageKey, message); },
      getMessage: (key) => messages.get(key) ?? null,
      updateMessage: (key, patch) => { writes.push('message'); Object.assign(messages.get(key)!, patch); },
      markMessageDeleted: () => { writes.push('delete'); },
      deleteAllMessagesForChat: () => { writes.push('delete'); },
    },
  });
});

afterEach(async () => {
  await connector.dispose();
  mock.timers.reset();
  rmSync(directory, { recursive: true, force: true });
});

const open = async () => {
  const connecting = connector.connect();
  await flush();
  const socket = sockets.at(-1)!;
  assert.equal(connector.getActiveSocket(), null, 'startup is not a connected socket');
  await socket.emit({ 'connection.update': { connection: 'open' } });
  await connecting;
  assert.equal(connector.getActiveSocket(), socket);
  return socket;
};

test('mirrors provider unread snapshots, read clears, and unread deltas without sending receipts', async () => {
  const socket = await open();
  const jid = '123@s.whatsapp.net';
  await socket.emit({ 'messaging-history.set': { chats: [{ id: jid, unreadCount: 3 }] } });
  assert.equal(chatUpserts.at(-1)?.unread, 3);
  await socket.emit({ 'chats.update': [{ id: jid, unreadCount: 2 }] });
  await socket.emit({ 'chats.update': [{ id: jid, unreadCount: 0 }] });
  await socket.emit({ 'chats.update': [{ id: jid, unreadCount: -1 }] });
  await socket.emit({ 'chats.update': [{ id: jid, name: 'metadata only' }] });
  await socket.emit({ 'chats.update': [{ id: jid, unreadCount: null }] });
  assert.deepEqual(unreadUpdates, [
    { operation: 'increment', jid, count: 2 },
    { operation: 'set', jid, count: 0 },
    { operation: 'mark-unread', jid },
  ]);
  assert.equal(chatUpserts.at(-1)?.unread, undefined, 'initial app-state null is a neutral update');
  assert.equal(emittedEvents.filter((event) => event.type === 'chat-update').length, 5);
});

test('incoming READ and PLAYED updates acknowledge only the messages read on another device', async () => {
  const socket = await open();
  const incomingKey = { remoteJid: '123@s.whatsapp.net', id: 'incoming', fromMe: false };
  const outgoingKey = { remoteJid: '123@s.whatsapp.net', id: 'outgoing', fromMe: true };
  const status = baileys.WAMessageStatus;
  await socket.emit({ 'messages.upsert': { type: 'notify', messages: [
    { key: incomingKey, messageTimestamp: 1, message: { conversation: 'incoming' }, status: status.DELIVERY_ACK },
    { key: outgoingKey, messageTimestamp: 2, message: { conversation: 'outgoing' }, status: status.DELIVERY_ACK },
  ] } });
  await socket.emit({ 'messages.update': [
    { key: incomingKey, update: { status: status.READ } },
    { key: outgoingKey, update: { status: status.READ } },
  ] });
  assert.deepEqual(readMessages, ['123@s.whatsapp.net|incoming|0|']);
  await socket.emit({ 'messages.update': [{ key: incomingKey, update: { status: status.PLAYED } }] });
  await socket.emit({ 'messages.update': [{ key: incomingKey, update: { status: status.DELIVERY_ACK } }] });
  assert.equal(messages.get('123@s.whatsapp.net|incoming|0|')?.status, status.PLAYED,
    'late delivery updates must not undo an external read');
  assert.deepEqual(readMessages, ['123@s.whatsapp.net|incoming|0|', '123@s.whatsapp.net|incoming|0|']);
  assert.deepEqual(unreadUpdates, [], 'a message receipt must not clear unrelated unread messages');
});

test('serializes provider event batches so a later read clear wins an asynchronous unread delta', async () => {
  const socket = await open();
  const jid = '123@s.whatsapp.net';
  let release!: () => void;
  let chatCalls = 0;
  onChat = () => ++chatCalls === 1 ? new Promise((resolve) => { release = resolve; }) : Promise.resolve();
  const incrementing = socket.emit({ 'chats.update': [{ id: jid, unreadCount: 1 }] });
  await flush();
  const reading = socket.emit({ 'chats.update': [{ id: jid, unreadCount: 0 }] });
  await flush();
  assert.deepEqual(unreadUpdates, [], 'later batches wait for accepted persistence');
  release();
  await Promise.all([incrementing, reading]);
  assert.deepEqual(unreadUpdates, [
    { operation: 'increment', jid, count: 1 },
    { operation: 'set', jid, count: 0 },
  ]);
});

test('dispose ends the socket, ignores stale events, and preserves linked-device credentials', async () => {
  const socket = await open();
  await connector.dispose();
  await socket.emit({
    'chats.upsert': [{ id: '123@g.us', name: 'stale' }],
    'connection.update': { connection: 'open', qr: 'stale-qr' },
  });
  assert.deepEqual(writes, []);
  assert.equal(socket.ended, 1);
  assert.equal(socket.loggedOut, 0);
  assert.equal(connector.getStatus().connected, false);
  assert.equal(connector.getStatus().lastQr, null);
  assert.equal(readFileSync(path.join(directory, 'whatsapp-session/creds.json'), 'utf8'),
    'preserved credentials');
});

test('dispose invalidates startup while auth state is loading', async () => {
  let release!: (value: Awaited<ReturnType<typeof loadAuth>>) => void;
  loadAuth = () => new Promise((resolve) => { release = resolve; });
  const booting = connector.bootstrap!();
  await flush();
  await connector.dispose();
  release({ state, saveCreds: async () => {} });
  await booting;
  assert.equal(sockets.length, 0);
  assert.deepEqual(writes, []);
});

test('dispose invalidates startup while version lookup is pending', async () => {
  let release!: (value: { version: number[] }) => void;
  loadVersion = () => new Promise((resolve) => { release = resolve; });
  const booting = connector.bootstrap!();
  await flush();
  await connector.dispose();
  release({ version: [2, 3000, 1] });
  await booting;
  assert.equal(sockets.length, 0);
});

test('dispose waits for accepted persistence before the host closes its database', async () => {
  const socket = await open();
  let release!: () => void;
  onChat = () => new Promise((resolve) => { release = resolve; });
  const event = socket.emit({ 'chats.upsert': [{ id: '123@g.us' }, { id: '456@g.us' }] });
  await flush();
  let disposed = false;
  const disposing = connector.dispose().then(() => { disposed = true; });
  await flush();
  assert.equal(disposed, false);
  release();
  await Promise.all([event, disposing]);
  assert.deepEqual(writes, ['chat'], 'remaining stale batch entries are discarded');
});

test('dispose cancels the scheduled reconnect', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const socket = await open();
  await socket.emit({ 'connection.update': { connection: 'close' } });
  assert.equal(connector.getStatus().reconnectCount, 1);
  await connector.dispose();
  mock.timers.tick(60_000);
  await flush();
  assert.equal(sockets.length, 1);
});

test('dispose rejects an outstanding pairing wait without leaving its timer alive', async () => {
  const connecting = assert.rejects(connector.connect(), /disposed/);
  await flush();
  await connector.dispose();
  await connecting;
});

test('ordinary disconnect logs out before ending the socket and removes local auth', async () => {
  const socket = await open();
  await connector.disconnect();
  assert.deepEqual(socket.order, ['logout', 'end']);
  assert.equal(existsSync(path.join(directory, 'whatsapp-session')), false);
  assert.equal(connector.getStatus().reconnectCount, 0);
  assert.equal(connector.getActiveSocket(), null);
});

test('explicit connect after logout preserves expired auth privately and starts fresh pairing', async () => {
  const socket = await open();
  await socket.emit({
    'connection.update': {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: baileys.DisconnectReason.loggedOut } } },
    },
  });
  assert.equal(connector.getStatus().loggedOut, true);
  assert.equal(sockets.length, 1, 'logout does not automatically restart pairing');

  let authLoads = 0;
  loadAuth = async (sessionDir) => {
    authLoads += 1;
    assert.equal(existsSync(path.join(sessionDir, 'creds.json')), false);
    writeFileSync(path.join(sessionDir, 'creds.json'), 'fresh credentials');
    return { state, saveCreds: async () => {} };
  };
  const connecting = connector.connect();
  await flush();
  const replacement = sockets.at(-1)!;
  await replacement.emit({ 'connection.update': { qr: 'fresh-qr' } });
  assert.equal(connector.getStatus().lastQr, 'fresh-qr');
  assert.equal(connector.getStatus().loggedOut, false);
  const backups = readdirSync(directory).filter((name) => name.startsWith('whatsapp-session.expired-'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(path.join(directory, backups[0], 'creds.json'), 'utf8'),
    'preserved credentials');
  if (process.platform !== 'win32') {
    assert.equal(statSync(path.join(directory, backups[0])).mode & 0o777, 0o700);
  }
  assert.equal(readFileSync(path.join(directory, 'whatsapp-session/creds.json'), 'utf8'),
    'fresh credentials');
  assert.equal(authLoads, 1);
  assert.deepEqual(writes, [], 'pairing recovery does not change mirrored chats or messages');
  await replacement.emit({ 'connection.update': { connection: 'open' } });
  await connecting;
  assert.equal(connector.getActiveSocket(), replacement);
});

test('failed expired-session backup keeps credentials and permits a safe retry', async () => {
  const socket = await open();
  await socket.emit({
    'connection.update': {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: baileys.DisconnectReason.loggedOut } } },
    },
  });
  renameSession = () => { throw new Error('simulated backup failure'); };
  await assert.rejects(connector.connect(), /Could not preserve the expired WhatsApp session/);
  assert.equal(connector.getStatus().loggedOut, true);
  assert.equal(sockets.length, 1, 'backup failure cannot start Baileys with the expired auth');
  assert.equal(readFileSync(path.join(directory, 'whatsapp-session/creds.json'), 'utf8'),
    'preserved credentials');
  assert.deepEqual(readdirSync(directory), ['whatsapp-session']);
  assert.deepEqual(writes, []);

  renameSession = fs.renameSync;
  const connecting = connector.connect();
  await flush();
  await sockets.at(-1)!.emit({ 'connection.update': { connection: 'open' } });
  await connecting;
  assert.equal(connector.getStatus().connected, true);
});

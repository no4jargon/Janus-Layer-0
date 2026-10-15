import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, mock, test } from 'node:test';

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

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'chai-wa-lifecycle-'));
  const session = path.join(directory, 'whatsapp-session');
  mkdirSync(session);
  writeFileSync(path.join(session, 'creds.json'), 'preserved credentials');
  sockets.length = 0;
  writes = [];
  onChat = async () => {};
  loadAuth = async () => ({ state, saveCreds: async () => {} });
  loadVersion = async () => ({ version: [2, 3000, 1] });
  renameSession = fs.renameSync;
  connector = createWhatsAppConnector({
    keystoreDir: directory,
    logger,
    adapter: {
      upsertJidMapping: () => { writes.push('mapping'); },
      upsertContact: () => { writes.push('contact'); },
      upsertChat: async () => { writes.push('chat'); await onChat(); },
      setChatUnread: () => { writes.push('unread'); },
      incrementChatUnread: () => { writes.push('unread'); },
      markChatRead: () => { writes.push('read'); },
      markChatUnread: () => { writes.push('unread'); },
      upsertMessage: () => { writes.push('message'); },
      getMessage: () => null,
      updateMessage: () => { writes.push('message'); },
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

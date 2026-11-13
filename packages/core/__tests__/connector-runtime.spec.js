import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createConnectorRuntime } from '../dist/connector-runtime.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const setup = (overrides = {}) => {
  const writes = [];
  const logs = [];
  const connector = (kind) => ({
    kind,
    connect: async () => ({}),
    disconnect: async () => {},
    sync: async () => ({}),
    ...overrides[kind],
  });
  const runtime = createConnectorRuntime({
    store: { list: () => [], upsert: (row) => { writes.push(row); } },
    logger: { info() {}, warn() {}, error: (...args) => { logs.push(args); } },
    connectors: { gmail: connector('gmail'), whatsapp: connector('whatsapp') },
  });
  return { runtime, writes, logs };
};

test('simultaneous syncs for one connector share one promise and state transition', async () => {
  const gate = deferred();
  let calls = 0;
  const { runtime, writes } = setup({ gmail: { sync: () => { calls += 1; return gate.promise; } } });
  const first = runtime.syncNow('gmail');
  const second = runtime.syncNow('gmail');
  assert.equal(first, second);
  await flush();
  assert.equal(calls, 1);
  assert.equal(runtime.list().find((item) => item.connector === 'gmail').status, 'syncing');
  gate.resolve({ lastSyncedAt: '2026-10-30T00:00:00.000Z', metadata: { messages: 3 } });
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one, two);
  assert.equal(one.status, 'connected');
  assert.deepEqual(one.metadata, { messages: 3 });
  assert.deepEqual(writes.map((row) => row.status), ['syncing', 'connected']);
});

test('different connectors can sync independently', async () => {
  const gate = deferred();
  let whatsappCalls = 0;
  const { runtime } = setup({
    gmail: { sync: () => gate.promise },
    whatsapp: { sync: async () => { whatsappCalls += 1; return { metadata: { ready: true } }; } },
  });
  const gmail = runtime.syncNow('gmail');
  const whatsapp = await runtime.syncNow('whatsapp');
  assert.equal(whatsapp.status, 'connected');
  assert.equal(whatsappCalls, 1);
  assert.equal(runtime.list().find((item) => item.connector === 'gmail').status, 'syncing');
  gate.resolve({});
  await gmail;
});

test('shared failures retain error snapshots and release the lock for a retry', async () => {
  const gate = deferred();
  let calls = 0;
  const { runtime, logs } = setup({ gmail: { sync: async () => {
    calls += 1;
    if (calls === 1) return gate.promise;
    return { metadata: { retried: true } };
  } } });
  const first = runtime.syncNow('gmail');
  const shared = runtime.syncNow('gmail');
  await flush();
  gate.reject(new Error('temporary sync failure'));
  const failed = await first;
  assert.equal(await shared, failed);
  assert.equal(failed.status, 'error');
  assert.equal(failed.lastError, 'temporary sync failure');
  assert.equal(logs.length, 1);
  const retry = await runtime.syncNow('gmail');
  assert.equal(calls, 2);
  assert.equal(retry.status, 'connected');
  assert.equal(retry.lastError, null);
  assert.deepEqual(retry.metadata, { retried: true });
});

test('disconnect waits for in-flight writes and blocks new syncs until cleanup completes', async () => {
  const syncGate = deferred();
  const disconnectGate = deferred();
  const order = [];
  const { runtime } = setup({ gmail: {
    sync: async () => { order.push('sync starts'); await syncGate.promise; order.push('sync writes finish'); return {}; },
    disconnect: async () => { order.push('cleanup starts'); await disconnectGate.promise; order.push('cleanup finishes'); },
  } });
  const syncing = runtime.syncNow('gmail');
  await flush();
  const disconnecting = runtime.disconnect('gmail');
  assert.equal(runtime.disconnect('gmail'), disconnecting);
  assert.equal(runtime.syncNow('gmail'), disconnecting);
  await flush();
  assert.deepEqual(order, ['sync starts']);
  syncGate.resolve();
  await syncing;
  await flush();
  assert.deepEqual(order, ['sync starts', 'sync writes finish', 'cleanup starts']);
  assert.equal(runtime.syncNow('gmail'), disconnecting);
  disconnectGate.resolve();
  const result = await disconnecting;
  assert.equal(result.status, 'disconnected');
  assert.equal(result.lastSyncedAt, null);
  assert.equal(result.metadata, null);
  assert.deepEqual(order, ['sync starts', 'sync writes finish', 'cleanup starts', 'cleanup finishes']);
  assert.equal(runtime.list().find((item) => item.connector === 'gmail').status, 'disconnected');
});

test('disconnect still runs after a failed sync and preserves disconnect error behavior', async () => {
  const gate = deferred();
  let cleanupCalls = 0;
  const { runtime } = setup({ gmail: {
    sync: () => gate.promise,
    disconnect: async () => { cleanupCalls += 1; throw new Error('cleanup failed'); },
  } });
  const syncing = runtime.syncNow('gmail');
  const disconnecting = runtime.disconnect('gmail');
  await flush();
  gate.reject(new Error('sync failed'));
  assert.equal((await syncing).lastError, 'sync failed');
  const result = await disconnecting;
  assert.equal(cleanupCalls, 1);
  assert.equal(result.status, 'error');
  assert.equal(result.lastError, 'cleanup failed');
});

test('waitForIdle drains both connector syncs before stores may close', async () => {
  const gmailGate = deferred();
  const whatsappGate = deferred();
  const { runtime } = setup({
    gmail: { sync: () => gmailGate.promise },
    whatsapp: { sync: () => whatsappGate.promise },
  });
  runtime.syncNow('gmail');
  runtime.syncNow('whatsapp');
  let drained = false;
  const idle = runtime.waitForIdle().then(() => { drained = true; });
  await flush();
  assert.equal(drained, false);
  gmailGate.resolve({});
  await flush();
  assert.equal(drained, false, 'the other connector is still using the stores');
  whatsappGate.reject(new Error('sync failed while draining'));
  await idle;
  assert.equal(drained, true);
  assert.equal(runtime.list().find((item) => item.connector === 'whatsapp').status, 'error');
  await runtime.waitForIdle();
});

test('waitForIdle includes disconnect cleanup queued behind an active sync', async () => {
  const syncGate = deferred();
  const cleanupGate = deferred();
  const { runtime } = setup({ gmail: {
    sync: () => syncGate.promise,
    disconnect: () => cleanupGate.promise,
  } });
  runtime.syncNow('gmail');
  runtime.disconnect('gmail');
  let drained = false;
  const idle = runtime.waitForIdle().then(() => { drained = true; });
  syncGate.resolve({});
  await flush();
  assert.equal(drained, false, 'sync completion alone must not permit the DB to close');
  cleanupGate.resolve();
  await idle;
  assert.equal(drained, true);
  assert.equal(runtime.list().find((item) => item.connector === 'gmail').status, 'disconnected');
});

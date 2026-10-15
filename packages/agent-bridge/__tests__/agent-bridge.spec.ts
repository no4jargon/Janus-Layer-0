import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request } from 'node:http';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createAgentBridgeService, createAgentBridgeHttpServer, loadAgentBridgeConfig } from '../src/index.js';
import { callAgentBridgeTool, handleMcpJsonRpc } from '../src/mcp.js';

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const createFixtureDb = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'chai-agent-bridge-'));
  const dbPath = path.join(dir, 'app.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE wa_contacts (
      jid TEXT PRIMARY KEY,
      name TEXT,
      notify TEXT,
      verified_name TEXT,
      username TEXT,
      phone_number TEXT,
      img_url TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE wa_jid_map (
      source_jid TEXT PRIMARY KEY,
      target_jid TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE wa_chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      is_group INTEGER NOT NULL DEFAULT 0,
      last_message_ts INTEGER NOT NULL DEFAULT 0,
      last_message_text TEXT NOT NULL DEFAULT '',
      last_message_type TEXT NOT NULL DEFAULT '',
      unread INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE wa_messages (
      message_key TEXT PRIMARY KEY,
      remote_jid TEXT NOT NULL,
      key_id TEXT NOT NULL,
      from_me INTEGER NOT NULL,
      participant TEXT,
      sender_jid TEXT,
      message_timestamp INTEGER NOT NULL,
      message_type TEXT,
      text TEXT NOT NULL DEFAULT '',
      status INTEGER,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      media_type TEXT,
      media_mime TEXT,
      media_path TEXT,
      media_thumb_data_uri TEXT,
      raw_content TEXT,
      reply_to_stanza_id TEXT,
      reply_to_participant TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE email_threads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      provider_thread_id TEXT NOT NULL,
      derived_thread_key TEXT,
      subject TEXT NOT NULL DEFAULT '',
      participant_summary TEXT NOT NULL DEFAULT '',
      last_message_at INTEGER NOT NULL DEFAULT 0,
      last_cleaned_preview TEXT NOT NULL DEFAULT '',
      unread_count INTEGER NOT NULL DEFAULT 0,
      has_attachments INTEGER NOT NULL DEFAULT 0,
      source_labels_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE email_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      provider_message_id TEXT NOT NULL,
      gmail_history_id TEXT,
      sender_name TEXT,
      sender_email TEXT NOT NULL,
      to_json TEXT NOT NULL DEFAULT '[]',
      cc_json TEXT NOT NULL DEFAULT '[]',
      sent_at INTEGER NOT NULL,
      direction TEXT NOT NULL,
      snippet TEXT,
      body_raw_html TEXT,
      body_raw_text TEXT,
      body_clean_text TEXT,
      has_attachments INTEGER NOT NULL DEFAULT 0,
      is_hidden_automated INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE agent_bridge_audit_events (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      agent_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      status TEXT NOT NULL,
      metadata_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE agent_response_watches (
      id TEXT PRIMARY KEY,
      person_query TEXT NOT NULL,
      instructions TEXT NOT NULL,
      context_refs_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE agent_response_tasks (
      id TEXT PRIMARY KEY,
      watch_id TEXT NOT NULL,
      person_query TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      message_json TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      sent_message_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(watch_id, message_id)
    );
  `);

  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO wa_contacts (jid, name, notify, verified_name, username, phone_number, img_url, updated_at)
     VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
  ).run('bob@s.whatsapp.net', 'Bob Client', Date.now());
  db.prepare(
    `INSERT INTO wa_chats (jid, name, is_group, last_message_ts, last_message_text, last_message_type, unread, updated_at)
     VALUES (?, ?, 0, ?, ?, 'conversation', 1, ?)`,
  ).run('bob@s.whatsapp.net', 'Bob Client', now, 'Can you check this?', Date.now());
  db.prepare(
    `INSERT INTO wa_messages (
      message_key, remote_jid, key_id, from_me, participant, sender_jid, message_timestamp,
      message_type, text, status, is_deleted, media_type, media_mime, media_path,
      media_thumb_data_uri, raw_content, reply_to_stanza_id, reply_to_participant,
      created_at, updated_at
    ) VALUES (?, ?, ?, 0, NULL, ?, ?, 'conversation', ?, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(
    'bob@s.whatsapp.net|m1|0|',
    'bob@s.whatsapp.net',
    'm1',
    'bob@s.whatsapp.net',
    now,
    'Can you check this?',
    Date.now(),
    Date.now(),
  );

  db.prepare(
    `INSERT INTO email_threads (
      id, user_id, account_id, provider_thread_id, subject, participant_summary,
      last_message_at, last_cleaned_preview, unread_count, has_attachments, created_at, updated_at
    ) VALUES (?, 'local-user', 'gmail-local', ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
  ).run(
    'thread_1',
    'provider_thread_1',
    'Project',
    'Ann Example',
    now,
    'Latest email',
    Date.now(),
    Date.now(),
  );
  db.prepare(
    `INSERT INTO email_messages (
      id, user_id, account_id, thread_id, provider_message_id, sender_name, sender_email,
      to_json, cc_json, sent_at, direction, snippet, body_clean_text,
      has_attachments, is_hidden_automated, created_at, updated_at
    ) VALUES (?, 'local-user', 'gmail-local', 'thread_1', ?, ?, ?, '[]', '[]', ?, 'incoming', ?, ?, 0, 0, ?, ?)`,
  ).run(
    'email_1',
    'provider_email_1',
    'Ann Example',
    'ann@example.com',
    now,
    'Latest email',
    'Latest email',
    Date.now(),
    Date.now(),
  );

  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

test('resolves people and finds incoming messages', () => {
  const fixture = createFixtureDb();
  try {
    const service = createAgentBridgeService({
      db: fixture.db,
      logger,
      gmailSender: null,
      whatsappSender: null,
    });

    const resolved = service.resolvePerson({ query: 'Bob' });
    assert.equal(resolved.candidates.length, 1);
    assert.equal(resolved.candidates[0].personId, 'whatsapp:bob@s.whatsapp.net');

    const messages = service.hasMessageFrom({ personQuery: 'Bob' });
    assert.equal(messages.ok, true);
    assert.equal(messages.ok && messages.hasMessage, true);
    assert.equal(messages.ok && messages.messages[0].text, 'Can you check this?');
  } finally {
    fixture.cleanup();
  }
});

test('sends separate messages to resolved recipients', async () => {
  const fixture = createFixtureDb();
  const sentWhatsApp: unknown[] = [];
  const sentGmail: unknown[] = [];
  try {
    const service = createAgentBridgeService({
      db: fixture.db,
      logger,
      gmailSender: {
        async sendEmail(input) {
          sentGmail.push(input);
          return {
            id: 'email_outbox_1',
            clientRequestId: input.clientRequestId,
            accountId: 'gmail-local',
            threadId: null,
            providerThreadId: null,
            toJson: JSON.stringify(input.to || []),
            ccJson: '[]',
            subject: input.subject || '',
            textBody: input.textBody,
            htmlBody: null,
            status: 'sent',
            errorCode: null,
            errorMessage: null,
            gmailMessageId: 'gmail_sent_1',
            gmailThreadId: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
        },
      },
      whatsappSender: {
        async sendText(input) {
          sentWhatsApp.push(input);
          return {
            id: 'wa_outbox_1',
            clientRequestId: input.clientRequestId,
            chatJid: input.jid,
            text: input.text,
            quotedMessageKey: null,
            status: 'sent',
            errorCode: null,
            errorMessage: null,
            waMessageKey: `${input.jid}|wa_sent_1|1|`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
        },
      },
    });

    const result = await service.sendMessage({
      recipients: ['Bob', 'ann@example.com'],
      text: 'hello',
      clientRequestId: 'req-send',
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.results.length, 2);
    const whatsappId = (sentWhatsApp[0] as any).clientRequestId;
    const gmailId = (sentGmail[0] as any).clientRequestId;
    assert.notEqual(whatsappId, gmailId);
    // A retry may reorder recipients without mixing their cached outbox records.
    await service.sendMessage({ recipients: ['ann@example.com', 'Bob'], text: 'hello', clientRequestId: 'req-send' });
    assert.equal((sentWhatsApp[1] as any).clientRequestId, whatsappId);
    assert.equal((sentGmail[1] as any).clientRequestId, gmailId);
    const restarted = createAgentBridgeService({ db: fixture.db, logger, gmailSender: null, whatsappSender: null });
    const conflict = await restarted.sendMessage({ recipients: ['Bob'], text: 'different', clientRequestId: 'req-send' });
    assert.equal(conflict.ok, false);
    assert.match(!conflict.ok && conflict.errors[0].message || '', /already used/);
    assert.equal(sentWhatsApp.length, 2);
  } finally {
    fixture.cleanup();
  }
});

test('creates response tasks with file context and audit entries', () => {
  const fixture = createFixtureDb();
  const contextDir = mkdtempSync(path.join(tmpdir(), 'chai-agent-context-'));
  const contextFile = path.join(contextDir, 'persona.txt');
  writeFileSync(contextFile, 'Be concise and practical.', 'utf8');
  try {
    const service = createAgentBridgeService({
      db: fixture.db,
      logger,
      gmailSender: null,
      whatsappSender: null,
    });

    const watch = service.createResponseWatch({
      personQuery: 'Bob',
      instructions: 'Respond as account manager.',
      contextRefs: [contextFile],
    });
    assert.equal(watch.ok, true);

    const tasks = service.listResponseTasks();
    assert.equal(tasks.tasks.length, 1);
    assert.equal(tasks.tasks[0].context[0].text, 'Be concise and practical.');
    assert.equal(tasks.tasks[0].instructions, 'Respond as account manager.');

    const completed = service.completeResponseTask({
      taskId: tasks.tasks[0].id,
      sentMessageIds: ['whatsapp:sent'],
    });
    assert.equal(completed.task?.status, 'completed');

    const audit = service.listAudit({ limit: 20 });
    assert.ok(audit.some((event) => event.action === 'file.read'));
    assert.ok(audit.some((event) => event.action === 'response_task.complete'));
  } finally {
    fixture.cleanup();
    rmSync(contextDir, { recursive: true, force: true });
  }
});

test('finds older WhatsApp groups and keeps literal JIDs on WhatsApp', async () => {
  const fixture = createFixtureDb();
  try {
    const insert = fixture.db.prepare(`INSERT INTO wa_chats
      (jid, name, is_group, last_message_ts, last_message_text, last_message_type, unread, updated_at)
      VALUES (?, ?, 1, ?, '', '', 0, 0)`);
    insert.run('old@g.us', 'Notes', 1);
    for (let i = 0; i < 505; i++) insert.run(`new${i}@g.us`, `Recent ${i}`, 1000 + i);
    const service = createAgentBridgeService({ db: fixture.db, logger, gmailSender: null, whatsappSender: null });
    assert.equal(service.resolvePerson({ query: 'Notes' }).candidates[0].address, 'old@g.us');
    const literal = service.resolvePerson({ query: 'unknown@s.whatsapp.net' });
    assert.equal(literal.candidates.length, 1);
    assert.equal(literal.candidates[0].channel, 'whatsapp');
    assert.equal(service.resolvePerson({ query: 'whatsapp:old@g.us' }).candidates[0].address, 'old@g.us');
  } finally { fixture.cleanup(); }
});

test('returns provider failure and in-flight status instead of claiming delivery', async () => {
  const fixture = createFixtureDb();
  try {
    let status = 'failed';
    let messageKey: string | null = null;
    const service = createAgentBridgeService({ db: fixture.db, logger, gmailSender: null,
      whatsappSender: { async sendText(input) { return {
        id: 'outbox', clientRequestId: input.clientRequestId, chatJid: input.jid, text: input.text,
        quotedMessageKey: null, status, waMessageKey: messageKey,
        errorCode: status === 'failed' ? 'OFFLINE' : null,
        errorMessage: status === 'failed' ? 'Phone is offline' : null,
        createdAt: 1, updatedAt: 1,
      } as any; } },
    });
    const failed = await service.sendMessage({ recipients: ['Bob'], text: 'test', clientRequestId: 'failed-result' });
    assert.equal(failed.ok && failed.results[0].status, 'failed');
    assert.equal(failed.ok && failed.results[0].error, 'Phone is offline');
    const mcp = await handleMcpJsonRpc(service, { jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'send_message', arguments: { recipients: ['Bob'], text: 'test', clientRequestId: 'failed-result' } } }) as any;
    assert.equal(mcp.result.isError, true);
    status = 'sending';
    const sending = await service.sendMessage({ recipients: ['Bob'], text: 'test', clientRequestId: 'inflight-result' });
    assert.equal(sending.ok && sending.results[0].status, 'sending');
    assert.equal(sending.ok && sending.results[0].messageId, null);
    status = 'sent';
    for (const key of [null, '||0|', 'another@g.us|id|1|', 'bob@s.whatsapp.net|id|0|']) {
      messageKey = key;
      const unconfirmed = await service.sendMessage({ recipients: ['Bob'], text: 'test', clientRequestId: `invalid-key-${key}` });
      assert.equal(unconfirmed.ok && unconfirmed.results[0].status, 'sending');
      assert.equal(unconfirmed.ok && unconfirmed.results[0].messageId, null);
      assert.match(unconfirmed.ok && unconfirmed.results[0].error || '', /unconfirmed/);
    }
    messageKey = 'bob@s.whatsapp.net|provider_id|1|';
    const confirmed = await service.sendMessage({ recipients: ['Bob'], text: 'test', clientRequestId: 'valid-key' });
    assert.equal(confirmed.ok && confirmed.results[0].status, 'sent');
    assert.equal(confirmed.ok && confirmed.results[0].messageId, 'whatsapp:bob@s.whatsapp.net|provider_id|1|');
  } finally { fixture.cleanup(); }
});

test('response watches survive recreation, expose instructions, pause, and drain a backlog', () => {
  const fixture = createFixtureDb();
  const makeService = () => createAgentBridgeService({ db: fixture.db, logger, gmailSender: null, whatsappSender: null });
  try {
    const service = makeService();
    const watch = service.createResponseWatch({ personQuery: 'Bob', instructions: 'Ask for the deadline.' }).watch;
    assert.equal(watch.personQuery, 'whatsapp:bob@s.whatsapp.net');
    service.setResponseWatchStatus({ watchId: watch.id, status: 'paused' });
    const now = Math.floor(Date.now() / 1000);
    const insert = fixture.db.prepare(`INSERT INTO wa_messages
      (message_key, remote_jid, key_id, from_me, message_timestamp, text, is_deleted, created_at, updated_at)
      VALUES (?, 'bob@s.whatsapp.net', ?, 0, ?, 'new', 0, ?, ?)`);
    for (let i = 0; i < 60; i++) insert.run(`backlog${i}`, `b${i}`, now + i, Date.now(), Date.now());
    const restarted = makeService();
    assert.equal(restarted.listResponseWatches().watches[0].status, 'paused');
    assert.equal(restarted.listResponseTasks().tasks.length, 1);
    restarted.setResponseWatchStatus({ watchId: watch.id, status: 'active' });
    restarted.refreshResponseTasks();
    restarted.refreshResponseTasks();
    const tasks = restarted.listResponseTasks().tasks;
    assert.equal(tasks.length, 61);
    assert.ok(tasks.every((task) => task.instructions === 'Ask for the deadline.'));
    assert.equal(new Set(tasks.map((task) => task.messageId)).size, 61);
  } finally { fixture.cleanup(); }
});

test('reads recent email messages when a conversation exceeds its limit', () => {
  const fixture = createFixtureDb();
  try {
    fixture.db.prepare(`INSERT INTO email_messages
      (id, user_id, account_id, thread_id, provider_message_id, sender_email,
       sent_at, direction, body_clean_text, created_at, updated_at)
      VALUES ('email_newest', 'local-user', 'gmail-local', 'thread_1', 'p2', 'ann@example.com',
       ?, 'incoming', 'Newest email', 1, 1)`).run(Math.floor(Date.now() / 1000) + 10);
    const service = createAgentBridgeService({ db: fixture.db, logger, gmailSender: null, whatsappSender: null });
    const result = service.readConversation({ conversationId: 'gmail:thread_1', limit: 1 });
    assert.equal(result.ok && result.messages[0].text, 'Newest email');
  } finally { fixture.cleanup(); }
});

test('rejects malformed MCP requests and validates tool arguments before execution', async () => {
  const fixture = createFixtureDb();
  try {
    const service = createAgentBridgeService({ db: fixture.db, logger, gmailSender: null, whatsappSender: null });
    for (const payload of [null, [], 'invalid', { jsonrpc: '1.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: null, method: 'tools/list' }, { jsonrpc: '2.0', method: 'tools/call' }]) {
      const response = await handleMcpJsonRpc(service, payload) as any;
      assert.equal(response.error.code, -32600);
    }
    assert.equal(await handleMcpJsonRpc(service, { jsonrpc: '2.0', method: 'notifications/cancelled' }), null);
    const init = await handleMcpJsonRpc(service, { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25' } }) as any;
    assert.equal(init.result.protocolVersion, '2025-11-25');
    const unknownVersion = await handleMcpJsonRpc(service, { jsonrpc: '2.0', id: 2, method: 'initialize',
      params: { protocolVersion: '2099-01-01' } }) as any;
    assert.equal(unknownVersion.result.protocolVersion, '2025-11-25');
    await assert.rejects(callAgentBridgeTool(service, 'send_message', { recipients: 'Bob', text: 'x', clientRequestId: 'bad' }), /Invalid recipients/);
    await assert.rejects(callAgentBridgeTool(service, 'resolve_person', {}), /query is required/);
    await assert.rejects(callAgentBridgeTool(service, 'list_conversations', { limit: 'NaN' }), /Invalid limit/);
  } finally { fixture.cleanup(); }
});

test('serves authenticated MCP locally and rejects origins, rebound hosts, and malformed HTTP', async () => {
  const fixture = createFixtureDb();
  const service = createAgentBridgeService({ db: fixture.db, logger, gmailSender: null, whatsappSender: null });
  const server = createAgentBridgeHttpServer({ service, logger, config: {
    enabled: true, host: '127.0.0.1', port: 0, token: 'test-token', tokenPath: '/test/token',
    rpcUrl: '', mcpUrl: '', scopes: [],
  } });
  try {
    await Promise.all([server.start(), server.start()]);
    const { rpcUrl, mcpUrl } = server.status();
    const baseUrl = new URL(rpcUrl).origin;
    const headers = { authorization: 'Bearer test-token', 'content-type': 'application/json',
      accept: 'application/json, text/event-stream' };
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as any).service, 'chai-agent-bridge');
    assert.equal((await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(rpcUrl, { method: 'POST', headers: { ...headers, origin: 'https://attacker.example' }, body: '{}' })).status, 403);
    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(rpcUrl, { method: 'POST', headers: { ...headers, host: 'attacker.example' } }, (res) => {
        res.resume(); res.once('end', () => resolve(res.statusCode));
      });
      req.once('error', reject); req.end('{}');
    });
    assert.equal(reboundStatus, 403);
    const init = await fetch(mcpUrl, { method: 'POST', headers, body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' },
    }) });
    assert.equal(init.status, 200);
    assert.equal((await init.json() as any).result.protocolVersion, '2025-06-18');
    assert.equal((await fetch(mcpUrl, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).status, 202);
    assert.equal((await fetch(mcpUrl, { headers })).status, 405);
    assert.equal((await fetch(mcpUrl, { method: 'POST', headers: { ...headers, 'mcp-protocol-version': 'unsupported' }, body: '{}' })).status, 400);
    assert.equal((await fetch(mcpUrl, { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal((await fetch(mcpUrl, { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: '{}' })).status, 415);
    const tools = await fetch(mcpUrl, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
    assert.ok((await tools.json() as any).result.tools.some((tool: any) => tool.name === 'set_response_watch_status'));
  } finally { await server.close(); fixture.cleanup(); }
  assert.equal(server.status().running, false);
});

test('refuses public binding and persists effective override token with private permissions', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'chai-agent-config-'));
  const saved = { ...process.env };
  try {
    process.env.CHAI_AGENT_BRIDGE_HOST = '0.0.0.0';
    assert.throws(() => loadAgentBridgeConfig({ baseDir: dir, logger }), /must be/);
    process.env.CHAI_AGENT_BRIDGE_HOST = '::1';
    process.env.CHAI_AGENT_BRIDGE_TOKEN = 'override-token';
    const config = loadAgentBridgeConfig({ baseDir: dir, logger });
    assert.equal(config.rpcUrl, 'http://[::1]:43124/rpc');
    assert.equal(JSON.parse(readFileSync(config.tokenPath, 'utf8')).token, 'override-token');
    if (process.platform !== 'win32') assert.equal(statSync(config.tokenPath).mode & 0o777, 0o600);
    delete process.env.CHAI_AGENT_BRIDGE_TOKEN;
    assert.equal(loadAgentBridgeConfig({ baseDir: dir, logger }).token, 'override-token');
  } finally {
    process.env = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed token configuration never leaks token snippets into logs', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'chai-agent-secret-'));
  const saved = { ...process.env };
  const logs: unknown[] = [];
  try {
    delete process.env.CHAI_AGENT_BRIDGE_TOKEN;
    process.env.CHAI_AGENT_BRIDGE_HOST = '127.0.0.1';
    writeFileSync(path.join(dir, 'agent-bridge.json'), '{"token":"SECRET_SENTINEL_DO_NOT_LOG", broken');
    const config = loadAgentBridgeConfig({ baseDir: dir, logger: {
      ...logger, warn: (...args: unknown[]) => { logs.push(args); },
    } });
    assert.ok(config.token);
    assert.equal(logs.length, 1);
    assert.ok(!JSON.stringify(logs).includes('SECRET_SENTINEL_DO_NOT_LOG'));
  } finally { process.env = saved; rmSync(dir, { recursive: true, force: true }); }
});

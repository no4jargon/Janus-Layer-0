import crypto from 'node:crypto';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import type { Logger } from '@chai/core';
import type { Database } from '@chai/db';
import { createEmailStore, createWhatsAppStore } from '@chai/db';
import type {
  AgentBridgeAuditEvent,
  AgentBridgeChannel,
  AgentBridgeContext,
  ContextDocument,
  GmailSender,
  NormalizedConversation,
  NormalizedMessage,
  PersonCandidate,
  ResponseTaskRecord,
  ResponseWatchRecord,
  SendMessageInput,
  SendMessageResult,
  SendRecipientResult,
  WhatsAppSender,
} from './types.js';

export type AgentBridgeServiceOptions = {
  db: Database;
  logger: Logger;
  gmailSender: GmailSender | null;
  whatsappSender: WhatsAppSender | null;
};

const DEFAULT_AGENT_ID = 'local-mcp';
const MAX_CONTEXT_FILE_CHARS = 200_000;
const MAX_WATCH_MESSAGES_PER_PERSON = 25;

const newId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalize = (value: unknown): string => clean(value).toLowerCase();

const includesNormalized = (value: unknown, query: string): boolean =>
  normalize(value).includes(query);

const boundedLimit = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.max(Math.floor(parsed), 1), 500) : fallback;
};

const isWhatsAppAddress = (value: string): boolean =>
  /^[^\s@:]+@(s\.whatsapp\.net|g\.us|lid)$/i.test(value);

const maybeEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const safeJsonParse = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const parseSinceSec = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return parseSinceSec(numeric);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return 0;
};

const parseConversationId = (
  conversationId: string,
): { channel: AgentBridgeChannel; id: string } | null => {
  const [prefix, ...rest] = clean(conversationId).split(':');
  const id = rest.join(':');
  if ((prefix === 'whatsapp' || prefix === 'gmail') && id) {
    return { channel: prefix, id };
  }
  return null;
};

const mapAuditRow = (row: any): AgentBridgeAuditEvent => ({
  id: row.id,
  requestId: row.request_id,
  agentId: row.agent_id,
  action: row.action,
  target: row.target,
  status: row.status,
  metadata: safeJsonParse<Record<string, unknown> | null>(
    row.metadata_json,
    null,
  ),
  createdAt: Number(row.created_at || 0),
});

const mapWatchRow = (row: any): ResponseWatchRecord => ({
  id: row.id,
  personQuery: row.person_query,
  instructions: row.instructions,
  contextRefs: safeJsonParse<string[]>(row.context_refs_json, []),
  status: row.status,
  createdAt: Number(row.created_at || 0),
  updatedAt: Number(row.updated_at || 0),
});

const mapTaskRow = (row: any): ResponseTaskRecord => ({
  id: row.id,
  watchId: row.watch_id,
  personQuery: row.person_query,
  instructions: row.instructions || '',
  conversationId: row.conversation_id,
  messageId: row.message_id,
  message: safeJsonParse<NormalizedMessage>(row.message_json, {
    messageId: row.message_id,
    channel: row.conversation_id.startsWith('gmail:') ? 'gmail' : 'whatsapp',
    conversationId: row.conversation_id,
    sender: '',
    timestamp: 0,
    text: '',
    direction: 'incoming',
    rawSourceId: row.message_id,
  }),
  context: safeJsonParse<ContextDocument[]>(row.context_json, []),
  status: row.status,
  sentMessageIds: safeJsonParse<string[]>(row.sent_message_ids_json, []),
  createdAt: Number(row.created_at || 0),
  updatedAt: Number(row.updated_at || 0),
});

export const createAgentBridgeService = (
  options: AgentBridgeServiceOptions,
) => {
  const emailStore = () => createEmailStore(options.db);
  const whatsappStore = () => createWhatsAppStore(options.db);

  const context = (input?: AgentBridgeContext) => ({
    agentId: clean(input?.agentId) || DEFAULT_AGENT_ID,
    requestId: clean(input?.requestId) || null,
  });

  const audit = (
    input: AgentBridgeContext | undefined,
    action: string,
    status: AgentBridgeAuditEvent['status'],
    details: {
      target?: string | null;
      metadata?: Record<string, unknown> | null;
    } = {},
  ) => {
    const ctx = context(input);
    options.db
      .prepare(
        `INSERT INTO agent_bridge_audit_events (
          id, request_id, agent_id, action, target, status, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId('agent_audit'),
        ctx.requestId,
        ctx.agentId,
        action,
        details.target ?? null,
        status,
        details.metadata ? JSON.stringify(details.metadata) : null,
        Date.now(),
      );
  };

  const listAudit = (input: AgentBridgeContext & { limit?: number } = {}) => {
    const limit = boundedLimit(input.limit, 100);
    audit(input, 'audit.list', 'ok', { metadata: { limit } });
    const rows = options.db
      .prepare(
        `SELECT id, request_id, agent_id, action, target, status, metadata_json, created_at
         FROM agent_bridge_audit_events
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as any[];
    return rows.map(mapAuditRow);
  };

  const normalizeWhatsAppMessage = (row: any): NormalizedMessage => {
    const store = whatsappStore();
    const senderJid = row.participant || row.sender_jid || row.remote_jid;
    const senderName = row.from_me
      ? 'You'
      : store.resolveDisplayName(senderJid) || senderJid || row.remote_jid;
    return {
      messageId: `whatsapp:${row.message_key}`,
      channel: 'whatsapp',
      conversationId: `whatsapp:${row.remote_jid}`,
      sender: senderName,
      timestamp: Number(row.message_timestamp || 0),
      text: row.is_deleted ? '' : String(row.text || ''),
      direction: Number(row.from_me || 0) === 1 ? 'outgoing' : 'incoming',
      rawSourceId: row.message_key,
    };
  };

  const normalizeEmailMessage = (row: any): NormalizedMessage => ({
    messageId: `gmail:${row.id}`,
    channel: 'gmail',
    conversationId: `gmail:${row.thread_id}`,
    sender:
      row.direction === 'outgoing'
        ? 'You'
        : row.sender_name
          ? `${row.sender_name} <${row.sender_email}>`
          : row.sender_email,
    timestamp: Number(row.sent_at || 0),
    text: String(row.body_clean_text || row.snippet || ''),
    direction: row.direction === 'outgoing' ? 'outgoing' : 'incoming',
    rawSourceId: row.id,
  });

  const dedupeCandidates = (candidates: PersonCandidate[]) => {
    const byId = new Map<string, PersonCandidate>();
    for (const candidate of candidates) {
      if (!byId.has(candidate.personId)) byId.set(candidate.personId, candidate);
    }
    return [...byId.values()].sort((a, b) => {
      const score = (candidate: PersonCandidate) =>
        candidate.match === 'exact' ? 0 : candidate.match === 'literal' ? 1 : 2;
      return score(a) - score(b) || a.label.localeCompare(b.label);
    });
  };

  const resolvePerson = (
    input: AgentBridgeContext & {
      query: string;
      channel?: AgentBridgeChannel;
    },
  ): { ok: true; candidates: PersonCandidate[] } => {
    const prefixed = parseConversationId(clean(input.query));
    const query = prefixed?.id ?? clean(input.query);
    const channel = input.channel ?? prefixed?.channel;
    if (input.channel && prefixed && input.channel !== prefixed.channel) {
      return { ok: true, candidates: [] };
    }
    const needle = normalize(query);
    if (!needle) {
      audit(input, 'person.resolve', 'blocked', {
        metadata: { reason: 'empty_query' },
      });
      return { ok: true, candidates: [] };
    }

    const candidates: PersonCandidate[] = [];
    const wantsWhatsApp = !channel || channel === 'whatsapp';
    const wantsGmail = !channel || channel === 'gmail';

    if (wantsWhatsApp) {
      const rows = options.db
        .prepare(
          `SELECT
             c.jid,
             COALESCE(NULLIF(TRIM(ct.name), ''), NULLIF(TRIM(ct.notify), ''),
                      NULLIF(TRIM(ct.verified_name), ''), NULLIF(TRIM(c.name), ''), c.jid) AS label
           FROM wa_chats c
           LEFT JOIN wa_contacts ct ON ct.jid = c.jid
           ORDER BY c.last_message_ts DESC`,
        )
        .all() as any[];
      for (const row of rows) {
        const label = whatsappStore().resolveDisplayName(row.jid) || clean(row.label) || row.jid;
        const exact = normalize(label) === needle || normalize(row.jid) === needle;
        if (exact || includesNormalized(label, needle) || includesNormalized(row.jid, needle)) {
          candidates.push({
            personId: `whatsapp:${row.jid}`,
            channel: 'whatsapp',
            label,
            address: row.jid,
            conversationId: `whatsapp:${row.jid}`,
            match: exact ? 'exact' : 'partial',
          });
        }
      }
      if (
        isWhatsAppAddress(query) &&
        !candidates.some((item) => item.address === query)
      ) {
        candidates.push({
          personId: `whatsapp:${query}`,
          channel: 'whatsapp',
          label: query,
          address: query,
          conversationId: `whatsapp:${query}`,
          match: 'literal',
        });
      }
    }

    if (wantsGmail) {
      if (maybeEmail(needle) && (!isWhatsAppAddress(needle) || channel === 'gmail')) {
        candidates.push({
          personId: `gmail:${needle}`,
          channel: 'gmail',
          label: needle,
          address: needle,
          conversationId: null,
          match: 'literal',
        });
      }

      const rows = options.db
        .prepare(
          `SELECT sender_email, MAX(sender_name) AS sender_name, MAX(thread_id) AS thread_id
           FROM email_messages
           WHERE sender_email IS NOT NULL
           GROUP BY sender_email
           ORDER BY MAX(sent_at) DESC`,
        )
        .all() as any[];
      for (const row of rows) {
        const email = clean(row.sender_email).toLowerCase();
        const name = clean(row.sender_name);
        const label = name ? `${name} <${email}>` : email;
        const exact = email === needle || normalize(name) === needle || normalize(label) === needle;
        if (exact || includesNormalized(email, needle) || includesNormalized(name, needle) || includesNormalized(label, needle)) {
          candidates.push({
            personId: `gmail:${email}`,
            channel: 'gmail',
            label,
            address: email,
            conversationId: row.thread_id ? `gmail:${row.thread_id}` : null,
            match: exact ? 'exact' : 'partial',
          });
        }
      }
    }

    const result = dedupeCandidates(candidates);
    audit(input, 'person.resolve', 'ok', {
      target: query,
      metadata: { channel: input.channel ?? null, candidateCount: result.length },
    });
    return { ok: true, candidates: result };
  };

  const listConversations = (
    input: AgentBridgeContext & {
      channel?: AgentBridgeChannel;
      query?: string;
      limit?: number;
    } = {},
  ): { ok: true; conversations: NormalizedConversation[] } => {
    const limit = boundedLimit(input.limit, 100);
    const needle = normalize(input.query);
    const out: NormalizedConversation[] = [];

    if (!input.channel || input.channel === 'whatsapp') {
      for (const chat of whatsappStore().getChats(limit)) {
        const title = chat.name || chat.jid;
        if (needle && !includesNormalized(title, needle) && !includesNormalized(chat.jid, needle)) {
          continue;
        }
        out.push({
          conversationId: `whatsapp:${chat.jid}`,
          channel: 'whatsapp',
          title,
          preview: chat.lastMessageText,
          timestamp: chat.lastMessageTs,
          unreadCount: chat.unread,
        });
      }
    }

    if (!input.channel || input.channel === 'gmail') {
      for (const thread of emailStore().getEmailThreads('local-user', limit)) {
        const title = thread.subject || thread.participantSummary || thread.id;
        if (
          needle &&
          !includesNormalized(title, needle) &&
          !includesNormalized(thread.participantSummary, needle)
        ) {
          continue;
        }
        out.push({
          conversationId: `gmail:${thread.id}`,
          channel: 'gmail',
          title,
          preview: thread.lastCleanedPreview,
          timestamp: thread.lastMessageAt,
          unreadCount: thread.unreadCount,
        });
      }
    }

    out.sort((a, b) => b.timestamp - a.timestamp);
    audit(input, 'conversation.list', 'ok', {
      metadata: { channel: input.channel ?? null, count: out.length },
    });
    return { ok: true, conversations: out.slice(0, limit) };
  };

  const readConversation = (
    input: AgentBridgeContext & {
      conversationId: string;
      limit?: number;
    },
  ):
    | { ok: true; messages: NormalizedMessage[] }
    | { ok: false; reason: 'invalid_conversation' | 'not_found' } => {
    const parsed = parseConversationId(input.conversationId);
    const limit = boundedLimit(input.limit, 200);
    if (!parsed) {
      audit(input, 'conversation.read', 'blocked', {
        target: input.conversationId,
        metadata: { reason: 'invalid_conversation' },
      });
      return { ok: false, reason: 'invalid_conversation' };
    }

    if (parsed.channel === 'whatsapp') {
      const rows = options.db
        .prepare(
          `SELECT * FROM (
            SELECT * FROM wa_messages
            WHERE remote_jid = ?
            ORDER BY message_timestamp DESC, created_at DESC
            LIMIT ?
          ) recent
          ORDER BY message_timestamp ASC, created_at ASC`,
        )
        .all(parsed.id, limit) as any[];
      const messages = rows.map(normalizeWhatsAppMessage);
      audit(input, 'conversation.read', 'ok', {
        target: input.conversationId,
        metadata: { count: messages.length },
      });
      return { ok: true, messages };
    }

    const thread = emailStore().getEmailThreadById(parsed.id);
    if (!thread) {
      audit(input, 'conversation.read', 'blocked', {
        target: input.conversationId,
        metadata: { reason: 'not_found' },
      });
      return { ok: false, reason: 'not_found' };
    }
    const rows = options.db
      .prepare(
        `SELECT * FROM (
          SELECT id, thread_id, sender_name, sender_email, sent_at, direction,
                 snippet, body_clean_text, created_at
          FROM email_messages
          WHERE thread_id = ?
          ORDER BY sent_at DESC, created_at DESC
          LIMIT ?
         ) recent ORDER BY sent_at ASC, created_at ASC`,
      )
      .all(parsed.id, limit) as any[];
    const messages = rows.map(normalizeEmailMessage);
    audit(input, 'conversation.read', 'ok', {
      target: input.conversationId,
      metadata: { count: messages.length },
    });
    return { ok: true, messages };
  };

  const latestIncomingMessagesForCandidate = (
    candidate: PersonCandidate,
    limit: number,
    watchId?: string,
  ): NormalizedMessage[] => {
    if (candidate.channel === 'whatsapp') {
      const rows = options.db
        .prepare(
          `SELECT *
           FROM wa_messages
           WHERE remote_jid = ?
             AND from_me = 0
             AND is_deleted = 0
             AND TRIM(text) != ''
             AND (? IS NULL OR NOT EXISTS (
               SELECT 1 FROM agent_response_tasks
               WHERE watch_id = ? AND message_id = 'whatsapp:' || wa_messages.message_key
             ))
           ORDER BY message_timestamp DESC, created_at DESC
           LIMIT ?`,
        )
        .all(candidate.address, watchId ?? null, watchId ?? null, limit) as any[];
      return rows.map(normalizeWhatsAppMessage);
    }
    const rows = options.db
      .prepare(
        `SELECT id, thread_id, sender_name, sender_email, sent_at, direction,
                snippet, body_clean_text
         FROM email_messages
         WHERE LOWER(sender_email) = ?
           AND direction = 'incoming'
           AND COALESCE(NULLIF(TRIM(body_clean_text), ''), TRIM(snippet), '') != ''
           AND (? IS NULL OR NOT EXISTS (
             SELECT 1 FROM agent_response_tasks
             WHERE watch_id = ? AND message_id = 'gmail:' || email_messages.id
           ))
         ORDER BY sent_at DESC, created_at DESC
         LIMIT ?`,
      )
      .all(candidate.address.toLowerCase(), watchId ?? null, watchId ?? null, limit) as any[];
    return rows.map(normalizeEmailMessage);
  };

  const hasMessageFrom = (
    input: AgentBridgeContext & {
      personQuery: string;
      since?: string | number;
      channel?: AgentBridgeChannel;
    },
  ):
    | { ok: true; hasMessage: boolean; messages: NormalizedMessage[] }
    | { ok: false; reason: 'ambiguous_person' | 'not_found'; candidates?: PersonCandidate[] } => {
    const resolved = resolvePerson({
      query: input.personQuery,
      channel: input.channel,
      agentId: input.agentId,
      requestId: input.requestId,
    });
    if (resolved.candidates.length === 0) {
      audit(input, 'message.has_from', 'blocked', {
        target: input.personQuery,
        metadata: { reason: 'not_found' },
      });
      return { ok: false, reason: 'not_found' };
    }
    if (resolved.candidates.length > 1) {
      audit(input, 'message.has_from', 'blocked', {
        target: input.personQuery,
        metadata: {
          reason: 'ambiguous_person',
          candidateCount: resolved.candidates.length,
        },
      });
      return {
        ok: false,
        reason: 'ambiguous_person',
        candidates: resolved.candidates,
      };
    }

    const since = parseSinceSec(input.since);
    const messages = latestIncomingMessagesForCandidate(
      resolved.candidates[0],
      50,
    )
      .filter((message) => message.timestamp >= since)
      .sort((a, b) => b.timestamp - a.timestamp);
    audit(input, 'message.has_from', 'ok', {
      target: input.personQuery,
      metadata: { since, count: messages.length },
    });
    return { ok: true, hasMessage: messages.length > 0, messages };
  };

  const resolveForSend = (
    recipient: string,
    channel: AgentBridgeChannel | undefined,
    ctx: AgentBridgeContext,
  ):
    | { ok: true; person: PersonCandidate }
    | { ok: false; reason: 'not_found' | 'ambiguous_recipient'; candidates: PersonCandidate[] } => {
    const resolved = resolvePerson({
      query: recipient,
      channel,
      agentId: ctx.agentId,
      requestId: ctx.requestId,
    });
    if (resolved.candidates.length === 0) {
      return { ok: false, reason: 'not_found', candidates: [] };
    }
    const exact = resolved.candidates.filter((candidate) => candidate.match === 'exact');
    const literal = resolved.candidates.filter((candidate) => candidate.match === 'literal');
    const preferred = exact.length === 1 ? exact[0] : literal.length === 1 ? literal[0] : null;
    if (preferred) return { ok: true, person: preferred };
    if (resolved.candidates.length === 1) {
      return { ok: true, person: resolved.candidates[0] };
    }
    return {
      ok: false,
      reason: 'ambiguous_recipient',
      candidates: resolved.candidates,
    };
  };

  const sendMessage = async (
    input: SendMessageInput,
  ): Promise<SendMessageResult> => {
    const recipients = Array.isArray(input.recipients)
      ? input.recipients.map(clean).filter(Boolean)
      : [];
    const text = clean(input.text);
    const clientRequestId = clean(input.clientRequestId);
    if (!recipients.length || !text || !clientRequestId) {
      audit(input, 'message.send', 'blocked', {
        metadata: {
          reason: 'invalid_input',
          recipients: recipients.length,
          hasText: Boolean(text),
          hasClientRequestId: Boolean(clientRequestId),
        },
      });
      return {
        ok: false,
        reason: 'invalid_input',
        errors: [
          {
            recipient: '',
            message: 'recipients, text, and clientRequestId are required',
          },
        ],
      };
    }

    const resolved = recipients.map((recipient) => ({
      recipient,
      result: resolveForSend(recipient, input.channel, input),
    }));
    const blocked = resolved.filter((item) => !item.result.ok) as Array<{
      recipient: string;
      result: {
        ok: false;
        reason: 'not_found' | 'ambiguous_recipient';
        candidates: PersonCandidate[];
      };
    }>;
    if (blocked.length) {
      audit(input, 'message.send', 'blocked', {
        metadata: {
          reason: blocked[0].result.reason,
          blockedRecipients: blocked.map((item) => item.recipient),
        },
      });
      return {
        ok: false,
        reason:
          blocked[0].result.reason === 'not_found'
            ? 'not_found'
            : 'ambiguous_recipient',
        errors: blocked.map((item) => ({
          recipient: item.recipient,
          message:
            item.result.reason === 'not_found'
              ? 'No matching person found'
              : 'Recipient is ambiguous',
          candidates: item.result.candidates,
        })),
      };
    }

    // Persist a content-free request fingerprint before dispatch. A retry can
    // reorder recipients, but must never reuse a key for a different delivery.
    const deliveries = [...new Map(resolved.map((item) => [
      (item.result as { ok: true; person: PersonCandidate }).person.personId, item,
    ])).values()];
    const digest = crypto.createHash('sha256').update(JSON.stringify({
      text, recipients: deliveries.map((item) =>
        (item.result as { ok: true; person: PersonCandidate }).person.personId).sort(),
    })).digest('hex');
    const claimed = options.db.prepare(
      `SELECT metadata_json FROM agent_bridge_audit_events
       WHERE action = 'message.send.request' AND target = ? LIMIT 1`,
    ).get(clientRequestId) as { metadata_json: string } | undefined;
    if (claimed && safeJsonParse<{ digest?: string }>(claimed.metadata_json, {}).digest !== digest) {
      audit(input, 'message.send', 'blocked', { metadata: { reason: 'request_id_conflict' } });
      return { ok: false, reason: 'invalid_input', errors: [{
        recipient: '', message: 'clientRequestId was already used with different recipients or text',
      }] };
    }
    if (!claimed) audit(input, 'message.send.request', 'ok', {
      target: clientRequestId, metadata: { digest },
    });
    const results: SendRecipientResult[] = [];
    for (const item of deliveries) {
      const person = (item.result as { ok: true; person: PersonCandidate }).person;
      const fanoutRequestId = `chai-agent:${crypto.createHash('sha256')
        .update(JSON.stringify([clientRequestId, person.personId])).digest('hex')}`;
      try {
        if (person.channel === 'whatsapp') {
          if (!options.whatsappSender) {
            throw new Error('WhatsApp send service is unavailable');
          }
          const sent = await options.whatsappSender.sendText({
            jid: person.address,
            text,
            clientRequestId: fanoutRequestId,
          });
          const key = clean(sent.waMessageKey).split('|');
          const confirmed = sent.status === 'sent' && key.length === 4 &&
            key[0] === person.address && Boolean(key[1]) && key[2] === '1';
          results.push({
            recipient: item.recipient,
            status: sent.status === 'sent' && !confirmed ? 'sending' : sent.status,
            person,
            outboxId: sent.id,
            messageId: confirmed ? `whatsapp:${sent.waMessageKey}` : null,
            error: sent.errorMessage || (sent.status === 'failed' ? sent.errorCode || 'WhatsApp send failed'
              : sent.status === 'sent' && !confirmed ? 'Delivery is unconfirmed: provider returned no valid outgoing message ID' : null),
          });
        } else {
          if (!options.gmailSender) {
            throw new Error('Gmail send service is unavailable');
          }
          const sent = await options.gmailSender.sendEmail({
            to: [{ email: person.address }],
            textBody: text,
            subject: 'Message from Chai',
            clientRequestId: fanoutRequestId,
          });
          const confirmed = sent.status === 'sent' && /^[A-Za-z0-9_-]+$/.test(clean(sent.gmailMessageId));
          results.push({
            recipient: item.recipient,
            status: sent.status === 'sent' && !confirmed ? 'sending' : sent.status,
            person,
            outboxId: sent.id,
            messageId: confirmed ? `gmail:${sent.gmailMessageId}` : null,
            error: sent.errorMessage || (sent.status === 'failed' ? sent.errorCode || 'Gmail send failed'
              : sent.status === 'sent' && !confirmed ? 'Delivery is unconfirmed: provider returned no valid message ID' : null),
          });
        }
      } catch (error) {
        results.push({
          recipient: item.recipient,
          status: 'failed' as const,
          person,
          outboxId: null,
          messageId: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const failed = results.filter((item) => item.status === 'failed');
    const pending = results.filter((item) => item.status === 'queued' || item.status === 'sending');
    audit(input, 'message.send', failed.length || pending.length ? 'error' : 'ok', {
      metadata: {
        count: results.length,
        failed: failed.length,
        pending: pending.length,
        recipients: results.map((item) => ({
          recipient: item.recipient,
          personId: item.person.personId,
          status: item.status,
        })),
      },
    });
    return { ok: true, results };
  };

  const readContextFiles = (
    refs: string[],
    ctx: AgentBridgeContext,
  ): ContextDocument[] => {
    const docs: ContextDocument[] = [];
    for (const ref of refs.map(clean).filter(Boolean)) {
      try {
        const stats = statSync(ref);
        if (!stats.isFile()) {
          docs.push({
            path: ref,
            text: '',
            truncated: false,
            error: 'Path is not a file',
          });
          audit(ctx, 'file.read', 'blocked', {
            target: ref,
            metadata: { reason: 'not_file' },
          });
          continue;
        }
        const fd = openSync(ref, 'r');
        const buffer = Buffer.alloc(Math.min(stats.size, MAX_CONTEXT_FILE_CHARS * 4 + 4));
        let bytes = 0;
        try { bytes = readSync(fd, buffer, 0, buffer.length, 0); } finally { closeSync(fd); }
        const raw = buffer.subarray(0, bytes).toString('utf8');
        const text = raw.slice(0, MAX_CONTEXT_FILE_CHARS);
        const truncated = stats.size > bytes || raw.length > text.length;
        docs.push({
          path: ref,
          text,
          truncated,
          error: null,
        });
        audit(ctx, 'file.read', 'ok', {
          target: ref,
          metadata: { bytes: stats.size, truncated },
        });
      } catch (error) {
        docs.push({
          path: ref,
          text: '',
          truncated: false,
          error: error instanceof Error ? error.message : String(error),
        });
        audit(ctx, 'file.read', 'error', {
          target: ref,
          metadata: { error: error instanceof Error ? error.message : String(error) },
        });
      }
    }
    return docs;
  };

  const insertTaskIfMissing = (
    watch: ResponseWatchRecord,
    message: NormalizedMessage,
    ctx: AgentBridgeContext,
  ): ResponseTaskRecord | null => {
    const contextDocs = readContextFiles(watch.contextRefs, ctx);
    const id = newId('agent_task');
    const now = Date.now();
    options.db
      .prepare(
        `INSERT OR IGNORE INTO agent_response_tasks (
          id, watch_id, person_query, conversation_id, message_id, message_json,
          context_json, status, sent_message_ids_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '[]', ?, ?)`,
      )
      .run(
        id,
        watch.id,
        watch.personQuery,
        message.conversationId,
        message.messageId,
        JSON.stringify(message),
        JSON.stringify(contextDocs),
        now,
        now,
      );
    const row = options.db
      .prepare(
        `SELECT id, watch_id, person_query, conversation_id, message_id, message_json,
                context_json, status, sent_message_ids_json, created_at, updated_at,
                (SELECT instructions FROM agent_response_watches WHERE id = watch_id) AS instructions
         FROM agent_response_tasks
         WHERE watch_id = ? AND message_id = ?
         LIMIT 1`,
      )
      .get(watch.id, message.messageId) as any;
    return row ? mapTaskRow(row) : null;
  };

  const refreshResponseTasks = (
    input: AgentBridgeContext = {},
  ): { ok: true; created: ResponseTaskRecord[] } => {
    const watches = (
      options.db
        .prepare(
          `SELECT id, person_query, instructions, context_refs_json, status, created_at, updated_at
           FROM agent_response_watches
           WHERE status = 'active'
           ORDER BY created_at ASC`,
        )
        .all() as any[]
    ).map(mapWatchRow);
    const created: ResponseTaskRecord[] = [];

    for (const watch of watches) {
      const candidates = resolvePerson({
        query: watch.personQuery,
        agentId: input.agentId,
        requestId: input.requestId,
      }).candidates;
      for (const candidate of candidates) {
        const messages = latestIncomingMessagesForCandidate(
          candidate,
          MAX_WATCH_MESSAGES_PER_PERSON,
          watch.id,
        );
        for (const message of messages) {
          const before = options.db
            .prepare(
              'SELECT id FROM agent_response_tasks WHERE watch_id = ? AND message_id = ? LIMIT 1',
            )
            .get(watch.id, message.messageId);
          if (before) continue;
          const task = insertTaskIfMissing(watch, message, input);
          if (task) {
            created.push(task);
            audit(input, 'response_task.create', 'ok', {
              target: task.id,
              metadata: {
                watchId: watch.id,
                messageId: message.messageId,
                conversationId: message.conversationId,
              },
            });
          }
        }
      }
    }

    return { ok: true, created };
  };

  const createResponseWatch = (
    input: AgentBridgeContext & {
      personQuery: string;
      instructions: string;
      contextRefs?: string[];
    },
  ): { ok: true; watch: ResponseWatchRecord; createdTasks: ResponseTaskRecord[] } => {
    const query = clean(input.personQuery);
    const instructions = clean(input.instructions);
    if (!query || !instructions) {
      audit(input, 'response_watch.create', 'blocked', {
        metadata: { reason: 'invalid_input' },
      });
      throw new Error('personQuery and instructions are required');
    }
    const resolved = resolveForSend(query, undefined, input);
    if (!resolved.ok) throw new Error(resolved.reason === 'not_found'
      ? 'No matching person found' : 'Watch recipient is ambiguous; use a personId');
    // Keep the resolved channel/address stable across new contacts and restarts.
    const personQuery = resolved.person.personId;
    const contextRefs = Array.isArray(input.contextRefs)
      ? input.contextRefs.map(clean).filter(Boolean)
      : [];
    const now = Date.now();
    const id = newId('agent_watch');
    options.db
      .prepare(
        `INSERT INTO agent_response_watches (
          id, person_query, instructions, context_refs_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(id, personQuery, instructions, JSON.stringify(contextRefs), now, now);
    const row = options.db
      .prepare(
        `SELECT id, person_query, instructions, context_refs_json, status, created_at, updated_at
         FROM agent_response_watches
         WHERE id = ?
         LIMIT 1`,
      )
      .get(id) as any;
    const watch = mapWatchRow(row);
    audit(input, 'response_watch.create', 'ok', {
      target: id,
      metadata: { personQuery, contextRefCount: contextRefs.length },
    });
    const refreshed = refreshResponseTasks(input);
    return { ok: true, watch, createdTasks: refreshed.created.filter((task) => task.watchId === id) };
  };

  const listResponseWatches = (input: AgentBridgeContext = {}) => {
    const watches = (options.db.prepare(
      `SELECT id, person_query, instructions, context_refs_json, status, created_at, updated_at
       FROM agent_response_watches ORDER BY created_at DESC`,
    ).all() as any[]).map(mapWatchRow);
    audit(input, 'response_watch.list', 'ok', { metadata: { count: watches.length } });
    return { ok: true as const, watches };
  };

  const setResponseWatchStatus = (
    input: AgentBridgeContext & { watchId: string; status: 'active' | 'paused' },
  ) => {
    if (!clean(input.watchId) || !['active', 'paused'].includes(input.status)) {
      throw new Error('watchId and active/paused status are required');
    }
    options.db.prepare(
      'UPDATE agent_response_watches SET status = ?, updated_at = ? WHERE id = ?',
    ).run(input.status, Date.now(), input.watchId);
    const row = options.db.prepare(
      `SELECT id, person_query, instructions, context_refs_json, status, created_at, updated_at
       FROM agent_response_watches WHERE id = ?`,
    ).get(input.watchId);
    audit(input, 'response_watch.set_status', row ? 'ok' : 'blocked', {
      target: input.watchId, metadata: { status: input.status },
    });
    return { ok: Boolean(row), watch: row ? mapWatchRow(row) : null };
  };

  const listResponseTasks = (
    input: AgentBridgeContext & { status?: 'pending' | 'completed'; limit?: number } = {},
  ): { ok: true; tasks: ResponseTaskRecord[] } => {
    refreshResponseTasks(input);
    const status = input.status || 'pending';
    const limit = boundedLimit(input.limit, 100);
    const rows = options.db
      .prepare(
        `SELECT id, watch_id, person_query, conversation_id, message_id, message_json,
                context_json, status, sent_message_ids_json, created_at, updated_at,
                (SELECT instructions FROM agent_response_watches WHERE id = watch_id) AS instructions
         FROM agent_response_tasks
         WHERE status = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(status, limit) as any[];
    const tasks = rows.map(mapTaskRow);
    audit(input, 'response_task.list', 'ok', {
      metadata: { status, count: tasks.length },
    });
    return { ok: true, tasks };
  };

  const completeResponseTask = (
    input: AgentBridgeContext & { taskId: string; sentMessageIds?: string[] },
  ): { ok: true; task: ResponseTaskRecord | null } => {
    const sentMessageIds = Array.isArray(input.sentMessageIds)
      ? input.sentMessageIds.map(clean).filter(Boolean)
      : [];
    options.db
      .prepare(
        `UPDATE agent_response_tasks
         SET status = 'completed', sent_message_ids_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(sentMessageIds), Date.now(), input.taskId);
    const row = options.db
      .prepare(
        `SELECT id, watch_id, person_query, conversation_id, message_id, message_json,
                context_json, status, sent_message_ids_json, created_at, updated_at,
                (SELECT instructions FROM agent_response_watches WHERE id = watch_id) AS instructions
         FROM agent_response_tasks
         WHERE id = ?
         LIMIT 1`,
      )
      .get(input.taskId) as any;
    const task = row ? mapTaskRow(row) : null;
    audit(input, 'response_task.complete', task ? 'ok' : 'blocked', {
      target: input.taskId,
      metadata: { sentMessageIds },
    });
    return { ok: true, task };
  };

  return {
    resolvePerson,
    hasMessageFrom,
    listConversations,
    readConversation,
    sendMessage,
    createResponseWatch,
    listResponseWatches,
    setResponseWatchStatus,
    listResponseTasks,
    completeResponseTask,
    refreshResponseTasks,
    listAudit,
  };
};

export type AgentBridgeService = ReturnType<typeof createAgentBridgeService>;

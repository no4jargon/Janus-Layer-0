import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from '@workspace/core';
import type { EmailOutboxMessageRecord, EmailStore } from '@workspace/db';
import {
  authedFetch,
  parseOauthConfig,
  refreshTokenIfNeeded,
  type GmailToken,
} from './oauth.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const base64UrlEncode = (value: string) =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

export type SendEmailInput = {
  clientRequestId: string;
  threadId?: string | null;
  to?: Array<{ name?: string; email: string }> | string[];
  cc?: Array<{ name?: string; email: string }> | string[];
  subject?: string;
  textBody: string;
  htmlBody?: string | null;
};

const parseRecipients = (
  values?: Array<{ name?: string; email: string }> | string[],
): Array<{ name: string; email: string }> => {
  const out: Array<{ name: string; email: string }> = [];
  for (const item of values || []) {
    if (typeof item === 'string') {
      const email = clean(item).toLowerCase();
      if (email) out.push({ name: '', email });
    } else {
      const email = clean(item.email).toLowerCase();
      if (email) out.push({ name: clean(item.name), email });
    }
  }
  return out;
};

const formatAddress = (entry: { name: string; email: string }): string =>
  entry.name
    ? `"${entry.name.replace(/"/g, '')}" <${entry.email}>`
    : entry.email;

const parseRecipientJson = (
  value: string,
): Array<{ name: string; email: string }> => {
  try {
    const raw = JSON.parse(value);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => ({
        name: clean(item?.name),
        email: clean(item?.email).toLowerCase(),
      }))
      .filter((item) => !!item.email);
  } catch {
    return [];
  }
};

const ensureDir = (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
};

const readTokenFile = (tokenFilePath: string): GmailToken | null => {
  if (!existsSync(tokenFilePath)) return null;
  try {
    const raw = readFileSync(tokenFilePath, 'utf8');
    const parsed = JSON.parse(raw) as GmailToken;
    if (!parsed.access_token) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeTokenFile = (tokenFilePath: string, token: GmailToken) => {
  ensureDir(tokenFilePath);
  writeFileSync(tokenFilePath, JSON.stringify(token, null, 2), 'utf8');
};

export type GmailSendServiceOptions = {
  emailStore: EmailStore;
  tokenFilePath: string;
  logger: Logger;
};

export type GmailSendService = {
  sendEmail(input: SendEmailInput): Promise<EmailOutboxMessageRecord>;
};

const buildRawMime = (input: {
  to: Array<{ name: string; email: string }>;
  cc: Array<{ name: string; email: string }>;
  subject: string;
  textBody: string;
  htmlBody?: string | null;
  inReplyTo?: string;
  references?: string;
}): string => {
  const headers: string[] = [
    `To: ${input.to.map(formatAddress).join(', ')}`,
    ...(input.cc.length ? [`Cc: ${input.cc.map(formatAddress).join(', ')}`] : []),
    `Subject: ${input.subject}`,
    'MIME-Version: 1.0',
  ];
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headers.push(`References: ${input.references}`);

  if (input.htmlBody && clean(input.htmlBody)) {
    const boundary = `alt_${crypto.randomUUID()}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const parts = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      input.textBody,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      input.htmlBody,
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    return `${headers.join('\r\n')}\r\n\r\n${parts}`;
  }

  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: 7bit');
  return `${headers.join('\r\n')}\r\n\r\n${input.textBody}`;
};

export const createGmailSendService = (
  options: GmailSendServiceOptions,
): GmailSendService => {
  const makeId = (prefix: string) =>
    `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

  const getAuthToken = async (): Promise<GmailToken> => {
    const config = parseOauthConfig();
    const token = readTokenFile(options.tokenFilePath);
    if (!token) throw new Error('Gmail not connected');
    const fresh = await refreshTokenIfNeeded(config, token);
    if (fresh !== token) {
      writeTokenFile(options.tokenFilePath, fresh);
    }
    return fresh;
  };

  const fetchRfcReplyHeaders = async (providerMessageId: string) => {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`;
    try {
      const token = await getAuthToken();
      const res = await authedFetch(token, url);
      const raw = await res.text();
      if (!res.ok) return { inReplyTo: '', references: '' };
      const payload = JSON.parse(raw) as {
        payload?: { headers?: Array<{ name?: string; value?: string }> };
      };
      const headers = payload.payload?.headers || [];
      const messageId = clean(
        headers.find((h) => clean(h.name).toLowerCase() === 'message-id')?.value,
      );
      const refs = clean(
        headers.find((h) => clean(h.name).toLowerCase() === 'references')?.value,
      );
      return {
        inReplyTo: messageId,
        references: refs ? `${refs} ${messageId}`.trim() : messageId,
      };
    } catch {
      return { inReplyTo: '', references: '' };
    }
  };

  const sendEmail = async (
    input: SendEmailInput,
  ): Promise<EmailOutboxMessageRecord> => {
    const clientRequestId = clean(input.clientRequestId);
    if (!clientRequestId) throw new Error('clientRequestId is required');
    const textBody = clean(input.textBody);
    if (!textBody) throw new Error('textBody is required');

    const account = options.emailStore.getEmailAccount('local-user', 'gmail');
    if (!account) throw new Error('Gmail account not connected');

    const dedupe =
      options.emailStore.getEmailOutboxMessageByClientRequestId(clientRequestId);
    if (dedupe && (dedupe.status === 'sent' || dedupe.status === 'sending')) {
      return dedupe;
    }

    let to = parseRecipients(input.to);
    let cc = parseRecipients(input.cc);
    let subject = clean(input.subject);
    let providerThreadId: string | null = null;
    let internalThreadId: string | null = null;
    let inReplyTo = '';
    let references = '';

    if (input.threadId) {
      const thread = options.emailStore.getEmailThreadById(input.threadId);
      if (!thread) throw new Error('Email thread not found');
      internalThreadId = thread.id;
      providerThreadId = thread.providerThreadId;
      subject = subject || thread.subject || '(No subject)';

      const messages = options.emailStore.getEmailMessagesForThread(thread.id);
      const newest = messages[messages.length - 1];
      const latestIncoming = [...messages]
        .reverse()
        .find((msg) => msg.direction === 'incoming');

      if (!to.length && latestIncoming?.senderEmail) {
        to = [
          {
            name: clean(latestIncoming.senderName),
            email: clean(latestIncoming.senderEmail).toLowerCase(),
          },
        ];
      }
      if (!to.length && newest) {
        to = parseRecipientJson(newest.toJson);
      }
      if (!cc.length && newest) {
        cc = parseRecipientJson(newest.ccJson);
      }

      if (newest?.providerMessageId) {
        const replyHeaders = await fetchRfcReplyHeaders(newest.providerMessageId);
        inReplyTo = replyHeaders.inReplyTo;
        references = replyHeaders.references;
      }
    }

    if (!to.length) throw new Error('At least one recipient is required');
    if (!subject) subject = '(No subject)';

    const queued =
      dedupe ||
      options.emailStore.createEmailOutboxMessage({
        id: makeId('email_outbox'),
        clientRequestId,
        accountId: account.id,
        threadId: internalThreadId,
        providerThreadId,
        toJson: JSON.stringify(to),
        ccJson: JSON.stringify(cc),
        subject,
        textBody,
        htmlBody: input.htmlBody || null,
        status: 'queued',
        errorCode: null,
        errorMessage: null,
        gmailMessageId: null,
        gmailThreadId: null,
      });
    if (!queued) throw new Error('Failed to queue email send request');

    options.emailStore.updateEmailOutboxMessageStatus(queued.id, {
      status: 'sending',
      errorCode: null,
      errorMessage: null,
    });

    try {
      const mime = buildRawMime({
        to,
        cc,
        subject,
        textBody,
        htmlBody: input.htmlBody,
        inReplyTo,
        references,
      });
      const payload: Record<string, unknown> = { raw: base64UrlEncode(mime) };
      if (providerThreadId) payload.threadId = providerThreadId;

      const token = await getAuthToken();
      const sendRes = await authedFetch(
        token,
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      const raw = await sendRes.text();
      if (!sendRes.ok) {
        if (
          raw.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
          raw.includes('insufficientPermissions')
        ) {
          throw new Error(
            'Gmail token is missing send scope. Disconnect Gmail, reconnect, and grant permissions again (gmail.readonly + gmail.send).',
          );
        }
        throw new Error(`Gmail send failed: ${raw}`);
      }

      const sent = JSON.parse(raw) as { id?: string; threadId?: string };
      const updated = options.emailStore.updateEmailOutboxMessageStatus(
        queued.id,
        {
          status: 'sent',
          gmailMessageId: clean(sent.id) || null,
          gmailThreadId: clean(sent.threadId) || null,
          errorCode: null,
          errorMessage: null,
        },
      );

      options.logger.info('gmail send succeeded', {
        outboxId: queued.id,
        gmailMessageId: clean(sent.id) || null,
      });
      return updated || queued;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.emailStore.updateEmailOutboxMessageStatus(queued.id, {
        status: 'failed',
        errorCode: 'EMAIL_SEND_FAILED',
        errorMessage: message,
      });
      options.logger.error('gmail send failed', {
        outboxId: queued.id,
        error: message,
      });
      throw error;
    }
  };

  return { sendEmail };
};

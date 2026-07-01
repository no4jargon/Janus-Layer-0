import crypto from 'node:crypto';
import type { WASocket } from 'baileys';
import type { Logger } from '@chai/core';
import {
  mkMessageKey,
  type WaOutboxMessageRecord,
  type WhatsAppStore,
} from '@chai/db';

export type SendTextInput = {
  jid: string;
  text: string;
  quotedMessageKey?: string | null;
  clientRequestId: string;
};

export type WhatsAppSendServiceOptions = {
  store: WhatsAppStore;
  logger: Logger;
  getSocket: () => WASocket | null;
};

export type WhatsAppSendService = {
  sendText(input: SendTextInput): Promise<WaOutboxMessageRecord>;
};

export const createWhatsAppSendService = (
  options: WhatsAppSendServiceOptions,
): WhatsAppSendService => {
  const makeId = (prefix: string) =>
    `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

  const parseQuotedMessageKey = (raw: string | null | undefined) => {
    if (!raw) return undefined;
    const existing = options.store.getMessage(raw);
    if (!existing) return undefined;
    return {
      remoteJid: existing.remoteJid,
      id: existing.keyId,
      fromMe: existing.fromMe,
      participant: existing.participant || undefined,
    };
  };

  const sendText = async (
    input: SendTextInput,
  ): Promise<WaOutboxMessageRecord> => {
    const chatJid = (input.jid || '').trim();
    const text = String(input.text || '').trim();
    const clientRequestId = String(input.clientRequestId || '').trim();
    if (!chatJid) throw new Error('jid is required');
    if (!text) throw new Error('text is required');
    if (!clientRequestId) throw new Error('clientRequestId is required');

    const existing =
      options.store.getWaOutboxMessageByClientRequestId(clientRequestId);
    if (
      existing &&
      (existing.status === 'sent' || existing.status === 'sending')
    ) {
      return existing;
    }

    const created =
      existing ||
      options.store.createWaOutboxMessage({
        id: makeId('wa_outbox'),
        clientRequestId,
        chatJid,
        text,
        quotedMessageKey: input.quotedMessageKey || null,
        status: 'queued',
        errorCode: null,
        errorMessage: null,
        waMessageKey: null,
      });
    if (!created) throw new Error('Failed to queue WhatsApp send request');

    options.store.updateWaOutboxMessageStatus(created.id, {
      status: 'sending',
      errorCode: null,
      errorMessage: null,
    });

    const sock = options.getSocket();
    if (!sock) {
      options.store.updateWaOutboxMessageStatus(created.id, {
        status: 'failed',
        errorCode: 'SOCKET_NOT_READY',
        errorMessage: 'WhatsApp socket is not connected',
      });
      throw new Error('WhatsApp socket is not connected');
    }

    try {
      const quoted = parseQuotedMessageKey(input.quotedMessageKey);
      const sent = await sock.sendMessage(
        chatJid,
        { text },
        quoted
          ? ({ quoted: { key: quoted } as unknown as never } as never)
          : undefined,
      );
      const messageKey = sent?.key ? mkMessageKey(sent.key) : null;
      const updated = options.store.updateWaOutboxMessageStatus(created.id, {
        status: 'sent',
        waMessageKey: messageKey,
        errorCode: null,
        errorMessage: null,
      });

      options.logger.info('whatsapp send succeeded', {
        outboxId: created.id,
        chatJid,
      });
      return updated || created;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      options.store.updateWaOutboxMessageStatus(created.id, {
        status: 'failed',
        errorCode: 'WA_SEND_FAILED',
        errorMessage,
      });
      options.logger.error('whatsapp send failed', {
        outboxId: created.id,
        error: errorMessage,
      });
      throw error;
    }
  };

  return { sendText };
};

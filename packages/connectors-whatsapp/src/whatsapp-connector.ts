import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Boom } from '@hapi/boom';
import P, { type Logger as PinoLogger } from 'pino';
import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
} from 'baileys';
import type {
  ConnectionState,
  WAMessage,
  WAMessageUpdate,
  WASocket,
} from 'baileys';
import type { Logger as CoreLogger, WorkspaceConnector } from '@workspace/core';
import type { WhatsAppStore } from '@workspace/db';
import {
  buildMessageRow,
  isInterestingJid,
  messageKeyFromWAKey,
} from './message-parser.js';

export type WhatsAppEvent =
  | { type: 'qr'; payload: { qr: string } }
  | { type: 'connection'; payload: { connection: string; statusCode?: number } }
  | { type: 'pairing-failed'; payload: { reason: string } }
  | { type: 'message-upsert'; payload: { remoteJid: string } }
  | { type: 'message-update'; payload: { remoteJid: string } }
  | { type: 'history-loaded'; payload: { chats: number; messages: number } };

export type WhatsAppConnectorOptions = {
  keystoreDir: string;
  logger: CoreLogger;
  store: WhatsAppStore;
  onEvent?: (event: WhatsAppEvent) => void;
};

export type WhatsAppRuntimeStatus = {
  connected: boolean;
  pairedAt: string | null;
  lastSyncedAt: string | null;
  lastQr: string | null;
  reconnectCount: number;
  loggedOut: boolean;
};

export type WhatsAppConnector = WorkspaceConnector & {
  getStatus(): WhatsAppRuntimeStatus;
  getActiveSocket(): WASocket | null;
};

export const createWhatsAppConnector = (
  options: WhatsAppConnectorOptions,
): WhatsAppConnector => {
  const sessionDir = path.join(options.keystoreDir, 'whatsapp-session');
  const { logger, store, onEvent } = options;

  const internalPino: PinoLogger = P({ level: 'warn' });

  let activeSock: WASocket | null = null;
  let reconnectHandle: NodeJS.Timeout | null = null;
  let reconnectCount = 0;
  let pairedAt: string | null = null;
  let lastSyncedAt: string | null = null;
  let lastQr: string | null = null;
  let loggedOut = false;
  let connecting = false;
  let connectedDeferred: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;

  const emit = (event: WhatsAppEvent) => {
    try {
      onEvent?.(event);
    } catch (error) {
      logger.warn('whatsapp event handler threw', { error: String(error) });
    }
  };

  const ensureSessionDir = () => {
    mkdirSync(sessionDir, { recursive: true });
  };

  const cancelReconnect = () => {
    if (reconnectHandle) {
      clearTimeout(reconnectHandle);
      reconnectHandle = null;
    }
  };

  const scheduleReconnect = () => {
    cancelReconnect();
    reconnectCount += 1;
    const delay = Math.min(3_000 * 2 ** Math.min(reconnectCount, 5), 30_000);
    logger.info('whatsapp reconnect scheduled', { delay, reconnectCount });

    reconnectHandle = setTimeout(() => {
      void start().catch((error) => {
        logger.error('whatsapp reconnect failed', { error: String(error) });
      });
    }, delay);
  };

  const teardownSocket = () => {
    if (!activeSock) return;
    try {
      activeSock.end?.(undefined);
    } catch (error) {
      logger.warn('whatsapp socket end failed', { error: String(error) });
    }
    activeSock = null;
  };

  const handleConnectionUpdate = (
    update: Partial<ConnectionState>,
    saveCreds: () => Promise<void>,
  ) => {
    if (update.qr) {
      lastQr = update.qr;
      emit({ type: 'qr', payload: { qr: update.qr } });
      logger.info('whatsapp qr available');
    }

    if (update.connection === 'open') {
      reconnectCount = 0;
      pairedAt = new Date().toISOString();
      lastQr = null;
      loggedOut = false;
      connecting = false;
      void saveCreds().catch((error) =>
        logger.warn('whatsapp saveCreds failed', { error: String(error) }),
      );
      emit({ type: 'connection', payload: { connection: 'open' } });

      if (connectedDeferred) {
        connectedDeferred.resolve();
        connectedDeferred = null;
      }
      logger.info('whatsapp connection open');
    }

    if (update.connection === 'close') {
      connecting = false;
      const statusCode = (update.lastDisconnect?.error as Boom | undefined)
        ?.output?.statusCode;
      emit({
        type: 'connection',
        payload: { connection: 'close', statusCode },
      });

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      teardownSocket();
      if (shouldReconnect) {
        scheduleReconnect();
      } else {
        loggedOut = true;
        emit({
          type: 'pairing-failed',
          payload: { reason: 'logged-out' },
        });
        if (connectedDeferred) {
          connectedDeferred.reject(
            new Error('WhatsApp logged out. Reset session to re-pair.'),
          );
          connectedDeferred = null;
        }
        logger.warn('whatsapp logged out');
      }
    }
  };

  const start = async () => {
    if (connecting) return;
    connecting = true;
    ensureSessionDir();

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: internalPino,
      browser: Browsers.macOS('Workspace App'),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, internalPino),
      },
      getMessage: async () => undefined,
      syncFullHistory: true,
      printQRInTerminal: false,
      shouldSyncHistoryMessage: () => true,
    });
    activeSock = sock;

    sock.ev.process(async (events) => {
      if (events['creds.update']) {
        await saveCreds();
      }

      if (events['connection.update']) {
        handleConnectionUpdate(
          events['connection.update'] as Partial<ConnectionState>,
          saveCreds,
        );
      }

      if (events['messaging-history.set']) {
        const historyEvent = events['messaging-history.set'] as {
          chats?: Array<Record<string, unknown> & { id?: string }>;
          messages?: WAMessage[];
          contacts?: Array<Record<string, unknown> & { id?: string }>;
          lidPnMappings?: Array<{ lid: string; pn: string }>;
        };
        const {
          chats = [],
          messages = [],
          contacts = [],
          lidPnMappings = [],
        } = historyEvent;

        for (const mapping of lidPnMappings) {
          const lid = jidNormalizedUser(mapping.lid);
          const pn = jidNormalizedUser(mapping.pn);
          if (lid && pn) {
            store.upsertJidMapping(lid, pn);
            store.upsertJidMapping(pn, lid);
          }
        }
        for (const contact of contacts) {
          if ('id' in contact && contact.id) {
            store.upsertContact({
              jid: contact.id as string,
              name: (contact as any).name ?? null,
              notify: (contact as any).notify ?? null,
              verifiedName: (contact as any).verifiedName ?? null,
              username: (contact as any).username ?? null,
              phoneNumber: (contact as any).phoneNumber ?? null,
              imgUrl: (contact as any).imgUrl ?? null,
            });
          }
        }
        for (const chat of chats) {
          if (chat.id) {
            store.upsertChat({
              jid: chat.id,
              name:
                (chat as any).displayName ||
                (chat as any).name ||
                (chat as any).username ||
                null,
              isGroup: isJidGroup(chat.id) ?? false,
              lastMessageTs: Number(
                (chat as any).conversationTimestamp ||
                  (chat as any).lastMessageTimestamp ||
                  0,
              ),
              lastMessageText: '',
              lastMessageType: '',
            });
          }
        }
        for (const message of messages as WAMessage[]) {
          if (!isInterestingJid(message.key?.remoteJid)) continue;
          store.upsertMessage(buildMessageRow(message));
        }
        emit({
          type: 'history-loaded',
          payload: { chats: chats.length, messages: messages.length },
        });
      }

      if (events['chats.upsert']) {
        for (const chat of events['chats.upsert']) {
          if (!chat.id) continue;
          store.upsertChat({
            jid: chat.id,
            name:
              (chat as any).displayName ||
              (chat as any).name ||
              (chat as any).username ||
              null,
            isGroup: isJidGroup(chat.id) ?? false,
            lastMessageTs: Number(
              (chat as any).conversationTimestamp ||
                (chat as any).lastMessageTimestamp ||
                0,
            ),
          });
        }
      }

      if (events['contacts.upsert']) {
        for (const contact of events['contacts.upsert']) {
          if (!contact.id) continue;
          store.upsertContact({
            jid: contact.id,
            name: (contact as any).name ?? null,
            notify: (contact as any).notify ?? null,
            verifiedName: (contact as any).verifiedName ?? null,
            username: (contact as any).username ?? null,
            phoneNumber: (contact as any).phoneNumber ?? null,
            imgUrl: (contact as any).imgUrl ?? null,
          });
        }
      }

      if (events['messages.upsert']) {
        const seen = new Set<string>();
        for (const message of events['messages.upsert'].messages as WAMessage[]) {
          if (!isInterestingJid(message.key?.remoteJid)) continue;
          const persisted = store.upsertMessage(buildMessageRow(message));
          if (persisted) seen.add(persisted.remoteJid);
        }
        for (const remoteJid of seen) {
          emit({ type: 'message-upsert', payload: { remoteJid } });
        }
      }

      if (events['messages.update']) {
        for (const update of events['messages.update'] as WAMessageUpdate[]) {
          const key = messageKeyFromWAKey(update.key);
          const existing = store.getMessage(key);
          if (!existing) continue;
          const text =
            update.update.message === null
              ? '[This message was deleted]'
              : (update.update.message as any)?.conversation ||
                (update.update.message as any)?.extendedTextMessage?.text ||
                existing.text;
          store.updateMessage(key, {
            text,
            status: update.update.status ?? existing.status,
            isDeleted: update.update.message === null,
          });
          emit({
            type: 'message-update',
            payload: { remoteJid: existing.remoteJid },
          });
        }
      }

      if (events['messages.delete']) {
        const data = events['messages.delete'] as
          | { keys: Array<{ remoteJid?: string; id?: string; fromMe?: boolean; participant?: string }> }
          | { jid: string; all: true };

        if ('all' in data && data.all && data.jid) {
          store.deleteAllMessagesForChat(data.jid);
          return;
        }

        for (const item of (data as { keys: any[] }).keys || []) {
          const messageKey = messageKeyFromWAKey(item);
          store.markMessageDeleted(messageKey);
        }
      }
    });
  };

  const start_ = () => start();

  const isConnected = () => activeSock !== null && pairedAt !== null && !loggedOut;

  const bootstrap: WorkspaceConnector['bootstrap'] = async () => {
    if (!existsSync(sessionDir)) {
      return { connected: false };
    }

    try {
      await start_();
      return {
        connected: isConnected(),
        metadata: pairedAt ? { pairedAt } : null,
        lastSyncedAt,
      };
    } catch (error) {
      logger.warn('whatsapp bootstrap failed', { error: String(error) });
      return { connected: false };
    }
  };

  const connect: WorkspaceConnector['connect'] = async () => {
    cancelReconnect();
    teardownSocket();
    pairedAt = null;
    loggedOut = false;
    reconnectCount = 0;

    const completion = new Promise<void>((resolve, reject) => {
      let timeout: NodeJS.Timeout | null = null;
      const wrapResolve = () => {
        if (timeout) clearTimeout(timeout);
        resolve();
      };
      const wrapReject = (error: Error) => {
        if (timeout) clearTimeout(timeout);
        reject(error);
      };
      connectedDeferred = { resolve: wrapResolve, reject: wrapReject };
      timeout = setTimeout(() => {
        if (connectedDeferred) {
          connectedDeferred.reject(
            new Error('WhatsApp pairing timed out. Try again.'),
          );
          connectedDeferred = null;
        }
      }, 240_000);
    });

    await start_();
    await completion;

    return {
      metadata: { pairedAt },
    };
  };

  const disconnect: WorkspaceConnector['disconnect'] = async () => {
    cancelReconnect();
    if (activeSock) {
      try {
        await activeSock.logout?.().catch(() => {});
      } catch (error) {
        logger.warn('whatsapp logout failed', { error: String(error) });
      }
      teardownSocket();
    }
    if (existsSync(sessionDir)) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
    pairedAt = null;
    lastSyncedAt = null;
    loggedOut = false;
    lastQr = null;
  };

  const sync: WorkspaceConnector['sync'] = async () => {
    if (!isConnected()) {
      throw new Error('WhatsApp not connected');
    }
    lastSyncedAt = new Date().toISOString();
    return {
      lastSyncedAt,
      metadata: { pairedAt },
    };
  };

  const getStatus = (): WhatsAppRuntimeStatus => ({
    connected: isConnected(),
    pairedAt,
    lastSyncedAt,
    lastQr,
    reconnectCount,
    loggedOut,
  });

  return {
    kind: 'whatsapp',
    bootstrap,
    connect,
    disconnect,
    sync,
    getStatus,
    getActiveSocket: () => activeSock,
  };
};

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
  ChatUpdate,
  ConnectionState,
  WAMessage,
  WAMessageUpdate,
  WASocket,
} from 'baileys';
import type { Logger as CoreLogger, ChaiConnector } from '@chai/core';
import type { BaileysSessionAdapter } from './baileys-session-adapter.js';
import {
  buildMessageRow,
  isInterestingJid,
  messageKeyFromWAKey,
} from './message-parser.js';

type BaileysContactLike = Record<string, unknown> & {
  id?: string;
  lid?: string;
  name?: string | null;
  notify?: string | null;
  verifiedName?: string | null;
  username?: string | null;
  phoneNumber?: string | null;
  imgUrl?: string | null;
};

type BaileysChatLike = Record<string, unknown> & {
  id?: string;
  displayName?: string | null;
  name?: string | null;
  username?: string | null;
  conversationTimestamp?: number | LongLike | null;
  lastMessageTimestamp?: number | LongLike | null;
  unreadCount?: number | null;
};

type LongLike = {
  toNumber?: () => number;
  toString?: () => string;
};

export type WhatsAppEvent =
  | { type: 'qr'; payload: { qr: string } }
  | { type: 'connection'; payload: { connection: string; statusCode?: number } }
  | { type: 'pairing-failed'; payload: { reason: string } }
  | { type: 'chat-update'; payload: { remoteJid: string } }
  | { type: 'message-upsert'; payload: { remoteJid: string } }
  | { type: 'message-update'; payload: { remoteJid: string } }
  | { type: 'history-loaded'; payload: { chats: number; messages: number } };

export type WhatsAppConnectorOptions = {
  keystoreDir: string;
  logger: CoreLogger;
  /**
   * Persistence sink for incoming Baileys events. The desktop wraps the
   * local SQLite `WhatsAppStore` via `createDesktopBaileysSessionAdapter`;
   * the worker (Phase 4+) supplies its own server-backed implementation.
   */
  adapter: BaileysSessionAdapter;
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

export type WhatsAppConnector = ChaiConnector & {
  getStatus(): WhatsAppRuntimeStatus;
  getActiveSocket(): WASocket | null;
  /** Stop local activity while preserving the linked-device credentials. */
  dispose(): Promise<void>;
};

export const createWhatsAppConnector = (
  options: WhatsAppConnectorOptions,
): WhatsAppConnector => {
  const sessionDir = path.join(options.keystoreDir, 'whatsapp-session');
  const { logger, adapter, onEvent } = options;

  const internalPino: PinoLogger = P({ level: 'warn' });

  let activeSock: WASocket | null = null;
  let reconnectHandle: NodeJS.Timeout | null = null;
  let reconnectCount = 0;
  let pairedAt: string | null = null;
  let lastSyncedAt: string | null = null;
  let lastQr: string | null = null;
  let loggedOut = false;
  let connecting = false;
  let connectionOpen = false;
  let disposed = false;
  let socketGeneration = 0;
  const pendingEvents = new Set<Promise<void>>();
  const pendingConnections = new Set<ReturnType<ChaiConnector['connect']>>();
  let connectedDeferred: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;

  const rejectPendingConnection = (error: Error) => {
    connectedDeferred?.reject(error);
    connectedDeferred = null;
  };

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

  const normalizeUserJid = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return jidNormalizedUser(trimmed) || trimmed;
    } catch {
      return trimmed;
    }
  };

  const persistJidMapping = async (
    lidValue: unknown,
    pnValue: unknown,
  ): Promise<void> => {
    const lid = normalizeUserJid(lidValue);
    const pn = normalizeUserJid(pnValue);
    if (!lid || !pn) return;
    await adapter.upsertJidMapping(lid, pn);
    await adapter.upsertJidMapping(pn, lid);
  };

  const persistContact = async (
    contact: BaileysContactLike,
  ): Promise<void> => {
    const jid = normalizeUserJid(contact.id);
    if (!jid) return;

    const lid =
      normalizeUserJid(contact.lid) || (jid.endsWith('@lid') ? jid : null);
    const phoneNumber =
      normalizeUserJid(contact.phoneNumber) ||
      (jid.endsWith('@s.whatsapp.net') ? jid : null);

    await persistJidMapping(lid, phoneNumber);
    await adapter.upsertContact({
      jid,
      name: contact.name ?? null,
      notify: contact.notify ?? null,
      verifiedName: contact.verifiedName ?? null,
      username: contact.username ?? null,
      phoneNumber,
      imgUrl: contact.imgUrl ?? null,
    });
  };

  const numberFromLongLike = (value: unknown): number => {
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object') {
      const longLike = value as LongLike;
      if (typeof longLike.toNumber === 'function') return longLike.toNumber();
      if (typeof longLike.toString === 'function') {
        return Number(longLike.toString());
      }
    }
    return Number(value || 0);
  };

  const providerUnreadCount = (
    value: unknown,
  ): number | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.trunc(parsed);
  };

  const persistChat = async (
    chat: BaileysChatLike,
    options: { syncUnread?: boolean } = { syncUnread: true },
  ): Promise<void> => {
    if (!chat.id) return;
    const rawUnread = providerUnreadCount(chat.unreadCount);
    await adapter.upsertChat({
      jid: chat.id,
      name: chat.displayName || chat.name || chat.username || null,
      isGroup: isJidGroup(chat.id) ?? false,
      lastMessageTs: numberFromLongLike(
        chat.conversationTimestamp || chat.lastMessageTimestamp || 0,
      ),
      unread:
        options.syncUnread === false ||
        rawUnread === undefined ||
        rawUnread === null
          ? undefined
          : Math.max(0, rawUnread),
    });
  };

  const applyProviderUnreadUpdate = async (
    jid: string,
    value: unknown,
  ): Promise<void> => {
    const unread = providerUnreadCount(value);
    if (unread === undefined || unread === null) return;
    if (unread === 0) {
      await adapter.markChatRead(jid);
    } else if (unread > 0) {
      await adapter.incrementChatUnread(jid, unread);
    } else {
      await adapter.markChatUnread(jid);
    }
  };

  const cancelReconnect = () => {
    if (reconnectHandle) {
      clearTimeout(reconnectHandle);
      reconnectHandle = null;
    }
  };

  const scheduleReconnect = () => {
    cancelReconnect();
    if (disposed) return;
    reconnectCount += 1;
    const delay = Math.min(3_000 * 2 ** Math.min(reconnectCount, 5), 30_000);
    logger.info('whatsapp reconnect scheduled', { delay, reconnectCount });

    reconnectHandle = setTimeout(() => {
      void start().catch((error) => {
        logger.error('whatsapp reconnect failed', { error: String(error) });
      });
    }, delay);
  };

  const teardownSocket = (closeSocket = true) => {
    // Invalidate in-flight startup and queued events before ending the socket:
    // Baileys may emit a close event as a consequence of end().
    socketGeneration += 1;
    connecting = false;
    connectionOpen = false;
    const socket = activeSock;
    activeSock = null;
    if (!socket || !closeSocket) return;
    try {
      socket.end?.(undefined);
    } catch (error) {
      logger.warn('whatsapp socket end failed', { error: String(error) });
    }
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
      connectionOpen = true;
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
    if (disposed) return;
    if (connecting) return;
    connecting = true;
    const generation = ++socketGeneration;
    const isCurrentStart = () => !disposed && socketGeneration === generation;
    ensureSessionDir();

    let state: Awaited<ReturnType<typeof useMultiFileAuthState>>['state'];
    let saveCreds: Awaited<ReturnType<typeof useMultiFileAuthState>>['saveCreds'];
    let version: Awaited<ReturnType<typeof fetchLatestBaileysVersion>>['version'];
    try {
      ({ state, saveCreds } = await useMultiFileAuthState(sessionDir));
      if (!isCurrentStart()) return;
      ({ version } = await fetchLatestBaileysVersion());
      if (!isCurrentStart()) return;
    } catch (error) {
      if (isCurrentStart()) connecting = false;
      throw error;
    }

    const sock = makeWASocket({
      version,
      logger: internalPino,
      browser: Browsers.macOS('Chai'),
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
    const isCurrentSocket = () => isCurrentStart() && activeSock === sock;

    sock.ev.process((events) => {
      if (!isCurrentSocket()) return;
      const task = (async () => {
        if (events['creds.update']) {
          await saveCreds();
        }
        if (!isCurrentSocket()) return;

        if (events['connection.update']) {
          handleConnectionUpdate(
            events['connection.update'] as Partial<ConnectionState>,
            saveCreds,
          );
        }
        if (!isCurrentSocket()) return;

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
            if (!isCurrentSocket()) return;
            await persistJidMapping(mapping.lid, mapping.pn);
          }
          for (const contact of contacts) {
            if (!isCurrentSocket()) return;
            await persistContact(contact);
          }
          for (const chat of chats) {
            if (!isCurrentSocket()) return;
            await persistChat(chat as BaileysChatLike);
          }
          for (const message of messages as WAMessage[]) {
            if (!isCurrentSocket()) return;
            if (!isInterestingJid(message.key?.remoteJid)) continue;
            await adapter.upsertMessage(buildMessageRow(message));
          }
          emit({
            type: 'history-loaded',
            payload: { chats: chats.length, messages: messages.length },
          });
        }
        if (!isCurrentSocket()) return;

        if (events['chats.upsert']) {
          const seen = new Set<string>();
          for (const chat of events['chats.upsert']) {
            if (!isCurrentSocket()) return;
            if (!chat.id) continue;
            await persistChat(chat as unknown as BaileysChatLike);
            seen.add(chat.id);
          }
          for (const remoteJid of seen) {
            emit({ type: 'chat-update', payload: { remoteJid } });
          }
        }
        if (!isCurrentSocket()) return;

        if (events['chats.update']) {
          const seen = new Set<string>();
          for (const chat of events['chats.update'] as ChatUpdate[]) {
            if (!isCurrentSocket()) return;
            if (!chat.id) continue;
            await persistChat(chat as BaileysChatLike, { syncUnread: false });
            await applyProviderUnreadUpdate(chat.id, chat.unreadCount);
            seen.add(chat.id);
          }
          for (const remoteJid of seen) {
            emit({ type: 'chat-update', payload: { remoteJid } });
          }
        }
        if (!isCurrentSocket()) return;

        if (events['contacts.upsert']) {
          for (const contact of events['contacts.upsert']) {
            if (!isCurrentSocket()) return;
            await persistContact(contact as BaileysContactLike);
          }
        }
        if (!isCurrentSocket()) return;

        if (events['contacts.update']) {
          for (const contact of events['contacts.update']) {
            if (!isCurrentSocket()) return;
            await persistContact(contact as BaileysContactLike);
          }
        }
        if (!isCurrentSocket()) return;

        if (events['lid-mapping.update']) {
          const mapping = events['lid-mapping.update'] as {
            lid?: string;
            pn?: string;
          };
          await persistJidMapping(mapping.lid, mapping.pn);
        }
        if (!isCurrentSocket()) return;

        if (events['messages.upsert']) {
          const seen = new Set<string>();
          for (const message of events['messages.upsert'].messages as WAMessage[]) {
            if (!isCurrentSocket()) return;
            if (!isInterestingJid(message.key?.remoteJid)) continue;
            const row = buildMessageRow(message);
            await adapter.upsertMessage(row);
            seen.add(row.remoteJid);
          }
          for (const remoteJid of seen) {
            emit({ type: 'message-upsert', payload: { remoteJid } });
          }
        }
        if (!isCurrentSocket()) return;

        if (events['messages.update']) {
          for (const update of events['messages.update'] as WAMessageUpdate[]) {
            if (!isCurrentSocket()) return;
            const key = messageKeyFromWAKey(update.key);
            const existing = await adapter.getMessage(key);
            if (!existing) continue;
            const text =
              update.update.message === null
                ? '[This message was deleted]'
                : (update.update.message as any)?.conversation ||
                  (update.update.message as any)?.extendedTextMessage?.text ||
                  existing.text;
            await adapter.updateMessage(key, {
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
        if (!isCurrentSocket()) return;

        if (events['messages.delete']) {
          const data = events['messages.delete'] as
            | { keys: Array<{ remoteJid?: string; id?: string; fromMe?: boolean; participant?: string }> }
            | { jid: string; all: true };

          if ('all' in data && data.all && data.jid) {
            await adapter.deleteAllMessagesForChat(data.jid);
            return;
          }

          for (const item of (data as { keys: any[] }).keys || []) {
            if (!isCurrentSocket()) return;
            const messageKey = messageKeyFromWAKey(item);
            await adapter.markMessageDeleted(messageKey);
          }
        }
      })();
      pendingEvents.add(task);
      return task.finally(() => pendingEvents.delete(task));
    });
  };

  const start_ = () => start();

  const isConnected = () => connectionOpen && activeSock !== null && !loggedOut;

  const bootstrap: ChaiConnector['bootstrap'] = async () => {
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

  const connectOnce: ChaiConnector['connect'] = async () => {
    if (disposed) throw new Error('WhatsApp connector has been disposed');
    cancelReconnect();
    teardownSocket();
    rejectPendingConnection(new Error('WhatsApp connection was replaced'));
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

    try {
      // Observe cancellation immediately, even while network startup awaits.
      await Promise.all([start_(), completion]);
    } catch (error) {
      rejectPendingConnection(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }

    return {
      metadata: { pairedAt },
    };
  };

  const connect: ChaiConnector['connect'] = () => {
    const task = connectOnce();
    pendingConnections.add(task);
    void task.then(
      () => pendingConnections.delete(task),
      () => pendingConnections.delete(task),
    );
    return task;
  };

  const disconnect: ChaiConnector['disconnect'] = async () => {
    cancelReconnect();
    // Invalidate startup/events before logout can yield to the event loop.
    const socket = activeSock;
    teardownSocket(false);
    rejectPendingConnection(new Error('WhatsApp connection was disconnected'));
    if (socket) {
      try {
        await socket.logout?.().catch(() => {});
      } catch (error) {
        logger.warn('whatsapp logout failed', { error: String(error) });
      } finally {
        try {
          socket.end?.(undefined);
        } catch (error) {
          logger.warn('whatsapp socket end failed', { error: String(error) });
        }
      }
    }
    await Promise.allSettled([...pendingEvents, ...pendingConnections]);
    if (existsSync(sessionDir)) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
    pairedAt = null;
    lastSyncedAt = null;
    loggedOut = false;
    lastQr = null;
  };

  const dispose = async (): Promise<void> => {
    disposed = true;
    cancelReconnect();
    teardownSocket();
    rejectPendingConnection(new Error('WhatsApp connector has been disposed'));
    lastQr = null;
    // The host may close SQLite only after every previously accepted event has
    // finished using its adapter. New/stale socket events are ignored above.
    await Promise.allSettled([...pendingEvents, ...pendingConnections]);
  };

  const sync: ChaiConnector['sync'] = async () => {
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
    getActiveSocket: () => isConnected() ? activeSock : null,
    dispose,
  };
};

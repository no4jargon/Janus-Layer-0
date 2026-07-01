import type { WhatsAppStore } from '@chai/db';
import type { BaileysSessionAdapter } from './baileys-session-adapter.js';

/**
 * Adapts the desktop's local-SQLite `WhatsAppStore` to the
 * `BaileysSessionAdapter` interface. All operations are forwarded
 * directly; the better-sqlite3 store is synchronous, so the Promise-shaped
 * method signatures resolve immediately.
 */
export const createDesktopBaileysSessionAdapter = (
  store: WhatsAppStore,
): BaileysSessionAdapter => ({
  upsertJidMapping: (sourceJid, targetJid) =>
    store.upsertJidMapping(sourceJid, targetJid),
  upsertContact: (input) => {
    store.upsertContact(input);
  },
  upsertChat: (input) => {
    store.upsertChat(input);
  },
  upsertMessage: (input) => {
    store.upsertMessage(input);
  },
  getMessage: (messageKey) => store.getMessage(messageKey),
  updateMessage: (messageKey, patch) => {
    store.updateMessage(messageKey, patch);
  },
  markMessageDeleted: (messageKey) => {
    store.markMessageDeleted(messageKey);
  },
  deleteAllMessagesForChat: (remoteJid) => {
    store.deleteAllMessagesForChat(remoteJid);
  },
});

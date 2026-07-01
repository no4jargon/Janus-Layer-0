import type {
  WaChatRecord,
  WaContactRecord,
  WaMessageRecord,
} from '@chai/db';

/** Partial chat upsert payload — only `jid` is required. */
export type WaChatUpsert = Partial<WaChatRecord> & { jid: string };

/** Partial contact upsert payload — only `jid` is required. */
export type WaContactUpsert = Partial<WaContactRecord> & { jid: string };

/**
 * Subset of message fields the connector mutates after the initial upsert
 * (e.g., a `messages.update` event flipping `isDeleted` and rewriting text).
 */
export type WaMessagePatch = Partial<
  Pick<
    WaMessageRecord,
    | 'text'
    | 'status'
    | 'mediaType'
    | 'mediaMime'
    | 'mediaPath'
    | 'mediaThumbDataUri'
    | 'rawContent'
    | 'isDeleted'
  >
>;

/**
 * Persistence surface the Baileys integration in `whatsapp-connector.ts`
 * needs from the host application.
 *
 * Today the only implementation is `createDesktopBaileysSessionAdapter`,
 * which wraps the local-SQLite `WhatsAppStore`. The forthcoming worker
 * adapter (Phase 4) will satisfy the same interface against the cloud
 * control plane so the connector code can be lifted into `chai-worker`
 * unchanged.
 *
 * Methods are typed `void | Promise<void>` so a desktop implementation
 * built on the synchronous `better-sqlite3` store doesn't pay the Promise
 * overhead, while an async (HTTP-backed) worker implementation remains
 * compatible. Callers in the connector `await` everything regardless.
 */
export interface BaileysSessionAdapter {
  upsertJidMapping(
    sourceJid: string,
    targetJid: string,
  ): void | Promise<void>;
  upsertContact(input: WaContactUpsert): void | Promise<void>;
  upsertChat(input: WaChatUpsert): void | Promise<void>;
  upsertMessage(input: WaMessageRecord): void | Promise<void>;
  getMessage(
    messageKey: string,
  ): WaMessageRecord | null | Promise<WaMessageRecord | null>;
  updateMessage(
    messageKey: string,
    patch: WaMessagePatch,
  ): void | Promise<void>;
  markMessageDeleted(messageKey: string): void | Promise<void>;
  deleteAllMessagesForChat(remoteJid: string): void | Promise<void>;
}

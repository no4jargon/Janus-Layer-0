import {
  getContentType,
  isJidGroup,
  isJidStatusBroadcast,
  normalizeMessageContent,
} from 'baileys';
import type { WAMessage, WAMessageKey } from 'baileys';
import type { WaMessageRecord } from '@janus/db';
import { mkMessageKey } from '@janus/db';

export const isInterestingJid = (jid: string | null | undefined): boolean => {
  if (!jid) return false;
  return !isJidStatusBroadcast(jid);
};

export const parseTextFromMessage = (message: WAMessage): string => {
  const content = normalizeMessageContent(message.message) as
    | Record<string, any>
    | undefined;
  if (!content) return '[Message]';

  const msgType = getContentType(content as any) as string | undefined;
  if (msgType === 'conversation') return content.conversation || '[Message]';
  if (msgType === 'extendedTextMessage') {
    return content.extendedTextMessage?.text || '[Message]';
  }
  if (msgType === 'imageMessage') {
    return content.imageMessage?.caption || '[Image]';
  }
  if (msgType === 'videoMessage') {
    return content.videoMessage?.caption || '[Video]';
  }
  if (msgType === 'audioMessage') return '[Audio]';
  if (msgType === 'documentMessage') {
    return content.documentMessage?.fileName
      ? `[Document] ${content.documentMessage.fileName}`
      : '[Document]';
  }
  if (msgType === 'stickerMessage') return '[Sticker]';
  if (msgType === 'locationMessage') return '[Location]';
  if (msgType === 'liveLocationMessage') return '[Live location]';
  if (msgType === 'contactMessage') return '[Contact]';
  if (msgType === 'pollCreationMessage') {
    return content.pollCreationMessage?.name || '[Poll]';
  }
  if (msgType === 'reactionMessage') return '[Reaction]';
  if (msgType === 'protocolMessage') return '[Protocol message]';
  return '[Message]';
};

export const getMessageTimestamp = (message: WAMessage): number => {
  const raw = Number(message.messageTimestamp || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : Math.floor(Date.now() / 1000);
};

export const buildMessageRow = (message: WAMessage): WaMessageRecord => {
  const content = normalizeMessageContent(message.message);
  const messageType =
    (getContentType(content as any) as string | undefined) ?? null;
  const key = message.key;
  const senderJid = key.fromMe
    ? key.remoteJid || null
    : key.participant || key.remoteJid || null;

  return {
    messageKey: mkMessageKey(key),
    remoteJid: key.remoteJid || '',
    keyId: key.id || '',
    fromMe: !!key.fromMe,
    participant: key.participant || null,
    senderJid,
    messageTimestamp: getMessageTimestamp(message),
    messageType,
    text: parseTextFromMessage(message),
    status: (message as { status?: number | null }).status ?? null,
    isDeleted: false,
    mediaType: null,
    mediaMime: null,
    mediaPath: null,
    mediaThumbDataUri: null,
    rawContent: JSON.stringify(message),
  };
};

export const isGroup = (jid: string): boolean => isJidGroup(jid) ?? false;

export const messageKeyFromWAKey = (key: WAMessageKey): string =>
  mkMessageKey(key);

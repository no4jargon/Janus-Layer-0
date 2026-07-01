import type { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

export type EmailAccountRecord = {
  id: string;
  userId: string;
  provider: string;
  emailAddress: string;
  oauthTokenRef: string | null;
  syncCursor: string | null;
  lastSyncAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type EmailThreadRecord = {
  id: string;
  userId: string;
  accountId: string;
  providerThreadId: string;
  derivedThreadKey: string | null;
  subject: string;
  participantSummary: string;
  lastMessageAt: number;
  lastCleanedPreview: string;
  unreadCount: number;
  hasAttachments: boolean;
  sourceLabelsJson: string | null;
  createdAt: number;
  updatedAt: number;
};

export type EmailMessageRecord = {
  id: string;
  userId: string;
  accountId: string;
  threadId: string;
  providerMessageId: string;
  gmailHistoryId: string | null;
  senderName: string | null;
  senderEmail: string;
  toJson: string;
  ccJson: string;
  sentAt: number;
  direction: 'incoming' | 'outgoing';
  snippet: string | null;
  bodyRawHtml: string | null;
  bodyRawText: string | null;
  bodyCleanText: string | null;
  hasAttachments: 0 | 1;
  isHiddenAutomated: 0 | 1;
  createdAt: number;
  updatedAt: number;
};

export type EmailAttachmentRecord = {
  id: string;
  userId: string;
  accountId: string;
  messageId: string;
  providerMessageId: string;
  providerAttachmentId: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  cachedLocalPath: string | null;
  cachedAt: number | null;
  createdAt: number;
};

export type EmailOutboxStatus = 'queued' | 'sending' | 'sent' | 'failed';

export type EmailOutboxMessageRecord = {
  id: string;
  clientRequestId: string;
  accountId: string;
  threadId: string | null;
  providerThreadId: string | null;
  toJson: string;
  ccJson: string;
  subject: string;
  textBody: string;
  htmlBody: string | null;
  status: EmailOutboxStatus;
  errorCode: string | null;
  errorMessage: string | null;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type WaContactRecord = {
  jid: string;
  name: string | null;
  notify: string | null;
  verifiedName: string | null;
  username: string | null;
  phoneNumber: string | null;
  imgUrl: string | null;
  updatedAt: number;
};

export type WaChatRecord = {
  jid: string;
  name: string | null;
  isGroup: boolean;
  lastMessageTs: number;
  lastMessageText: string;
  lastMessageType: string;
  unread: number;
};

export type WaMessageRecord = {
  messageKey: string;
  remoteJid: string;
  keyId: string;
  fromMe: boolean;
  participant: string | null;
  senderJid: string | null;
  messageTimestamp: number;
  messageType: string | null;
  text: string;
  status: number | null;
  isDeleted: boolean;
  mediaType: string | null;
  mediaMime: string | null;
  mediaPath: string | null;
  mediaThumbDataUri: string | null;
  rawContent: string | null;
  replyToStanzaId: string | null;
  replyToParticipant: string | null;
};

export type WaMessageWithReply = WaMessageRecord & {
  replyToText: string | null;
  replyToSenderJid: string | null;
};

export type WaOutboxStatus = 'queued' | 'sending' | 'sent' | 'failed';

export type WaOutboxMessageRecord = {
  id: string;
  clientRequestId: string;
  chatJid: string;
  text: string;
  quotedMessageKey: string | null;
  status: WaOutboxStatus;
  errorCode: string | null;
  errorMessage: string | null;
  waMessageKey: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ConnectorRow = {
  connector: string;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
};

export type ClusterMemberSource = 'gmail' | 'whatsapp';

export type ClusterRecord = {
  id: string;
  name: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  memberCount: number;
};

export type ClusterMemberRecord = {
  clusterId: string;
  source: ClusterMemberSource;
  sourceRef: string;
  addedAt: number;
};

export type AiOutputRecord = {
  id: string;
  clusterId: string | null;
  kind: string;
  inputSummary: string | null;
  outputText: string;
  model: string | null;
  createdAt: number;
};

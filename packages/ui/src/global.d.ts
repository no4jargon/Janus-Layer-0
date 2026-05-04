export {};

type RuntimeMode = 'development' | 'production';
type ConnectorKind = 'gmail' | 'whatsapp';
type ConnectorStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'error';

type ConnectorSnapshot = {
  connector: ConnectorKind;
  status: ConnectorStatus;
  lastError: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
  metadata?: Record<string, unknown> | null;
};

type SerializedMigrationFailure = {
  failedMigration: string;
  message: string;
  backupPath: string | null;
};

type JanusRuntimeSnapshot = {
  appVersion: string;
  mode: RuntimeMode;
  phase: string;
  paths: {
    baseDir: string;
    dbPath: string;
    logsDir: string;
  };
  settings: {
    onboardingCompleted: boolean;
    theme: 'system' | 'light' | 'dark';
    llmModelPath: string | null;
    workStartTime: string | null;
    lastOpenedAt: number | null;
  };
  previousLastOpenedAt: number | null;
  connectors: ConnectorSnapshot[];
  migrationFailure: SerializedMigrationFailure | null;
};

type EmailThreadSummary = {
  id: string;
  subject: string;
  participantSummary: string;
  lastCleanedPreview: string;
  lastMessageAt: number;
  unreadCount: number;
  hasAttachments: boolean;
};

type EmailAttachmentSummary = {
  id: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  cachedLocalPath: string | null;
};

type EmailMessageSummary = {
  id: string;
  threadId: string;
  senderName: string | null;
  senderEmail: string;
  toJson: string;
  ccJson: string;
  sentAt: number;
  direction: 'incoming' | 'outgoing';
  snippet: string | null;
  bodyCleanText: string | null;
  hasAttachments: 0 | 1;
  attachments?: EmailAttachmentSummary[];
};

type WaChatSummary = {
  jid: string;
  name: string | null;
  isGroup: boolean;
  lastMessageTs: number;
  lastMessageText: string;
  lastMessageType: string;
  unread: number;
};

type WaMessageSummary = {
  messageKey: string;
  remoteJid: string;
  participant: string | null;
  senderJid: string | null;
  senderName?: string | null;
  fromMe: boolean;
  text: string;
  isDeleted: boolean;
  messageTimestamp: number;
};

type WaEvent =
  | { type: 'qr'; payload: { qr: string } }
  | { type: 'connection'; payload: { connection: string; statusCode?: number } }
  | { type: 'pairing-failed'; payload: { reason: string } }
  | { type: 'message-upsert'; payload: { remoteJid: string } }
  | { type: 'message-update'; payload: { remoteJid: string } }
  | { type: 'history-loaded'; payload: { chats: number; messages: number } };

type ConnectorEvent = {
  connector: ConnectorKind;
  type: 'sync.started' | 'sync.completed' | 'sync.failed';
  error?: string;
};

type GmailEvent = {
  type: 'send.completed';
  payload: unknown;
};

type ClusterRecord = {
  id: string;
  name: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  memberCount: number;
};

type ClusterMemberInput = {
  source: 'gmail' | 'whatsapp';
  sourceRef: string;
};

declare global {
  type UpdateCheckResult =
    | {
        kind: 'up-to-date';
        currentVersion: string;
        latestVersion: string;
        channel: 'beta' | 'stable';
      }
    | {
        kind: 'optional';
        currentVersion: string;
        latestVersion: string;
        channel: 'beta' | 'stable';
        downloadUrl?: string;
        releaseNotesUrl?: string;
      }
    | {
        kind: 'required';
        currentVersion: string;
        latestVersion: string;
        channel: 'beta' | 'stable';
        minSupportedVersion: string;
        downloadUrl?: string;
        releaseNotesUrl?: string;
      }
    | { kind: 'unconfigured'; message: string }
    | { kind: 'error'; message: string };

  type UpdateEvent =
    | { kind: 'check-result'; info: UpdateCheckResult }
    | { kind: 'checking' }
    | {
        kind: 'available';
        version?: string;
        releaseDate?: string;
        releaseNotes?: string;
      }
    | { kind: 'not-available'; version?: string }
    | {
        kind: 'progress';
        percent?: number;
        bytesPerSecond?: number;
        transferred?: number;
        total?: number;
      }
    | { kind: 'downloaded'; version?: string }
    | { kind: 'error'; message: string };

  interface Window {
    janusMeta?: {
      platform: string;
      versions: Record<string, string>;
    };
    janusApi?: {
      getRuntimeState: () => Promise<JanusRuntimeSnapshot>;
      updateSettings: (
        patch: Partial<JanusRuntimeSnapshot['settings']>,
      ) => Promise<JanusRuntimeSnapshot>;
      connectConnector: (
        connector: ConnectorKind,
      ) => Promise<JanusRuntimeSnapshot>;
      disconnectConnector: (
        connector: ConnectorKind,
      ) => Promise<JanusRuntimeSnapshot>;
      syncConnector: (
        connector: ConnectorKind,
      ) => Promise<JanusRuntimeSnapshot>;
      gmail: {
        listThreads: () => Promise<EmailThreadSummary[]>;
        getThread: (
          threadId: string,
        ) => Promise<{
          thread: EmailThreadSummary;
          messages: EmailMessageSummary[];
        } | null>;
        sendEmail: (payload: {
          clientRequestId: string;
          threadId?: string | null;
          to?: Array<{ name?: string; email: string }>;
          cc?: Array<{ name?: string; email: string }>;
          subject?: string;
          textBody: string;
          htmlBody?: string | null;
        }) => Promise<unknown>;
        downloadAttachment: (
          attachmentId: string,
        ) => Promise<{ saved: boolean; savedPath?: string }>;
        openAttachment: (attachmentId: string) => Promise<{ opened: boolean }>;
      };
      whatsapp: {
        listChats: () => Promise<WaChatSummary[]>;
        getChat: (jid: string) => Promise<WaMessageSummary[]>;
        sendText: (payload: {
          jid: string;
          text: string;
          quotedMessageKey?: string | null;
          clientRequestId: string;
        }) => Promise<unknown>;
        getStatus: () => Promise<{
          connected: boolean;
          pairedAt: string | null;
          lastSyncedAt: string | null;
          lastQr: string | null;
          reconnectCount: number;
          loggedOut: boolean;
        } | null>;
      };
      cluster: {
        list: () => Promise<{
          clusters: ClusterRecord[];
          clusterMap: Record<string, string>;
        }>;
        create: (input: {
          name: string;
          color?: string | null;
          members?: ClusterMemberInput[];
        }) => Promise<{
          cluster: ClusterRecord;
          clusterMap: Record<string, string>;
        }>;
        rename: (input: {
          id: string;
          name: string;
          color?: string | null;
        }) => Promise<ClusterRecord | null>;
        remove: (
          id: string,
        ) => Promise<{ clusterMap: Record<string, string> }>;
        addMembers: (input: {
          clusterId: string;
          members: ClusterMemberInput[];
        }) => Promise<{
          cluster: ClusterRecord | null;
          clusterMap: Record<string, string>;
        }>;
        removeMember: (input: {
          clusterId: string;
          source: 'gmail' | 'whatsapp';
          sourceRef: string;
        }) => Promise<{ clusterMap: Record<string, string> }>;
        listMembers: (clusterId: string) => Promise<
          Array<{
            clusterId: string;
            source: 'gmail' | 'whatsapp';
            sourceRef: string;
            addedAt: number;
          }>
        >;
        clearAll: () => Promise<{
          clusterMap: Record<string, string>;
          clusters: ClusterRecord[];
        }>;
      };
      ai: {
        extractWorkflow: (text: string) => Promise<string>;
        chooseModelFile: () => Promise<
          { canceled: true } | { canceled: false; path: string }
        >;
        saveOutput: (input: {
          clusterId?: string | null;
          kind: string;
          inputSummary?: string | null;
          outputText: string;
          model?: string | null;
        }) => Promise<unknown>;
        listOutputs: (clusterId: string) => Promise<unknown[]>;
      };
      migration: {
        retry: () => Promise<JanusRuntimeSnapshot>;
      };
      diagnostics: {
        export: () => Promise<{ saved: boolean; savedPath?: string }>;
      };
      update: {
        check: (input?: {
          feedUrl?: string;
          channel?: 'beta' | 'stable';
        }) => Promise<UpdateCheckResult>;
        download: () => Promise<
          | { kind: 'started' | 'skipped' | 'error'; message?: string }
        >;
        install: () => Promise<{ kind: 'installing' | 'skipped'; message?: string }>;
        lastInfo: () => Promise<UpdateCheckResult | null>;
      };
      events: {
        onRuntimeSnapshot: (
          handler: (snapshot: JanusRuntimeSnapshot) => void,
        ) => () => void;
        onWhatsAppEvent: (handler: (event: WaEvent) => void) => () => void;
        onConnectorEvent: (
          handler: (event: ConnectorEvent) => void,
        ) => () => void;
        onGmailEvent: (handler: (event: GmailEvent) => void) => () => void;
        onUpdateEvent: (handler: (event: UpdateEvent) => void) => () => void;
        onModelDownload: (
          handler: (status: {
            transferredBytes: number;
            totalBytes: number;
          }) => void,
        ) => () => void;
      };
    };
  }
}

export type SourceType = 'whatsapp' | 'gmail';

export type RuntimeMode = 'development' | 'production';

export type ConnectorKind = 'gmail' | 'whatsapp';

export type ConnectorStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'error';

export type ConnectorSnapshot = {
  connector: ConnectorKind;
  status: ConnectorStatus;
  lastError: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
  metadata?: Record<string, unknown> | null;
};

export type WorkspaceSettings = {
  onboardingCompleted: boolean;
  theme: 'system' | 'light' | 'dark';
};

export type RuntimeSnapshot = {
  appVersion: string;
  mode: RuntimeMode;
  phase: string;
  paths: {
    baseDir: string;
    dbPath: string;
    logsDir: string;
  };
  settings: WorkspaceSettings;
  connectors: ConnectorSnapshot[];
};

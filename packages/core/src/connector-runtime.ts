import type { ConnectorStateStore } from '@chai/db';
import type { Logger } from './logger.js';

export type ConnectorKind = 'gmail' | 'whatsapp';

export type ConnectorStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'error';

export type ConnectorMetadata = Record<string, unknown> | null;

export type ConnectorSnapshot = {
  connector: ConnectorKind;
  status: ConnectorStatus;
  lastError: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
  metadata: ConnectorMetadata;
};

export interface ChaiConnector {
  readonly kind: ConnectorKind;
  bootstrap?(): Promise<{
    connected: boolean;
    metadata?: ConnectorMetadata;
    lastSyncedAt?: string | null;
  }>;
  connect(): Promise<{ metadata?: ConnectorMetadata }>;
  disconnect(): Promise<void>;
  sync(): Promise<{
    lastSyncedAt?: string | null;
    metadata?: ConnectorMetadata;
  }>;
}

const KINDS: ConnectorKind[] = ['gmail', 'whatsapp'];

const nowIso = () => new Date().toISOString();

const normalizeStatus = (value: string): ConnectorStatus => {
  switch (value) {
    case 'disconnected':
    case 'connecting':
    case 'connected':
    case 'syncing':
    case 'error':
      return value;
    default:
      return 'disconnected';
  }
};

export type ConnectorRuntimeInput = {
  store: ConnectorStateStore;
  logger: Logger;
  connectors: Partial<Record<ConnectorKind, ChaiConnector>>;
};

export const createConnectorRuntime = (input: ConnectorRuntimeInput) => {
  const state = new Map<ConnectorKind, ConnectorSnapshot>();

  const seedDefaults = () => {
    for (const kind of KINDS) {
      if (!state.has(kind)) {
        state.set(kind, {
          connector: kind,
          status: 'disconnected',
          lastError: null,
          lastSyncedAt: null,
          updatedAt: nowIso(),
          metadata: null,
        });
      }
    }
  };

  const loadFromStore = () => {
    for (const row of input.store.list()) {
      if (!KINDS.includes(row.connector as ConnectorKind)) continue;
      state.set(row.connector as ConnectorKind, {
        connector: row.connector as ConnectorKind,
        status: normalizeStatus(row.status),
        lastError: row.lastError,
        lastSyncedAt: row.lastSyncedAt,
        updatedAt: row.updatedAt,
        metadata: null,
      });
    }
    seedDefaults();
  };

  const persist = (snapshot: ConnectorSnapshot) => {
    input.store.upsert({
      connector: snapshot.connector,
      status: snapshot.status,
      lastError: snapshot.lastError,
      lastSyncedAt: snapshot.lastSyncedAt,
      updatedAt: snapshot.updatedAt,
    });
  };

  const update = (
    kind: ConnectorKind,
    patch: Partial<Omit<ConnectorSnapshot, 'connector' | 'updatedAt'>>,
  ): ConnectorSnapshot => {
    const current = state.get(kind);
    if (!current) {
      throw new Error(`Unknown connector: ${kind}`);
    }
    const next: ConnectorSnapshot = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    };
    state.set(kind, next);
    persist(next);
    return next;
  };

  const requireConnector = (kind: ConnectorKind): ChaiConnector => {
    const connector = input.connectors[kind];
    if (!connector) {
      throw new Error(`Connector not registered: ${kind}`);
    }
    return connector;
  };

  const list = (): ConnectorSnapshot[] =>
    KINDS.map((kind) => state.get(kind)!).filter((value): value is ConnectorSnapshot => !!value);

  const bootstrap = async () => {
    for (const kind of KINDS) {
      const connector = input.connectors[kind];
      if (!connector?.bootstrap) continue;
      try {
        const result = await connector.bootstrap();
        if (result.connected) {
          update(kind, {
            status: 'connected',
            lastError: null,
            lastSyncedAt: result.lastSyncedAt ?? state.get(kind)?.lastSyncedAt ?? null,
            metadata: result.metadata ?? null,
          });
        }
      } catch (error) {
        input.logger.warn('connector bootstrap failed', {
          connector: kind,
          error: String(error),
        });
      }
    }
  };

  const connect = async (kind: ConnectorKind): Promise<ConnectorSnapshot> => {
    const connector = requireConnector(kind);
    input.logger.info('connector connect requested', { connector: kind });
    update(kind, { status: 'connecting', lastError: null });

    try {
      const result = await connector.connect();
      return update(kind, {
        status: 'connected',
        lastError: null,
        lastSyncedAt: nowIso(),
        metadata: result.metadata ?? null,
      });
    } catch (error) {
      input.logger.error('connector connect failed', {
        connector: kind,
        error: String(error),
      });
      return update(kind, {
        status: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const disconnect = async (kind: ConnectorKind): Promise<ConnectorSnapshot> => {
    const connector = requireConnector(kind);
    input.logger.info('connector disconnect requested', { connector: kind });

    try {
      await connector.disconnect();
      return update(kind, {
        status: 'disconnected',
        lastError: null,
        lastSyncedAt: null,
        metadata: null,
      });
    } catch (error) {
      input.logger.error('connector disconnect failed', {
        connector: kind,
        error: String(error),
      });
      return update(kind, {
        status: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const syncNow = async (kind: ConnectorKind): Promise<ConnectorSnapshot> => {
    const connector = requireConnector(kind);
    input.logger.info('connector sync requested', { connector: kind });
    update(kind, { status: 'syncing', lastError: null });

    try {
      const result = await connector.sync();
      return update(kind, {
        status: 'connected',
        lastError: null,
        lastSyncedAt: result.lastSyncedAt ?? nowIso(),
        metadata: result.metadata ?? state.get(kind)?.metadata ?? null,
      });
    } catch (error) {
      input.logger.error('connector sync failed', {
        connector: kind,
        error: String(error),
      });
      return update(kind, {
        status: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  };

  loadFromStore();

  return {
    list,
    bootstrap,
    connect,
    disconnect,
    syncNow,
  };
};

export type ConnectorRuntime = ReturnType<typeof createConnectorRuntime>;

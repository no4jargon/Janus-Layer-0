import {
  bootstrapDatabase,
  createConnectorStateStore,
  type Database,
  type MigrationFailure,
} from '@janus/db';
import {
  createConnectorRuntime,
  type ConnectorKind,
  type ConnectorRuntime,
  type ConnectorSnapshot,
  type JanusConnector,
} from './connector-runtime.js';
import {
  ensureAppDataPaths,
  resolveAppDataPaths,
  type AppDataPaths,
  type RuntimeMode,
} from './data-paths.js';
import { createFileLogger, type Logger } from './logger.js';
import {
  createSettingsStore,
  type SettingsStore,
  type JanusSettings,
} from './settings-store.js';

export type CreateRuntimeInput = {
  mode: RuntimeMode;
  repoRoot: string;
  userDataPath: string;
  migrationsDir: string;
  appVersion: string;
  buildConnectors: (context: BuildConnectorsContext) => Partial<
    Record<ConnectorKind, JanusConnector>
  >;
};

export type BuildConnectorsContext = {
  db: Database;
  paths: AppDataPaths;
  logger: Logger;
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
  settings: JanusSettings;
  previousLastOpenedAt: number | null;
  connectors: ConnectorSnapshot[];
  migrationFailure: SerializedMigrationFailure | null;
};

export type SerializedMigrationFailure = {
  failedMigration: string;
  message: string;
  backupPath: string | null;
};

export type JanusRuntime = {
  logger: Logger;
  paths: AppDataPaths;
  db: Database;
  settingsStore: SettingsStore;
  connectorRuntime: ConnectorRuntime;
  migrationFailure: MigrationFailure | null;
  getSnapshot: () => RuntimeSnapshot;
  close: () => void;
};

const PHASE_LABEL = 'phase-1-and-2-foundation';

const serializeMigrationFailure = (
  failure: MigrationFailure | null,
): SerializedMigrationFailure | null =>
  failure
    ? {
        failedMigration: failure.failedMigration,
        message: failure.error.message,
        backupPath: failure.backupPath,
      }
    : null;

export const createJanusRuntime = (
  input: CreateRuntimeInput,
): JanusRuntime => {
  const paths = resolveAppDataPaths({
    mode: input.mode,
    repoRoot: input.repoRoot,
    userDataPath: input.userDataPath,
  });
  ensureAppDataPaths(paths);

  const logger = createFileLogger({ logsDir: paths.logsDir });

  const { db, appliedMigrations, migrationFailure } = bootstrapDatabase({
    dbPath: paths.dbPath,
    migrationsDir: input.migrationsDir,
    logger,
  });

  if (appliedMigrations.length > 0) {
    logger.info('migrations applied at startup', { appliedMigrations });
  }

  const settingsStore = createSettingsStore({ baseDir: paths.baseDir, logger });
  const previousLastOpenedAt = settingsStore.read().lastOpenedAt;
  settingsStore.write({ lastOpenedAt: Date.now() });
  const connectorStore = createConnectorStateStore(db);

  const connectors = input.buildConnectors({ db, paths, logger });

  const connectorRuntime = createConnectorRuntime({
    store: connectorStore,
    logger,
    connectors,
  });

  if (!migrationFailure) {
    connectorRuntime.bootstrap().catch((error) => {
      logger.warn('connector runtime bootstrap failed', { error: String(error) });
    });
  }

  logger.info('janus runtime initialized', {
    mode: input.mode,
    appVersion: input.appVersion,
    dbPath: paths.dbPath,
    logFilePath: logger.filePath,
    migrationFailure: migrationFailure?.failedMigration ?? null,
  });

  const getSnapshot = (): RuntimeSnapshot => ({
    appVersion: input.appVersion,
    mode: input.mode,
    phase: PHASE_LABEL,
    paths: {
      baseDir: paths.baseDir,
      dbPath: paths.dbPath,
      logsDir: paths.logsDir,
    },
    settings: settingsStore.read(),
    previousLastOpenedAt,
    connectors: connectorRuntime.list(),
    migrationFailure: serializeMigrationFailure(migrationFailure),
  });

  return {
    logger,
    paths,
    db,
    settingsStore,
    connectorRuntime,
    migrationFailure,
    getSnapshot,
    close: () => {
      try {
        db.close();
      } catch (error) {
        logger.warn('db close failed', { error: String(error) });
      }
      logger.info('janus runtime closed');
    },
  };
};

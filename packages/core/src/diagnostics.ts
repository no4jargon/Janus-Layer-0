import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import type { Database } from '@janus/db';
import type { AppDataPaths, RuntimeMode } from './data-paths.js';
import type { WorkspaceSettings } from './settings-store.js';

const SETTING_REDACTIONS: Array<keyof WorkspaceSettings> = [];

const sanitizeSettings = (settings: WorkspaceSettings): WorkspaceSettings => {
  const copy = { ...settings };
  for (const key of SETTING_REDACTIONS) {
    (copy as Record<string, unknown>)[key as string] = null;
  }
  return copy;
};

export type DiagnosticsBundle = {
  generatedAt: string;
  app: {
    version: string;
    mode: RuntimeMode;
    platform: string;
    nodeVersion: string;
  };
  paths: AppDataPaths;
  settings: WorkspaceSettings;
  schemaMigrations: Array<{ id: string; appliedAt: string }>;
  connectors: Array<{
    connector: string;
    status: string;
    lastError: string | null;
    lastSyncedAt: string | null;
    updatedAt: string;
  }>;
  backups: Array<{ filename: string; sizeBytes: number; createdAtMs: number }>;
  logTail: string[];
};

export type BuildDiagnosticsInput = {
  appVersion: string;
  mode: RuntimeMode;
  paths: AppDataPaths;
  settings: WorkspaceSettings;
  db: Database;
  logTailLines?: number;
};

const readSchemaMigrations = (
  db: Database,
): Array<{ id: string; appliedAt: string }> => {
  try {
    const rows = db
      .prepare('SELECT id, applied_at FROM schema_migrations ORDER BY id ASC')
      .all() as Array<{ id: string; applied_at: string }>;
    return rows.map((row) => ({ id: row.id, appliedAt: row.applied_at }));
  } catch {
    return [];
  }
};

const readConnectorState = (
  db: Database,
): DiagnosticsBundle['connectors'] => {
  try {
    const rows = db
      .prepare(
        'SELECT connector, status, last_error, last_synced_at, updated_at FROM connector_state',
      )
      .all() as Array<{
      connector: string;
      status: string;
      last_error: string | null;
      last_synced_at: string | null;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      connector: row.connector,
      status: row.status,
      lastError: row.last_error,
      lastSyncedAt: row.last_synced_at,
      updatedAt: row.updated_at,
    }));
  } catch {
    return [];
  }
};

const readBackups = (paths: AppDataPaths): DiagnosticsBundle['backups'] => {
  const backupDir = path.join(paths.baseDir, 'backups');
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((name) => name.endsWith('.db'))
    .map((filename) => {
      const filePath = path.join(backupDir, filename);
      const stats = statSync(filePath);
      return {
        filename,
        sizeBytes: stats.size,
        createdAtMs: stats.mtimeMs,
      };
    })
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
};

const readLogTail = (
  paths: AppDataPaths,
  limit: number,
): string[] => {
  const logPath = path.join(paths.logsDir, 'app.log');
  if (!existsSync(logPath)) return [];
  try {
    const raw = readFileSync(logPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit);
  } catch {
    return [];
  }
};

export const buildDiagnosticsBundle = (
  input: BuildDiagnosticsInput,
): DiagnosticsBundle => ({
  generatedAt: new Date().toISOString(),
  app: {
    version: input.appVersion,
    mode: input.mode,
    platform: process.platform,
    nodeVersion: process.version,
  },
  paths: input.paths,
  settings: sanitizeSettings(input.settings),
  schemaMigrations: readSchemaMigrations(input.db),
  connectors: readConnectorState(input.db),
  backups: readBackups(input.paths),
  logTail: readLogTail(input.paths, input.logTailLines ?? 200),
});

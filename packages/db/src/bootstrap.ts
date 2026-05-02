import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Database } from './types.js';

export type DbLogger = {
  info?: (message: string, details?: unknown) => void;
  warn?: (message: string, details?: unknown) => void;
  error?: (message: string, details?: unknown) => void;
};

export type DbBootstrapInput = {
  dbPath: string;
  migrationsDir: string;
  logger?: DbLogger;
};

export type MigrationFailure = {
  failedMigration: string;
  error: Error;
  backupPath: string | null;
};

export type DbBootstrapResult = {
  db: Database;
  appliedMigrations: string[];
  pendingMigrations: string[];
  migrationFailure: MigrationFailure | null;
};

const ensureParentDir = (dbPath: string) => {
  mkdirSync(path.dirname(dbPath), { recursive: true });
};

const ensureMigrationTable = (db: Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const listMigrationFiles = (migrationsDir: string): string[] => {
  if (!existsSync(migrationsDir)) return [];

  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
};

const getAppliedMigrationSet = (db: Database): Set<string> => {
  const rows = db
    .prepare('SELECT id FROM schema_migrations ORDER BY id ASC')
    .all() as Array<{ id: string }>;

  return new Set(rows.map((row) => row.id));
};

const backupDatabase = (dbPath: string, logger?: DbLogger): string | null => {
  if (!existsSync(dbPath)) return null;

  const backupDir = path.join(path.dirname(dbPath), 'backups');
  mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `app-pre-migration-${timestamp}.db`);

  try {
    copyFileSync(dbPath, backupPath);
    logger?.info?.('db backup created before pending migrations', { backupPath });
    return backupPath;
  } catch (error) {
    logger?.warn?.('db backup failed', { error: String(error) });
    return null;
  }
};

export const bootstrapDatabase = (input: DbBootstrapInput): DbBootstrapResult => {
  ensureParentDir(input.dbPath);

  const db = new DatabaseSync(input.dbPath);

  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');

  ensureMigrationTable(db);

  const applied = getAppliedMigrationSet(db);
  const migrationFiles = listMigrationFiles(input.migrationsDir);
  const pending = migrationFiles.filter((file) => !applied.has(file));
  const appliedNow: string[] = [];

  if (pending.length === 0) {
    return {
      db,
      appliedMigrations: appliedNow,
      pendingMigrations: pending,
      migrationFailure: null,
    };
  }

  const backupPath = backupDatabase(input.dbPath, input.logger);

  for (const migrationFile of pending) {
    const sqlPath = path.join(input.migrationsDir, migrationFile);
    const sql = readFileSync(sqlPath, 'utf8');

    try {
      db.exec('BEGIN');
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(migrationFile);
      db.exec('COMMIT');
      appliedNow.push(migrationFile);
      input.logger?.info?.('migration applied', { migrationFile });
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore rollback errors after failure */
      }

      const wrapped = error instanceof Error ? error : new Error(String(error));
      input.logger?.error?.('migration failed', {
        migrationFile,
        error: wrapped.message,
      });

      return {
        db,
        appliedMigrations: appliedNow,
        pendingMigrations: pending.slice(pending.indexOf(migrationFile)),
        migrationFailure: {
          failedMigration: migrationFile,
          error: wrapped,
          backupPath,
        },
      };
    }
  }

  return {
    db,
    appliedMigrations: appliedNow,
    pendingMigrations: [],
    migrationFailure: null,
  };
};

export const closeDatabase = (db: Database) => {
  db.close();
};

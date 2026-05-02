import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFileLogger,
  ensureAppDataPaths,
  resolveAppDataPaths,
} from '@janus/core';
import { bootstrapDatabase } from '@janus/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..', '..');
const migrationsDir = path.join(__dirname, 'migrations');

const devPaths = resolveAppDataPaths({
  mode: 'development',
  repoRoot,
  userDataPath: path.join(repoRoot, '.unused-user-data'),
});

const prodPaths = resolveAppDataPaths({
  mode: 'production',
  repoRoot,
  userDataPath: path.join(repoRoot, '.prod-data-smoke', 'Janus Layer 0'),
});

for (const paths of [devPaths, prodPaths]) {
  ensureAppDataPaths(paths);
  const logger = createFileLogger({ logsDir: paths.logsDir });
  const { db, appliedMigrations, migrationFailure } = bootstrapDatabase({
    dbPath: paths.dbPath,
    migrationsDir,
    logger,
  });

  if (migrationFailure) {
    logger.error('migration failure during smoke test', {
      failedMigration: migrationFailure.failedMigration,
      message: migrationFailure.error.message,
    });
    db.close();
    process.exit(1);
  }

  logger.info('smoke test bootstrap ok', { appliedMigrations });
  db.close();
}

console.log('[desktop] verified data paths + db bootstrap', {
  devDb: devPaths.dbPath,
  prodDb: prodPaths.dbPath,
});

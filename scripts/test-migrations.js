#!/usr/bin/env node
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapDatabase } from '../packages/db/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const migrationsDir = path.join(repoRoot, 'packages', 'db', 'migrations');

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: (message, details) =>
    console.error(`[db error] ${message}`, details ?? ''),
};

const expected = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b));

let failed = 0;
const fail = (message) => {
  console.error(`✘ ${message}`);
  failed += 1;
};
const pass = (message) => console.log(`✔ ${message}`);

const withTempDb = (fn) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'chai-migrations-'));
  const dbPath = path.join(dir, 'app.db');
  try {
    return fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const expectedTables = [
  'schema_migrations',
  'app_settings',
  'connector_state',
  'email_accounts',
  'email_threads',
  'email_messages',
  'email_attachments',
  'email_outbox_messages',
  'wa_contacts',
  'wa_jid_map',
  'wa_chats',
  'wa_messages',
  'wa_outbox_messages',
  'clusters',
  'cluster_members',
  'ai_outputs',
];

const tableSet = (db) =>
  new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name),
  );

withTempDb((dbPath) => {
  const result = bootstrapDatabase({
    dbPath,
    migrationsDir,
    logger: silentLogger,
  });
  const applied = result.appliedMigrations;
  if (result.migrationFailure) {
    fail(`fresh bootstrap failed: ${result.migrationFailure.error.message}`);
  } else if (applied.length !== expected.length) {
    fail(
      `fresh bootstrap applied ${applied.length} migrations, expected ${expected.length}`,
    );
  } else {
    pass(`fresh bootstrap applied all ${applied.length} migrations`);
  }

  const tables = tableSet(result.db);
  for (const name of expectedTables) {
    if (!tables.has(name)) {
      fail(`expected table missing after fresh bootstrap: ${name}`);
    }
  }
  pass('all expected tables present after fresh bootstrap');

  result.db.close();
});

withTempDb((dbPath) => {
  const first = bootstrapDatabase({
    dbPath,
    migrationsDir,
    logger: silentLogger,
  });
  if (first.migrationFailure) {
    fail(`first bootstrap failed: ${first.migrationFailure.error.message}`);
    first.db.close();
    return;
  }
  first.db.close();

  const second = bootstrapDatabase({
    dbPath,
    migrationsDir,
    logger: silentLogger,
  });
  if (second.migrationFailure) {
    fail(
      `second bootstrap (idempotency) failed: ${second.migrationFailure.error.message}`,
    );
  } else if (second.appliedMigrations.length !== 0) {
    fail(
      `second bootstrap should have applied 0 migrations, applied ${second.appliedMigrations.length}`,
    );
  } else {
    pass('second bootstrap is a no-op (idempotency holds)');
  }
  second.db.close();
});

withTempDb((dbPath) => {
  // Simulate a v1 install (only 001-002 applied) then upgrade to current.
  const baseline = bootstrapDatabase({
    dbPath,
    migrationsDir: path.join(__dirname, 'fixtures', 'migrations-v1'),
    logger: silentLogger,
  });
  if (baseline.migrationFailure) {
    fail(`v1 baseline bootstrap failed: ${baseline.migrationFailure.error.message}`);
    baseline.db.close();
    return;
  }
  baseline.db
    .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
    .run('seed', 'preserved-across-upgrade');
  baseline.db.close();

  const upgraded = bootstrapDatabase({
    dbPath,
    migrationsDir,
    logger: silentLogger,
  });
  if (upgraded.migrationFailure) {
    fail(
      `upgrade from v1 baseline failed: ${upgraded.migrationFailure.error.message}`,
    );
  } else {
    pass(
      `upgrade from v1 baseline applied ${upgraded.appliedMigrations.length} new migrations`,
    );
  }

  const seedRow = upgraded.db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get('seed');
  if (seedRow?.value !== 'preserved-across-upgrade') {
    fail('app_settings row was lost during upgrade');
  } else {
    pass('app_settings row preserved across upgrade');
  }

  const tables = tableSet(upgraded.db);
  for (const name of expectedTables) {
    if (!tables.has(name)) {
      fail(`expected table missing after upgrade: ${name}`);
    }
  }
  pass('all expected tables present after upgrade');

  upgraded.db.close();
});

if (failed > 0) {
  console.error(`\nMigration tests: ${failed} failure(s).`);
  process.exit(1);
} else {
  console.log('\nMigration tests: all green.');
}

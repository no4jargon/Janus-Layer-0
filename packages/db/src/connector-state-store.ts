import type { ConnectorRow, Database } from './types.js';

type DbRow = {
  connector: string;
  status: string;
  last_error: string | null;
  last_synced_at: string | null;
  updated_at: string;
};

export const createConnectorStateStore = (db: Database) => {
  const list = (): ConnectorRow[] => {
    const rows = db
      .prepare(
        'SELECT connector, status, last_error, last_synced_at, updated_at FROM connector_state',
      )
      .all() as DbRow[];

    return rows.map((row) => ({
      connector: row.connector,
      status: row.status,
      lastError: row.last_error ?? null,
      lastSyncedAt: row.last_synced_at ?? null,
      updatedAt: row.updated_at,
    }));
  };

  const upsert = (input: ConnectorRow) => {
    db.prepare(
      `
      INSERT INTO connector_state (connector, status, last_error, last_synced_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(connector) DO UPDATE SET
        status = excluded.status,
        last_error = excluded.last_error,
        last_synced_at = excluded.last_synced_at,
        updated_at = excluded.updated_at
      `,
    ).run(
      input.connector,
      input.status,
      input.lastError,
      input.lastSyncedAt,
      input.updatedAt,
    );
  };

  return { list, upsert };
};

export type ConnectorStateStore = ReturnType<typeof createConnectorStateStore>;

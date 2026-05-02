import type {
  AiOutputRecord,
  ClusterMemberRecord,
  ClusterMemberSource,
  ClusterRecord,
  Database,
} from './types.js';

const num = (value: unknown) => Number(value ?? 0);

const mapClusterRow = (row: any): ClusterRecord => ({
  id: row.id,
  name: row.name,
  color: row.color,
  createdAt: num(row.created_at),
  updatedAt: num(row.updated_at),
  memberCount: num(row.member_count),
});

const mapMemberRow = (row: any): ClusterMemberRecord => ({
  clusterId: row.cluster_id,
  source: row.source as ClusterMemberSource,
  sourceRef: row.source_ref,
  addedAt: num(row.added_at),
});

const mapAiRow = (row: any): AiOutputRecord => ({
  id: row.id,
  clusterId: row.cluster_id,
  kind: row.kind,
  inputSummary: row.input_summary,
  outputText: row.output_text,
  model: row.model,
  createdAt: num(row.created_at),
});

export const createClusterStore = (db: Database) => {
  const list = (): ClusterRecord[] => {
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.color, c.created_at, c.updated_at,
                COALESCE(COUNT(m.cluster_id), 0) AS member_count
         FROM clusters c
         LEFT JOIN cluster_members m ON m.cluster_id = c.id
         GROUP BY c.id
         ORDER BY c.updated_at DESC`,
      )
      .all() as any[];
    return rows.map(mapClusterRow);
  };

  const get = (id: string): ClusterRecord | null => {
    const row = db
      .prepare(
        `SELECT c.id, c.name, c.color, c.created_at, c.updated_at,
                COALESCE(COUNT(m.cluster_id), 0) AS member_count
         FROM clusters c
         LEFT JOIN cluster_members m ON m.cluster_id = c.id
         WHERE c.id = ?
         GROUP BY c.id`,
      )
      .get(id) as any;
    if (!row) return null;
    return mapClusterRow(row);
  };

  const create = (input: { id: string; name: string; color?: string | null }) => {
    const now = Date.now();
    db.prepare(
      `INSERT INTO clusters (id, name, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(input.id, input.name, input.color ?? null, now, now);
    return get(input.id)!;
  };

  const rename = (id: string, name: string, color?: string | null) => {
    db.prepare(
      `UPDATE clusters
         SET name = ?, color = COALESCE(?, color), updated_at = ?
       WHERE id = ?`,
    ).run(name, color ?? null, Date.now(), id);
    return get(id);
  };

  const remove = (id: string) => {
    db.prepare('DELETE FROM clusters WHERE id = ?').run(id);
  };

  const addMember = (input: ClusterMemberRecord) => {
    db.prepare(
      `INSERT INTO cluster_members (cluster_id, source, source_ref, added_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(source, source_ref) DO UPDATE SET
         cluster_id = excluded.cluster_id,
         added_at = excluded.added_at`,
    ).run(input.clusterId, input.source, input.sourceRef, input.addedAt);
    db.prepare('UPDATE clusters SET updated_at = ? WHERE id = ?').run(
      Date.now(),
      input.clusterId,
    );
  };

  const addMembers = (
    clusterId: string,
    members: Array<{ source: ClusterMemberSource; sourceRef: string }>,
  ) => {
    const now = Date.now();
    const stmt = db.prepare(
      `INSERT INTO cluster_members (cluster_id, source, source_ref, added_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(source, source_ref) DO UPDATE SET
         cluster_id = excluded.cluster_id,
         added_at = excluded.added_at`,
    );
    db.exec('BEGIN');
    try {
      for (const member of members) {
        stmt.run(clusterId, member.source, member.sourceRef, now);
      }
      db.prepare('UPDATE clusters SET updated_at = ? WHERE id = ?').run(
        now,
        clusterId,
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  const clearAll = () => {
    db.prepare('DELETE FROM cluster_members').run();
    db.prepare('DELETE FROM clusters').run();
  };

  const getClusterMap = (): Record<string, string> => {
    const rows = db
      .prepare('SELECT cluster_id, source, source_ref FROM cluster_members')
      .all() as Array<{
      cluster_id: string;
      source: string;
      source_ref: string;
    }>;
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[`${row.source}:${row.source_ref}`] = row.cluster_id;
    }
    return map;
  };

  const removeMember = (
    clusterId: string,
    source: ClusterMemberSource,
    sourceRef: string,
  ) => {
    db.prepare(
      `DELETE FROM cluster_members
       WHERE cluster_id = ? AND source = ? AND source_ref = ?`,
    ).run(clusterId, source, sourceRef);
    db.prepare('UPDATE clusters SET updated_at = ? WHERE id = ?').run(
      Date.now(),
      clusterId,
    );
  };

  const listMembers = (clusterId: string): ClusterMemberRecord[] => {
    const rows = db
      .prepare(
        `SELECT cluster_id, source, source_ref, added_at
         FROM cluster_members
         WHERE cluster_id = ?
         ORDER BY added_at ASC`,
      )
      .all(clusterId) as any[];
    return rows.map(mapMemberRow);
  };

  const listClustersForSource = (
    source: ClusterMemberSource,
    sourceRef: string,
  ): ClusterRecord[] => {
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.color, c.created_at, c.updated_at,
                (SELECT COUNT(*) FROM cluster_members WHERE cluster_id = c.id) AS member_count
         FROM clusters c
         JOIN cluster_members m ON m.cluster_id = c.id
         WHERE m.source = ? AND m.source_ref = ?
         ORDER BY c.updated_at DESC`,
      )
      .all(source, sourceRef) as any[];
    return rows.map(mapClusterRow);
  };

  return {
    list,
    get,
    create,
    rename,
    remove,
    addMember,
    addMembers,
    removeMember,
    listMembers,
    listClustersForSource,
    clearAll,
    getClusterMap,
  };
};

export type ClusterStore = ReturnType<typeof createClusterStore>;

export const createAiOutputStore = (db: Database) => {
  const create = (
    input: Omit<AiOutputRecord, 'createdAt'> & { createdAt?: number },
  ) => {
    const createdAt = input.createdAt ?? Date.now();
    db.prepare(
      `INSERT INTO ai_outputs (id, cluster_id, kind, input_summary, output_text, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.clusterId,
      input.kind,
      input.inputSummary,
      input.outputText,
      input.model,
      createdAt,
    );
    return get(input.id);
  };

  const get = (id: string): AiOutputRecord | null => {
    const row = db
      .prepare(
        `SELECT id, cluster_id, kind, input_summary, output_text, model, created_at
         FROM ai_outputs WHERE id = ? LIMIT 1`,
      )
      .get(id) as any;
    if (!row) return null;
    return mapAiRow(row);
  };

  const listForCluster = (clusterId: string): AiOutputRecord[] => {
    const rows = db
      .prepare(
        `SELECT id, cluster_id, kind, input_summary, output_text, model, created_at
         FROM ai_outputs WHERE cluster_id = ? ORDER BY created_at DESC`,
      )
      .all(clusterId) as any[];
    return rows.map(mapAiRow);
  };

  return { create, get, listForCluster };
};

export type AiOutputStore = ReturnType<typeof createAiOutputStore>;

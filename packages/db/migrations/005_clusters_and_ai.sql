CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clusters_updated
  ON clusters(updated_at DESC);

CREATE TABLE IF NOT EXISTS cluster_members (
  cluster_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY(source, source_ref),
  FOREIGN KEY(cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster
  ON cluster_members(cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_members_source
  ON cluster_members(source, source_ref);

CREATE TABLE IF NOT EXISTS ai_outputs (
  id TEXT PRIMARY KEY,
  cluster_id TEXT,
  kind TEXT NOT NULL,
  input_summary TEXT,
  output_text TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(cluster_id) REFERENCES clusters(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_outputs_cluster_created
  ON ai_outputs(cluster_id, created_at DESC);

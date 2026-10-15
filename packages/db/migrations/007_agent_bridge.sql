CREATE TABLE IF NOT EXISTS agent_bridge_audit_events (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  agent_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_bridge_audit_created
  ON agent_bridge_audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_bridge_audit_agent_created
  ON agent_bridge_audit_events(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_response_watches (
  id TEXT PRIMARY KEY,
  person_query TEXT NOT NULL,
  instructions TEXT NOT NULL,
  context_refs_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_response_watches_status
  ON agent_response_watches(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_response_tasks (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL,
  person_query TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  message_json TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  sent_message_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(watch_id) REFERENCES agent_response_watches(id) ON DELETE CASCADE,
  UNIQUE(watch_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_response_tasks_status_created
  ON agent_response_tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_response_tasks_watch
  ON agent_response_tasks(watch_id, created_at DESC);

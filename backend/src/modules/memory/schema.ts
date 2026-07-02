export const MEMORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  summary TEXT NOT NULL,
  type TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'WORKING',
  source TEXT,
  source_ref TEXT,
  tags TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 1.0,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  last_accessed_at TEXT,
  expires_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  pin_order INTEGER NOT NULL DEFAULT 0,
  structured_map TEXT NOT NULL DEFAULT '{}',
  quality_score INTEGER DEFAULT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  agent_name TEXT DEFAULT NULL,
  owner TEXT DEFAULT NULL,
  search_vector TSVECTOR
);

CREATE INDEX IF NOT EXISTS idx_ke_search ON knowledge_entries USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_ke_tier ON knowledge_entries(tier);
CREATE INDEX IF NOT EXISTS idx_ke_type ON knowledge_entries(type);
CREATE INDEX IF NOT EXISTS idx_ke_source ON knowledge_entries(source);
CREATE INDEX IF NOT EXISTS idx_ke_confidence ON knowledge_entries(confidence);
CREATE INDEX IF NOT EXISTS idx_ke_access ON knowledge_entries(access_count);
CREATE INDEX IF NOT EXISTS idx_ke_created ON knowledge_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_ke_expires ON knowledge_entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_ke_pinned ON knowledge_entries(pinned, pin_order);
CREATE INDEX IF NOT EXISTS idx_ke_archived ON knowledge_entries(archived);
CREATE INDEX IF NOT EXISTS idx_ke_quality ON knowledge_entries(quality_score);
CREATE INDEX IF NOT EXISTS idx_ke_agent_name ON knowledge_entries(agent_name);
CREATE INDEX IF NOT EXISTS idx_ke_tier_archived ON knowledge_entries(tier, archived, created_at);

CREATE OR REPLACE FUNCTION knowledge_entries_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.summary, '') || ' ' ||
    coalesce(NEW.content, '') || ' ' ||
    coalesce(NEW.tags, '') || ' ' ||
    coalesce(NEW.type, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS knowledge_entries_search_trigger ON knowledge_entries;
CREATE TRIGGER knowledge_entries_search_trigger
  BEFORE INSERT OR UPDATE ON knowledge_entries
  FOR EACH ROW EXECUTE FUNCTION knowledge_entries_search_update();

CREATE TABLE IF NOT EXISTS knowledge_vectors (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL UNIQUE,
  vector BYTEA NOT NULL,
  model TEXT NOT NULL DEFAULT 'paraphrase-multilingual-MiniLM-L12-v2',
  dimensions INTEGER NOT NULL DEFAULT 384,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  FOREIGN KEY (entry_id) REFERENCES knowledge_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kv_entry ON knowledge_vectors(entry_id);

CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
  id SERIAL PRIMARY KEY,
  source_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  relation TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  FOREIGN KEY (source_id) REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES knowledge_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kge_source ON knowledge_graph_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_kge_target ON knowledge_graph_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_kge_relation ON knowledge_graph_edges(relation);

CREATE TABLE IF NOT EXISTS consolidation_log (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL,
  from_tier TEXT NOT NULL,
  to_tier TEXT NOT NULL,
  reason TEXT NOT NULL,
  consolidated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  FOREIGN KEY (entry_id) REFERENCES knowledge_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cl_entry ON consolidation_log(entry_id);

CREATE TABLE IF NOT EXISTS memory_sessions (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  agent_name TEXT,
  started_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  ended_at TEXT,
  observation_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_ms_session ON memory_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_ms_status ON memory_sessions(status);

CREATE TABLE IF NOT EXISTS memory_audit (
  id SERIAL PRIMARY KEY,
  operation TEXT NOT NULL,
  entry_id INTEGER,
  session_id TEXT,
  agent_name TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE INDEX IF NOT EXISTS idx_ma_operation ON memory_audit(operation);
CREATE INDEX IF NOT EXISTS idx_ma_entry ON memory_audit(entry_id);
CREATE INDEX IF NOT EXISTS idx_ma_session ON memory_audit(session_id);
CREATE INDEX IF NOT EXISTS idx_ma_created ON memory_audit(created_at);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  metadata TEXT,
  summarized INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE INDEX IF NOT EXISTS idx_ct_session ON conversation_turns(session_id, turn_number);
CREATE INDEX IF NOT EXISTS idx_ct_role ON conversation_turns(role);
CREATE INDEX IF NOT EXISTS idx_ct_created ON conversation_turns(created_at);
CREATE INDEX IF NOT EXISTS idx_ct_summarized ON conversation_turns(summarized);

CREATE TABLE IF NOT EXISTS entity_index (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL,
  entity_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES knowledge_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ei_name ON entity_index(entity_name);
CREATE INDEX IF NOT EXISTS idx_ei_type ON entity_index(entity_type);
CREATE INDEX IF NOT EXISTS idx_ei_entry ON entity_index(entry_id);

CREATE TABLE IF NOT EXISTS agent_scope_config (
  id SERIAL PRIMARY KEY,
  agent_role TEXT NOT NULL UNIQUE,
  tag_set TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS quality_scores (
  entry_id INTEGER PRIMARY KEY,
  total_score INTEGER NOT NULL DEFAULT 0,
  dimensions TEXT NOT NULL DEFAULT '{}',
  scored_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  FOREIGN KEY (entry_id) REFERENCES knowledge_entries(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT DEFAULT NULL,
  parent_tag TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (entry_id, tag_id),
  FOREIGN KEY (entry_id) REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS citations (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL,
  cited_by TEXT NOT NULL,
  context TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  FOREIGN KEY (entry_id) REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  UNIQUE(entry_id, cited_by, context)
);

CREATE INDEX IF NOT EXISTS idx_citations_entry ON citations(entry_id);

CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  description TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  FOREIGN KEY (entry_id) REFERENCES knowledge_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_entry ON attachments(entry_id);

CREATE TABLE IF NOT EXISTS templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  required_sections TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  FOREIGN KEY (entry_id) REFERENCES knowledge_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feedback_entry ON feedback(entry_id);

CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL,
  assignee TEXT DEFAULT NULL,
  interval_days INTEGER NOT NULL DEFAULT 90,
  next_due TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  snoozed_until TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  FOREIGN KEY (entry_id) REFERENCES knowledge_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reminders_entry ON reminders(entry_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);

CREATE TABLE IF NOT EXISTS search_log (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE INDEX IF NOT EXISTS idx_search_log_created ON search_log(created_at);

CREATE TABLE IF NOT EXISTS popular_queries (
  query TEXT PRIMARY KEY,
  hit_count INTEGER NOT NULL DEFAULT 1,
  avg_results REAL NOT NULL DEFAULT 0,
  last_searched TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

INSERT INTO agent_scope_config (agent_role, tag_set) VALUES
  ('QA', '["testing","qa","test-plan","test-case","bug"]'),
  ('DEV', '["code","api","architecture","implementation","design"]'),
  ('BA', '["requirement","business","stakeholder","process"]'),
  ('SA', '["architecture","design","infrastructure","security"]'),
  ('DEVOPS', '["deployment","infrastructure","ci-cd","monitoring"]')
ON CONFLICT DO NOTHING;
`;

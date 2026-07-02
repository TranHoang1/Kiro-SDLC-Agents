import { Pool } from 'pg';

const ENHANCED_SYMBOL_COLUMNS = [
  { name: 'parameters', type: 'TEXT' },
  { name: 'return_type', type: 'TEXT' },
  { name: 'parent_symbol_id', type: 'INTEGER' },
  { name: 'decorators', type: 'TEXT' },
  { name: 'complexity', type: 'INTEGER' },
  { name: 'is_async', type: 'INTEGER DEFAULT 0' },
  { name: 'is_exported', type: 'INTEGER DEFAULT 0' },
  { name: 'doc_comment_full', type: 'TEXT' },
  { name: 'modifiers', type: 'TEXT' },
] as const;

const GRAPH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS relationships (
  id SERIAL PRIMARY KEY,
  source_symbol_id INTEGER NOT NULL,
  target_symbol TEXT NOT NULL,
  target_symbol_id INTEGER,
  kind TEXT NOT NULL CHECK(kind IN ('calls','imports','inherits','implements','uses','decorates')),
  file_path TEXT NOT NULL,
  line INTEGER NOT NULL,
  metadata TEXT,
  FOREIGN KEY (source_symbol_id) REFERENCES symbols(id) ON DELETE CASCADE,
  FOREIGN KEY (target_symbol_id) REFERENCES symbols(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_rel_source_kind ON relationships(source_symbol_id, kind);
CREATE INDEX IF NOT EXISTS idx_rel_target_kind ON relationships(target_symbol, kind);
CREATE INDEX IF NOT EXISTS idx_rel_target_id ON relationships(target_symbol_id) WHERE target_symbol_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rel_file ON relationships(file_path);
`;

const FILE_INDEX_SQL = `
CREATE TABLE IF NOT EXISTS file_index (
  path TEXT PRIMARY KEY,
  mtime INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  last_indexed TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  symbol_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_file_index_hash ON file_index(content_hash);
`;

const GRAPH_META_SQL = `
CREATE TABLE IF NOT EXISTS graph_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO graph_meta (key, value) VALUES
  ('schema_version', '3'),
  ('last_checkpoint', ''),
  ('total_nodes', '0'),
  ('total_edges', '0')
ON CONFLICT DO NOTHING;
`;

const BODY_EMBEDDINGS_SQL = `
CREATE TABLE IF NOT EXISTS body_embeddings (
  id SERIAL PRIMARY KEY,
  symbol_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  embedding BYTEA NOT NULL,
  token_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  UNIQUE(symbol_id, chunk_index),
  FOREIGN KEY (symbol_id) REFERENCES symbols(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_body_embeddings_symbol ON body_embeddings(symbol_id);
`;

export async function runGraphMigrations(pool: Pool): Promise<void> {
  console.error('[graph-migrator] Running graph schema migrations...');

  await addEnhancedSymbolColumns(pool);
  await pool.query(GRAPH_SCHEMA_SQL);
  console.error('[graph-migrator] Relationships table ready');

  await pool.query(FILE_INDEX_SQL);
  console.error('[graph-migrator] File index table ready');

  await pool.query(GRAPH_META_SQL);
  console.error('[graph-migrator] Graph metadata table ready');

  await pool.query(BODY_EMBEDDINGS_SQL);
  console.error('[graph-migrator] Body embeddings table ready');

  await pool.query(
    "INSERT INTO schema_version (version) VALUES (3) ON CONFLICT (version) DO UPDATE SET version = 3"
  );
  console.error('[graph-migrator] Schema version set to 3');
}

async function addEnhancedSymbolColumns(pool: Pool): Promise<void> {
  const existing = await getExistingColumns(pool, 'symbols');
  let added = 0;

  for (const col of ENHANCED_SYMBOL_COLUMNS) {
    if (!existing.has(col.name)) {
      try {
        await pool.query(`ALTER TABLE symbols ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
        added++;
      } catch {
        // column may already exist
      }
    }
  }

  if (added > 0) {
    console.error(`[graph-migrator] Added ${added} enhanced symbol columns`);
    try {
      await pool.query('CREATE INDEX IF NOT EXISTS idx_sym_parent ON symbols(parent_symbol_id) WHERE parent_symbol_id IS NOT NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_sym_exported ON symbols(is_exported) WHERE is_exported = 1');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_sym_file_kind ON symbols(file_id, kind)');
    } catch {
      // indexes may already exist
    }
  }
}

async function getExistingColumns(pool: Pool, table: string): Promise<Set<string>> {
  const result = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
    [table]
  );
  return new Set(result.rows.map((r: any) => r.column_name));
}

export async function isGraphSchemaReady(pool: Pool): Promise<boolean> {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'relationships'"
    );
    return parseInt(result.rows[0].cnt) > 0;
  } catch {
    return false;
  }
}

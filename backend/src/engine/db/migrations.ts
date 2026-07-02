import { Pool } from 'pg';
import { SCHEMA_V1 } from './schema.js';
import { runGraphMigrations } from '../database/migrator.js';
import { MEMORY_SCHEMA } from '../../modules/memory/schema.js';

const MIGRATION_V2_COLUMNS = [
  'di_style',
  'error_handling',
  'naming_convention',
  'logging_framework',
  'testing_framework',
  'purpose',
] as const;

const MEMORY_TABLES = [
  'knowledge_entries',
  'knowledge_vectors',
  'knowledge_graph_edges',
  'consolidation_log',
  'memory_sessions',
  'memory_audit',
  'conversation_turns',
  'entity_index',
  'agent_scope_config',
  'quality_scores',
  'tags',
  'entry_tags',
  'citations',
  'attachments',
  'templates',
  'feedback',
  'reminders',
  'search_log',
  'popular_queries',
];

export async function getCurrentVersion(pool: Pool): Promise<number> {
  try {
    const result = await pool.query('SELECT MAX(version) as v FROM schema_version');
    return parseInt(result.rows[0]?.v ?? '0') || 0;
  } catch {
    return 0;
  }
}

export async function runMigrations(pool: Pool): Promise<void> {
  try {
    await pool.query(SCHEMA_V1);
  } catch (err) {
    console.error('[migrations] Schema error (graceful):', err);
  }

  const current = await getCurrentVersion(pool);

  if (current >= 4) {
    console.error('[migrations] Schema up to date');
    return;
  }

  if (current < 1) {
    await pool.query(
      "INSERT INTO schema_version (version) VALUES (1) ON CONFLICT (version) DO NOTHING"
    );
    console.error('[migrations] v1 applied');
  }

  if (current < 2) {
    await applyMigrationV2(pool);
  }

  if (current < 3) {
    try {
      await runGraphMigrations(pool);
    } catch (err) {
      console.error('[migrations] V3 graph migration error (graceful):', err);
    }
  }

  if (current < 4) {
    await applyMigrationV4(pool);
  }
}

async function applyMigrationV4(pool: Pool): Promise<void> {
  try {
    for (const table of [...MEMORY_TABLES].reverse()) {
      await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    await pool.query(MEMORY_SCHEMA);
    await pool.query(
      "INSERT INTO schema_version (version) VALUES (4) ON CONFLICT (version) DO UPDATE SET version = 4"
    );
    console.error('[migrations] V4: Memory tables dropped and recreated');
  } catch (err) {
    console.error('[migrations] V4 error:', err);
  }
}

async function applyMigrationV2(pool: Pool): Promise<void> {
  try {
    for (const col of MIGRATION_V2_COLUMNS) {
      await pool.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS ${col} TEXT DEFAULT NULL`);
    }
    await pool.query(
      "INSERT INTO schema_version (version) VALUES (2) ON CONFLICT (version) DO UPDATE SET version = 2"
    );
    console.error('[migrations] V2: Pattern columns added');
  } catch (err) {
    console.error('[migrations] V2 error (graceful):', err);
  }
}

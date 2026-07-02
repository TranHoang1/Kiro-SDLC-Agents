import { Pool, PoolClient } from 'pg';

export interface CallerResult {
  name: string;
  kind: string;
  file_path: string;
  def_line: number;
  call_line: number;
  parameters: string | null;
  is_async: number;
  id: number;
}

export interface CalleeResult {
  name: string;
  call_line: number;
  metadata: string | null;
  kind: string | null;
  file_path: string | null;
  def_line: number | null;
}

export interface RelationshipInput {
  sourceSymbolId: number;
  targetSymbol: string;
  targetSymbolId?: number | null;
  kind: string;
  filePath: string;
  line: number;
  metadata?: Record<string, unknown> | null;
}

export class GraphRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async insertRelationships(relationships: RelationshipInput[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const rel of relationships) {
        await client.query(
          `INSERT INTO relationships (source_symbol_id, target_symbol, target_symbol_id, kind, file_path, line, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [rel.sourceSymbolId, rel.targetSymbol, rel.targetSymbolId ?? null, rel.kind, rel.filePath, rel.line,
           rel.metadata ? JSON.stringify(rel.metadata) : null]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteFileRelationships(filePath: string): Promise<void> {
    await this.pool.query('DELETE FROM relationships WHERE file_path = $1', [filePath]);
  }

  async findCallers(symbolName: string, kind: string = 'calls', limit: number = 20): Promise<CallerResult[]> {
    const result = await this.pool.query(`
      SELECT s.name, s.kind, f.relative_path as file_path, s.start_line as def_line, r.line as call_line,
             s.parent_symbol as parameters, s.visibility as is_async, s.id
      FROM relationships r
      JOIN symbols s ON s.id = r.source_symbol_id
      JOIN files f ON f.id = s.file_id
      WHERE r.target_symbol = $1 AND r.kind = $2
      ORDER BY f.relative_path, r.line
      LIMIT $3
    `, [symbolName, kind, limit]);
    return result.rows as CallerResult[];
  }

  async findCallees(symbolId: number, kind: string = 'calls', limit: number = 20): Promise<CalleeResult[]> {
    const result = await this.pool.query(`
      SELECT r.target_symbol as name, r.line as call_line, r.metadata,
             ts.kind, tf.relative_path as file_path, ts.start_line as def_line
      FROM relationships r
      LEFT JOIN symbols ts ON ts.id = r.target_symbol_id
      LEFT JOIN files tf ON tf.id = ts.file_id
      WHERE r.source_symbol_id = $1 AND r.kind = $2
      ORDER BY r.line
      LIMIT $3
    `, [symbolId, kind, limit]);
    return result.rows as CalleeResult[];
  }

  async resolveTargets(batchSize: number = 1000): Promise<number> {
    const client = await this.pool.connect();
    try {
      const unresolved = await client.query(`
        SELECT r.id, r.target_symbol
        FROM relationships r
        WHERE r.target_symbol_id IS NULL
        LIMIT $1
      `, [batchSize]);

      let resolved = 0;
      await client.query('BEGIN');
      for (const row of unresolved.rows) {
        const target = await client.query('SELECT id FROM symbols WHERE name = $1 LIMIT 1', [row.target_symbol]);
        if (target.rows.length > 0) {
          await client.query('UPDATE relationships SET target_symbol_id = $1 WHERE id = $2', [target.rows[0].id, row.id]);
          resolved++;
        }
      }
      await client.query('COMMIT');
      return resolved;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async getRelationshipCount(): Promise<number> {
    const result = await this.pool.query('SELECT COUNT(*) as count FROM relationships');
    return parseInt(result.rows[0].count);
  }

  async getStats(): Promise<{ kind: string; count: number }[]> {
    const result = await this.pool.query(`
      SELECT kind, COUNT(*) as count
      FROM relationships
      GROUP BY kind
      ORDER BY count DESC
    `);
    return result.rows.map(r => ({ kind: r.kind, count: parseInt(r.count) }));
  }
}

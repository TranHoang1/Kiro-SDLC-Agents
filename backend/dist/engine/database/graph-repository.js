export class GraphRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async insertRelationships(relationships) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            for (const rel of relationships) {
                await client.query(`INSERT INTO relationships (source_symbol_id, target_symbol, target_symbol_id, kind, file_path, line, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`, [rel.sourceSymbolId, rel.targetSymbol, rel.targetSymbolId ?? null, rel.kind, rel.filePath, rel.line,
                    rel.metadata ? JSON.stringify(rel.metadata) : null]);
            }
            await client.query('COMMIT');
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    async deleteFileRelationships(filePath) {
        await this.pool.query('DELETE FROM relationships WHERE file_path = $1', [filePath]);
    }
    async findCallers(symbolName, kind = 'calls', limit = 20) {
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
        return result.rows;
    }
    async findCallees(symbolId, kind = 'calls', limit = 20) {
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
        return result.rows;
    }
    async resolveTargets(batchSize = 1000) {
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
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    async getRelationshipCount() {
        const result = await this.pool.query('SELECT COUNT(*) as count FROM relationships');
        return parseInt(result.rows[0].count);
    }
    async getStats() {
        const result = await this.pool.query(`
      SELECT kind, COUNT(*) as count
      FROM relationships
      GROUP BY kind
      ORDER BY count DESC
    `);
        return result.rows.map(r => ({ kind: r.kind, count: parseInt(r.count) }));
    }
}
//# sourceMappingURL=graph-repository.js.map
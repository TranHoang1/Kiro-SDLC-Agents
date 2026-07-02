/**
 * Query Layer — FTS5 search, symbol lookup, module listing.
 * Provides the data access layer for all MCP tool handlers.
 */
export class QueryLayer {
    db;
    constructor(dbManager) {
        this.db = dbManager.getSqliteDb();
    }
    /** Full-text search across symbols using FTS5. */
    searchCode(query, limit = 20) {
        const ftsQuery = sanitizeFtsQuery(query);
        const stmt = this.db.prepare(`
      SELECT s.name, s.kind, s.signature, f.relative_path as filePath,
             s.start_line as startLine, s.end_line as endLine,
             s.doc_comment as docComment, rank
      FROM symbols_fts
      JOIN symbols s ON symbols_fts.rowid = s.id
      JOIN files f ON s.file_id = f.id
      WHERE symbols_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
        return stmt.all(ftsQuery, limit);
    }
    /** Lookup symbols by exact name or prefix. */
    findSymbols(name, kind, limit = 50) {
        let sql = `
      SELECT s.name, s.kind, s.signature, f.relative_path as filePath,
             s.start_line as startLine, s.end_line as endLine,
             s.visibility, s.doc_comment as docComment, s.parent_symbol as parentSymbol
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.name LIKE ?
    `;
        const params = [`${name}%`];
        if (kind) {
            sql += ' AND s.kind = ?';
            params.push(kind);
        }
        sql += ' ORDER BY s.name LIMIT ?';
        params.push(limit);
        return this.db.prepare(sql).all(...params);
    }
    /** Get symbols in a specific file. */
    getFileSymbols(relativePath) {
        const stmt = this.db.prepare(`
      SELECT s.name, s.kind, s.signature, f.relative_path as filePath,
             s.start_line as startLine, s.end_line as endLine,
             s.visibility, s.doc_comment as docComment, s.parent_symbol as parentSymbol
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE f.relative_path = ?
      ORDER BY s.start_line
    `);
        return stmt.all(relativePath);
    }
    /** List all modules with stats and pattern metadata. */
    listModules() {
        const stmt = this.db.prepare(`
      SELECT name, root_path as rootPath, language, description,
             file_count as fileCount, symbol_count as symbolCount,
             di_style as diStyle, error_handling as errorHandling,
             naming_convention as namingConvention,
             logging_framework as loggingFramework,
             testing_framework as testingFramework, purpose
      FROM modules
      ORDER BY name
    `);
        return stmt.all();
    }
    /** List modules with pattern metadata, optionally filtered by name. */
    listModulesWithPatterns(name) {
        if (!name)
            return this.listModules();
        const stmt = this.db.prepare(`
      SELECT name, root_path as rootPath, language, description,
             file_count as fileCount, symbol_count as symbolCount,
             di_style as diStyle, error_handling as errorHandling,
             naming_convention as namingConvention,
             logging_framework as loggingFramework,
             testing_framework as testingFramework, purpose
      FROM modules
      WHERE name LIKE ?
      ORDER BY name
    `);
        return stmt.all(`${name}%`);
    }
    /** Get index status and statistics. */
    getIndexStatus() {
        const files = this.db.prepare('SELECT COUNT(*) as c FROM files').get();
        const symbols = this.db.prepare('SELECT COUNT(*) as c FROM symbols').get();
        const modules = this.db.prepare('SELECT COUNT(*) as c FROM modules').get();
        const lastRow = this.db.prepare('SELECT MAX(last_indexed) as t FROM files').get();
        const langRows = this.db.prepare('SELECT language, COUNT(*) as c FROM files GROUP BY language').all();
        const languages = {};
        for (const row of langRows) {
            languages[row.language] = row.c;
        }
        return {
            totalFiles: files.c,
            totalSymbols: symbols.c,
            totalModules: modules.c,
            languages,
            lastIndexed: lastRow.t,
        };
    }
}
function sanitizeFtsQuery(query) {
    return query.replace(/[^\w\s*"]/g, ' ').trim() || '*';
}
//# sourceMappingURL=query-layer.js.map
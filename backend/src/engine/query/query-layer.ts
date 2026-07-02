/**
 * Query Layer — FTS5 search, symbol lookup, module listing.
 * Provides the data access layer for all MCP tool handlers.
 */

import Database from 'better-sqlite3';
import { DatabaseManager } from '../db/database-manager.js';

export interface SearchResult {
  name: string;
  kind: string;
  signature: string;
  filePath: string;
  startLine: number;
  endLine: number;
  docComment: string | null;
  rank: number;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  signature: string;
  filePath: string;
  startLine: number;
  endLine: number;
  visibility: string | null;
  docComment: string | null;
  parentSymbol: string | null;
}

export interface ModuleInfo {
  name: string;
  rootPath: string;
  language: string | null;
  description: string | null;
  fileCount: number;
  symbolCount: number;
  diStyle: string | null;
  errorHandling: string | null;
  namingConvention: string | null;
  loggingFramework: string | null;
  testingFramework: string | null;
  purpose: string | null;
}

export interface IndexStatus {
  totalFiles: number;
  totalSymbols: number;
  totalModules: number;
  languages: Record<string, number>;
  lastIndexed: string | null;
}

export class QueryLayer {
  private db: any;

  constructor(dbManager: DatabaseManager) {
    this.db = dbManager.getSqliteDb();
  }

  /** Full-text search across symbols using FTS5. */
  searchCode(query: string, limit: number = 20): SearchResult[] {
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
    return stmt.all(ftsQuery, limit) as SearchResult[];
  }

  /** Lookup symbols by exact name or prefix. */
  findSymbols(name: string, kind?: string, limit: number = 50): SymbolInfo[] {
    let sql = `
      SELECT s.name, s.kind, s.signature, f.relative_path as filePath,
             s.start_line as startLine, s.end_line as endLine,
             s.visibility, s.doc_comment as docComment, s.parent_symbol as parentSymbol
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.name LIKE ?
    `;
    const params: any[] = [`${name}%`];

    if (kind) {
      sql += ' AND s.kind = ?';
      params.push(kind);
    }
    sql += ' ORDER BY s.name LIMIT ?';
    params.push(limit);

    return this.db.prepare(sql).all(...params) as SymbolInfo[];
  }

  /** Get symbols in a specific file. */
  getFileSymbols(relativePath: string): SymbolInfo[] {
    const stmt = this.db.prepare(`
      SELECT s.name, s.kind, s.signature, f.relative_path as filePath,
             s.start_line as startLine, s.end_line as endLine,
             s.visibility, s.doc_comment as docComment, s.parent_symbol as parentSymbol
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE f.relative_path = ?
      ORDER BY s.start_line
    `);
    return stmt.all(relativePath) as SymbolInfo[];
  }

  /** List all modules with stats and pattern metadata. */
  listModules(): ModuleInfo[] {
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
    return stmt.all() as ModuleInfo[];
  }

  /** List modules with pattern metadata, optionally filtered by name. */
  listModulesWithPatterns(name: string | null): ModuleInfo[] {
    if (!name) return this.listModules();
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
    return stmt.all(`${name}%`) as ModuleInfo[];
  }

  /** Get index status and statistics. */
  getIndexStatus(): IndexStatus {
    const files = this.db.prepare('SELECT COUNT(*) as c FROM files').get() as { c: number };
    const symbols = this.db.prepare('SELECT COUNT(*) as c FROM symbols').get() as { c: number };
    const modules = this.db.prepare('SELECT COUNT(*) as c FROM modules').get() as { c: number };
    const lastRow = this.db.prepare(
      'SELECT MAX(last_indexed) as t FROM files'
    ).get() as { t: string | null };

    const langRows = this.db.prepare(
      'SELECT language, COUNT(*) as c FROM files GROUP BY language'
    ).all() as { language: string; c: number }[];

    const languages: Record<string, number> = {};
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

function sanitizeFtsQuery(query: string): string {
  return query.replace(/[^\w\s*"]/g, ' ').trim() || '*';
}

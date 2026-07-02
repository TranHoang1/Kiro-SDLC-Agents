/**
 * KSA-158: AI Context Service — intent-aware context assembly with token budgeting.
 * Orchestrates symbol resolution, section fetching, and budget management.
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { SymbolResolver, ResolvedSymbol } from '../graph/symbol-resolver.js';
import { CallGraphService } from '../graph/call-graph-service.js';
import { TokenBudgetManager } from './token-budget-manager.js';
import { getStrategy, SectionDef } from './intent-strategies.js';
import { GitService } from './git-service.js';
import { AIContextParams, AIContextResponse } from './types.js';

export class AIContextService {
  private db: Database.Database;
  private resolver: SymbolResolver;
  private callGraph: CallGraphService;
  private gitService: GitService;
  private workspace: string;

  constructor(
    db: Database.Database,
    resolver: SymbolResolver,
    callGraph: CallGraphService,
    workspace: string
  ) {
    this.db = db;
    this.resolver = resolver;
    this.callGraph = callGraph;
    this.gitService = new GitService(workspace);
    this.workspace = workspace;
  }

  /** Get intent-aware context for a symbol within token budget. */
  async getContext(params: AIContextParams): Promise<AIContextResponse> {
    const startTime = Date.now();
    const { symbol, intent = 'explain', token_budget = 4000, caller_depth = 1 } = params;

    // 1. Resolve symbol
    const resolved = this.resolver.resolve(symbol);
    if (resolved.length === 0) {
      return this.notFoundResponse(symbol, intent, token_budget, startTime);
    }

    const targetSymbol = resolved[0];

    // 2. Get intent strategy
    const strategy = getStrategy(intent);

    // 3. Assemble context with budget
    const budgetManager = new TokenBudgetManager(token_budget);
    const context: Record<string, any> = {};
    const sectionsIncluded: string[] = [];
    const sectionsOmitted: string[] = [];

    for (const section of strategy.sections) {
      if (budgetManager.isExhausted()) {
        sectionsOmitted.push(section.name);
        continue;
      }

      const content = await this.fetchSection(section, targetSymbol, caller_depth);
      if (content == null) {
        continue; // Section not available
      }

      const tokens = budgetManager.estimateTokens(content);

      if (budgetManager.canFit(tokens)) {
        context[section.name] = content;
        budgetManager.consume(tokens);
        sectionsIncluded.push(section.name);
      } else if (budgetManager.remaining() > 100) {
        // Partial fit
        const truncated = budgetManager.truncateToFit(content);
        context[section.name] = truncated;
        context[`${section.name}_truncated`] = true;
        budgetManager.consumeAll();
        sectionsIncluded.push(section.name);
      } else {
        sectionsOmitted.push(section.name);
      }
    }

    return {
      symbol: targetSymbol.name,
      file_path: targetSymbol.filePath,
      kind: targetSymbol.kind,
      intent,
      context,
      metadata: {
        budget_used: budgetManager.used(),
        budget_total: token_budget,
        sections_included: sectionsIncluded,
        sections_omitted: sectionsOmitted,
        query_time_ms: Date.now() - startTime
      }
    };
  }

  private async fetchSection(section: SectionDef, symbol: ResolvedSymbol, callerDepth: number): Promise<any> {
    try {
      switch (section.name) {
        case 'source':
          return this.fetchSource(symbol);
        case 'callers':
          return await this.fetchCallers(symbol, callerDepth, section.format);
        case 'callees':
          return await this.fetchCallees(symbol, callerDepth);
        case 'siblings':
          return this.fetchSiblings(symbol);
        case 'imports':
          return this.fetchImports(symbol);
        case 'tests':
          return this.fetchRelatedTests(symbol);
        case 'type_definitions':
          return this.fetchTypeDefinitions(symbol);
        case 'doc_comment':
          return this.fetchDocComment(symbol);
        case 'error_patterns':
          return this.fetchErrorPatterns(symbol);
        case 'recent_changes':
          return this.fetchRecentChanges(symbol);
        case 'test_patterns':
          return this.fetchTestPatterns(symbol);
        case 'mocks_needed':
          return await this.fetchMocksNeeded(symbol);
        default:
          return null;
      }
    } catch {
      return null; // Section fetch failed, skip gracefully
    }
  }

  private fetchSource(symbol: ResolvedSymbol): string | null {
    try {
      const fullPath = path.resolve(this.workspace, symbol.filePath);
      if (!fs.existsSync(fullPath)) return null;
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      const startLine = symbol.line - 1;
      const endLine = this.getSymbolEndLine(symbol) || startLine + 50;
      return lines.slice(startLine, endLine).join('\n');
    } catch {
      return null;
    }
  }

  private async fetchCallers(symbol: ResolvedSymbol, depth: number, format: string): Promise<any> {
    const result = await this.callGraph.findCallers(symbol.name, depth, 10);
    if (result.results.length === 0) return null;

    if (format === 'summary') {
      return result.results.map(r => `${r.symbol} (${r.filePath}:${r.callSiteLine})`);
    }
    return result.results.map(r => ({
      symbol: r.symbol,
      file: r.filePath,
      line: r.callSiteLine,
      kind: r.kind
    }));
  }

  private async fetchCallees(symbol: ResolvedSymbol, depth: number): Promise<any> {
    const result = await this.callGraph.findCallees(symbol.name, depth, 10);
    if (result.results.length === 0) return null;
    return result.results.map(r => ({
      symbol: r.symbol,
      file: r.filePath,
      line: r.callSiteLine,
      kind: r.kind
    }));
  }

  private fetchSiblings(symbol: ResolvedSymbol): any {
    const query = symbol.parentSymbolId
      ? `SELECT name, kind, signature, start_line as line FROM symbols WHERE parent_symbol_id = ? AND id != ? ORDER BY start_line`
      : `SELECT s.name, s.kind, s.signature, s.start_line as line FROM symbols s JOIN files f ON s.file_id = f.id WHERE f.relative_path = ? AND s.parent_symbol_id IS NULL AND s.id != ? ORDER BY s.start_line`;

    const params = symbol.parentSymbolId
      ? [symbol.parentSymbolId, symbol.id]
      : [symbol.filePath, symbol.id];

    const rows = this.db.prepare(query).all(...params) as any[];
    if (rows.length === 0) return null;
    return rows.map(r => ({ name: r.name, kind: r.kind, signature: r.signature, line: r.line }));
  }

  private fetchImports(symbol: ResolvedSymbol): any {
    const rows = this.db.prepare(`
      SELECT DISTINCT r.target_symbol as name, r.file_path
      FROM relationships r
      WHERE r.source_symbol_id = ? AND r.kind = 'imports'
    `).all(symbol.id) as any[];
    if (rows.length === 0) return null;
    return rows.map(r => r.name);
  }

  private fetchRelatedTests(symbol: ResolvedSymbol): any {
    const rows = this.db.prepare(`
      SELECT DISTINCT f.relative_path as file_path
      FROM relationships r
      JOIN files f ON r.file_path = f.relative_path
      WHERE r.target_symbol LIKE ?
      AND (f.relative_path LIKE '%test%' OR f.relative_path LIKE '%spec%')
      LIMIT 5
    `).all(`%${symbol.name}%`) as any[];
    if (rows.length === 0) return null;
    return rows.map(r => r.file_path);
  }

  private fetchTypeDefinitions(symbol: ResolvedSymbol): any {
    const rows = this.db.prepare(`
      SELECT DISTINCT s.name, s.kind, s.signature, f.relative_path as file
      FROM relationships r
      JOIN symbols s ON s.id = r.target_symbol_id
      JOIN files f ON s.file_id = f.id
      WHERE r.source_symbol_id = ? AND s.kind IN ('interface', 'type_alias', 'enum', 'class')
      LIMIT 10
    `).all(symbol.id) as any[];
    if (rows.length === 0) return null;
    return rows;
  }

  private fetchDocComment(symbol: ResolvedSymbol): string | null {
    const row = this.db.prepare(`
      SELECT doc_comment FROM symbols WHERE id = ?
    `).get(symbol.id) as { doc_comment: string | null } | undefined;
    return row?.doc_comment || null;
  }

  private fetchErrorPatterns(symbol: ResolvedSymbol): any {
    const source = this.fetchSource(symbol);
    if (!source) return null;

    const patterns: any[] = [];
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('throw ')) patterns.push({ type: 'throw', line: i + 1, text: line });
      if (line.startsWith('catch')) patterns.push({ type: 'catch', line: i + 1, text: line });
      if (line.includes('.catch(')) patterns.push({ type: 'promise-catch', line: i + 1, text: line });
    }
    return patterns.length > 0 ? patterns : null;
  }

  private fetchRecentChanges(symbol: ResolvedSymbol): any {
    const commits = this.gitService.getFileHistory(symbol.filePath, 5);
    return commits.length > 0 ? commits : null;
  }

  private fetchTestPatterns(symbol: ResolvedSymbol): any {
    const rows = this.db.prepare(`
      SELECT DISTINCT s.name, s.signature
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE (f.relative_path LIKE '%test%' OR f.relative_path LIKE '%spec%')
      AND s.kind = 'function'
      AND f.module = (SELECT module FROM files WHERE relative_path = ?)
      LIMIT 10
    `).all(symbol.filePath) as any[];
    if (rows.length === 0) return null;
    return rows.map(r => r.name);
  }

  private async fetchMocksNeeded(symbol: ResolvedSymbol): Promise<any> {
    const result = await this.callGraph.findCallees(symbol.name, 1, 20);
    if (result.results.length === 0) return null;

    const externalDeps = result.results
      .filter(r => r.filePath !== symbol.filePath && r.filePath !== '(external)')
      .map(r => ({ symbol: r.symbol, file: r.filePath }));

    return externalDeps.length > 0 ? externalDeps : null;
  }

  private getSymbolEndLine(symbol: ResolvedSymbol): number | null {
    const row = this.db.prepare(`SELECT end_line FROM symbols WHERE id = ?`).get(symbol.id) as { end_line: number } | undefined;
    return row?.end_line || null;
  }

  private notFoundResponse(symbol: string, intent: string, budget: number, startTime: number): AIContextResponse {
    const suggestions = this.resolver.suggest(symbol);
    return {
      symbol,
      file_path: '',
      kind: 'unknown',
      intent,
      context: { error: `Symbol "${symbol}" not found`, suggestions },
      metadata: {
        budget_used: 0,
        budget_total: budget,
        sections_included: [],
        sections_omitted: [],
        query_time_ms: Date.now() - startTime
      }
    };
  }
}

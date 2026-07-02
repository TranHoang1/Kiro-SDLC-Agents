/**
 * KSA-159: Edit Context Service — source + callers + tests + git for editing.
 * Gathers everything needed before modifying a symbol.
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { SymbolResolver, ResolvedSymbol } from '../graph/symbol-resolver.js';
import { CallGraphService } from '../graph/call-graph-service.js';
import { TestDetector } from '../graph/test-detector.js';
import { TokenBudgetManager } from './token-budget-manager.js';
import { GitService } from './git-service.js';
import {
  EditContextParams, EditContextResult,
  CallerContext, TestContext, SiblingContext, GitCommit, MemoryContext
} from './types.js';

interface ResolvedSymbolFull extends ResolvedSymbol {
  endLine?: number;
  signature?: string;
}

export class EditContextService {
  private db: Database.Database;
  private resolver: SymbolResolver;
  private callGraph: CallGraphService;
  private testDetector: TestDetector;
  private gitService: GitService;
  private budgetManager: TokenBudgetManager;
  private workspace: string;

  constructor(
    db: Database.Database,
    resolver: SymbolResolver,
    callGraph: CallGraphService,
    testDetector: TestDetector,
    workspace: string
  ) {
    this.db = db;
    this.resolver = resolver;
    this.callGraph = callGraph;
    this.testDetector = testDetector;
    this.gitService = new GitService(workspace);
    this.budgetManager = new TokenBudgetManager(4000);
    this.workspace = workspace;
  }

  /** Get full edit context for a symbol. */
  async getContext(params: EditContextParams): Promise<EditContextResult> {
    const startTime = Date.now();
    const {
      symbol: symbolInput,
      include_callers = true,
      include_tests = true,
      include_memories = false,
      include_git = true,
      token_budget = 4000,
      caller_depth = 1
    } = params;

    // 1. Resolve symbol
    const symbol = this.resolveSymbolInput(symbolInput);
    if (!symbol) {
      return this.symbolNotFoundResponse(symbolInput, token_budget, startTime);
    }

    // 2. Read source (always included)
    const source = this.readSymbolSource(symbol);
    const signature = this.getSignature(symbol);

    // 3. Gather sections in parallel
    const [callers, tests, gitHistory, siblings] = await Promise.all([
      include_callers ? this.getCallerContext(symbol, caller_depth) : Promise.resolve(null),
      include_tests ? this.getTestContext(symbol) : Promise.resolve(null),
      include_git ? this.getGitContext(symbol) : Promise.resolve(null),
      this.getSiblingContext(symbol)
    ]);

    // 4. Assemble within token budget
    const sections: Record<string, { content: any; priority: number }> = {
      source: { content: source, priority: 1 },
    };
    if (callers && callers.length > 0) sections.callers = { content: callers, priority: 2 };
    if (tests && tests.length > 0) sections.tests = { content: tests, priority: 3 };
    if (gitHistory && gitHistory.length > 0) sections.git_history = { content: gitHistory, priority: 5 };
    if (siblings && siblings.length > 0) sections.siblings = { content: siblings, priority: 6 };

    const assembled = this.budgetManager.assemble(sections, token_budget);

    const result: EditContextResult = {
      symbol: symbol.name,
      file: symbol.filePath,
      line: symbol.line,
      kind: symbol.kind,
      source: assembled.result.source || source,
      signature,
      metadata: {
        tokenCount: assembled.tokenCount,
        tokenBudget: token_budget,
        sectionsIncluded: assembled.included,
        sectionsExcluded: assembled.excluded,
        queryTimeMs: Date.now() - startTime
      }
    };

    if (assembled.result.callers) result.callers = assembled.result.callers;
    if (assembled.result.tests) result.tests = assembled.result.tests;
    if (assembled.result.git_history) result.git_history = assembled.result.git_history;
    if (assembled.result.siblings) result.siblings = assembled.result.siblings;

    return result;
  }

  private resolveSymbolInput(input: string): ResolvedSymbolFull | null {
    // Try file:line format
    if (input.includes(':') && /:\d+$/.test(input)) {
      const colonIdx = input.lastIndexOf(':');
      const file = input.substring(0, colonIdx);
      const line = parseInt(input.substring(colonIdx + 1));
      return this.findSymbolAtLine(file, line);
    }

    // Standard resolution
    const resolved = this.resolver.resolve(input);
    if (resolved.length === 0) return null;

    // Enrich with end_line and signature
    const sym = resolved[0];
    const extra = this.db.prepare(`
      SELECT end_line as endLine, signature FROM symbols WHERE id = ?
    `).get(sym.id) as { endLine: number; signature: string } | undefined;

    return {
      ...sym,
      endLine: extra?.endLine,
      signature: extra?.signature || undefined
    };
  }

  private findSymbolAtLine(file: string, line: number): ResolvedSymbolFull | null {
    const row = this.db.prepare(`
      SELECT s.id, s.name, s.kind, f.relative_path as filePath, s.start_line as line,
             s.end_line as endLine, s.signature, s.parent_symbol_id as parentSymbolId
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE f.relative_path LIKE ? AND s.start_line <= ? AND s.end_line >= ?
      ORDER BY (s.end_line - s.start_line) ASC
      LIMIT 1
    `).get(`%${file}`, line, line) as ResolvedSymbolFull | undefined;
    return row || null;
  }

  private readSymbolSource(symbol: ResolvedSymbolFull): string {
    try {
      const fullPath = path.resolve(this.workspace, symbol.filePath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      const start = symbol.line - 1;
      const end = symbol.endLine || start + 50;
      return lines.slice(start, end).join('\n');
    } catch {
      return '';
    }
  }

  private getSignature(symbol: ResolvedSymbolFull): string | null {
    if (symbol.signature) return symbol.signature;
    const row = this.db.prepare(`SELECT signature FROM symbols WHERE id = ?`).get(symbol.id) as { signature: string | null } | undefined;
    return row?.signature || null;
  }

  private async getCallerContext(symbol: ResolvedSymbolFull, depth: number): Promise<CallerContext[]> {
    const result = await this.callGraph.findCallers(symbol.name, depth, 10);

    return result.results.map(caller => {
      const context = this.getLineContext(caller.filePath, caller.callSiteLine, 2);
      return {
        symbol: caller.qualifiedName || caller.symbol,
        file: caller.filePath,
        line: caller.callSiteLine,
        context
      };
    });
  }

  private getLineContext(file: string, line: number, surroundingLines: number): string {
    try {
      const fullPath = path.resolve(this.workspace, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      const start = Math.max(0, line - 1 - surroundingLines);
      const end = Math.min(lines.length, line + surroundingLines);
      return lines.slice(start, end).join('\n');
    } catch {
      return '';
    }
  }

  private async getTestContext(symbol: ResolvedSymbolFull): Promise<TestContext[]> {
    const testFiles = this.testDetector.findRelatedTests([symbol], []);
    const results: TestContext[] = [];

    for (const tf of testFiles.slice(0, 3)) {
      try {
        const fullPath = path.resolve(this.workspace, tf.file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const testBlocks = this.extractTestBlocks(content, symbol.name);
        for (const block of testBlocks.slice(0, 2)) {
          results.push({
            file: tf.file,
            testName: block.name,
            source: block.source
          });
        }
      } catch { /* skip unreadable files */ }
    }

    return results;
  }

  private extractTestBlocks(content: string, symbolName: string): Array<{ name: string; source: string }> {
    const blocks: Array<{ name: string; source: string }> = [];
    const lines = content.split('\n');

    const testPattern = /(?:it|test|describe)\s*\(\s*['"`]([^'"`]*?)['"`]/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(testPattern);
      if (match && (lines[i].includes(symbolName) || (i + 10 < lines.length && lines.slice(i, i + 10).join('\n').includes(symbolName)))) {
        const name = match[1];
        const end = Math.min(i + 15, lines.length);
        const source = lines.slice(i, end).join('\n');
        blocks.push({ name, source });
      }
    }

    return blocks;
  }

  private async getGitContext(symbol: ResolvedSymbolFull): Promise<GitCommit[]> {
    return this.gitService.getFileHistory(symbol.filePath, 5);
  }

  private async getSiblingContext(symbol: ResolvedSymbolFull): Promise<SiblingContext[]> {
    const query = symbol.parentSymbolId
      ? `SELECT name, kind, signature, start_line as line FROM symbols WHERE parent_symbol_id = ? AND id != ? ORDER BY start_line`
      : `SELECT s.name, s.kind, s.signature, s.start_line as line FROM symbols s JOIN files f ON s.file_id = f.id WHERE f.relative_path = ? AND s.parent_symbol_id IS NULL AND s.id != ? ORDER BY s.start_line`;

    const params = symbol.parentSymbolId
      ? [symbol.parentSymbolId, symbol.id]
      : [symbol.filePath, symbol.id];

    return (this.db.prepare(query).all(...params) as any[]).map(r => ({
      name: r.name,
      kind: r.kind,
      signature: r.signature,
      line: r.line
    }));
  }

  private symbolNotFoundResponse(symbol: string, budget: number, startTime: number): EditContextResult {
    return {
      symbol,
      file: '',
      line: 0,
      kind: 'unknown',
      source: '',
      signature: null,
      metadata: {
        tokenCount: 0,
        tokenBudget: budget,
        sectionsIncluded: [],
        sectionsExcluded: ['error: symbol not found'],
        queryTimeMs: Date.now() - startTime
      }
    };
  }
}

/**
 * KSA-156: Impact Analysis Service - blast radius prediction.
 * Combines call graph + dependency graph + test detection for comprehensive impact analysis.
 */
export class ImpactAnalysisService {
    callGraph;
    depGraph;
    resolver;
    testDetector;
    db;
    constructor(db, callGraph, depGraph, resolver, testDetector) {
        this.db = db;
        this.callGraph = callGraph;
        this.depGraph = depGraph;
        this.resolver = resolver;
        this.testDetector = testDetector;
    }
    /** Analyze the impact of modifying/deleting/renaming a symbol. */
    async analyzeImpact(symbolName, action = 'modify', depth = 3, includeTests = true, severityThreshold = 'low') {
        const startTime = Date.now();
        const clampedDepth = Math.min(Math.max(depth, 1), 5);
        // 1. Resolve symbol
        const resolved = this.resolver.resolve(symbolName);
        if (resolved.length === 0) {
            return this.emptyResult(symbolName, action);
        }
        const impacts = [];
        const sourceFile = resolved[0].filePath;
        // 2. Find callers via call graph
        const callerResult = await this.callGraph.findCallers(symbolName, clampedDepth, 100);
        for (const caller of callerResult.results) {
            const severity = this.classifySeverity(caller.depthLevel, action, 'caller');
            impacts.push({
                symbol: caller.symbol,
                qualifiedName: caller.qualifiedName,
                file: caller.filePath,
                line: caller.callSiteLine,
                severity,
                reason: caller.depthLevel === 1 ? 'Direct caller' : `Transitive caller (depth ${caller.depthLevel})`,
            });
        }
        // 3. Find interface implementors
        const implImpacts = this.findImplementorImpacts(resolved, symbolName);
        impacts.push(...implImpacts);
        // 4. Find file-level dependents
        const depResult = this.depGraph.query(sourceFile, 'incoming', Math.min(clampedDepth, 2), false, 50);
        for (const dep of depResult.results) {
            if (!impacts.some(i => i.file === dep.file)) {
                impacts.push({
                    symbol: dep.file,
                    file: dep.file,
                    line: 0,
                    severity: action === 'delete' ? 'high' : 'medium',
                    reason: 'Imports modified file',
                });
            }
        }
        // 5. Find related tests
        let affectedTests = [];
        if (includeTests) {
            affectedTests = this.testDetector.findRelatedTests(resolved, impacts.map(i => i.file));
            for (const test of affectedTests) {
                if (!impacts.some(i => i.file === test.file)) {
                    impacts.push({
                        symbol: test.file,
                        file: test.file,
                        line: 0,
                        severity: 'high',
                        reason: test.reason,
                    });
                }
            }
        }
        // 6. Filter by severity threshold
        const filtered = this.filterBySeverity(impacts, severityThreshold);
        // 7. Deduplicate and sort
        const deduped = this.deduplicate(filtered);
        deduped.sort((a, b) => this.severityOrder(a.severity) - this.severityOrder(b.severity));
        // 8. Generate recommendations
        const recommendations = this.generateRecommendations(deduped, action, symbolName);
        // 9. Build summary
        const summary = this.buildSummary(deduped);
        const affectedFiles = new Set(deduped.map(i => i.file)).size;
        return {
            symbol: symbolName,
            action,
            blastRadius: {
                summary,
                totalAffected: deduped.length,
                affectedFiles,
                affectedTests: affectedTests.length,
            },
            impacts: deduped,
            affectedTests,
            recommendations,
            metadata: {
                queryTimeMs: Date.now() - startTime,
                depthSearched: clampedDepth,
                truncated: callerResult.metadata.truncated,
            },
        };
    }
    classifySeverity(depth, action, type) {
        if (action === 'delete') {
            if (depth <= 1)
                return 'critical';
            if (depth <= 2)
                return 'high';
            return 'medium';
        }
        if (action === 'rename' && depth <= 1)
            return 'high';
        if (depth === 1)
            return 'critical';
        if (depth === 2)
            return 'high';
        if (depth === 3)
            return 'medium';
        return 'low';
    }
    findImplementorImpacts(resolved, symbolName) {
        const impacts = [];
        for (const sym of resolved) {
            if (sym.kind !== 'method')
                continue;
            if (!sym.parentSymbolId)
                continue;
            // Check if parent is interface
            const parent = this.db.prepare('SELECT kind, name FROM symbols WHERE id = ?').get(sym.parentSymbolId);
            if (!parent || parent.kind !== 'interface')
                continue;
            // Find all classes implementing this interface
            const implementors = this.db.prepare(`
        SELECT DISTINCT s.name, f.relative_path as file_path, s.start_line as line
        FROM relationships r
        JOIN symbols s ON s.id = r.source_symbol_id
        JOIN files f ON s.file_id = f.id
        WHERE r.target_symbol = ? AND r.kind = 'implements'
      `).all(parent.name);
            for (const impl of implementors) {
                impacts.push({
                    symbol: `${impl.name}.${sym.name}`,
                    file: impl.file_path,
                    line: impl.line,
                    severity: 'critical',
                    reason: `Implements ${parent.name}.${sym.name}`,
                });
            }
        }
        return impacts;
    }
    generateRecommendations(impacts, action, symbol) {
        const recs = [];
        const critical = impacts.filter(i => i.severity === 'critical');
        const testImpacts = impacts.filter(i => this.testDetector.isTestFile(i.file));
        if (action === 'delete' && impacts.length === 0) {
            recs.push(`Safe to delete "${symbol}" - no references found`);
        }
        else if (action === 'delete' && impacts.length > 0) {
            recs.push(`Remove all ${impacts.length} references before deleting "${symbol}"`);
        }
        if (action === 'modify' && critical.length > 0) {
            recs.push(`Update ${critical.length} direct callers if signature changes`);
        }
        if (action === 'rename') {
            const files = new Set(impacts.map(i => i.file)).size;
            recs.push(`Update references in ${files} files with new name`);
        }
        if (testImpacts.length > 0) {
            const testFiles = testImpacts.map(t => t.file).slice(0, 5);
            recs.push(`Run affected tests: ${testFiles.join(', ')}`);
        }
        if (impacts.length > 20) {
            recs.push('Consider incremental refactoring to reduce blast radius');
        }
        return recs;
    }
    filterBySeverity(impacts, threshold) {
        const order = { critical: 0, high: 1, medium: 2, low: 3 };
        const thresholdOrder = order[threshold];
        return impacts.filter(i => order[i.severity] <= thresholdOrder);
    }
    deduplicate(impacts) {
        const seen = new Set();
        return impacts.filter(i => {
            const key = `${i.file}:${i.symbol}:${i.line}`;
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
    }
    severityOrder(severity) {
        const order = { critical: 0, high: 1, medium: 2, low: 3 };
        return order[severity];
    }
    buildSummary(impacts) {
        const summary = { critical: 0, high: 0, medium: 0, low: 0 };
        for (const i of impacts) {
            summary[i.severity]++;
        }
        return summary;
    }
    emptyResult(symbolName, action) {
        return {
            symbol: symbolName,
            action,
            blastRadius: { summary: { critical: 0, high: 0, medium: 0, low: 0 }, totalAffected: 0, affectedFiles: 0, affectedTests: 0 },
            impacts: [],
            affectedTests: [],
            recommendations: [`Symbol "${symbolName}" not found in index`],
            metadata: { queryTimeMs: 0, depthSearched: 0, truncated: false },
        };
    }
}
//# sourceMappingURL=impact-analysis-service.js.map
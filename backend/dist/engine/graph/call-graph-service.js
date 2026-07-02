/**
 * KSA-154: Call Graph Service - BFS traversal for callers/callees.
 * Provides transitive call graph analysis with depth control.
 */
export class CallGraphService {
    graphRepo;
    symbolResolver;
    constructor(graphRepo, symbolResolver) {
        this.graphRepo = graphRepo;
        this.symbolResolver = symbolResolver;
    }
    /** Find all callers of a symbol with transitive depth. */
    async findCallers(symbolName, depth = 1, limit = 20, fileFilter, kindFilter = 'calls') {
        const startTime = Date.now();
        const clampedDepth = Math.min(Math.max(depth, 1), 5);
        const resolved = this.symbolResolver.resolve(symbolName);
        if (resolved.length === 0) {
            return this.symbolNotFoundResponse(symbolName);
        }
        // KSA-191: Support multiple kind filters (SF call types: flow-action, wire, apex-import)
        const kinds = Array.isArray(kindFilter) ? kindFilter : [kindFilter];
        const results = [];
        const visited = new Set();
        const queue = [];
        for (const sym of resolved) {
            queue.push({ symbolName: sym.name, depth: 0 });
        }
        while (queue.length > 0 && results.length < limit) {
            const { symbolName: current, depth: currentDepth } = queue.shift();
            if (currentDepth >= clampedDepth)
                continue;
            // Query for each kind
            for (const kind of kinds) {
                const callers = await this.graphRepo.findCallers(current, kind, limit - results.length);
                for (const caller of callers) {
                    if (visited.has(caller.id))
                        continue;
                    visited.add(caller.id);
                    const item = {
                        symbol: caller.name,
                        qualifiedName: caller.parameters ? `${caller.parameters}.${caller.name}` : caller.name,
                        kind: caller.kind,
                        filePath: caller.file_path,
                        definitionLine: caller.def_line,
                        callSiteLine: caller.call_line,
                        depthLevel: currentDepth + 1,
                        parameters: caller.parameters,
                        isAsync: caller.is_async === 1,
                    };
                    if (fileFilter && !this.matchFilter(item.filePath, fileFilter))
                        continue;
                    results.push(item);
                    if (currentDepth + 1 < clampedDepth) {
                        queue.push({ symbolName: caller.name, depth: currentDepth + 1 });
                    }
                }
            }
        }
        return {
            symbol: symbolName,
            resolvedTo: resolved.map(s => ({ id: s.id, file: s.filePath, line: s.line, kind: s.kind })),
            results,
            metadata: {
                totalCount: results.length,
                depthSearched: clampedDepth,
                truncated: results.length >= limit,
                queryTimeMs: Date.now() - startTime,
            },
        };
    }
    /** Find all callees of a symbol with transitive depth. */
    async findCallees(symbolName, depth = 1, limit = 20, fileFilter, includeExternal = true, kindFilter = 'calls') {
        const startTime = Date.now();
        const clampedDepth = Math.min(Math.max(depth, 1), 5);
        const resolved = this.symbolResolver.resolve(symbolName);
        if (resolved.length === 0) {
            return this.symbolNotFoundResponse(symbolName);
        }
        // KSA-191: Support multiple kind filters (SF: dml, soql, trigger-on)
        const kinds = Array.isArray(kindFilter) ? kindFilter : [kindFilter];
        const results = [];
        const visited = new Set();
        const queue = [];
        for (const sym of resolved) {
            queue.push({ symbolId: sym.id, depth: 0 });
        }
        while (queue.length > 0 && results.length < limit) {
            const { symbolId, depth: currentDepth } = queue.shift();
            if (currentDepth >= clampedDepth)
                continue;
            for (const kind of kinds) {
                const callees = await this.graphRepo.findCallees(symbolId, kind, limit - results.length);
                for (const callee of callees) {
                    const key = `${callee.name}:${callee.call_line}`;
                    if (visited.has(key))
                        continue;
                    visited.add(key);
                    if (!includeExternal && !callee.file_path)
                        continue;
                    const item = {
                        symbol: callee.name,
                        qualifiedName: callee.name,
                        kind: callee.kind || 'unknown',
                        filePath: callee.file_path || '(external)',
                        definitionLine: callee.def_line || 0,
                        callSiteLine: callee.call_line,
                        depthLevel: currentDepth + 1,
                    };
                    if (fileFilter && item.filePath !== '(external)' && !this.matchFilter(item.filePath, fileFilter))
                        continue;
                    results.push(item);
                    if (callee.file_path && currentDepth + 1 < clampedDepth) {
                        const calleeResolved = this.symbolResolver.resolve(callee.name);
                        for (const cr of calleeResolved) {
                            if (cr.filePath === callee.file_path) {
                                queue.push({ symbolId: cr.id, depth: currentDepth + 1 });
                                break;
                            }
                        }
                    }
                }
            }
        }
        return {
            symbol: symbolName,
            resolvedTo: resolved.map(s => ({ id: s.id, file: s.filePath, line: s.line, kind: s.kind })),
            results,
            metadata: {
                totalCount: results.length,
                depthSearched: clampedDepth,
                truncated: results.length >= limit,
                queryTimeMs: Date.now() - startTime,
            },
        };
    }
    symbolNotFoundResponse(symbolName) {
        const suggestions = this.symbolResolver.suggest(symbolName);
        return {
            symbol: symbolName,
            resolvedTo: [],
            results: [],
            metadata: { totalCount: 0, depthSearched: 0, truncated: false, queryTimeMs: 0 },
        };
    }
    matchFilter(filePath, filter) {
        if (filter.includes('*')) {
            const regex = new RegExp('^' + filter.replace(/\*/g, '.*') + '$');
            return regex.test(filePath);
        }
        return filePath.includes(filter);
    }
}
//# sourceMappingURL=call-graph-service.js.map
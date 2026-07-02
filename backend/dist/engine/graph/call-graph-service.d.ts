/**
 * KSA-154: Call Graph Service - BFS traversal for callers/callees.
 * Provides transitive call graph analysis with depth control.
 */
import { GraphRepository } from '../database/graph-repository.js';
import { SymbolResolver } from './symbol-resolver.js';
export interface CallGraphItem {
    symbol: string;
    qualifiedName: string;
    kind: string;
    filePath: string;
    definitionLine: number;
    callSiteLine: number;
    depthLevel: number;
    parameters?: string | null;
    isAsync?: boolean;
}
export interface CallGraphResponse {
    symbol: string;
    resolvedTo: Array<{
        id: number;
        file: string;
        line: number;
        kind: string;
    }>;
    results: CallGraphItem[];
    metadata: {
        totalCount: number;
        depthSearched: number;
        truncated: boolean;
        queryTimeMs: number;
    };
}
export declare class CallGraphService {
    private graphRepo;
    private symbolResolver;
    constructor(graphRepo: GraphRepository, symbolResolver: SymbolResolver);
    /** Find all callers of a symbol with transitive depth. */
    findCallers(symbolName: string, depth?: number, limit?: number, fileFilter?: string, kindFilter?: string | string[]): Promise<CallGraphResponse>;
    /** Find all callees of a symbol with transitive depth. */
    findCallees(symbolName: string, depth?: number, limit?: number, fileFilter?: string, includeExternal?: boolean, kindFilter?: string | string[]): Promise<CallGraphResponse>;
    private symbolNotFoundResponse;
    private matchFilter;
}

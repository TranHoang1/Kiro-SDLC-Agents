import { Pool } from 'pg';
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
export declare class GraphRepository {
    private pool;
    constructor(pool: Pool);
    insertRelationships(relationships: RelationshipInput[]): Promise<void>;
    deleteFileRelationships(filePath: string): Promise<void>;
    findCallers(symbolName: string, kind?: string, limit?: number): Promise<CallerResult[]>;
    findCallees(symbolId: number, kind?: string, limit?: number): Promise<CalleeResult[]>;
    resolveTargets(batchSize?: number): Promise<number>;
    getRelationshipCount(): Promise<number>;
    getStats(): Promise<{
        kind: string;
        count: number;
    }[]>;
}

/**
 * KSA-156: Impact Analysis Service - blast radius prediction.
 * Combines call graph + dependency graph + test detection for comprehensive impact analysis.
 */
import Database from 'better-sqlite3';
import { CallGraphService } from './call-graph-service.js';
import { DependencyGraphService } from './dependency-graph-service.js';
import { SymbolResolver } from './symbol-resolver.js';
import { TestDetector, RelatedTest } from './test-detector.js';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type ImpactAction = 'modify' | 'delete' | 'rename';
export interface ImpactItem {
    symbol: string;
    qualifiedName?: string;
    file: string;
    line: number;
    severity: Severity;
    reason: string;
    chain?: string[];
}
export interface ImpactResult {
    symbol: string;
    action: ImpactAction;
    blastRadius: {
        summary: Record<Severity, number>;
        totalAffected: number;
        affectedFiles: number;
        affectedTests: number;
    };
    impacts: ImpactItem[];
    affectedTests: RelatedTest[];
    recommendations: string[];
    metadata: {
        queryTimeMs: number;
        depthSearched: number;
        truncated: boolean;
    };
}
export declare class ImpactAnalysisService {
    private callGraph;
    private depGraph;
    private resolver;
    private testDetector;
    private db;
    constructor(db: Database.Database, callGraph: CallGraphService, depGraph: DependencyGraphService, resolver: SymbolResolver, testDetector: TestDetector);
    /** Analyze the impact of modifying/deleting/renaming a symbol. */
    analyzeImpact(symbolName: string, action?: ImpactAction, depth?: number, includeTests?: boolean, severityThreshold?: Severity): Promise<ImpactResult>;
    private classifySeverity;
    private findImplementorImpacts;
    private generateRecommendations;
    private filterBySeverity;
    private deduplicate;
    private severityOrder;
    private buildSummary;
    private emptyResult;
}

/**
 * KSA-158/159/160: AI Context MCP tool handlers and definitions.
 */
import { DatabaseManager } from '../db/database-manager.js';
export declare const AI_CONTEXT_TOOL_DEFINITIONS: ({
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            symbol: {
                type: string;
                description: string;
            };
            intent: {
                type: string;
                description: string;
                enum: string[];
            };
            token_budget: {
                type: string;
                description: string;
            };
            caller_depth: {
                type: string;
                description: string;
            };
            include_callers?: undefined;
            include_tests?: undefined;
            include_git?: undefined;
            query?: undefined;
            max_tokens?: undefined;
            include_source?: undefined;
            include_memory?: undefined;
            include_graph?: undefined;
            source_weights?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            symbol: {
                type: string;
                description: string;
            };
            include_callers: {
                type: string;
                description: string;
            };
            include_tests: {
                type: string;
                description: string;
            };
            include_git: {
                type: string;
                description: string;
            };
            token_budget: {
                type: string;
                description: string;
            };
            caller_depth: {
                type: string;
                description: string;
            };
            intent?: undefined;
            query?: undefined;
            max_tokens?: undefined;
            include_source?: undefined;
            include_memory?: undefined;
            include_graph?: undefined;
            source_weights?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
            max_tokens: {
                type: string;
                description: string;
            };
            include_source: {
                type: string;
                description: string;
            };
            include_memory: {
                type: string;
                description: string;
            };
            include_graph: {
                type: string;
                description: string;
            };
            source_weights: {
                type: string;
                description: string;
                properties: {
                    code: {
                        type: string;
                    };
                    memory: {
                        type: string;
                    };
                    graph: {
                        type: string;
                    };
                };
            };
            symbol?: undefined;
            intent?: undefined;
            token_budget?: undefined;
            caller_depth?: undefined;
            include_callers?: undefined;
            include_tests?: undefined;
            include_git?: undefined;
        };
        required: string[];
    };
})[];
/** Handle get_ai_context tool call. */
export declare function handleGetAIContext(args: Record<string, unknown>, db: any, workspace: string): string;
/** Handle get_edit_context tool call. */
export declare function handleGetEditContext(args: Record<string, unknown>, db: any, workspace: string): string;
/** Handle get_curated_context tool call. */
export declare function handleGetCuratedContext(args: Record<string, unknown>, db: any, workspace: string, dbManager: DatabaseManager): string;

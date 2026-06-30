/**
 * Code Intelligence Module — handles code_* tool operations.
 * Provides code indexing, search, and symbol resolution.
 */
import type { IModule, ModuleStatus } from '../../types/module.js';
import type { ToolHandler, ToolDefinition } from '../../types/tool.js';
import type { Logger } from 'pino';
import { IndexingEngine } from '../../engine/indexer/indexing-engine.js';
export declare class CodeIntelModule implements IModule {
    readonly name = "codeIntel";
    private _status;
    private logger;
    private dbManager;
    private indexer;
    private workspace;
    constructor(logger: Logger);
    get status(): ModuleStatus;
    getIndexer(): IndexingEngine;
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    getToolHandlers(): Map<string, ToolHandler>;
    getToolDefinitions(): ToolDefinition[];
}

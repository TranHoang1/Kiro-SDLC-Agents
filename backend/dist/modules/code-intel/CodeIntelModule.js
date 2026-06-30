/**
 * Code Intelligence Module — handles code_* tool operations.
 * Provides code indexing, search, and symbol resolution.
 */
import { DatabaseManager } from '../../engine/db/database-manager.js';
import { IndexingEngine } from '../../engine/indexer/indexing-engine.js';
import { loadConfig } from '../../engine/config.js';
import { CODE_INTEL_TOOL_DEFINITIONS, dispatchCodeIntelTool } from '../../engine/tools/register-tools.js';
export class CodeIntelModule {
    name = 'codeIntel';
    _status = 'initializing';
    logger;
    dbManager;
    indexer;
    workspace;
    constructor(logger) {
        this.logger = logger.child({ module: this.name });
    }
    get status() { return this._status; }
    getIndexer() {
        return this.indexer;
    }
    async initialize() {
        this.logger.info('Initializing code intelligence module');
        try {
            const config = loadConfig();
            this.workspace = config.workspace;
            this.dbManager = new DatabaseManager(config.dbPath);
            this.dbManager.initialize();
            this.indexer = new IndexingEngine(this.dbManager, config);
            this.indexer.startBackgroundIndexing();
            this._status = 'ready';
        }
        catch (error) {
            this.logger.error({ err: error }, 'Failed to initialize code intelligence module');
            this._status = 'error';
        }
    }
    async shutdown() {
        this.logger.info('Shutting down code intelligence module');
        if (this.indexer) {
            this.indexer.stop();
        }
        if (this.dbManager) {
            this.dbManager.close();
        }
        this._status = 'stopped';
    }
    getToolHandlers() {
        const handlers = new Map();
        for (const def of CODE_INTEL_TOOL_DEFINITIONS) {
            handlers.set(def.name, async (args) => {
                try {
                    const result = await dispatchCodeIntelTool(def.name, args, this.dbManager, this.indexer, this.workspace);
                    return { content: [{ type: 'text', text: result }], isError: false };
                }
                catch (error) {
                    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
                }
            });
        }
        return handlers;
    }
    getToolDefinitions() {
        return CODE_INTEL_TOOL_DEFINITIONS.map(def => ({
            name: def.name,
            description: def.description,
            inputSchema: def.inputSchema,
            category: 'code'
        }));
    }
}
//# sourceMappingURL=CodeIntelModule.js.map
/**
 * Memory Module — handles mem_* tool operations.
 * Provides semantic search, memory storage, and retrieval.
 * In this stub: registers tool definitions but actual logic is placeholder.
 */
import { DatabaseManager } from '../../engine/db/database-manager.js';
import { MemoryEngine } from './MemoryEngine.js';
import { MemoryToolDispatcher } from './MemoryToolDispatcher.js';
import { MEMORY_TOOL_DEFINITIONS } from './MemoryToolDefinitions.js';
import { loadConfig } from '../../engine/config.js';
import { QueryLayer } from '../../engine/query/query-layer.js';
export class MemoryModule {
    name = 'memory';
    _status = 'initializing';
    logger;
    dbManager;
    engine;
    dispatcher;
    constructor(logger) {
        this.logger = logger.child({ module: this.name });
    }
    get status() {
        return this._status;
    }
    async initialize() {
        this.logger.info('Initializing memory module');
        try {
            const config = loadConfig();
            this.dbManager = new DatabaseManager();
            await this.dbManager.initialize();
            this.engine = new MemoryEngine(this.dbManager.getSqliteDb(config.dbPath));
            // Start session for context tracking
            this.engine.startSession('kiro-backend');
            const queryLayer = new QueryLayer(this.dbManager);
            this.dispatcher = new MemoryToolDispatcher(this.engine, config.workspace, queryLayer);
            this._status = 'ready';
        }
        catch (error) {
            this.logger.error({ err: error }, 'Failed to initialize memory module');
            this._status = 'error';
        }
    }
    async shutdown() {
        this.logger.info('Shutting down memory module');
        if (this.engine) {
            this.engine.endSession();
        }
        if (this.dbManager) {
            this.dbManager.close();
        }
        this._status = 'stopped';
    }
    getEngine() {
        return this.engine;
    }
    getToolHandlers() {
        const handlers = new Map();
        for (const def of MEMORY_TOOL_DEFINITIONS) {
            handlers.set(def.name, async (args) => {
                try {
                    const text = this.dispatcher.dispatch(def.name, args);
                    if (text === null) {
                        return {
                            content: [{ type: 'text', text: `Unknown tool: ${def.name}` }],
                            isError: true,
                        };
                    }
                    return {
                        content: [{ type: 'text', text }],
                        isError: false,
                    };
                }
                catch (error) {
                    this.logger.error({ tool: def.name, err: error }, 'Tool execution failed');
                    return {
                        content: [{ type: 'text', text: `Error: ${error.message}` }],
                        isError: true,
                    };
                }
            });
        }
        return handlers;
    }
    getToolDefinitions() {
        return MEMORY_TOOL_DEFINITIONS.map(def => ({
            ...def,
            category: 'memory'
        }));
    }
}
//# sourceMappingURL=MemoryModule.js.map
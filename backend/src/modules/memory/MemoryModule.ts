/**
 * Memory Module — handles mem_* tool operations.
 * Provides semantic search, memory storage, and retrieval.
 * In this stub: registers tool definitions but actual logic is placeholder.
 */

import type { IModule, ModuleStatus } from '../../types/module.js';
import type { ToolHandler, ToolDefinition } from '../../types/tool.js';
import type { Logger } from 'pino';
import { DatabaseManager } from '../../engine/db/database-manager.js';
import { MemoryEngine } from './MemoryEngine.js';
import { MemoryToolDispatcher } from './MemoryToolDispatcher.js';
import { MEMORY_TOOL_DEFINITIONS } from './MemoryToolDefinitions.js';
import { loadConfig } from '../../engine/config.js';
import { QueryLayer } from '../../engine/query/query-layer.js';

export class MemoryModule implements IModule {
  readonly name = 'memory';
  private _status: ModuleStatus = 'initializing';
  private logger: Logger;
  private dbManager!: DatabaseManager;
  private engine!: MemoryEngine;
  private dispatcher!: MemoryToolDispatcher;

  constructor(logger: Logger) {
    this.logger = logger.child({ module: this.name });
  }

  get status(): ModuleStatus {
    return this._status;
  }

  async initialize(): Promise<void> {
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
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to initialize memory module');
      this._status = 'error';
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down memory module');
    if (this.engine) {
      this.engine.endSession();
    }
    if (this.dbManager) {
      this.dbManager.close();
    }
    this._status = 'stopped';
  }

  getEngine(): MemoryEngine {
    return this.engine;
  }

  getToolHandlers(): Map<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();

    for (const def of MEMORY_TOOL_DEFINITIONS) {
      handlers.set(def.name, async (args) => {
        try {
          const text = this.dispatcher.dispatch(def.name, args as Record<string, unknown>);
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
        } catch (error: any) {
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

  getToolDefinitions(): ToolDefinition[] {
    return MEMORY_TOOL_DEFINITIONS.map(def => ({
      ...def,
      category: 'memory'
    })) as ToolDefinition[];
  }
}

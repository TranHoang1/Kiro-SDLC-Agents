import type { Logger } from 'pino';
import type { ToolDefinition } from '../../types/tool.js';
export declare class McpClientManager {
    private clients;
    private toolsToServer;
    private proxiedTools;
    private credentialMappings;
    private logger;
    constructor(logger: Logger);
    initializeAll(): Promise<void>;
    getProxiedTools(): ToolDefinition[];
    ownsTool(toolName: string): boolean;
    getServerForTool(toolName: string): string | null;
    executeTool(toolName: string, args: any, userCredentials?: Record<string, string>): Promise<any>;
    shutdownAll(): Promise<void>;
}

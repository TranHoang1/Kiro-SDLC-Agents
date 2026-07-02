import fs from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadConfig, getWorkspacePath } from '../../config/BackendConfig.js';
export class McpClientManager {
    clients = new Map();
    toolsToServer = new Map();
    proxiedTools = [];
    credentialMappings = new Map();
    logger;
    constructor(logger) {
        this.logger = logger.child({ component: 'McpClientManager' });
    }
    async initializeAll() {
        const cfg = loadConfig();
        const configPath = path.resolve(getWorkspacePath(), cfg.dataDir, cfg.orchestrationConfigPath);
        if (!fs.existsSync(configPath)) {
            this.logger.warn({ configPath }, 'orchestration.json not found, skipping child servers');
            return;
        }
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            const servers = config.mcpServers || {};
            const connectPromises = Object.entries(servers).map(async ([serverName, serverConfig]) => {
                if (serverConfig.disabled) {
                    this.logger.info({ serverName }, 'Skipping disabled server');
                    return;
                }
                // Skip code-intelligence since it's us
                if (serverName === 'code-intelligence') {
                    return;
                }
                try {
                    this.logger.info({ serverName }, 'Connecting to child MCP server');
                    const client = new Client({ name: 'code-intel-orchestrator', version: '1.0.0' }, { capabilities: {} });
                    let transport;
                    if (serverConfig.type === 'sse' || serverConfig.transportType === 'sse') {
                        transport = new SSEClientTransport(new URL(serverConfig.url));
                    }
                    else if (serverConfig.type === 'httpStream' || serverConfig.transportType === 'httpStream') {
                        transport = new StreamableHTTPClientTransport(new URL(serverConfig.url));
                    }
                    else if (serverConfig.command) {
                        transport = new StdioClientTransport({
                            command: serverConfig.command,
                            args: serverConfig.args || [],
                            env: { ...process.env, ...(serverConfig.env || {}) }
                        });
                    }
                    else {
                        this.logger.warn({ serverName }, 'Unknown transport type configuration');
                        return;
                    }
                    // Don't wait forever, add a timeout for connecting
                    const connectPromise = client.connect(transport);
                    await Promise.race([
                        connectPromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 10000))
                    ]);
                    this.clients.set(serverName, client);
                    if (serverConfig.credential_mapping) {
                        this.credentialMappings.set(serverName, serverConfig.credential_mapping);
                    }
                    this.logger.info({ serverName }, 'Connected to child server. Fetching tools...');
                    // Fetch tools
                    const toolsResult = await client.listTools();
                    const tools = toolsResult.tools || [];
                    for (const tool of tools) {
                        this.toolsToServer.set(tool.name, serverName);
                        this.proxiedTools.push({
                            name: tool.name,
                            description: tool.description || '',
                            category: serverName,
                            inputSchema: tool.inputSchema
                        });
                    }
                    this.logger.info({ serverName, toolCount: tools.length }, 'Imported tools from child server');
                }
                catch (err) {
                    this.logger.error({ err: err.message, serverName }, 'Failed to connect to child server');
                }
            });
            // Wait for all connections to settle
            await Promise.allSettled(connectPromises);
        }
        catch (err) {
            this.logger.error({ err }, 'Failed to parse orchestration.json');
        }
    }
    getProxiedTools() {
        return this.proxiedTools;
    }
    ownsTool(toolName) {
        return this.toolsToServer.has(toolName);
    }
    getServerForTool(toolName) {
        return this.toolsToServer.get(toolName) || null;
    }
    async executeTool(toolName, args, userCredentials) {
        const serverName = this.toolsToServer.get(toolName);
        if (!serverName) {
            throw new Error(`Tool ${toolName} is not managed by any child server`);
        }
        const client = this.clients.get(serverName);
        if (!client) {
            throw new Error(`Client for server ${serverName} is disconnected`);
        }
        let enrichedArgs = { ...args };
        if (userCredentials) {
            const mapping = this.credentialMappings.get(serverName);
            if (mapping) {
                for (const [clientField, serverField] of Object.entries(mapping)) {
                    if (userCredentials[clientField] !== undefined) {
                        enrichedArgs[serverField] = userCredentials[clientField];
                    }
                }
            }
        }
        this.logger.info({ toolName, serverName }, 'Proxying tool execution to child server');
        try {
            const result = await client.callTool({
                name: toolName,
                arguments: enrichedArgs
            });
            return {
                content: result.content,
                isError: result.isError
            };
        }
        catch (err) {
            this.logger.error({ err, toolName, serverName }, 'Tool execution failed on child server');
            throw err;
        }
    }
    async shutdownAll() {
        for (const [name, client] of this.clients.entries()) {
            try {
                await client.close();
            }
            catch (e) {
                this.logger.error({ err: e, serverName: name }, 'Error closing client');
            }
        }
    }
}
//# sourceMappingURL=McpClientManager.js.map
/**
 * Hono HTTP server setup with all routes and middleware.
 * Implements: UC-2, UC-7, BR-35, BR-37
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { ToolRouter } from '../tools/ToolRouter.js';
import { createHealthRoute } from './routes/health.js';
import { createToolsRoute } from './routes/tools.js';
import { createApiRoute } from './routes/api.js';
import { createAdminRoute } from './routes/admin.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { createErrorHandler } from './middleware/error-handler.js';
import { localhostOnly } from './middleware/localhost-only.js';
import { rateLimiter } from './middleware/rate-limiter.js';
import { getMcpServer, registerTransport } from './mcpServer.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
export class HttpServer {
    options;
    app;
    server = null;
    logger;
    port;
    host;
    _isRunning = false;
    constructor(options) {
        this.options = options;
        this.logger = options.logger;
        this.port = options.port;
        this.host = options.host;
        this.app = this.createApp();
    }
    createApp() {
        const app = new Hono();
        const toolRouter = new ToolRouter(this.options.registry, this.logger);
        // Global middleware
        app.use('*', localhostOnly);
        app.use('*', createRequestLogger(this.logger));
        app.use('/api/admin/*', rateLimiter); // 100 req/min per IP on admin API
        app.onError(createErrorHandler(this.logger));
        // Routes
        const healthRoute = createHealthRoute(this.options.registry, this.options.version);
        const toolsRoute = createToolsRoute(toolRouter, this.logger);
        const apiRoute = createApiRoute(this.options.registry, this.logger);
        const adminRoute = createAdminRoute(this.logger);
        app.route('/', healthRoute);
        app.route('/', toolsRoute);
        app.route('/', apiRoute);
        app.route('/', adminRoute);
        // MCP Streamable HTTP endpoint
        app.all('/mcp', async (c) => {
            const transport = new WebStandardStreamableHTTPServerTransport();
            registerTransport(transport);
            const server = getMcpServer(this.options.registry, this.logger);
            await server.connect(transport);
            return transport.handleRequest(c.req.raw);
        });
        return app;
    }
    async start() {
        return new Promise((resolve) => {
            this.server = serve({
                fetch: this.app.fetch,
                port: this.port,
                hostname: this.host,
            }, (info) => {
                this._isRunning = true;
                this.logger.info({ port: info.port, host: this.host }, 'Backend server started');
                resolve();
            });
        });
    }
    async stop() {
        if (this.server) {
            this.server.close();
            this._isRunning = false;
            this.logger.info('Backend server stopped');
        }
    }
    get isRunning() {
        return this._isRunning;
    }
    get honoApp() {
        return this.app;
    }
}
//# sourceMappingURL=HttpServer.js.map
/**
 * Webview data API endpoints — /api/*
 * Provides data for Dashboard, KB Graph, Analytics, Tags, Quality panels.
 * Implements: UC-5
 */
import { Hono } from 'hono';
import type { Logger } from 'pino';
import type { ModuleRegistry } from '../../modules/ModuleRegistry.js';
export declare function createApiRoute(registry: ModuleRegistry, logger: Logger): Hono;

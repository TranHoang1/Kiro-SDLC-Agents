import { z } from 'zod';
export declare function getWorkspacePath(): string;
declare const BackendConfigSchema: z.ZodObject<{
    port: z.ZodDefault<z.ZodNumber>;
    host: z.ZodDefault<z.ZodString>;
    dataDir: z.ZodDefault<z.ZodString>;
    onnxModelPath: z.ZodDefault<z.ZodString>;
    sqliteDbPath: z.ZodDefault<z.ZodString>;
    databaseUrl: z.ZodDefault<z.ZodString>;
    orchestrationConfigPath: z.ZodDefault<z.ZodString>;
    logLevel: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
}, "strip", z.ZodTypeAny, {
    port: number;
    host: string;
    dataDir: string;
    onnxModelPath: string;
    sqliteDbPath: string;
    databaseUrl: string;
    orchestrationConfigPath: string;
    logLevel: "debug" | "info" | "warn" | "error";
}, {
    port?: number | undefined;
    host?: string | undefined;
    dataDir?: string | undefined;
    onnxModelPath?: string | undefined;
    sqliteDbPath?: string | undefined;
    databaseUrl?: string | undefined;
    orchestrationConfigPath?: string | undefined;
    logLevel?: "debug" | "info" | "warn" | "error" | undefined;
}>;
export type BackendConfig = z.infer<typeof BackendConfigSchema> & {
    workspace: string;
};
export declare function loadConfig(overrides?: Partial<BackendConfig>): BackendConfig;
export {};

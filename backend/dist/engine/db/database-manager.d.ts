import { Pool } from 'pg';
export declare class DatabaseManager {
    private static initPromise;
    static preResolveBinding(): Promise<void>;
    initialize(): Promise<void>;
    getDb(): Pool;
    getSqliteDb(dbPath?: string): any;
    close(): Promise<void>;
}

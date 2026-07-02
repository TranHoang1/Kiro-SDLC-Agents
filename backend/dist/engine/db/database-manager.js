import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs';
import { getPool, closePool } from './pg-pool.js';
import { runMigrations } from './migrations.js';
const _req = createRequire(import.meta.url);
let _sqliteDb = null;
export class DatabaseManager {
    static initPromise = null;
    static async preResolveBinding() { }
    async initialize() {
        if (DatabaseManager.initPromise) {
            await DatabaseManager.initPromise;
            return;
        }
        const pool = getPool();
        DatabaseManager.initPromise = runMigrations(pool);
        await DatabaseManager.initPromise;
        console.error('[db] PostgreSQL initialized');
    }
    getDb() {
        return getPool();
    }
    getSqliteDb(dbPath) {
        if (_sqliteDb)
            return _sqliteDb;
        if (!dbPath)
            throw new Error('[db] getSqliteDb called before initialization with a path');
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        const DB = _req('better-sqlite3');
        _sqliteDb = new DB(dbPath, { fileMustExist: false });
        return _sqliteDb;
    }
    async close() {
        await closePool();
        console.error('[db] Connection closed');
    }
}
//# sourceMappingURL=database-manager.js.map
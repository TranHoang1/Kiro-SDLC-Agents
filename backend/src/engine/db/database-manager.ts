import { Pool } from 'pg';
import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs';
import { getPool, closePool } from './pg-pool.js';
import { runMigrations } from './migrations.js';

const _req = createRequire(import.meta.url);
let _sqliteDb: any = null;

export class DatabaseManager {
  private static initPromise: Promise<void> | null = null;

  static async preResolveBinding(): Promise<void> {}

  async initialize(): Promise<void> {
    if (DatabaseManager.initPromise) {
      await DatabaseManager.initPromise;
      return;
    }
    const pool = getPool();
    DatabaseManager.initPromise = runMigrations(pool);
    await DatabaseManager.initPromise;
    console.error('[db] PostgreSQL initialized');
  }

  getDb(): Pool {
    return getPool();
  }

  getSqliteDb(dbPath?: string): any {
    if (_sqliteDb) return _sqliteDb;
    if (!dbPath) throw new Error('[db] getSqliteDb called before initialization with a path');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const DB = _req('better-sqlite3');
    _sqliteDb = new DB(dbPath, { fileMustExist: false });
    return _sqliteDb;
  }

  async close(): Promise<void> {
    await closePool();
    console.error('[db] Connection closed');
  }
}


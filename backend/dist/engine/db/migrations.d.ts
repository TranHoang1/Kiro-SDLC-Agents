import { Pool } from 'pg';
export declare function getCurrentVersion(pool: Pool): Promise<number>;
export declare function runMigrations(pool: Pool): Promise<void>;

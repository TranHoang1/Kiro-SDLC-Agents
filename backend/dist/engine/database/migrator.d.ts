import { Pool } from 'pg';
export declare function runGraphMigrations(pool: Pool): Promise<void>;
export declare function isGraphSchemaReady(pool: Pool): Promise<boolean>;

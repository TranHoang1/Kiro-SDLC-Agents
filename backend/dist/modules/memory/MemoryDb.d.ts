import { Pool } from 'pg';
export declare function getMemoryDb(): Pool;
export declare function closeMemoryDb(): Promise<void>;

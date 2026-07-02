import { Pool } from 'pg';
import { getPool, closePool } from '../../engine/db/pg-pool.js';

export function getMemoryDb(): Pool {
  return getPool();
}

export async function closeMemoryDb(): Promise<void> {
  await closePool();
}

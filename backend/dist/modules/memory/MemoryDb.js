import { getPool, closePool } from '../../engine/db/pg-pool.js';
export function getMemoryDb() {
    return getPool();
}
export async function closeMemoryDb() {
    await closePool();
}
//# sourceMappingURL=MemoryDb.js.map
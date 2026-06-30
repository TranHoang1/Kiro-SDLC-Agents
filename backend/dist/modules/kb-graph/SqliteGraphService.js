/**
 * SqliteGraphService — Embedded graph layer using SQLite for KB Graph visualization.
 *
 * Zero external dependencies — uses the existing admin.db with graph_nodes + graph_edges tables.
 * Provides spatial bounding-box queries for progressive 3D loading.
 * Syncs BOTH knowledge_entries (Documents) AND code symbols from index.db.
 */
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { getAdminDb, getKbEntries } from '../../admin/admin-db.js';
import { getWorkspacePath } from '../../config/BackendConfig.js';
import { resolveNativeBindingSync } from '../../engine/db/native-addon-resolver.js';
function openDb(dbPath, options) {
    const nativeBinding = resolveNativeBindingSync();
    return nativeBinding
        ? new Database(dbPath, { ...options, nativeBinding })
        : new Database(dbPath, options);
}
const LEVEL_MAP = {
    ARCHITECTURE: 0, REQUIREMENT: 0, DECISION: 0,
    PROCEDURE: 0, CONTEXT: 0, CODE_ENTITY: 0,
    LESSON_LEARNED: 1, ERROR_PATTERN: 1, DOCUMENT: 1,
    FUNCTION: 1, METHOD: 1, CLASS: 0, INTERFACE: 0,
    TYPE: 1, CONSTRUCTOR: 1, PROPERTY: 2, ENUM: 1,
};
// Map code symbol kinds -> display type
const KIND_TO_TYPE = {
    function: 'FUNCTION',
    method: 'METHOD',
    class: 'CLASS',
    interface: 'INTERFACE',
    type: 'TYPE',
    constructor: 'CONSTRUCTOR',
    property: 'PROPERTY',
    enum: 'ENUM',
    constant: 'CONSTANT',
    variable: 'VARIABLE',
};
export class SqliteGraphService {
    logger;
    _ready = false;
    constructor(logger) {
        this.logger = logger.child({ service: 'sqlite-graph' });
    }
    get ready() { return this._ready; }
    initialize() {
        const db = getAdminDb();
        const count = db.prepare('SELECT COUNT(*) as cnt FROM graph_nodes').get().cnt;
        this._ready = true;
        // Auto-sync all data sources if graph is empty
        if (count === 0) {
            this.logger.info('Graph empty — starting full sync from all sources');
            this.fullSync();
        }
        else {
            this.logger.info({ existingNodes: this.getNodeCount() }, 'SQLite graph service ready');
        }
    }
    /**
     * Full sync: reads documents from knowledge_entries and code from symbols table,
     * then builds graph_nodes + graph_edges. Safe to call multiple times (REPLACE semantics).
     */
    fullSync() {
        const startTime = Date.now();
        const sources = {};
        // 1. Collect all entries to sync
        const allEntries = [];
        const ksaGroupMap = new Map(); // KSA-NNN → groupId
        let groupCounter = 0;
        function getKsaGroupId(source) {
            if (!source)
                return 0;
            const m = source.match(/KSA-\d+/i);
            const key = m ? m[0].toUpperCase() : 'MISC';
            if (!ksaGroupMap.has(key))
                ksaGroupMap.set(key, groupCounter++);
            return ksaGroupMap.get(key);
        }
        // 1a. Knowledge entries (Documents)
        const docResult = getKbEntries(1, 100000, 'created_at', 'desc');
        for (const entry of docResult.items) {
            const type = (entry.type || 'DOCUMENT').toUpperCase();
            const label = ((entry.summary || entry.tags || '').substring(0, 50)) ||
                (entry.source || '').split('/').pop() || `Doc ${entry.id}`;
            allEntries.push({
                id: `doc-${entry.id}`,
                label,
                type,
                tier: entry.tier || 'SHARED',
                groupId: getKsaGroupId(entry.source),
            });
            sources[type] = (sources[type] || 0) + 1;
        }
        this.logger.info({ count: docResult.items.length }, 'Collected knowledge entries');
        // 1b. Code symbols from index.db
        const indexDbPath = path.resolve(getWorkspacePath(), '.code-intel', 'index.db');
        if (fs.existsSync(indexDbPath)) {
            try {
                const indexDb = openDb(indexDbPath, { readonly: true });
                // Check tables exist
                const hasTables = indexDb.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name IN ('symbols','files')").get();
                if (hasTables && hasTables.cnt >= 2) {
                    // Get symbols joined with file paths, in batches
                    const BATCH = 10000;
                    let offset = 0;
                    let batchCount = 0;
                    // Only include meaningful symbol kinds (skip properties/variables to keep graph readable)
                    const INCLUDE_KINDS = ['function', 'class', 'interface', 'method', 'type', 'enum', 'constructor'];
                    const placeholders = INCLUDE_KINDS.map(() => '?').join(',');
                    while (true) {
                        const rows = indexDb.prepare(`
              SELECT s.id, s.name, s.kind, f.path as file_path, f.language
              FROM symbols s
              LEFT JOIN files f ON f.id = s.file_id
              WHERE s.kind IN (${placeholders})
              ORDER BY s.id ASC
              LIMIT ? OFFSET ?
            `).all(...INCLUDE_KINDS, BATCH, offset);
                        if (rows.length === 0)
                            break;
                        for (const sym of rows) {
                            const type = KIND_TO_TYPE[sym.kind] || 'CODE_ENTITY';
                            const fileSuffix = sym.file_path ? sym.file_path.replace(/\\/g, '/').split('/').pop() || '' : '';
                            const label = `${sym.name} (${fileSuffix})`.substring(0, 60);
                            // Code symbols get grouped by source module (src/server → 'server', src/modules/memory → 'memory')
                            const fileParts = (sym.file_path || '').replace(/\\/g, '/').split('/');
                            const srcIdx = fileParts.lastIndexOf('src');
                            const module = srcIdx >= 0 && fileParts[srcIdx + 1] ? fileParts[srcIdx + 1] : 'code';
                            const moduleKey = `MODULE-${module}`;
                            if (!ksaGroupMap.has(moduleKey))
                                ksaGroupMap.set(moduleKey, groupCounter++);
                            allEntries.push({
                                id: `sym-${sym.id}`,
                                label,
                                type,
                                tier: 'CODE',
                                groupId: ksaGroupMap.get(moduleKey),
                            });
                            sources[type] = (sources[type] || 0) + 1;
                        }
                        batchCount += rows.length;
                        offset += BATCH;
                        if (rows.length < BATCH)
                            break;
                    }
                    this.logger.info({ symbolCount: batchCount }, 'Collected code symbols');
                }
                indexDb.close();
            }
            catch (err) {
                this.logger.warn({ error: err.message }, 'Failed to read code symbols from index.db — skipping');
            }
        }
        else {
            this.logger.warn({ indexDbPath }, 'index.db not found — skipping code symbols');
        }
        // 2. Write all nodes to graph_nodes
        const result = this.syncFromEntries(allEntries);
        const elapsed = Date.now() - startTime;
        this.logger.info({ ...result, sources, elapsed: `${elapsed}ms` }, 'Full graph sync complete');
        this._ready = true;
        return { ...result, sources };
    }
    getNodeCount() {
        return getAdminDb().prepare('SELECT COUNT(*) as cnt FROM graph_nodes').get().cnt;
    }
    addNode(entryId, label, type, tier) {
        const db = getAdminDb();
        const existing = db.prepare('SELECT entry_id FROM graph_nodes WHERE entry_id = ?').get(entryId);
        if (existing)
            return this.getNode(entryId);
        const count = this.getNodeCount();
        const pos = this.computePosition(count, type);
        db.prepare(`INSERT OR IGNORE INTO graph_nodes (entry_id, label, type, tier, x, y, z, level, cluster_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(entryId, label.substring(0, 50), type.toUpperCase(), tier, pos.x, pos.y, pos.z, pos.level, pos.clusterId);
        this.autoCreateEdges(entryId, type.toUpperCase(), tier);
        return { id: entryId, label, type: type.toUpperCase(), tier, ...pos };
    }
    removeNode(entryId) {
        const db = getAdminDb();
        db.prepare('DELETE FROM graph_edges WHERE source = ? OR target = ?').run(entryId, entryId);
        db.prepare('DELETE FROM graph_nodes WHERE entry_id = ?').run(entryId);
    }
    getNode(entryId) {
        const row = getAdminDb().prepare('SELECT * FROM graph_nodes WHERE entry_id = ?').get(entryId);
        if (!row)
            return null;
        return this.rowToNode(row);
    }
    addEdge(source, target, weight = 0.5, relType = 'RELATED_TO') {
        getAdminDb().prepare('INSERT OR IGNORE INTO graph_edges (source, target, weight, rel_type) VALUES (?, ?, ?, ?)').run(source, target, weight, relType);
    }
    /**
     * Returns ALL node positions (minimal data, no edges) for initial full-load rendering.
     * Optimized for Points-based visualization of 200k+ nodes.
     */
    getAllPositions() {
        const db = getAdminDb();
        const rows = db.prepare('SELECT entry_id, x, y, z, type, tier, label FROM graph_nodes').all();
        const nodes = rows.map((r) => ({
            id: r.entry_id,
            x: r.x,
            y: r.y,
            z: r.z,
            type: r.type,
            tier: r.tier,
            label: r.label,
        }));
        return { nodes, total: nodes.length };
    }
    spatialQuery(params) {
        const db = getAdminDb();
        const startTime = performance.now();
        const { camX, camY, camZ, zoom } = params;
        const r = Math.max(200, zoom * 0.5);
        let nodes;
        let level;
        if (zoom > 500) {
            level = 'macro';
            // Sample evenly from each type (no RANDOM — use LIMIT per type)
            const types = db.prepare('SELECT DISTINCT type FROM graph_nodes WHERE level = 0').all().map((r) => r.type);
            const perType = Math.max(20, Math.floor(500 / Math.max(types.length, 1)));
            const allNodes = [];
            for (const t of types) {
                const rows = db.prepare('SELECT * FROM graph_nodes WHERE level = 0 AND type = ? LIMIT ?').all(t, perType);
                allNodes.push(...rows);
            }
            nodes = allNodes.slice(0, 500).map(this.rowToNode);
        }
        else if (zoom > 200) {
            level = 'mid';
            nodes = db.prepare(`
        SELECT *, ABS(x - ?) + ABS(y - ?) + ABS(z - ?) as manhattan_dist
        FROM graph_nodes WHERE level <= 1
        ORDER BY manhattan_dist ASC
        LIMIT 1500
      `).all(camX, camY, camZ).map(this.rowToNode);
        }
        else {
            level = 'micro';
            const nearNodes = db.prepare(`
        SELECT *, ABS(x - ?) + ABS(y - ?) + ABS(z - ?) as manhattan_dist
        FROM graph_nodes
        ORDER BY manhattan_dist ASC
        LIMIT 10000
      `).all(camX, camY, camZ);
            nodes = nearNodes.map(this.rowToNode);
        }
        let edges = [];
        if (nodes.length > 0) {
            const ids = nodes.map(n => n.id);
            db.exec('CREATE TEMP TABLE IF NOT EXISTS _vis (id TEXT PRIMARY KEY)');
            db.exec('DELETE FROM _vis');
            const insert = db.prepare('INSERT OR IGNORE INTO _vis (id) VALUES (?)');
            db.transaction((nodeIds) => {
                for (const id of nodeIds) {
                    insert.run(id);
                }
            })(ids);
            edges = db.prepare(`
        SELECT e.source, e.target, e.weight, e.rel_type
        FROM graph_edges e
        INNER JOIN _vis v1 ON e.source = v1.id
        INNER JOIN _vis v2 ON e.target = v2.id
        LIMIT 3000
      `).all()
                .map((row) => ({ source: row.source, target: row.target, weight: row.weight, type: row.rel_type }));
        }
        const queryTimeMs = performance.now() - startTime;
        // Cache counts (expensive full-table scans)
        if (!this._cachedEdgeCount || Date.now() - (this._cachedEdgeCountTime || 0) > 60000) {
            this._cachedEdgeCount = db.prepare('SELECT COUNT(*) as cnt FROM graph_edges').get().cnt;
            this._cachedNodeCount = this.getNodeCount();
            this._cachedEdgeCountTime = Date.now();
        }
        return { nodes, edges, stats: { totalNodes: nodes.length, totalEdges: edges.length, queryTimeMs: Math.round(queryTimeMs * 100) / 100, level, totalInDb: this._cachedNodeCount || 0, totalEdgesInDb: this._cachedEdgeCount || 0 } };
    }
    syncFromEntries(entries) {
        const db = getAdminDb();
        let nodesCreated = 0;
        let edgesCreated = 0;
        const n = entries.length;
        // Compute groupId: use provided groupId if available, otherwise fall back to type-based
        const typeGroups = new Map();
        let typeGroupCounter = 0;
        const totalGroups = Math.max(...entries.map(e => e.groupId ?? 0)) + 1 || 1;
        function resolveGroupId(e) {
            if (e.groupId !== undefined)
                return e.groupId;
            const type = e.type.toUpperCase();
            if (!typeGroups.has(type))
                typeGroups.set(type, typeGroupCounter++);
            return typeGroups.get(type);
        }
        const insertNode = db.prepare(`INSERT OR REPLACE INTO graph_nodes (entry_id, label, type, tier, x, y, z, level, cluster_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const insertEdge = db.prepare(`INSERT OR IGNORE INTO graph_edges (source, target, weight, rel_type) VALUES (?, ?, ?, ?)`);
        // Insert nodes in batches of 5000
        const CHUNK = 5000;
        for (let start = 0; start < n; start += CHUNK) {
            const chunk = entries.slice(start, start + CHUNK);
            db.transaction(() => {
                for (let ci = 0; ci < chunk.length; ci++) {
                    const entry = chunk[ci];
                    const type = entry.type.toUpperCase();
                    const gId = resolveGroupId(entry);
                    const pos = this.computePositionByIndex(start + ci, n, type, gId, totalGroups);
                    insertNode.run(entry.id, entry.label.substring(0, 60), type, entry.tier, pos.x, pos.y, pos.z, pos.level, pos.clusterId);
                    nodesCreated++;
                }
            })();
        }
        // Build edges via spatial bucketing
        const allNodeRows = db.prepare('SELECT entry_id, x, y, z, cluster_id, type FROM graph_nodes').all();
        const bucketSize = 150;
        const buckets = new Map();
        for (const row of allNodeRows) {
            const bx = Math.floor(row.x / bucketSize);
            const by = Math.floor(row.y / bucketSize);
            const bz = Math.floor(row.z / bucketSize);
            const key = `${bx},${by},${bz}`;
            if (!buckets.has(key))
                buckets.set(key, []);
            buckets.get(key).push(row);
        }
        db.transaction(() => {
            for (const [, members] of buckets) {
                for (let i = 0; i < members.length; i++) {
                    for (let j = i + 1; j < Math.min(members.length, i + 4); j++) {
                        insertEdge.run(members[i].entry_id, members[j].entry_id, 0.7, 'SPATIAL');
                        edgesCreated++;
                    }
                }
            }
            // Cross-cluster hub links
            const clusterMap = new Map();
            for (const row of allNodeRows) {
                const cid = row.cluster_id || 'default';
                if (!clusterMap.has(cid))
                    clusterMap.set(cid, row.entry_id);
            }
            const hubs = Array.from(clusterMap.values());
            for (let i = 0; i < hubs.length; i++) {
                for (let j = i + 1; j < Math.min(hubs.length, i + 5); j++) {
                    insertEdge.run(hubs[i], hubs[j], 0.5, 'CLUSTER_LINK');
                    edgesCreated++;
                }
            }
        })();
        this.logger.info({ nodesCreated, edgesCreated }, 'syncFromEntries complete');
        return { nodesCreated, edgesCreated };
    }
    computePosition(index, type) {
        const db = getAdminDb();
        const typeRows = db.prepare('SELECT DISTINCT type FROM graph_nodes').all();
        const groups = new Map();
        let gc = 0;
        for (const r of typeRows) {
            groups.set(r.type, gc++);
        }
        if (!groups.has(type.toUpperCase()))
            groups.set(type.toUpperCase(), gc++);
        return this.computePositionByIndex(index, this.getNodeCount() + 1, type, groups.get(type.toUpperCase()) || 0, gc || 1);
    }
    computePositionByIndex(i, total, type, groupId, groupCount) {
        const n = Math.max(total, 1);
        const level = LEVEL_MAP[type.toUpperCase()] ?? 2;
        const golden = (1 + Math.sqrt(5)) / 2;
        // Each GROUP is now a KSA project cluster (not a type cluster)
        // Types within the same group are co-located but offset by Z to show hierarchy:
        //   REQUIREMENT: z = 0 (ground level)
        //   ARCHITECTURE: z = +150
        //   PROCEDURE: z = +300
        //   CODE (FUNCTION/CLASS/etc): z = +450 (highest — built on top of design)
        const TYPE_Z_OFFSET = {
            REQUIREMENT: 0,
            ARCHITECTURE: 150,
            PROCEDURE: 300,
            CONTEXT: 50,
            DECISION: 200,
            DOCUMENT: 100,
            LESSON_LEARNED: -100,
            ERROR_PATTERN: -150,
            // Code entities orbit at the top
            CLASS: 500, INTERFACE: 450,
            FUNCTION: 600, METHOD: 550,
            TYPE: 480, CONSTRUCTOR: 520,
            ENUM: 460, CONSTANT: 400, VARIABLE: 380,
            CODE_ENTITY: 470,
        };
        // Place groups on a Fibonacci sphere surface (evenly spread clusters)
        const phi = Math.acos(1 - 2 * (groupId + 0.5) / Math.max(groupCount, 1));
        const theta_g = 2 * Math.PI * groupId / golden;
        const sphereRadius = 1200; // radius of the sphere of clusters
        const centerX = sphereRadius * Math.sin(phi) * Math.cos(theta_g);
        const centerY = sphereRadius * Math.sin(phi) * Math.sin(theta_g);
        const centerZ = sphereRadius * Math.cos(phi);
        // Within each cluster, scatter nodes in a small disk
        // Use golden angle for even local distribution
        const localSpread = 180; // tighter clusters so nodes appear grouped
        const theta_l = 2 * Math.PI * i / golden;
        const localR = Math.sqrt((i % 200) / 200) * localSpread; // disk pattern, max 200 per cluster
        const zOffset = TYPE_Z_OFFSET[type.toUpperCase()] ?? level * 150;
        return {
            x: Math.round((centerX + localR * Math.cos(theta_l)) * 100) / 100,
            y: Math.round((centerY + localR * Math.sin(theta_l)) * 100) / 100,
            z: Math.round((centerZ + zOffset) * 100) / 100,
            level, clusterId: `cluster-${groupId}`,
        };
    }
    autoCreateEdges(entryId, type, tier) {
        const db = getAdminDb();
        for (const row of db.prepare('SELECT entry_id FROM graph_nodes WHERE type = ? AND entry_id != ? ORDER BY RANDOM() LIMIT 3').all(type, entryId)) {
            db.prepare('INSERT OR IGNORE INTO graph_edges (source, target, weight, rel_type) VALUES (?, ?, ?, ?)').run(entryId, row.entry_id, 0.6, 'TYPE_MATCH');
        }
        for (const row of db.prepare('SELECT entry_id FROM graph_nodes WHERE tier = ? AND type != ? AND entry_id != ? ORDER BY RANDOM() LIMIT 1').all(tier, type, entryId)) {
            db.prepare('INSERT OR IGNORE INTO graph_edges (source, target, weight, rel_type) VALUES (?, ?, ?, ?)').run(entryId, row.entry_id, 0.4, 'TIER_MATCH');
        }
    }
    rowToNode(row) {
        return { id: row.entry_id, label: row.label, type: row.type, tier: row.tier, x: row.x, y: row.y, z: row.z, level: row.level, clusterId: row.cluster_id };
    }
}
//# sourceMappingURL=SqliteGraphService.js.map
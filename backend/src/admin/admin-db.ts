/**
 * Admin Portal Database Layer — PostgreSQL
 */

import { Pool, PoolClient } from 'pg';
import * as crypto from 'crypto';
import type { User, UserStatus, AccessGroup, GroupPermission, Session, AuditEntry } from './types/rbac.types.js';
import { getPool } from '../engine/db/pg-pool.js';

const ADMIN_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  access_group_id TEXT NOT NULL,
  force_password_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS access_groups (
  access_group_id TEXT PRIMARY KEY,
  access_group_name TEXT UNIQUE NOT NULL,
  is_system_group INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS group_permissions (
  id SERIAL PRIMARY KEY,
  access_group_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  role_data TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (access_group_id) REFERENCES access_groups(access_group_id) ON DELETE CASCADE,
  UNIQUE(access_group_id, permission_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  device TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  login_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT DEFAULT '',
  changes TEXT DEFAULT '',
  timestamp TEXT NOT NULL,
  ip_address TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS config_changes (
  id SERIAL PRIMARY KEY,
  section TEXT NOT NULL,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  requires_restart INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS graph_nodes (
  entry_id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'DOCUMENT',
  tier TEXT NOT NULL DEFAULT 'SHARED',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  z REAL NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 2,
  cluster_id TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE TABLE IF NOT EXISTS graph_edges (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0.5,
  rel_type TEXT NOT NULL DEFAULT 'RELATED_TO',
  UNIQUE(source, target)
);
CREATE TABLE IF NOT EXISTS query_logs (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  response_time_ms INTEGER NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  user_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS promotion_cooldowns (
  entry_id TEXT NOT NULL,
  cooldown_until TEXT NOT NULL,
  rejected_at TEXT NOT NULL,
  rejected_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_config_changes_time ON config_changes(changed_at);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_x ON graph_nodes(x);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_y ON graph_nodes(y);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_z ON graph_nodes(z);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_level ON graph_nodes(level);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_cluster ON graph_nodes(cluster_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source_target ON graph_edges(source, target);
CREATE INDEX IF NOT EXISTS idx_query_logs_timestamp ON query_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_query_logs_user_id ON query_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_promo_cooldown_entry ON promotion_cooldowns(entry_id);
`;

let _adminInitialized = false;

export async function initAdminDb(): Promise<void> {
  if (_adminInitialized) return;
  _adminInitialized = true;
  const pool = getPool();
  await pool.query(ADMIN_SCHEMA);
  await seedDefaults(pool);
}

async function seedDefaults(pool: Pool): Promise<void> {
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO access_groups (access_group_id, access_group_name, is_system_group, created_at, updated_at)
     VALUES ('grp-admin', 'Administrators', 1, $1, $1) ON CONFLICT DO NOTHING`,
    [now]
  );
  const allPerms = [
    'DASHBOARD_VIEW', 'KB_READ', 'KB_WRITE', 'KB_PROMOTE', 'KB_IMPORT_EXPORT',
    'MCP_ACCESS', 'MCP_MANAGE', 'USER_MANAGE', 'RBAC_MANAGE', 'CONFIG_EDIT',
    'SEARCH_EXPLORE', 'AUDIT_VIEW', 'GRAPH_VIEW', 'ANALYTICS_VIEW',
  ];
  for (const perm of allPerms) {
    await pool.query(
      'INSERT INTO group_permissions (access_group_id, permission_id, role_data) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      ['grp-admin', perm, '{}']
    );
  }
  const hash = hashPassword('admin');
  await pool.query(
    `INSERT INTO users (user_id, username, email, password_hash, status, access_group_id, force_password_change, created_at)
     VALUES ('user-admin-001', 'admin', 'admin@localhost', $1, 'ACTIVE', 'grp-admin', 0, $2) ON CONFLICT DO NOTHING`,
    [hash, now]
  );
}


// --- Password Hashing ---

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const computed = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(computed, 'hex'));
}

// --- Token Management ---

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createSession(userId: string, device?: string, ip?: string): Promise<Session & { token: string }> {
  const pool = getPool();
  const sessionId = 'sess-' + crypto.randomUUID().slice(0, 8);
  const token = generateToken();
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO sessions (session_id, user_id, token, device, ip_address, login_at, expires_at, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
    [sessionId, userId, token, device || '', ip || '', now.toISOString(), expires.toISOString()]
  );
  return { sessionId, userId, token, device, ipAddress: ip, loginAt: now.toISOString(), expiresAt: expires.toISOString(), isActive: true };
}

export async function validateSession(token: string): Promise<{ userId: string; username: string; accessGroupId: string } | null> {
  const pool = getPool();
  const row = (await pool.query(
    `SELECT s.user_id, s.expires_at, s.is_active, u.username, u.access_group_id, u.status
     FROM sessions s JOIN users u ON s.user_id = u.user_id WHERE s.token = $1`,
    [token]
  )).rows[0];
  if (!row || !row.is_active || row.status !== 'ACTIVE') return null;
  if (new Date(row.expires_at) < new Date()) {
    await pool.query('UPDATE sessions SET is_active = 0 WHERE token = $1', [token]);
    return null;
  }
  return { userId: row.user_id, username: row.username, accessGroupId: row.access_group_id };
}

export async function invalidateSession(token: string): Promise<void> {
  await getPool().query('UPDATE sessions SET is_active = 0 WHERE token = $1', [token]);
}

export async function invalidateUserSessions(userId: string): Promise<number> {
  const result = await getPool().query(
    'UPDATE sessions SET is_active = 0 WHERE user_id = $1 AND is_active = 1', [userId]
  );
  return result.rowCount ?? 0;
}

export async function refreshSession(token: string): Promise<{ token: string; expiresAt: string } | null> {
  const pool = getPool();
  const row = (await pool.query(
    `SELECT s.expires_at, s.is_active, u.status FROM sessions s JOIN users u ON s.user_id = u.user_id WHERE s.token = $1`,
    [token]
  )).rows[0];
  if (!row || !row.is_active || row.status !== 'ACTIVE') return null;
  if (new Date(row.expires_at) < new Date()) {
    await pool.query('UPDATE sessions SET is_active = 0 WHERE token = $1', [token]);
    return null;
  }
  const newToken = generateToken();
  const newExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await pool.query('UPDATE sessions SET token = $1, expires_at = $2 WHERE token = $3', [newToken, newExpires, token]);
  return { token: newToken, expiresAt: newExpires };
}


// --- User Operations ---

export async function getUsers(filters?: { status?: string; search?: string; accessGroupId?: string }, page = 1, pageSize = 50): Promise<{ items: any[]; total: number }> {
  const pool = getPool();
  let pIdx = 1;
  let where = 'WHERE 1=1';
  const params: any[] = [];
  if (filters?.status) { where += ` AND u.status = $${pIdx++}`; params.push(filters.status); }
  if (filters?.accessGroupId) { where += ` AND u.access_group_id = $${pIdx++}`; params.push(filters.accessGroupId); }
  if (filters?.search) {
    where += ` AND (u.username LIKE $${pIdx} OR u.email LIKE $${pIdx + 1})`;
    pIdx += 2;
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  const total = parseInt((await pool.query(`SELECT COUNT(*) as cnt FROM users u ${where}`, params)).rows[0].cnt);
  const rows = (await pool.query(
    `SELECT u.*, g.access_group_name FROM users u LEFT JOIN access_groups g ON u.access_group_id = g.access_group_id ${where} ORDER BY u.created_at DESC LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
    [...params, pageSize, (page - 1) * pageSize]
  )).rows;
  return {
    total,
    items: rows.map(r => ({
      userId: r.user_id, username: r.username, email: r.email, status: r.status,
      accessGroupId: r.access_group_id, accessGroupName: r.access_group_name || '',
      forcePasswordChange: !!r.force_password_change,
      createdAt: r.created_at, lastLogin: r.last_login || undefined,
    })),
  };
}

export async function getUserById(userId: string): Promise<User | null> {
  const r = (await getPool().query('SELECT * FROM users WHERE user_id = $1', [userId])).rows[0];
  if (!r) return null;
  return { userId: r.user_id, username: r.username, email: r.email, status: r.status, accessGroupId: r.access_group_id, forcePasswordChange: !!r.force_password_change, createdAt: r.created_at, lastLogin: r.last_login || undefined };
}

export async function getUserByUsername(username: string): Promise<(User & { passwordHash: string }) | null> {
  const r = (await getPool().query('SELECT * FROM users WHERE username = $1', [username])).rows[0];
  if (!r) return null;
  return { userId: r.user_id, username: r.username, email: r.email, status: r.status, accessGroupId: r.access_group_id, forcePasswordChange: !!r.force_password_change, createdAt: r.created_at, lastLogin: r.last_login || undefined, passwordHash: r.password_hash };
}

export async function createUser(username: string, email: string, password: string, accessGroupId: string): Promise<User> {
  const pool = getPool();
  const userId = 'user-' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const hash = hashPassword(password);
  await pool.query(
    `INSERT INTO users (user_id, username, email, password_hash, status, access_group_id, force_password_change, created_at) VALUES ($1, $2, $3, $4, 'ACTIVE', $5, 1, $6)`,
    [userId, username, email, hash, accessGroupId, now]
  );
  return { userId, username, email, status: 'ACTIVE', accessGroupId, forcePasswordChange: true, createdAt: now };
}

export async function updateUserStatus(userId: string, status: UserStatus): Promise<number> {
  await getPool().query('UPDATE users SET status = $1 WHERE user_id = $2', [status, userId]);
  if (status === 'DISABLED') return invalidateUserSessions(userId);
  return 0;
}

export async function deleteUser(userId: string): Promise<void> {
  const pool = getPool();
  const user = (await pool.query('SELECT username FROM users WHERE user_id = $1', [userId])).rows[0];
  if (user?.username === 'admin') throw new Error('Cannot delete system admin');
  await invalidateUserSessions(userId);
  await pool.query('DELETE FROM users WHERE user_id = $1', [userId]);
}

export async function resetUserPassword(userId: string): Promise<string> {
  const tempPwd = crypto.randomBytes(6).toString('base64url');
  const hash = hashPassword(tempPwd);
  await getPool().query('UPDATE users SET password_hash = $1, force_password_change = 1 WHERE user_id = $2', [hash, userId]);
  return tempPwd;
}

export async function changePassword(userId: string, newPassword: string): Promise<void> {
  const hash = hashPassword(newPassword);
  await getPool().query('UPDATE users SET password_hash = $1, force_password_change = 0 WHERE user_id = $2', [hash, userId]);
}

export async function updateLastLogin(userId: string): Promise<void> {
  await getPool().query('UPDATE users SET last_login = $1 WHERE user_id = $2', [new Date().toISOString(), userId]);
}

// --- RBAC Group Operations ---

export async function getGroups(): Promise<AccessGroup[]> {
  const pool = getPool();
  const groups = (await pool.query('SELECT * FROM access_groups ORDER BY is_system_group DESC, access_group_name ASC')).rows;
  return Promise.all(groups.map(async g => {
    const perms = (await pool.query('SELECT permission_id, role_data FROM group_permissions WHERE access_group_id = $1', [g.access_group_id])).rows;
    return {
      accessGroupId: g.access_group_id, accessGroupName: g.access_group_name,
      isSystemGroup: !!g.is_system_group,
      permissions: perms.map(p => ({ permissionId: p.permission_id, roleData: JSON.parse(p.role_data || '{}') })),
      createdAt: g.created_at, updatedAt: g.updated_at,
    };
  }));
}

export async function getGroupById(groupId: string): Promise<AccessGroup | null> {
  const pool = getPool();
  const g = (await pool.query('SELECT * FROM access_groups WHERE access_group_id = $1', [groupId])).rows[0];
  if (!g) return null;
  const perms = (await pool.query('SELECT permission_id, role_data FROM group_permissions WHERE access_group_id = $1', [groupId])).rows;
  return {
    accessGroupId: g.access_group_id, accessGroupName: g.access_group_name, isSystemGroup: !!g.is_system_group,
    permissions: perms.map(p => ({ permissionId: p.permission_id, roleData: JSON.parse(p.role_data || '{}') })),
    createdAt: g.created_at, updatedAt: g.updated_at,
  };
}

export async function createGroup(name: string, permissions: GroupPermission[]): Promise<AccessGroup> {
  const pool = getPool();
  const id = 'grp-' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  await pool.query('INSERT INTO access_groups (access_group_id, access_group_name, is_system_group, created_at, updated_at) VALUES ($1, $2, 0, $3, $3)', [id, name, now]);
  for (const p of permissions) {
    await pool.query('INSERT INTO group_permissions (access_group_id, permission_id, role_data) VALUES ($1, $2, $3)', [id, p.permissionId, JSON.stringify(p.roleData || {})]);
  }
  return { accessGroupId: id, accessGroupName: name, isSystemGroup: false, permissions, createdAt: now, updatedAt: now };
}

export async function updateGroup(groupId: string, name: string | undefined, permissions: GroupPermission[]): Promise<AccessGroup> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = (await client.query('SELECT * FROM access_groups WHERE access_group_id = $1', [groupId])).rows[0];
    if (!existing) throw new Error('Group not found');
    const now = new Date().toISOString();
    if (name) {
      await client.query('UPDATE access_groups SET access_group_name = $1, updated_at = $2 WHERE access_group_id = $3', [name, now, groupId]);
    } else {
      await client.query('UPDATE access_groups SET updated_at = $1 WHERE access_group_id = $2', [now, groupId]);
    }
    await client.query('DELETE FROM group_permissions WHERE access_group_id = $1', [groupId]);
    for (const p of permissions) {
      await client.query('INSERT INTO group_permissions (access_group_id, permission_id, role_data) VALUES ($1, $2, $3)', [groupId, p.permissionId, JSON.stringify(p.roleData || {})]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return (await getGroupById(groupId))!;
}

export async function deleteGroup(groupId: string): Promise<void> {
  const pool = getPool();
  const g = (await pool.query('SELECT is_system_group FROM access_groups WHERE access_group_id = $1', [groupId])).rows[0];
  if (!g) throw new Error('Group not found');
  if (g.is_system_group) throw new Error('Cannot delete system group');
  const cnt = parseInt((await pool.query('SELECT COUNT(*) as cnt FROM users WHERE access_group_id = $1', [groupId])).rows[0].cnt);
  if (cnt > 0) throw new Error('Cannot delete group with assigned users');
  await pool.query('DELETE FROM access_groups WHERE access_group_id = $1', [groupId]);
}

// --- User Permissions ---

export async function getUserPermissions(userId: string): Promise<GroupPermission[]> {
  const pool = getPool();
  const user = (await pool.query('SELECT access_group_id FROM users WHERE user_id = $1', [userId])).rows[0];
  if (!user) return [];
  const perms = (await pool.query('SELECT permission_id, role_data FROM group_permissions WHERE access_group_id = $1', [user.access_group_id])).rows;
  return perms.map(p => ({ permissionId: p.permission_id, roleData: JSON.parse(p.role_data || '{}') }));
}

// --- Audit Operations ---

export async function recordAudit(userId: string, username: string, action: string, resource: string, resourceId?: string, changes?: string, ip?: string): Promise<void> {
  const auditId = 'aud-' + crypto.randomUUID().slice(0, 8);
  await getPool().query(
    `INSERT INTO audit_log (audit_id, user_id, username, action, resource, resource_id, changes, timestamp, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [auditId, userId, username, action, resource, resourceId || '', changes || '', new Date().toISOString(), ip || '']
  );
}

export async function getAuditLogs(filters?: { userId?: string; action?: string; dateFrom?: string; dateTo?: string }, page = 1, pageSize = 50): Promise<{ items: AuditEntry[]; total: number }> {
  const pool = getPool();
  let pIdx = 1;
  let where = 'WHERE 1=1';
  const params: any[] = [];
  if (filters?.userId) { where += ` AND user_id = $${pIdx++}`; params.push(filters.userId); }
  if (filters?.action) { where += ` AND action = $${pIdx++}`; params.push(filters.action); }
  if (filters?.dateFrom) { where += ` AND timestamp >= $${pIdx++}`; params.push(filters.dateFrom); }
  if (filters?.dateTo) { where += ` AND timestamp <= $${pIdx++}`; params.push(filters.dateTo); }
  const total = parseInt((await pool.query(`SELECT COUNT(*) as cnt FROM audit_log ${where}`, params)).rows[0].cnt);
  const rows = (await pool.query(
    `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
    [...params, pageSize, (page - 1) * pageSize]
  )).rows;
  return {
    total,
    items: rows.map(r => ({ auditId: r.audit_id, userId: r.user_id, username: r.username, action: r.action, resource: r.resource, resourceId: r.resource_id, changes: r.changes, timestamp: r.timestamp, ipAddress: r.ip_address })),
  };
}

// --- Session listing ---

export async function getUserSessions(userId: string): Promise<Session[]> {
  const rows = (await getPool().query('SELECT * FROM sessions WHERE user_id = $1 AND is_active = 1 ORDER BY login_at DESC', [userId])).rows;
  return rows.map(r => ({ sessionId: r.session_id, userId: r.user_id, device: r.device, ipAddress: r.ip_address, loginAt: r.login_at, expiresAt: r.expires_at, isActive: !!r.is_active }));
}

// --- Config Change Tracking ---

export interface ConfigChange {
  id: number; section: string; key: string; oldValue: string | null;
  newValue: string; changedBy: string; changedAt: string; requiresRestart: boolean;
}

export async function recordConfigChange(section: string, key: string, oldValue: string | null, newValue: string, changedBy: string, requiresRestart: boolean): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO config_changes (section, key, old_value, new_value, changed_by, changed_at, requires_restart) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [section, key, oldValue, newValue, changedBy, new Date().toISOString(), requiresRestart ? 1 : 0]
  );
  await pool.query(`DELETE FROM config_changes WHERE id NOT IN (SELECT id FROM config_changes ORDER BY changed_at DESC LIMIT 50)`);
}

export async function getConfigChanges(limit = 10): Promise<ConfigChange[]> {
  const rows = (await getPool().query('SELECT * FROM config_changes ORDER BY changed_at DESC LIMIT $1', [limit])).rows;
  return rows.map(r => ({ id: r.id, section: r.section, key: r.key, oldValue: r.old_value, newValue: r.new_value, changedBy: r.changed_by, changedAt: r.changed_at, requiresRestart: !!r.requires_restart }));
}

// --- Query Logs ---

export async function recordQueryLog(query: string, responseTimeMs: number, resultCount: number, userId = ''): Promise<void> {
  await getPool().query(
    'INSERT INTO query_logs (query, timestamp, response_time_ms, result_count, user_id) VALUES ($1, $2, $3, $4, $5)',
    [query, new Date().toISOString(), responseTimeMs, resultCount, userId]
  );
}

export async function getQueryLogs(days = 14, userId?: string): Promise<{ date: string; queries: number; avgResponseTime: number }[]> {
  const pool = getPool();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  let pIdx = 2;
  let sql = `SELECT LEFT(timestamp, 10) as date, COUNT(*) as queries, CAST(AVG(response_time_ms) AS INTEGER) as avg_response_time FROM query_logs WHERE timestamp >= $1`;
  const params: any[] = [since];
  if (userId) { sql += ` AND user_id = $${pIdx++}`; params.push(userId); }
  sql += ` GROUP BY LEFT(timestamp, 10) ORDER BY date ASC`;
  const rows = (await pool.query(sql, params)).rows;
  return rows.map(r => ({ date: r.date, queries: parseInt(r.queries), avgResponseTime: parseInt(r.avg_response_time) || 0 }));
}

export async function getQueryLogStats(userId?: string): Promise<{ totalQueries: number; avgResponseTime: number; queriesLast24h: number }> {
  const pool = getPool();
  let pIdx = 1;
  const totalParams: any[] = [];
  let userFilter = '';
  if (userId) { userFilter = ` WHERE user_id = $${pIdx++}`; totalParams.push(userId); }
  const total = (await pool.query(`SELECT COUNT(*) as cnt, CAST(AVG(response_time_ms) AS INTEGER) as avg FROM query_logs${userFilter}`, totalParams)).rows[0];
  const since24h = new Date(Date.now() - 86400000).toISOString();
  const last24hParams: any[] = [since24h];
  let userFilterAnd = '';
  if (userId) { userFilterAnd = ` AND user_id = $2`; last24hParams.push(userId); }
  const last24h = parseInt((await pool.query(`SELECT COUNT(*) as cnt FROM query_logs WHERE timestamp >= $1${userFilterAnd}`, last24hParams)).rows[0].cnt);
  return { totalQueries: parseInt(total.cnt) || 0, avgResponseTime: parseInt(total.avg) || 0, queriesLast24h: last24h || 0 };
}

// --- Promotion Cooldown ---

export async function setPromotionCooldown(entryId: string, rejectedBy: string): Promise<void> {
  const cooldownUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await getPool().query(
    'INSERT INTO promotion_cooldowns (entry_id, cooldown_until, rejected_at, rejected_by) VALUES ($1, $2, $3, $4)',
    [entryId, cooldownUntil, new Date().toISOString(), rejectedBy]
  );
}

export async function checkPromotionCooldown(entryId: string): Promise<{ onCooldown: boolean; cooldownUntil?: string }> {
  const now = new Date().toISOString();
  const row = (await getPool().query(
    'SELECT cooldown_until FROM promotion_cooldowns WHERE entry_id = $1 AND cooldown_until > $2 ORDER BY cooldown_until DESC LIMIT 1',
    [entryId, now]
  )).rows[0];
  if (row) return { onCooldown: true, cooldownUntil: row.cooldown_until };
  return { onCooldown: false };
}

// --- KB search ---

export async function searchKbEntries(query: string): Promise<{ items: any[]; total: number }> {
  try {
    const pool = getPool();
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    if (queryTerms.length === 0) return { items: [], total: 0 };

    const totalDocs = parseInt((await pool.query('SELECT COUNT(*) as cnt FROM knowledge_entries')).rows[0].cnt);

    const searchCols = ['content', 'source', 'summary', 'tags'];
    const likeClauses: string[] = [];
    const likeParams: string[] = [];
    let pIdx = 1;
    for (const term of queryTerms) {
      for (const col of searchCols) {
        likeClauses.push(`${col} LIKE $${pIdx++}`);
        likeParams.push(`%${term}%`);
      }
    }
    const rows = (await pool.query(`SELECT * FROM knowledge_entries WHERE ${likeClauses.join(' OR ')} LIMIT 200`, likeParams)).rows;

    const termDocFreq: Record<string, number> = {};
    for (const term of queryTerms) {
      let docCount = 0;
      for (const row of rows) {
        const text = `${row.content || ''} ${row.source || ''} ${row.summary || ''} ${row.tags || ''}`.toLowerCase();
        if (text.includes(term)) docCount++;
      }
      termDocFreq[term] = docCount;
    }

    const now = Date.now();
    const scoredRows = rows.map((row: any) => {
      const fields = {
        content: (row.content || '').toLowerCase(),
        source: (row.source || '').toLowerCase(),
        summary: (row.summary || '').toLowerCase(),
        tags: (row.tags || '').toLowerCase(),
      };
      const fullText = `${fields.content} ${fields.source} ${fields.summary} ${fields.tags}`;
      const totalWords = fullText.split(/\s+/).length || 1;
      let tfidfScore = 0;
      for (const term of queryTerms) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'gi');
        const tf = (fullText.match(regex) || []).length / totalWords;
        const idf = Math.log((totalDocs + 1) / ((termDocFreq[term] || 1) + 1)) + 1;
        tfidfScore += tf * idf;
      }
      const normalizedTfidf = Math.min(tfidfScore * 100, 1.0);
      let keywordBonus = 0;
      for (const term of queryTerms) {
        if (fields.source.includes(term)) keywordBonus += 0.15;
        if (fields.summary.includes(term)) keywordBonus += 0.1;
        if (fields.tags.includes(term)) keywordBonus += 0.05;
      }
      keywordBonus = Math.min(keywordBonus, 0.3);
      const ageDays = (now - (row.created_at ? new Date(row.created_at).getTime() : 0)) / (1000 * 60 * 60 * 24);
      const recencyBonus = ageDays <= 7 ? 0.2 : ageDays <= 30 ? 0.1 : 0;
      const qualityBonus = (row.quality_score != null ? row.quality_score / 100 : (row.confidence || 0)) * 0.1;
      const finalScore = Math.min(+(normalizedTfidf + keywordBonus + recencyBonus + qualityBonus).toFixed(3), 1.0);
      return { ...row, score: finalScore, scores: { similarity: +normalizedTfidf.toFixed(3), keyword: +keywordBonus.toFixed(3), recency: +recencyBonus.toFixed(3), quality: +qualityBonus.toFixed(3) } };
    });
    scoredRows.sort((a: any, b: any) => b.score - a.score);
    return { items: scoredRows.slice(0, 50), total: scoredRows.length };
  } catch {
    return { items: [], total: 0 };
  }
}

// --- KB Embedding space ---

export async function getKbEmbeddings(limit = 100): Promise<{ items: { id: string; label: string; x: number; y: number; type: string }[]; hasRealData: boolean }> {
  try {
    const pool = getPool();
    const rows = (await pool.query(`
      SELECT e.id, e.source, e.summary, e.type, e.tier, v.vector
      FROM knowledge_entries e
      INNER JOIN knowledge_vectors v ON v.entry_id = e.id
      WHERE v.vector IS NOT NULL
      ORDER BY e.created_at DESC LIMIT $1
    `, [limit])).rows;

    if (rows.length > 0) {
      const items = rows.map((row: any, i: number) => {
        let x = 0, y = 0;
        try {
          let embedding: number[] = [];
          if (typeof row.vector === 'string') {
            embedding = JSON.parse(row.vector);
          } else if (Buffer.isBuffer(row.vector)) {
            const buf = row.vector as Buffer;
            const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
            embedding = Array.from(floats);
          }
          if (embedding.length >= 2) {
            const half = Math.floor(embedding.length / 2);
            let sumX = 0, sumY = 0;
            for (let j = 0; j < half; j++) { sumX += embedding[j]; sumY += embedding[j + half]; }
            x = Math.max(0, Math.min(1, +((sumX / half + 1) / 2).toFixed(3)));
            y = Math.max(0, Math.min(1, +((sumY / half + 1) / 2).toFixed(3)));
          }
        } catch {
          const content = row.source || row.summary || '';
          let h1 = 0, h2 = 0;
          for (let j = 0; j < content.length; j++) {
            h1 = (h1 * 31 + content.charCodeAt(j)) & 0x7fffffff;
            h2 = (h2 * 37 + content.charCodeAt(j)) & 0x7fffffff;
          }
          x = +((h1 % 1000) / 1000).toFixed(3);
          y = +((h2 % 1000) / 1000).toFixed(3);
        }
        return { id: String(row.id), label: row.source || row.summary || `Entry ${i + 1}`, x, y, type: row.type || 'document' };
      });
      return { items, hasRealData: true };
    }

    const fallbackRows = (await pool.query('SELECT id, source, summary, type, content FROM knowledge_entries ORDER BY created_at DESC LIMIT $1', [limit])).rows;
    if (fallbackRows.length === 0) return { items: [], hasRealData: false };
    const items = fallbackRows.map((row: any, i: number) => {
      const content = row.content || row.source || row.summary || '';
      let h1 = 0, h2 = 0;
      for (let j = 0; j < content.length; j++) {
        h1 = (h1 * 31 + content.charCodeAt(j)) & 0x7fffffff;
        h2 = (h2 * 37 + content.charCodeAt(j)) & 0x7fffffff;
      }
      return { id: String(row.id), label: row.source || row.summary || `Entry ${i + 1}`, x: +((h1 % 1000) / 1000).toFixed(3), y: +((h2 % 1000) / 1000).toFixed(3), type: row.type || 'document' };
    });
    return { items, hasRealData: true };
  } catch {
    return { items: [], hasRealData: false };
  }
}

// --- KB single entry ---

export async function getKbEntryById(entryId: string): Promise<any | null> {
  try {
    const row = (await getPool().query('SELECT * FROM knowledge_entries WHERE id = $1', [entryId])).rows[0];
    return row || null;
  } catch {
    return null;
  }
}

// --- KB Entry Count ---

export async function getKbEntryCount(): Promise<number> {
  try {
    return parseInt((await getPool().query('SELECT COUNT(*) as cnt FROM knowledge_entries')).rows[0].cnt);
  } catch {
    return 0;
  }
}

export async function getKbEntries(page = 1, pageSize = 20, sortBy = 'created_at', sortDir: 'asc' | 'desc' = 'desc'): Promise<{ items: any[]; total: number }> {
  try {
    const pool = getPool();
    const colResult = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'knowledge_entries'"
    );
    const validColumns = colResult.rows.map((c: any) => c.column_name);
    const safeSort = validColumns.includes(sortBy) ? sortBy : 'created_at';
    const safeDir = sortDir === 'asc' ? 'ASC' : 'DESC';
    const total = parseInt((await pool.query('SELECT COUNT(*) as cnt FROM knowledge_entries')).rows[0].cnt);
    const rows = (await pool.query(
      `SELECT * FROM knowledge_entries ORDER BY ${safeSort} ${safeDir} LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize]
    )).rows;
    return { items: rows, total };
  } catch {
    return { items: [], total: 0 };
  }
}

// --- Recent Activity ---

export async function getRecentActivity(limit = 10): Promise<AuditEntry[]> {
  const rows = (await getPool().query('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT $1', [limit])).rows;
  return rows.map(r => ({ auditId: r.audit_id, userId: r.user_id, username: r.username, action: r.action, resource: r.resource, resourceId: r.resource_id, changes: r.changes, timestamp: r.timestamp, ipAddress: r.ip_address }));
}

// --- KB Tags Management ---

export async function getAllKbTags(): Promise<Record<string, { count: number; lastUsed: string }>> {
  const tagCounts: Record<string, { count: number; lastUsed: string }> = {};
  try {
    const rows = (await getPool().query("SELECT tags, created_at FROM knowledge_entries WHERE tags IS NOT NULL AND tags != ''")).rows;
    for (const row of rows) {
      if (!row.tags) continue;
      const tags = row.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
      for (const tag of tags) {
        if (!tagCounts[tag]) tagCounts[tag] = { count: 0, lastUsed: row.created_at || new Date().toISOString() };
        tagCounts[tag].count++;
        if (row.created_at && new Date(row.created_at) > new Date(tagCounts[tag].lastUsed)) tagCounts[tag].lastUsed = row.created_at;
      }
    }
  } catch (e) { console.error('Error in getAllKbTags:', e); }
  return tagCounts;
}

export async function updateKbEntryTags(entryId: string, tags: string[]): Promise<void> {
  try {
    await getPool().query('UPDATE knowledge_entries SET tags = $1 WHERE id = $2', [tags.join(','), entryId]);
  } catch (e) { console.error('Error in updateKbEntryTags:', e); }
}

export async function renameKbTag(oldName: string, newName: string): Promise<number> {
  let renamed = 0;
  try {
    const pool = getPool();
    const rows = (await pool.query('SELECT id, tags FROM knowledge_entries WHERE tags LIKE $1', [`%${oldName}%`])).rows;
    for (const row of rows) {
      if (!row.tags) continue;
      const tagArr = row.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
      const idx = tagArr.indexOf(oldName);
      if (idx !== -1) { tagArr[idx] = newName.trim(); await pool.query('UPDATE knowledge_entries SET tags = $1 WHERE id = $2', [tagArr.join(','), row.id]); renamed++; }
    }
  } catch (e) { console.error('Error in renameKbTag:', e); }
  return renamed;
}

export async function deleteKbTag(tagName: string): Promise<number> {
  let removed = 0;
  try {
    const pool = getPool();
    const rows = (await pool.query('SELECT id, tags FROM knowledge_entries WHERE tags LIKE $1', [`%${tagName}%`])).rows;
    for (const row of rows) {
      if (!row.tags) continue;
      const tagArr = row.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
      const idx = tagArr.indexOf(tagName);
      if (idx !== -1) { tagArr.splice(idx, 1); await pool.query('UPDATE knowledge_entries SET tags = $1 WHERE id = $2', [tagArr.join(','), row.id]); removed++; }
    }
  } catch (e) { console.error('Error in deleteKbTag:', e); }
  return removed;
}

export async function mergeKbTags(sourceTag: string, targetTag: string): Promise<number> {
  let merged = 0;
  try {
    const pool = getPool();
    const rows = (await pool.query('SELECT id, tags FROM knowledge_entries WHERE tags LIKE $1', [`%${sourceTag}%`])).rows;
    for (const row of rows) {
      if (!row.tags) continue;
      const tagArr = row.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
      const idx = tagArr.indexOf(sourceTag);
      if (idx !== -1) {
        tagArr.splice(idx, 1);
        if (!tagArr.includes(targetTag)) tagArr.push(targetTag);
        await pool.query('UPDATE knowledge_entries SET tags = $1 WHERE id = $2', [tagArr.join(','), row.id]);
        merged++;
      }
    }
  } catch (e) { console.error('Error in mergeKbTags:', e); }
  return merged;
}

export async function getKbEntriesByTag(tagName: string): Promise<any[]> {
  const entries: any[] = [];
  try {
    const rows = (await getPool().query('SELECT * FROM knowledge_entries WHERE tags LIKE $1', [`%${tagName}%`])).rows;
    for (const row of rows) {
      if (!row.tags) continue;
      if (row.tags.split(',').map((t: string) => t.trim()).includes(tagName)) entries.push(row);
    }
  } catch (e) { console.error('Error in getKbEntriesByTag:', e); }
  return entries;
}

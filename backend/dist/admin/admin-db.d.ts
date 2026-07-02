/**
 * Admin Portal Database Layer — PostgreSQL
 */
import type { User, UserStatus, AccessGroup, GroupPermission, Session, AuditEntry } from './types/rbac.types.js';
export declare function initAdminDb(): Promise<void>;
export declare function hashPassword(password: string): string;
export declare function verifyPassword(password: string, stored: string): boolean;
export declare function generateToken(): string;
export declare function createSession(userId: string, device?: string, ip?: string): Promise<Session & {
    token: string;
}>;
export declare function validateSession(token: string): Promise<{
    userId: string;
    username: string;
    accessGroupId: string;
} | null>;
export declare function invalidateSession(token: string): Promise<void>;
export declare function invalidateUserSessions(userId: string): Promise<number>;
export declare function refreshSession(token: string): Promise<{
    token: string;
    expiresAt: string;
} | null>;
export declare function getUsers(filters?: {
    status?: string;
    search?: string;
    accessGroupId?: string;
}, page?: number, pageSize?: number): Promise<{
    items: any[];
    total: number;
}>;
export declare function getUserById(userId: string): Promise<User | null>;
export declare function getUserByUsername(username: string): Promise<(User & {
    passwordHash: string;
}) | null>;
export declare function createUser(username: string, email: string, password: string, accessGroupId: string): Promise<User>;
export declare function updateUserStatus(userId: string, status: UserStatus): Promise<number>;
export declare function deleteUser(userId: string): Promise<void>;
export declare function resetUserPassword(userId: string): Promise<string>;
export declare function changePassword(userId: string, newPassword: string): Promise<void>;
export declare function updateLastLogin(userId: string): Promise<void>;
export declare function getGroups(): Promise<AccessGroup[]>;
export declare function getGroupById(groupId: string): Promise<AccessGroup | null>;
export declare function createGroup(name: string, permissions: GroupPermission[]): Promise<AccessGroup>;
export declare function updateGroup(groupId: string, name: string | undefined, permissions: GroupPermission[]): Promise<AccessGroup>;
export declare function deleteGroup(groupId: string): Promise<void>;
export declare function getUserPermissions(userId: string): Promise<GroupPermission[]>;
export declare function recordAudit(userId: string, username: string, action: string, resource: string, resourceId?: string, changes?: string, ip?: string): Promise<void>;
export declare function getAuditLogs(filters?: {
    userId?: string;
    action?: string;
    dateFrom?: string;
    dateTo?: string;
}, page?: number, pageSize?: number): Promise<{
    items: AuditEntry[];
    total: number;
}>;
export declare function getUserSessions(userId: string): Promise<Session[]>;
export interface ConfigChange {
    id: number;
    section: string;
    key: string;
    oldValue: string | null;
    newValue: string;
    changedBy: string;
    changedAt: string;
    requiresRestart: boolean;
}
export declare function recordConfigChange(section: string, key: string, oldValue: string | null, newValue: string, changedBy: string, requiresRestart: boolean): Promise<void>;
export declare function getConfigChanges(limit?: number): Promise<ConfigChange[]>;
export declare function recordQueryLog(query: string, responseTimeMs: number, resultCount: number, userId?: string): Promise<void>;
export declare function getQueryLogs(days?: number, userId?: string): Promise<{
    date: string;
    queries: number;
    avgResponseTime: number;
}[]>;
export declare function getQueryLogStats(userId?: string): Promise<{
    totalQueries: number;
    avgResponseTime: number;
    queriesLast24h: number;
}>;
export declare function setPromotionCooldown(entryId: string, rejectedBy: string): Promise<void>;
export declare function checkPromotionCooldown(entryId: string): Promise<{
    onCooldown: boolean;
    cooldownUntil?: string;
}>;
export declare function searchKbEntries(query: string): Promise<{
    items: any[];
    total: number;
}>;
export declare function getKbEmbeddings(limit?: number): Promise<{
    items: {
        id: string;
        label: string;
        x: number;
        y: number;
        type: string;
    }[];
    hasRealData: boolean;
}>;
export declare function getKbEntryById(entryId: string): Promise<any | null>;
export declare function getKbEntryCount(): Promise<number>;
export declare function getKbEntries(page?: number, pageSize?: number, sortBy?: string, sortDir?: 'asc' | 'desc'): Promise<{
    items: any[];
    total: number;
}>;
export declare function getRecentActivity(limit?: number): Promise<AuditEntry[]>;
export declare function getAllKbTags(): Promise<Record<string, {
    count: number;
    lastUsed: string;
}>>;
export declare function updateKbEntryTags(entryId: string, tags: string[]): Promise<void>;
export declare function renameKbTag(oldName: string, newName: string): Promise<number>;
export declare function deleteKbTag(tagName: string): Promise<number>;
export declare function mergeKbTags(sourceTag: string, targetTag: string): Promise<number>;
export declare function getKbEntriesByTag(tagName: string): Promise<any[]>;

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Database } from 'sqlite';

export const API_SCOPES = ['servers.read', 'resources.read', 'backups.read', 'backups.create', 'operations.read'] as const;
export type ApiScope = typeof API_SCOPES[number];
export type ApiToken = {
    id: string; ownerId: number; name: string; scopes: ApiScope[]; serverIds: string[];
    createdAt: number; expiresAt: number; revokedAt: number | null; lastUsedAt: number | null;
};
type TokenRow = {
    id: string; owner_id: number; name: string; scopes: string; server_ids: string;
    created_at: number; expires_at: number; revoked_at: number | null; last_used_at: number | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = (secret: string) => createHash('sha256').update(secret).digest('hex');
const columns = 'id,owner_id,name,scopes,server_ids,created_at,expires_at,revoked_at,last_used_at';
function decode(row: TokenRow): ApiToken {
    const scopes: unknown = JSON.parse(row.scopes), serverIds: unknown = JSON.parse(row.server_ids);
    if (!Array.isArray(scopes) || !scopes.length || !scopes.every(s => API_SCOPES.includes(s)) ||
        !Array.isArray(serverIds) || !serverIds.length || !serverIds.every(s => typeof s === 'string' && uuid.test(s)))
        throw new Error('Invalid stored API token restrictions');
    return { id: row.id, ownerId: row.owner_id, name: row.name, scopes, serverIds,
        createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at, lastUsedAt: row.last_used_at };
}

/** Token storage only. Routes must also check the owner's CURRENT account and server permissions. */
export class ApiTokenStore {
    constructor(private db: Database, private now: () => number = Date.now) {}
    async initialize() {
        await this.db.exec(`CREATE TABLE IF NOT EXISTS api_tokens (
            id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL, secret_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL,
            server_ids TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
            revoked_at INTEGER, last_used_at INTEGER
        ); CREATE INDEX IF NOT EXISTS api_tokens_owner ON api_tokens(owner_id)`);
    }
    async create(ownerId: number, input: { name: string; scopes: ApiScope[]; serverIds: string[]; expiresAt: number }) {
        const now = this.now();
        if (!Number.isSafeInteger(ownerId) || ownerId < 1 || typeof input.name !== 'string' ||
            !input.name.trim() || input.name.trim().length > 80 || /[\x00-\x1f\x7f]/.test(input.name) ||
            !Array.isArray(input.scopes) || !input.scopes.length || input.scopes.length > API_SCOPES.length ||
            !input.scopes.every(s => API_SCOPES.includes(s)) ||
            !Array.isArray(input.serverIds) || !input.serverIds.length || input.serverIds.length > 100 ||
            !input.serverIds.every(s => typeof s === 'string' && uuid.test(s)) ||
            !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now || input.expiresAt > now + 365 * 86400000)
            throw new Error('Invalid API token parameters');
        const token: ApiToken = { id: randomUUID(), ownerId, name: input.name.trim(),
            scopes: [...new Set(input.scopes)], serverIds: [...new Set(input.serverIds.map(s => s.toLowerCase()))],
            createdAt: now, expiresAt: input.expiresAt, revokedAt: null, lastUsedAt: null };
        // 256 random bits. Only this creation response contains the bearer secret.
        const secret = `gpp_${randomBytes(32).toString('base64url')}`;
        await this.db.run(`INSERT INTO api_tokens(id,owner_id,name,secret_hash,scopes,server_ids,created_at,expires_at)
            VALUES(?,?,?,?,?,?,?,?)`, token.id, ownerId, token.name, digest(secret),
            JSON.stringify(token.scopes), JSON.stringify(token.serverIds), now, token.expiresAt);
        return { token, secret };
    }
    async list(ownerId: number): Promise<ApiToken[]> {
        const rows = await this.db.all<TokenRow[]>(`SELECT ${columns} FROM api_tokens WHERE owner_id=? ORDER BY created_at DESC,id`, ownerId);
        return rows.map(decode);
    }
    async authenticate(secret: string): Promise<ApiToken | null> {
        if (!/^gpp_[A-Za-z0-9_-]{43}$/.test(secret)) return null;
        const row = await this.db.get<TokenRow>(`SELECT ${columns} FROM api_tokens
            WHERE secret_hash=? AND revoked_at IS NULL AND expires_at>?`, digest(secret), this.now());
        if (!row) return null;
        try { return decode(row); } catch { return null; }
    }
    async revoke(ownerId: number, id: string) {
        const result = await this.db.run('UPDATE api_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE owner_id=? AND id=?', this.now(), ownerId, id);
        return result.changes === 1;
    }
    async markUsed(id: string) {
        await this.db.run('UPDATE api_tokens SET last_used_at=? WHERE id=? AND revoked_at IS NULL AND expires_at>?', this.now(), id, this.now());
    }
}

/** null means no current membership; an empty permission list can still allow basic server visibility. */
export function tokenAllows(token: ApiToken, serverId: string, scope: ApiScope,
    owner: { enabled: boolean; permissions: readonly string[] | null }, now = Date.now()): boolean {
    if (!owner.enabled || owner.permissions === null || token.revokedAt !== null || token.expiresAt <= now ||
        !token.serverIds.includes(serverId) || !token.scopes.includes(scope)) return false;
    if (scope === 'backups.read' || scope === 'backups.create') return owner.permissions.includes(scope);
    return true;
}

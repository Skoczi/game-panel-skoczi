import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Database } from 'sqlite';
import { digest, nodeOrigin, seal, secret, unseal } from './protocol.js';

export type NodeRow = { id: string; name: string; origin: string; location: string; enabled: number;
    key_encrypted: string | null; enrollment_hash: string | null; enrollment_expires: number | null;
    last_seen: number | null; agent_version: string | null; created_at: number };
export type PublicNode = Omit<NodeRow, 'key_encrypted' | 'enrollment_hash' | 'enrollment_expires'> & {
    status: 'pending' | 'disabled' | 'online' | 'offline';
};
export class NodeStore {
    constructor(private db: Database, private master: string, private allowLoopback = false) {}
    async initialize() {
        await this.db.exec(`CREATE TABLE IF NOT EXISTS execution_nodes (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, origin TEXT NOT NULL UNIQUE, location TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), key_encrypted TEXT,
          enrollment_hash TEXT, enrollment_expires INTEGER, last_seen INTEGER, agent_version TEXT, created_at INTEGER NOT NULL
        ); CREATE TABLE IF NOT EXISTS node_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT NOT NULL, actor TEXT NOT NULL,
          action TEXT NOT NULL, created_at INTEGER NOT NULL
        )`);
    }
    async audit(nodeId: string, actor: string, action: string) {
        await this.db.run('INSERT INTO node_audit(node_id,actor,action,created_at) VALUES(?,?,?,?)', nodeId, actor, action, Date.now());
    }
    async get(id: string): Promise<NodeRow | undefined> { return this.db.get('SELECT * FROM execution_nodes WHERE id=?', id); }
    public(row: NodeRow): PublicNode {
        const { key_encrypted, enrollment_hash: _hash, enrollment_expires: _expiry, ...safe } = row;
        return { ...safe, status: !row.enabled ? 'disabled' : !key_encrypted ? 'pending' :
            row.last_seen && Date.now() - row.last_seen < 60000 ? 'online' : 'offline' };
    }
    async list(): Promise<PublicNode[]> { return (await this.db.all<NodeRow[]>('SELECT * FROM execution_nodes ORDER BY created_at')).map(row => this.public(row)); }
    async create(input: { name: string; origin: string; location?: string }, actor: string) {
        const name = input.name?.trim(); const location = input.location?.trim() || '';
        if (!name || name.length > 80 || location.length > 120) throw new Error('Name (1–80) and location (0–120) required');
        const origin = nodeOrigin(input.origin, this.allowLoopback); const id = randomUUID(); const token = secret();
        await this.db.run('INSERT INTO execution_nodes(id,name,origin,location,enrollment_hash,enrollment_expires,created_at) VALUES(?,?,?,?,?,?,?)',
            id, name, origin, location, digest(token), Date.now() + 15 * 60000, Date.now());
        await this.audit(id, actor, 'created');
        return { node: this.public((await this.get(id))!), enrollmentToken: token, expiresInSeconds: 900 };
    }
    async enroll(id: string, token: string) {
        if (typeof token !== 'string' || token.length !== 43) throw new Error('Invalid enrollment');
        const row = await this.get(id);
        const hash = digest(token);
        if (!row?.enabled || !row.enrollment_hash || !row.enrollment_expires || row.enrollment_expires < Date.now() ||
            !timingSafeEqual(Buffer.from(hash), Buffer.from(row.enrollment_hash))) throw new Error('Invalid or expired enrollment');
        const key = secret();
        // Atomic token consumption; parallel requests cannot enroll twice.
        const changed = await this.db.run('UPDATE execution_nodes SET key_encrypted=?,enrollment_hash=NULL,enrollment_expires=NULL,last_seen=NULL WHERE id=? AND enrollment_hash=? AND enrollment_expires>? AND enabled=1',
            seal(key, this.master, id), id, hash, Date.now());
        if (changed.changes !== 1) throw new Error('Enrollment already consumed');
        await this.audit(id, 'agent', 'enrolled');
        return { nodeId: id, key, origin: row.origin, protocol: 1 };
    }
    key(row: NodeRow): string {
        if (!row.enabled || !row.key_encrypted) throw new Error('Node disabled or not enrolled');
        return unseal(row.key_encrypted, this.master, row.id);
    }
    async setEnabled(id: string, enabled: boolean, actor: string) {
        if (!await this.get(id)) throw new Error('Node not found');
        await this.db.run('UPDATE execution_nodes SET enabled=? WHERE id=?', enabled ? 1 : 0, id);
        await this.audit(id, actor, enabled ? 'enabled' : 'disabled');
    }
    async renewEnrollment(id: string, actor: string) {
        if (!await this.get(id)) throw new Error('Node not found');
        const token = secret();
        await this.db.run('UPDATE execution_nodes SET key_encrypted=NULL,enrollment_hash=?,enrollment_expires=?,last_seen=NULL WHERE id=?', digest(token), Date.now() + 900000, id);
        await this.audit(id, actor, 'credential-revoked');
        return { enrollmentToken: token, expiresInSeconds: 900 };
    }
    async heartbeat(id: string, version: string) {
        await this.db.run('UPDATE execution_nodes SET last_seen=?,agent_version=? WHERE id=?', Date.now(), version.slice(0,80), id);
    }
}

import { randomUUID } from 'node:crypto';
import type { Database } from 'sqlite';
import { ASSIGNABLE_SERVER_PERMISSIONS } from '../permissions.js';

export type FleetRow = {
    id: string;
    server_number: number;
    node_id: string;
    runtime_id: number;
    name: string;
    provider: string;
    status: string;
    observed_at: number;
    missing: number;
    placement_revision: number;
    runtime_key: string;
    catalog_id: string | null;
};
export type InventoryItem = {
    id: number;
    runtimeKey: string;
    name: string;
    provider: string;
    status: string;
    catalogId?: string | null;
};

export class FleetStore {
    constructor(private db: Database) {}
    async initialize() {
        await this.db.exec(`CREATE TABLE IF NOT EXISTS fleet_servers (
            id TEXT PRIMARY KEY, node_id TEXT NOT NULL, runtime_id INTEGER NOT NULL,
            runtime_key TEXT NOT NULL, name TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL,
            observed_at INTEGER NOT NULL, missing INTEGER NOT NULL DEFAULT 0,
            placement_revision INTEGER NOT NULL DEFAULT 1, UNIQUE(node_id,runtime_key)
        ); CREATE TABLE IF NOT EXISTS fleet_grants (
            server_id TEXT NOT NULL REFERENCES fleet_servers(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            permissions_json TEXT NOT NULL, PRIMARY KEY(server_id,user_id)
        ); CREATE TABLE IF NOT EXISTS fleet_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT, server_id TEXT NOT NULL,
            actor_id INTEGER NOT NULL, action TEXT NOT NULL, created_at INTEGER NOT NULL
        )`);
        const columns = await this.db.all<{ name: string }[]>('PRAGMA table_info(fleet_servers)');
        if (!columns.some(column => column.name === 'catalog_id'))
            await this.db.exec('ALTER TABLE fleet_servers ADD COLUMN catalog_id TEXT');
        // Keep allocations after deletion: human-readable IDs must never be recycled.
        // The trigger allocates atomically with insertion, including concurrent inventories.
        await this.db.exec(`CREATE TABLE IF NOT EXISTS fleet_server_numbers (
            number INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id TEXT NOT NULL UNIQUE
        );
        INSERT INTO fleet_server_numbers(server_id)
            SELECT id FROM fleet_servers
            WHERE id NOT IN (SELECT server_id FROM fleet_server_numbers)
            ORDER BY observed_at,id;
        CREATE TRIGGER IF NOT EXISTS fleet_allocate_server_number
            AFTER INSERT ON fleet_servers BEGIN
                INSERT INTO fleet_server_numbers(server_id)
                    SELECT NEW.id WHERE NOT EXISTS
                    (SELECT 1 FROM fleet_server_numbers WHERE server_id=NEW.id);
            END;`);
    }
    async observe(node: string, inventory: InventoryItem[], requireEnabledNode = false) {
        // Validate the complete snapshot before changing any state; a failed/partial read never marks servers missing.
        if (
            !Array.isArray(inventory) ||
            inventory.length > 10000 ||
            inventory.some(
                (s) =>
                    !Number.isSafeInteger(s.id) ||
                    s.id <= 0 ||
                    typeof s.name !== 'string' ||
                    s.name.length > 256 ||
                    typeof s.runtimeKey !== 'string' ||
                    !/^[a-f0-9]{32}$/.test(s.runtimeKey) ||
                    typeof s.provider !== 'string' ||
                    s.provider.length > 100 ||
                    (s.catalogId != null && (typeof s.catalogId !== 'string' || s.catalogId.length > 256)) ||
                    typeof s.status !== 'string' ||
                    s.status.length > 100,
            ) ||
            new Set(inventory.map((s) => s.id)).size !== inventory.length ||
            new Set(inventory.map((s) => s.runtimeKey)).size !== inventory.length
        )
            throw new Error('Invalid node inventory');
        const now = Date.now();
        for (const s of inventory)
            await this.db.run(
                `INSERT INTO fleet_servers
            (id,node_id,runtime_id,runtime_key,name,provider,status,observed_at,catalog_id)
            SELECT ?,?,?,?,?,?,?,?,? WHERE ${requireEnabledNode ? 'EXISTS (SELECT 1 FROM execution_nodes WHERE id=? AND enabled=1)' : '1'}
            ON CONFLICT(node_id,runtime_key) DO UPDATE SET runtime_id=excluded.runtime_id,name=excluded.name,provider=excluded.provider,
            status=excluded.status,observed_at=excluded.observed_at,missing=0,catalog_id=excluded.catalog_id`,
                randomUUID(),
                node,
                s.id,
                s.runtimeKey,
                s.name,
                s.provider,
                s.status,
                now,
                s.catalogId || null,
                ...(requireEnabledNode ? [node] : []),
            );
        const ids = new Set(inventory.map((s) => s.runtimeKey));
        for (const row of await this.list())
            if (row.node_id === node && !ids.has(row.runtime_key))
                await this.db.run('UPDATE fleet_servers SET missing=1 WHERE id=?', row.id);
    }
    get(id: string): Promise<FleetRow | undefined> {
        return this.db.get('SELECT s.*,n.number AS server_number FROM fleet_servers s JOIN fleet_server_numbers n ON n.server_id=s.id WHERE s.id=?', id);
    }
    getByNumber(number: number): Promise<FleetRow | undefined> {
        return this.db.get('SELECT s.*,n.number AS server_number FROM fleet_servers s JOIN fleet_server_numbers n ON n.server_id=s.id WHERE n.number=?', number);
    }
    list(): Promise<FleetRow[]> {
        return this.db.all('SELECT s.*,n.number AS server_number FROM fleet_servers s JOIN fleet_server_numbers n ON n.server_id=s.id ORDER BY s.name,s.id');
    }
    async grants(id: string) {
        return this.db.all<{ user_id: number; username: string; permissions_json: string }[]>(
            'SELECT g.user_id,u.username,g.permissions_json FROM fleet_grants g JOIN users u ON u.id=g.user_id WHERE g.server_id=? ORDER BY u.username',
            id,
        );
    }
    async permissions(id: string, userId: number): Promise<string[] | null> {
        const row = await this.db.get(
            'SELECT permissions_json FROM fleet_grants WHERE server_id=? AND user_id=?',
            id,
            userId,
        );
        return row ? JSON.parse(row.permissions_json) : null;
    }
    async grant(id: string, userId: number, permissions: unknown, actorId: number) {
        if (
            !Array.isArray(permissions) ||
            permissions.length > ASSIGNABLE_SERVER_PERMISSIONS.size ||
            !permissions.every((p) => typeof p === 'string' && ASSIGNABLE_SERVER_PERMISSIONS.has(p))
        )
            throw new Error('Invalid permissions');
        await this.db.run(
            `INSERT INTO fleet_grants(server_id,user_id,permissions_json) VALUES(?,?,?)
            ON CONFLICT(server_id,user_id) DO UPDATE SET permissions_json=excluded.permissions_json`,
            id,
            userId,
            JSON.stringify([...new Set(permissions)].sort()),
        );
        await this.audit(id, actorId, `grant:${userId}:${JSON.stringify(permissions)}`);
    }
    async revoke(id: string, userId: number, actorId: number) {
        await this.db.run('DELETE FROM fleet_grants WHERE server_id=? AND user_id=?', id, userId);
        await this.audit(id, actorId, `revoke:${userId}`);
    }
    audit(id: string, actorId: number, action: string) {
        return this.db.run(
            'INSERT INTO fleet_audit(server_id,actor_id,action,created_at) VALUES(?,?,?,?)',
            id,
            actorId,
            action,
            Date.now(),
        );
    }
}

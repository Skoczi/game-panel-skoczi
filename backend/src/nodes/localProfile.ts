import type { Database } from 'sqlite';

export function validateLocalProfile(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['name', 'location', 'origin'].includes(k)))
        throw new Error('Expected name, location and origin only.');
    const fields = value as Record<string, unknown>;
    const clean = (key: string, max: number) => {
        if (typeof fields[key] !== 'string' || (fields[key] as string).length > max || /[\x00-\x1f\x7f]/.test(fields[key] as string))
            throw new Error(`Invalid ${key}.`);
        return (fields[key] as string).trim();
    };
    const name = clean('name', 80), location = clean('location', 120), origin = clean('origin', 256);
    if (!name) throw new Error('Name is required.');
    if (origin) {
        let url: URL;
        try { url = new URL(origin); } catch { throw new Error('Origin must be an HTTP(S) origin or empty.'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
            throw new Error('Origin must contain only scheme, hostname and optional port.');
        return { name, location, origin: url.origin };
    }
    return { name, location, origin };
}

export class LocalProfileStore {
    constructor(private db: Database) {}
    async initialize() {
        await this.db.exec(`CREATE TABLE IF NOT EXISTS local_node_profile (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, location TEXT NOT NULL, origin TEXT NOT NULL)`);
        await this.db.run("INSERT OR IGNORE INTO local_node_profile VALUES(1,'Local','','')");
    }
    async read() { return this.db.get<{name: string; location: string; origin: string}>('SELECT name,location,origin FROM local_node_profile WHERE id=1'); }
    async save(value: unknown) {
        const profile = validateLocalProfile(value);
        await this.db.run('UPDATE local_node_profile SET name=?,location=?,origin=? WHERE id=1', profile.name, profile.location, profile.origin);
        return profile;
    }
}

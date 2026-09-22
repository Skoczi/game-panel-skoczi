import { randomUUID } from 'node:crypto';
import type { Database } from 'sqlite';
export const ALERT_CATEGORIES = ['game', 'node', 'backup', 'schedule', 'recovery'] as const;
export type AlertCategory = typeof ALERT_CATEGORIES[number];
export type AlertEvent = { id: string; category: AlertCategory; title: string; detail: string; createdAt: number };
export type AlertConfig = { enabled: boolean; webhook: string; categories: AlertCategory[] };
const defaults: AlertConfig = { enabled: false, webhook: '', categories: [...ALERT_CATEGORIES] };
function invalid(message: string, statusCode = 400): never { throw Object.assign(new Error(message), { statusCode }); }
export function webhookUrl(value: unknown): string {
    if (typeof value !== 'string') return invalid('Enter a Discord webhook URL');
    if (!value) return '';
    if (!/^https:\/\/discord\.com\/api\/webhooks\/\d{15,22}\/[A-Za-z0-9_-]{30,150}$/.test(value)) return invalid('Use an HTTPS discord.com webhook URL without query parameters');
    return value;
}
export function validateAlertBatch(value: unknown, now = Date.now()): AlertEvent[] {
    if (!Array.isArray(value) || value.length > 20) return invalid('Invalid alert batch');
    return value.map(e => {
        if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !/^[a-f0-9-]{36}$/.test(e.id)
            || !ALERT_CATEGORIES.includes(e.category) || typeof e.title !== 'string' || e.title.length > 200
            || typeof e.detail !== 'string' || e.detail.length > 1000 || !Number.isSafeInteger(e.createdAt)
            || e.createdAt > now + 60000 || e.createdAt < now - 86400000) return invalid('Invalid alert event');
        return { id: e.id, category: e.category, title: e.title, detail: e.detail, createdAt: e.createdAt };
    });
}
export class AlertStore {
    constructor(private db: Database) {}
    async config(): Promise<AlertConfig & { revision: number }> {
        const row = await this.db.get('SELECT * FROM alert_settings WHERE id=1');
        return row ? { ...JSON.parse(row.config_json), revision: row.revision } : { ...defaults, revision: 0 };
    }
    async view() {
        const { webhook, ...config } = await this.config();
        const recent = await this.db.all("SELECT id, category, payload_json, created_at, state, attempts, result FROM alert_events WHERE source != 'agent-outbox' ORDER BY created_at DESC LIMIT 20");
        return { ...config, webhookConfigured: Boolean(webhook), recent: recent.map(({ payload_json, ...r }) => ({ ...r, title: JSON.parse(payload_json).title })) };
    }
    async save(input: any) {
        const old = await this.config();
        if (!input || Object.keys(input).some(k => !['revision', 'enabled', 'webhook', 'categories'].includes(k)) || typeof input.enabled !== 'boolean'
            || !Array.isArray(input.categories) || input.categories.some((c: any) => !ALERT_CATEGORIES.includes(c)) || input.categories.length > 5) invalid('Invalid notification settings');
        if (input.revision !== old.revision) invalid('Notification settings changed; reload before saving', 409);
        const config: AlertConfig = { enabled: input.enabled, categories: [...new Set<AlertCategory>(input.categories)], webhook: input.webhook === undefined ? old.webhook : webhookUrl(input.webhook) };
        if (config.enabled && !config.webhook) invalid('Set a Discord webhook before enabling notifications');
        const result = old.revision === 0
            ? await this.db.run('INSERT OR IGNORE INTO alert_settings(id,revision,config_json) VALUES(1,1,?)', JSON.stringify(config))
            : await this.db.run('UPDATE alert_settings SET revision=revision+1,config_json=? WHERE id=1 AND revision=?', JSON.stringify(config), old.revision);
        if (result.changes !== 1) invalid('Notification settings changed; reload before saving', 409);
        // Never deliver a backlog to a newly selected channel or after a disabled period.
        if (!config.enabled || config.webhook !== old.webhook) await this.db.run("UPDATE alert_events SET state='skipped',result='Notification destination changed or disabled' WHERE state='pending' AND source!='agent-outbox'");
        return this.view();
    }
    async enqueue(event: AlertEvent, source: string) {
        const config = source === 'agent-outbox' ? null : await this.config();
        const state = !config || (config.enabled && config.categories.includes(event.category)) ? 'pending' : 'skipped';
        await this.db.run('INSERT OR IGNORE INTO alert_events(id,source,category,payload_json,created_at,state) VALUES(?,?,?,?,?,?)',
            source === 'agent-outbox' ? event.id : `${source}:${event.id}`, source, event.category, JSON.stringify(event), event.createdAt, state);
    }
    async create(category: AlertCategory, title: string, detail: string, source = 'local') {
        const event = { id: randomUUID(), category, title: title.slice(0, 200), detail: detail.slice(0, 1000), createdAt: Date.now() };
        await this.enqueue(event, source); return event;
    }
    async outbox(): Promise<AlertEvent[]> {
        await this.prune();
        return (await this.db.all("SELECT payload_json FROM alert_events WHERE source='agent-outbox' AND state='pending' ORDER BY created_at,id LIMIT 20")).map(r => JSON.parse(r.payload_json));
    }
    async acknowledge(ids: string[]) {
        for (const id of ids) await this.db.run("DELETE FROM alert_events WHERE id=? AND source='agent-outbox'", id);
    }
    async receive(source: string, nodeName: string, events: AlertEvent[]) {
        for (const e of events) await this.enqueue({ ...e, detail: `Node: ${nodeName.slice(0,80)}\n${e.detail}`.slice(0, 1000) }, source);
        return events.map(e => e.id);
    }
    async prune(now = Date.now()) {
        await this.db.run("UPDATE alert_events SET state='expired',result='Delivery window expired' WHERE state='pending' AND created_at<?", now - 86400000);
        await this.db.run('DELETE FROM alert_events WHERE created_at<?', now - 7 * 86400000);
        await this.db.run("DELETE FROM alert_events WHERE source='agent-outbox' AND id NOT IN (SELECT id FROM alert_events WHERE source='agent-outbox' ORDER BY created_at DESC LIMIT 1000)");
    }
    async next(now = Date.now()) { return this.db.get("SELECT * FROM alert_events WHERE state='pending' AND source!='agent-outbox' AND next_at<=? ORDER BY created_at,id LIMIT 1", now); }
    async finish(id: string, state: string, result: string, nextAt = 0) {
        await this.db.run('UPDATE alert_events SET state=?,result=?,attempts=attempts+1,next_at=? WHERE id=?', state, result, nextAt, id);
    }
    async recoverSending() { await this.db.run("UPDATE alert_events SET state='unknown',result='Panel stopped during delivery; verify Discord before retrying' WHERE state='sending'"); }
    async claim(id: string) { return (await this.db.run("UPDATE alert_events SET state='sending' WHERE id=? AND state='pending'", id)).changes === 1; }
    async nodeState(id: string, name: string, offline: boolean, now = Date.now()) {
        const previous = await this.db.get('SELECT * FROM node_alert_state WHERE node_id=?', id);
        if (!previous || Boolean(previous.offline) !== offline) {
            await this.db.run('INSERT INTO node_alert_state(node_id,offline,since) VALUES(?,?,?) ON CONFLICT(node_id) DO UPDATE SET offline=excluded.offline,since=excluded.since', id, Number(offline), now);
            if (offline || previous?.offline) await this.create('node', offline ? 'Node connection lost' : 'Node connection restored', `${name}${!offline && previous ? ` · unavailable for ${Math.round((now-previous.since)/1000)} seconds` : ''}`);
        }
    }
    async forgetNode(id: string) { await this.db.run('DELETE FROM node_alert_state WHERE node_id=?', id); }
}

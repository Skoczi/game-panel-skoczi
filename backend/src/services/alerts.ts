import { getDatabase } from '../database/init.js';
import { isAgent } from '../agent/identity.js';
import { serverRepository } from '../database/index.js';
import { nodes } from '../nodes/control.js';
import { AlertStore, type AlertCategory } from './alertStore.js';
import { deliverDiscord } from './discordAlerts.js';
import { isPanelMaintenance } from './panelMaintenance.js';
import { logError } from '../utils/logger.js';
export async function alertStore() { return new AlertStore(await getDatabase()); }
export function actionAlert(level: string, message: string, actor: string): { category: AlertCategory; title: string } | null {
    if (actor === 'monitor') {
        if (message.startsWith('Game is not responding')) return { category: 'game', title: 'Game is not responding' };
        if (message.startsWith('Game response recovered')) return { category: 'game', title: 'Game response restored' };
        if (message.startsWith('Automatic restart')) return { category: 'recovery', title: message.split(':')[0].slice(0,100) };
    }
    if (actor === 'scheduler' && (level === 'error' || level === 'warning') && /^Scheduled .* (failed|interrupted)/.test(message)) return { category: 'schedule', title: 'Scheduled task failed or was interrupted' };
    if (level === 'error' && /^(backup|restore) failed:/.test(message)) return { category: 'backup', title: 'Backup or restore failed' };
    return null;
}
export async function alertForAction(serverId: number, level: string, message: string, actor: string) {
    const kind = actionAlert(level, message, actor); if (!kind) return;
    const server = await serverRepository.findById(serverId); if (!server) return;
    // Do not forward command contents, game logs or arbitrary error payloads to Discord.
    const detail = `${server.name} · server ${serverId}\n${kind.category === 'game' || kind.category === 'recovery' ? message.slice(0,700) : 'See Activity in Game Panel for the result and details.'}`;
    await (await alertStore()).create(kind.category, kind.title, detail, isAgent() ? 'agent-outbox' : 'local');
}
export function startAlertWorker() {
    let stopped = false, busy = false, nextDelivery = 0;
    const startedAt = Date.now();
    const tick = async () => {
        if (stopped || busy || isAgent() || isPanelMaintenance()) return;
        busy = true;
        try {
            const store = await alertStore();
            // Give agents a chance to reconnect after a panel restart before declaring loss.
            if (Date.now() - startedAt > 90000) for (const node of await nodes().list()) {
                if (!node.enabled || node.status === 'pending') { await store.forgetNode(node.id); continue; }
                await store.nodeState(node.id, node.name, Date.now() - (node.last_seen || node.created_at) > 90000);
            }
            await store.prune();
            if (Date.now() < nextDelivery || stopped) return;
            const row = await store.next(); if (!row) return;
            const config = await store.config();
            if (!config.enabled || !config.webhook || !config.categories.includes(row.category)) { await store.finish(row.id, 'skipped', 'Notification disabled'); return; }
            if (!await store.claim(row.id)) return;
            const delivery = await deliverDiscord(config.webhook, JSON.parse(row.payload_json));
            nextDelivery = Date.now() + (delivery.retrySeconds || 3) * 1000;
            await store.finish(row.id, delivery.state === 'pending' && row.attempts >= 4 ? 'failed' : delivery.state, delivery.result, nextDelivery);
        } catch (error) { logError('ALERT:WORKER', error); }
        finally { busy = false; }
    };
    void alertStore().then(s => s.recoverSending()).then(() => tick()).catch(e => logError('ALERT:START', e));
    const timer = setInterval(() => void tick(), 3000);
    return { stop() { stopped = true; clearInterval(timer); } };
}

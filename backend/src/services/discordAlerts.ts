import type { AlertEvent } from './alertStore.js';
import { webhookUrl } from './alertStore.js';
export type Delivery = { state: 'delivered' | 'failed' | 'unknown' | 'pending'; result: string; retrySeconds?: number };
export async function deliverDiscord(webhook: string, event: AlertEvent, send: typeof fetch = fetch): Promise<Delivery> {
    const url = new URL(webhookUrl(webhook)); url.searchParams.set('wait', 'true');
    try {
        const res = await send(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'Game Panel PRO', allowed_mentions: { parse: [] }, embeds: [{ title: event.title, description: event.detail, timestamp: new Date(event.createdAt).toISOString(), footer: { text: `Event ${event.id}` } }] }) });
        if (res.status === 429) {
            const body = await res.json().catch(() => ({})) as { retry_after?: number };
            return { state: 'pending', result: 'Discord rate limit', retrySeconds: Math.min(86400, Math.max(5, Number(body.retry_after) || 60)) };
        }
        if (res.ok) { await res.body?.cancel(); return { state: 'delivered', result: 'Discord accepted the notification' }; }
        await res.body?.cancel();
        // A server error/timeout can happen after Discord accepted the message. Do not duplicate it blindly.
        return { state: res.status >= 500 ? 'unknown' : 'failed', result: `Discord returned HTTP ${res.status}` };
    } catch { return { state: 'unknown', result: 'Delivery could not be confirmed; check Discord' }; }
}

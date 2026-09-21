import http from 'node:http';
import https from 'node:https';
import type { Database } from 'sqlite';
import type { NodeStore } from './store.js';
import { signNodeRequest } from './protocol.js';
import { nodeTls } from './transport.js';
import { globalSettings } from '../services/globalSettings.js';
import { DEFAULT_APPEARANCE, validateGlobalSettings } from '../services/globalSettingsStore.js';
import { AllocationError, type AllocationRuntime, type RuntimeSettings } from './allocations.js';

export function allocationRuntime(db: Database, nodes: NodeStore): AllocationRuntime {
    async function request<T = RuntimeSettings>(id: string, method: 'GET' | 'PUT', value?: RuntimeSettings, operationId?: string, path = '/api/system/settings'): Promise<T> {
        const node = await nodes.get(id);
        if (!node?.key_encrypted || (method === 'PUT' && !node.enabled))
            throw new AllocationError('Node must be enrolled and enabled before saving allocations.', 409);
        const url = new URL(path, node.origin);
        const body = value ? Buffer.from(JSON.stringify(value)) : undefined;
        return new Promise((resolve, reject) => {
            const req = (url.protocol === 'https:' ? https : http).request(url, {
                method, ...nodeTls(), headers: {
                    'x-gamepanel-node-auth': signNodeRequest(nodes.key({ ...node, enabled: 1 }), id, method, path, 'node-allocations'),
                    ...(body ? { 'Content-Type': 'application/json', 'Content-Length': body.length, 'Idempotency-Key': operationId! } : {}),
                },
            }, res => {
                const chunks: Buffer[] = []; let size = 0;
                res.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > 1024 * 1024) req.destroy(new Error('Oversized settings response'));
                    else chunks.push(chunk);
                });
                res.on('error', reject);
                res.on('end', () => {
                    try {
                        const result = JSON.parse(Buffer.concat(chunks).toString());
                        if (res.statusCode !== 200) {
                            reject(new AllocationError(typeof result.error === 'string' ? result.error : 'Node settings request rejected', res.statusCode || 502));
                            return;
                        }
                        if (path === '/api/system/settings' && (!Number.isSafeInteger(result.revision) || !result.network || !Array.isArray(result.network.allocations))) throw new Error('Invalid settings response');
                        if (path === '/api/system/settings') result.network = validateGlobalSettings({ appearance: DEFAULT_APPEARANCE, network: result.network }).network;
                        resolve(result);
                    } catch (error) { reject(error); }
                });
            });
            const timeout = setTimeout(() => req.destroy(new Error('Node settings request timed out')), 10000);
            req.once('close', () => clearTimeout(timeout)); req.on('error', reject); req.end(body);
        });
    }
    return {
        async targets() {
            // A revoked credential does not turn a formerly paired node into an empty one.
            const paired = await db.all<Array<{ id: string; name: string }>>(`SELECT id,name FROM execution_nodes n
                WHERE key_encrypted IS NOT NULL OR agent_version IS NOT NULL
                OR EXISTS(SELECT 1 FROM node_audit a WHERE a.node_id=n.id AND a.action='enrolled')`);
            return [{ id: 'local', name: 'Local' }, ...paired];
        },
        async read(id) {
            if (id !== 'local') return request(id, 'GET');
            return { ...globalSettings().snapshot(), assignments: await globalSettings().assignments() };
        },
        async write(id, value, operationId) {
            if (id !== 'local') {
                try { await request(id, 'PUT', value, operationId); }
                catch (error) {
                    // A proxy 4xx is not proof that an earlier request stopped. Consult the durable agent journal.
                    let outcome: { state: string; status: number } | undefined;
                    try { outcome = await request<{ state: string; status: number }>(id, 'GET', undefined, undefined, `/api/operations/${operationId}`); } catch { /* Retain claims. */ }
                    if (outcome?.state === 'completed' && outcome.status >= 400 && outcome.status < 500)
                        throw new AllocationError(error instanceof Error ? error.message : 'Agent rejected the save', outcome.status, true);
                    throw error;
                }
                return;
            }
            const current = globalSettings().snapshot();
            // Local persistence may have completed just before a panel restart.
            if (current.revision === value.revision + 1 && JSON.stringify(current.network) === JSON.stringify(value.network)) return;
            try { await globalSettings().save({ appearance: value.appearance, network: value.network }, value.revision); }
            catch (error) { const status = Number((error as { statusCode?: number }).statusCode) || 500; throw new AllocationError(error instanceof Error ? error.message : 'Cannot save Local allocations', status, status < 500); }
        },
    };
}

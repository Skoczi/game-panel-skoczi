import http from 'node:http';
import https from 'node:https';
import type { FleetRow } from '../fleet/store.js';
import { nodes } from '../nodes/control.js';
import { nodeTls } from '../nodes/transport.js';
import { signNodeRequest } from '../nodes/protocol.js';

/** Fixed internal endpoints only; never accepts a caller-controlled URL or follows redirects. */
export async function readApiRuntime(row: FleetRow, actorId: number,
    suffix: 'resources' | 'backups' | 'backups/create-native' | `backups/jobs/${string}`,
    permissions: string[], maxBytes = 16384, mutation?: { name: string; key: string }) {
    if (!/^(resources|backups|backups\/create-native|backups\/jobs\/[0-9a-f-]{36})$/.test(suffix)) throw new Error('Invalid runtime endpoint');
    if (Boolean(mutation) !== (suffix === 'backups/create-native')) throw new Error('Invalid runtime method');
    const method = mutation ? 'POST' : 'GET';
    const body = mutation ? JSON.stringify({ name: mutation.name }) : undefined;
    const node = await nodes().get(row.node_id);
    if (!node?.enabled || !node.key_encrypted) throw new Error('Node unavailable');
    const route = `/api/servers/${row.runtime_id}/${suffix}`;
    const url = new URL(route, node.origin);
    if (url.origin !== node.origin) throw new Error('Node origin mismatch');
    return new Promise<unknown>((resolve, reject) => {
        const request = (url.protocol === 'https:' ? https : http).request(url, {
            method, ...nodeTls(), headers: {
                ...(mutation ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body!), 'idempotency-key': mutation.key } : {}),
                'x-gamepanel-node-auth': signNodeRequest(nodes().key(node), node.id, method, route, `api-user:${actorId}`,
                    { actorId, serverId: row.runtime_id, runtimeKey: row.runtime_key, permissions }),
            },
        });
        const timer = setTimeout(() => request.destroy(new Error('Node resource request timed out')), 15000);
        request.once('close', () => clearTimeout(timer));
        request.once('error', reject);
        request.once('response', response => {
            if (response.statusCode !== (mutation ? 202 : 200)) { response.resume(); reject(new Error('Runtime endpoint did not confirm the request')); return; }
            let bytes = 0; const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > maxBytes) request.destroy(new Error('Resource response too large'));
                else chunks.push(chunk);
            });
            response.once('error', reject);
            response.once('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
                catch { reject(new Error('Invalid resource response')); }
            });
        });
        request.end(body);
    });
}

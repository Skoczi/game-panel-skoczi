import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { pipeline } from 'node:stream';
import { signNodeRequest } from './protocol.js';

export function nodeTls() {
    return process.env.GAMEPANEL_NODE_CA ? { ca: readFileSync(process.env.GAMEPANEL_NODE_CA) } : {};
}
const safeHeaders = new Set(['content-type', 'content-length', 'content-disposition', 'range', 'if-range',
    'etag', 'last-modified', 'accept-ranges', 'content-range', 'idempotency-key', 'idempotency-replayed']);
export function filteredHeaders(headers: http.IncomingHttpHeaders) {
    return Object.fromEntries(Object.entries(headers).filter(([key]) => safeHeaders.has(key.toLowerCase())));
}

// No redirects, no proxy environment variables, bounded connect/idle waits, streaming bodies.
export function proxyRuntime(req: IncomingMessage, res: ServerResponse, options: {
    origin: string; nodeId: string; key: string; path: string; actor: string;
    transformJson?: (value: Record<string, unknown>) => Record<string, unknown>;
}) {
    const target = new URL(options.path, options.origin);
    if (target.origin !== options.origin) throw new Error('Runtime origin mismatch');
    const upstream = (target.protocol === 'https:' ? https : http).request(target, {
        method: req.method, ...nodeTls(), headers: {
            ...filteredHeaders(req.headers),
            'x-gamepanel-node-auth': signNodeRequest(options.key, options.nodeId, req.method || 'GET', options.path, options.actor),
        },
    });
    const connectTimer = setTimeout(() => upstream.destroy(new Error('Node connection timeout')), 10000);
    upstream.on('socket', socket => {
        if (!socket.connecting) clearTimeout(connectTimer);
        else socket.once(target.protocol === 'https:' ? 'secureConnect' : 'connect', () => clearTimeout(connectTimer));
    });
    upstream.setTimeout(120000, () => upstream.destroy(new Error('Node response idle timeout')));
    upstream.on('response', remote => {
        if (options.transformJson && remote.statusCode && remote.statusCode >= 200 && remote.statusCode < 300) {
            const chunks: Buffer[] = []; let size = 0;
            remote.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > 16384) { upstream.destroy(new Error('Oversized agent response')); return; }
                chunks.push(chunk);
            });
            remote.on('error', () => upstream.destroy());
            remote.on('end', () => {
                if (res.destroyed || res.headersSent || size > 16384) return;
                try {
                    const value = options.transformJson!(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                    res.writeHead(remote.statusCode!, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value));
                } catch { res.writeHead(502); res.end(); }
            });
            return;
        }
        // Origin redirects must never send clients to agent hosts or disclose credentials.
        if (remote.statusCode && remote.statusCode >= 300 && remote.statusCode < 400 && remote.statusCode !== 304) {
            remote.resume(); res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"Agent redirect refused"}'); return;
        }
        res.writeHead(remote.statusCode || 502, { ...filteredHeaders(remote.headers), 'Cache-Control': 'no-store', 'X-GamePanel-Node': options.nodeId });
        pipeline(remote, res, () => {});
    });
    upstream.on('error', () => {
        clearTimeout(connectTimer);
        if (res.destroyed || res.writableEnded) return;
        if (res.headersSent) { res.destroy(); return; }
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Node unavailable. No local fallback. If this was a mutation, verify its result before retrying.', nodeId: options.nodeId }));
    });
    upstream.once('close', () => clearTimeout(connectTimer));
    req.once('aborted', () => upstream.destroy());
    res.once('close', () => { if (!res.writableEnded) upstream.destroy(); });
    req.pipe(upstream);
}

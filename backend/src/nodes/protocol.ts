import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

export const PROTOCOL_VERSION = 1;
export const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const secret = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function nodeOrigin(value: unknown, allowLoopback = false): string {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid node origin');
    const url = new URL(value);
    const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(allowLoopback && loopback && url.protocol === 'http:')) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw new Error('Use an HTTPS origin without credentials, path, query or fragment');
    }
    return url.origin;
}

// Separate encryption key from JWT signing, with authenticated context binding.
export function seal(value: string, master: string, nodeId: string): string {
    const key = createHash('sha256').update('gamepanel-node-key-v1\0' + master).digest();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(nodeId));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [nonce, cipher.getAuthTag(), encrypted].map(b => b.toString('base64url')).join('.');
}
export function unseal(value: string, master: string, nodeId: string): string {
    const [nonce, tag, encrypted] = value.split('.').map(v => Buffer.from(v, 'base64url'));
    const key = createHash('sha256').update('gamepanel-node-key-v1\0' + master).digest();
    const cipher = createDecipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(nodeId)); cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
}

export type NodeClaim = { method: string; path: string; actor: string; protocol: number };
export function signNodeRequest(key: string, nodeId: string, method: string, path: string, actor: string): string {
    return jwt.sign({ method, path, actor, protocol: PROTOCOL_VERSION }, key, {
        algorithm: 'HS256', issuer: 'gamepanel-control', audience: nodeId,
        expiresIn: 30, jwtid: randomBytes(16).toString('hex'),
    });
}

export class RequestVerifier {
    private seen = new Map<string, number>();
    verify(token: string, key: string, nodeId: string, method: string, path: string): NodeClaim {
        const value = jwt.verify(token, key, { algorithms: ['HS256'], issuer: 'gamepanel-control', audience: nodeId, maxAge: '35s' });
        if (typeof value !== 'object' || value.protocol !== PROTOCOL_VERSION || value.method !== method || value.path !== path ||
            typeof value.actor !== 'string' || value.actor.length > 100 || !value.actor || !value.jti || !value.exp) throw new Error('Invalid node claim');
        const now = Date.now() / 1000;
        for (const [id, expires] of this.seen) if (expires < now) this.seen.delete(id);
        if (this.seen.has(value.jti) || this.seen.size >= 20000) throw new Error('Replayed request or replay cache full');
        this.seen.set(value.jti, value.exp);
        return value as unknown as NodeClaim;
    }
}

// Explicit allowlist; never proxy accounts, updater, node registry or arbitrary paths.
export function runtimePath(path: string): boolean {
    let pathname: string;
    try { pathname = decodeURIComponent(path.split('?')[0]); } catch { return false; }
    if (/[\u0000-\u001f\\]|\/\.|\/\//.test(pathname)) return false;
    return /^\/api\/servers(?:\/|$)/.test(pathname) || /^\/api\/operations\/[a-zA-Z0-9_-]{16,128}$/.test(pathname) || /^\/api\/download\/[a-zA-Z0-9_-]+$/.test(pathname) ||
        ['/api/health', '/api/version', '/api/system/metrics', '/api/system/info', '/api/system/settings',
            '/api/system/bind-addresses', '/api/system/docker-info', '/api/system/disk-usage'].includes(pathname);
}

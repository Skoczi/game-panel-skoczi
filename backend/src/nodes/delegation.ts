import { ASSIGNABLE_SERVER_PERMISSIONS } from '../permissions.js';

/** A single-server capability. Never a node administrator or a global permission. */
export type Delegation = {
    actorId: number;
    serverId: number;
    runtimeKey: string;
    permissions: string[];
    downloadPath?: string;
};

export function validateDelegation(value: unknown): Delegation {
    const d = value as Delegation;
    if (
        !d ||
        !Number.isSafeInteger(d.actorId) ||
        d.actorId <= 0 ||
        !Number.isSafeInteger(d.serverId) ||
        d.serverId <= 0 ||
        typeof d.runtimeKey !== 'string' ||
        !/^[a-f0-9]{32}$/.test(d.runtimeKey) ||
        (d.downloadPath !== undefined &&
            (typeof d.downloadPath !== 'string' ||
                !/^\/api\/download\/[a-zA-Z0-9_-]{43}$/.test(d.downloadPath))) ||
        !Array.isArray(d.permissions) ||
        d.permissions.length > ASSIGNABLE_SERVER_PERMISSIONS.size ||
        !d.permissions.every((p) => typeof p === 'string' && ASSIGNABLE_SERVER_PERMISSIONS.has(p))
    ) {
        throw new Error('Invalid server capability');
    }
    return {
        actorId: d.actorId,
        serverId: d.serverId,
        runtimeKey: d.runtimeKey,
        permissions: [...new Set(d.permissions)].sort(),
        ...(d.downloadPath ? { downloadPath: d.downloadPath } : {}),
    };
}

export function delegatedPath(path: string, d: Delegation, method: string): boolean {
    // Lists are filtered by the runtime. Global settings, members, installs and operation journals are never delegated.
    const pathname = path.split('?')[0];
    if (
        d.downloadPath &&
        method === 'GET' &&
        path === d.downloadPath &&
        d.permissions.includes('fs.read')
    )
        return true;
    if (
        method === 'GET' &&
        ['/api/servers', '/api/servers/', '/api/servers/metrics'].includes(pathname)
    )
        return true;
    if (/\/members(?:\/|$)/.test(pathname)) return false;
    return new RegExp(`^/api/servers/${d.serverId}(?:/|$)`).test(pathname);
}

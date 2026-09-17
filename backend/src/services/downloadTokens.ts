import crypto from 'node:crypto';

export interface DownloadTokenData {
    serverId: number;
    userId: number;
    tokenVersion: number;
    runtimeKey: string;
    root: string;
    path: string;
}

interface StoredDownloadToken extends DownloadTokenData {
    expiresAt: number;
}

export const DOWNLOAD_TOKEN_TTL_MS = 60_000;
const DOWNLOAD_TOKEN_CLEANUP_INTERVAL_MS = 5 * 60_000;

const tokens = new Map<string, StoredDownloadToken>();

export function createDownloadToken(data: DownloadTokenData): {
    token: string;
    expiresInMs: number;
} {
    const token = crypto.randomBytes(32).toString('base64url');
    tokens.set(token, { ...data, expiresAt: Date.now() + DOWNLOAD_TOKEN_TTL_MS });
    return { token, expiresInMs: DOWNLOAD_TOKEN_TTL_MS };
}

export function consumeDownloadToken(token: string): DownloadTokenData | null {
    const stored = tokens.get(token);
    if (!stored) return null;

    tokens.delete(token);

    if (stored.expiresAt < Date.now()) return null;

    const { expiresAt: _expiresAt, ...data } = stored;
    return data;
}

export function startDownloadTokenCleanupJob(): { stop: () => void } {
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [token, stored] of tokens) {
            if (stored.expiresAt < now) tokens.delete(token);
        }
    }, DOWNLOAD_TOKEN_CLEANUP_INTERVAL_MS);

    return {
        stop() {
            clearInterval(timer);
        },
    };
}

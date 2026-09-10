import { getConfig } from '../../../config.js';
import { logWarn } from '../../../utils/logger.js';

const CATALOG_TIMEOUT_MS = 10_000;
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry = { fetchedAt: number; payload: unknown };

const cache = new Map<string, CacheEntry>();

function catalogBaseUrl(): string {
    const baseUrl = getConfig().databaseApiBaseUrl;
    if (!baseUrl) {
        throw Object.assign(
            new Error('The version catalog service is not configured on this panel'),
            { statusCode: 503 }
        );
    }
    return baseUrl;
}

async function fetchCatalog(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
    timeout.unref?.();

    let response: Response;
    try {
        response = await fetch(`${catalogBaseUrl()}${path}`, {
            headers: { accept: 'application/json' },
            signal: controller.signal,
        });
    } catch {
        throw Object.assign(new Error('Unable to reach the version catalog service'), { statusCode: 502 });
    } finally {
        clearTimeout(timeout);
    }

    if (response.status === 404) {
        throw Object.assign(new Error('Version catalog entry not found'), { statusCode: 404 });
    }
    if (!response.ok) {
        throw Object.assign(
            new Error(`Version catalog service error (HTTP ${response.status})`),
            { statusCode: 502 }
        );
    }

    try {
        return await response.json();
    } catch {
        throw Object.assign(
            new Error('Version catalog service returned an invalid response'),
            { statusCode: 502 }
        );
    }
}

export async function readCatalog<T>(path: string): Promise<T> {
    const cached = cache.get(path);
    if (cached && Date.now() - cached.fetchedAt < CATALOG_CACHE_TTL_MS) {
        return cached.payload as T;
    }

    const payload = await fetchCatalog(path);
    cache.set(path, { fetchedAt: Date.now(), payload });
    return payload as T;
}

export async function tryReadCatalog<T>(path: string): Promise<T | null> {
    try {
        return await readCatalog<T>(path);
    } catch (error) {
        if ((error as { statusCode?: number }).statusCode !== 404) {
            logWarn('OVHCLOUD:SETTINGS:CATALOG_UNAVAILABLE', `Version catalog unavailable: ${path}`, {
                error: error instanceof Error ? error.message : 'unknown error',
            });
        }
        return null;
    }
}

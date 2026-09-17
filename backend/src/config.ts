import path from 'node:path';
import { gamePanelImage } from './utils/images.js';
import { agentIdentity, isAgent } from './agent/identity.js';

function mustEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing env var: ${name}`);
    return v;
}

function envOrDefault(name: string, fallback: string): string {
    const v = process.env[name];
    if (!v || !v.trim()) return fallback;
    return v.trim();
}

function urlEnv(name: string): string | null {
    const trimmed = String(process.env[name] ?? '').trim();
    return trimmed ? trimmed.replace(/\/+$/, '') : null;
}

const CONTAINER_DATA_DIR = '/data';

function boolEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (!raw || !raw.trim()) return fallback;

    switch (raw.trim().toLowerCase()) {
        case '1':
        case 'true':
        case 'yes':
        case 'on':
            return true;
        case '0':
        case 'false':
        case 'no':
        case 'off':
            return false;
        default:
            return fallback;
    }
}

type TrustProxySetting = boolean | number | string;

function trustProxyEnv(name: string, fallback: TrustProxySetting): TrustProxySetting {
    const raw = process.env[name];
    if (!raw || !raw.trim()) return fallback;

    const normalized = raw.trim().toLowerCase();

    switch (normalized) {
        case '1':
            return 1;
        case 'true':
        case 'yes':
        case 'on':
            return true;
        case '0':
        case 'false':
        case 'no':
        case 'off':
            return false;
        default:
            if (/^\d+$/.test(raw.trim())) return Number(raw.trim());
            return raw.trim();
    }
}

type AppConfig = {
    port: number;
    jwtSecret: string;
    domain: string;
    frontendUrl: string;
    trustProxy: TrustProxySetting;
    adminUsername: string;
    gamepanelServersDir: string;
    gamepanelDataDir: string;
    gamepanelAppRoot: string;
    dockerSocket: string;
    composeProjectName: string;
    gamesNetwork: string;
    updaterImage: string;
    repositoryUrl: string;
    instanceId: string | null;
    instanceSecret: string | null;
    telemetryEnabled: boolean;
    databaseApiBaseUrl: string | null;
};

let cached: AppConfig | null = null;

export function requireAdminBootstrapPassword(): string {
    const password = process.env.ADMIN_PASSWORD?.trim();
    if (!password) {
        throw new Error('Missing env var: ADMIN_PASSWORD. It is required only while creating the first root user.');
    }

    return password;
}

export function getConfig(): AppConfig {
    if (cached) return cached;
    const nodeId = isAgent() ? agentIdentity().nodeId : null;

    const domain = mustEnv('DOMAIN').trim();
    if (!domain) throw new Error('Missing env var: DOMAIN');

    const gamepanelAppRoot = envOrDefault('GAMEPANEL_APP_ROOT', '/opt/gamepanel');

    cached = {
        port: Number(mustEnv('PORT')),
        jwtSecret: mustEnv('JWT_SECRET'),
        domain,
        frontendUrl: `https://${domain}`,
        trustProxy: trustProxyEnv('TRUST_PROXY', false),
        adminUsername: envOrDefault('ADMIN_USERNAME', 'admin'),
        gamepanelServersDir: path.posix.join(gamepanelAppRoot, 'servers'),
        gamepanelDataDir: CONTAINER_DATA_DIR,
        gamepanelAppRoot,
        dockerSocket: envOrDefault('DOCKER_SOCKET', '/var/run/docker.sock'),
        composeProjectName: nodeId ? `gp-${nodeId}` : envOrDefault('COMPOSE_PROJECT_NAME', 'gamepanel'),
        gamesNetwork: nodeId ? `gp-${nodeId}-games` : envOrDefault('GAMEPANEL_GAMES_NETWORK', 'gamepanel-games'),
        updaterImage: envOrDefault('GAMEPANEL_UPDATER_IMAGE', gamePanelImage('gamepanel-updater')),
        // Skoczi fork: never fall back to upstream for fork updates.
        repositoryUrl: envOrDefault('GAMEPANEL_REPOSITORY_URL', 'https://github.com/Skoczi/game-panel-skoczi.git'),
        instanceId: process.env.APP_INSTANCE_ID?.trim() || null,
        instanceSecret: process.env.APP_INSTANCE_SECRET?.trim() || null,
        telemetryEnabled: boolEnv('TELEMETRY_ENABLED', false),
        databaseApiBaseUrl: urlEnv('TELEMETRY_API_BASE_URL'),
    };

    return cached;
}

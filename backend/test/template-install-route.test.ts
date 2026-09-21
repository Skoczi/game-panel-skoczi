import assert from 'node:assert/strict';
import * as nativeContract from '../src/templates/nativeContract.js';
import { test } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { loadWithMocks } from './loadWithMocks.js';
import * as tickets from '../src/templates/tickets.js';
import { CS16_TEMPLATE, validateTemplate, templateHash } from '../src/templates/schema.js';
import * as ports from '../src/utils/ports.js';
import * as healthcheck from '../src/utils/healthcheck.js';
import * as resources from '../src/utils/resourceLimits.js';
import * as validation from '../src/utils/httpValidation.js';
import * as providerTypes from '../src/providers/types.js';
import * as permissions from '../src/permissions.js';
import { setManagedPortPolicy } from '../src/utils/portPolicy.js';
import * as allocationLock from '../src/services/portAllocationLock.js';
import { NATIVE_CS16_TEMPLATE } from '../src/templates/nativeCs16.js';

test('actual install route verifies target authorization before persistence and preserves trusted snapshot', async () => {
    setManagedPortPolicy({ '192.0.2.10': { tcp: [], udp: [{ from: 27015, to: 27030 }] } });
    let remote = false; let created: any; let installed: any; let checkedPorts: any;
    let beforeCreate: (() => Promise<void>) | undefined;
    let missingImage = false;
    const key = 'test-runtime-ticket-key';
    const module = loadWithMocks('../src/routes/servers/install.ts', {
        '../../services/portAllocationLock.js': allocationLock,
        '../../services/nativeImages.js': { resolveNativeImages: async () => {
            if (missingImage) throw Object.assign(new Error('Installer image is missing'), { statusCode: 409 });
            return { nativeRuntimeImage: 'sha256:runtime', nativeInstallerImage: 'sha256:installer' };
        } },
        '../../services/templatePortAllocation.js': { resolveTemplateBindings: async (_template: unknown, bindings: unknown) => bindings },
        '../../templates/nativeContract.js': nativeContract,
        express,
        '../../agent/identity.js': { isAgent: () => remote, agentIdentity: () => ({ key, nodeId: 'node-test' }) },
        '../../config.js': { getConfig: () => ({ jwtSecret: key }) }, '../../templates/tickets.js': tickets,
        '../../middleware/auth.js': { requireGlobalPermission: () => (_req: any, _res: any, next: any) => next() },
        '../../database/index.js': {
            serverRepository: { findByName: async () => undefined, create: async (data: any) => { await beforeCreate?.(); created = data; return 17; } },
            installProgressRepository: { create: async () => {} }, userRepository: { findById: async () => ({ is_root: 1 }) }, serverMemberRepository: {},
        },
        '../../realtime/bus.js': { bus: { emit: () => {} } },
        '../../providers/installSpec.js': { resolveInstallSpec: async (ctx: any) => ({ provider: ctx.provider, catalogId: ctx.body.shortname, dockerImage: ctx.body.dockerImage, ports: ctx.ports, healthcheck: ctx.healthcheck, resourceLimits: ctx.resourceLimits, mounts: ctx.body.mounts, env: Object.entries(ctx.body.env).map(([k, v]) => `${k}=${v}`), runtimeConfig: {}, providerMetadata: {} }) },
        '../../providers/types.js': providerTypes,
        '../../services/servers.js': { installServerAsync: async (_id: number, _name: string, spec: any) => { installed = spec; } },
        '../../services/hostPortAvailability.js': { assertHostPortsAvailableForServer: async (p: any) => { checkedPorts = p.ports; } },
        '../../utils/ports.js': ports, '../../utils/healthcheck.js': healthcheck, '../../utils/resourceLimits.js': resources,
        '../../utils/logger.js': {}, '../../utils/time.js': { nowIso: () => new Date().toISOString() },
        '../../utils/apiSerialization.js': { serializeGameServer: (v: any) => v },
        '../../utils/routeErrors.js': { getErrorStatusCode: (e: any, fallback = 500) => e.statusCode || fallback, sendRouteError: (res: any, e: any) => res.status(e.statusCode || 500).json({ error: e.message }) },
        '../../permissions.js': permissions, '../../utils/httpValidation.js': validation,
        './shared.js': { asOptionalString: (v: unknown) => typeof v === 'string' ? v : null, isValidServerName: (v: string) => v.length >= 3 && v.length <= 50, loadServerAfterMutation: async () => ({ id: 17 }), parseOptionalBoolean: (v: unknown) => v === undefined ? false : typeof v === 'boolean' ? v : null },
    });
    const app = express(); app.use(express.json()); app.use((req: any, _res, next) => { req.user = { isRoot: req.headers['x-role'] !== 'user', userId: 1, username: 'admin' }; next(); }); app.use('/api/servers', module.createServerInstallRoutes());
    const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as any).port}/api/servers/install`;
    const document = validateTemplate({ ...CS16_TEMPLATE, runtime: { ...CS16_TEMPLATE.runtime, architectures: ['x64', 'arm64'] } }); const s = { id: 'test', version: 1, document, hash: templateHash(document) };
    const input = { name: 'Test game', bindings: [{ key: 'game', host: 27020, hostIp: '192.0.2.10' }], dockerImage: 'untrusted', env: { BAD: 'ignored' }, variables: {} };
    const request = (body: any, role = 'root') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-role': role }, body: JSON.stringify(body) });
    try {
        assert.equal((await request({ ...input, templateSnapshot: s })).status, 400); assert.equal(created, undefined);
        assert.equal((await request({ ...input, templateTicket: 'bad' })).status, 409); assert.equal(created, undefined);
        const localTicket = tickets.issueTemplateTicket(s, key, 'local');
        assert.equal((await request({ ...input, bindings: [{ key: 'game', host: 8080, hostIp: '192.0.2.10' }], templateTicket: localTicket })).status, 400);
        assert.equal(created, undefined);
        assert.equal((await request({ ...input, templateTicket: localTicket }, 'user')).status, 403);
        const accepted = await request({ ...input, templateTicket: localTicket });
        assert.equal(accepted.status, 201, await accepted.text());
        assert.equal(created.dockerImage, document.runtime.image); assert.equal(created.env.includes('BAD=ignored'), false);
        assert.equal(created.providerMetadata.template.hash, s.hash); assert.equal(installed.providerMetadata.template.id, s.id);
        assert.equal(checkedPorts.udp[0].host, 27020); assert.equal(checkedPorts.udp[0].container, 27015);
        created = undefined; remote = true;
        assert.equal((await request({ ...input, templateTicket: localTicket })).status, 409); assert.equal(created, undefined);
        assert.equal((await request({ ...input, templateTicket: tickets.issueTemplateTicket(s, key, 'node-test') })).status, 201);
        assert.equal(created.providerMetadata.template.version, 1);
        let reached!: () => void; const entered = new Promise<void>(r => { reached = r; });
        let finish!: () => void; const gate = new Promise<void>(r => { finish = r; });
        beforeCreate = async () => { reached(); await gate; };
        const remoteTicket = tickets.issueTemplateTicket(s, key, 'node-test');
        const first = request({ ...input, templateTicket: remoteTicket });
        await entered;
        try {
            const second = await request({ ...input, templateTicket: remoteTicket });
            assert.equal(second.status, 409);
            assert.match((await second.json()).error, /allocation change/);
        } finally { finish(); }
        assert.equal((await first).status, 201);
        beforeCreate = undefined; created = undefined;
        const native = validateTemplate({ ...structuredClone(NATIVE_CS16_TEMPLATE), runtime: { ...NATIVE_CS16_TEMPLATE.runtime, architectures: ['x64', 'arm64'] } });
        native.lifecycle!.installerImage = 'reviewed:installer';
        native.lifecycle!.install = [{ name: 'Script', script: 'echo installed', timeoutSeconds: 30 }];
        const canonical = validateTemplate(native);
        const nativeTicket = tickets.issueTemplateTicket({ id: 'native', version: 1, document: canonical, hash: templateHash(canonical) }, key, 'node-test');
        missingImage = true;
        const missing = await request({ ...input, templateTicket: nativeTicket });
        assert.equal(missing.status, 409); assert.equal(created, undefined, 'Missing image must not create a server or reserve ports');
        missingImage = false;
        assert.equal((await request({ ...input, templateTicket: nativeTicket })).status, 201);
        assert.equal(created.runtimeConfig.nativeInstallerImage, 'sha256:installer');
        assert.equal(installed.runtimeConfig.nativeRuntimeImage, 'sha256:runtime');
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); setManagedPortPolicy(null); }
});

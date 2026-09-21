import { exerciseNativeBackups } from './nativeAcceptance.js';
// Disposable Linux CI only: two separate runtime databases and real Docker containers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { setTimeout as delay } from 'node:timers/promises';

test(
    'real central + agent: enroll, isolated install, HTTP/files/WS, replay, restart, offline and revocation',
    {
        skip: process.env.GAMEPANEL_NODE_DOCKER_TEST !== '1',
        timeout: 480000,
    },
    async () => {
        assert.equal(
            process.platform,
            'linux',
            'Run only in the disposable Linux CI job',
        );
        const root = mkdtempSync(path.join(tmpdir(), 'gamepanel-node-ci-'));
        const suffix = randomUUID().slice(0, 8),
            panelName = `gp-ci-panel-${suffix}`,
            agentName = `gp-ci-agent-${suffix}`,
            sentinelName = `gp-ci-foreign-${suffix}`;
        const image =
            process.env.GAMEPANEL_NODE_TEST_IMAGE || 'gamepanel-agent:ci';
        const password = randomBytes(24).toString('base64url'),
            master = randomBytes(48).toString('base64url');
        const panel = 'http://127.0.0.1:32181',
            agent = 'http://127.0.0.1:32182';
        let token = '',
            nodeId = '',
            gameContainer = '',
            localGameContainer = '',
            serverHeader = '';
        const docker = (...args: string[]) =>
            execFileSync('docker', args, { encoding: 'utf8', timeout: 120000 });
        const request = async (
            url: string,
            method = 'GET',
            body?: unknown,
            key = randomUUID(),
            discardReply = false,
        ) => {
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'Idempotency-Key': key,
                    ...(serverHeader
                        ? { 'X-GamePanel-Server': serverHeader }
                        : {}),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(20000),
            });
            if (discardReply) {
                await response.body?.cancel();
                return { status: response.status, value: null, headers: response.headers };
            }
            const text = await response.text();
            let value: any;
            try {
                value = JSON.parse(text);
            } catch {
                value = text;
            }
            return { status: response.status, value, headers: response.headers };
        };
        const ok = async (
            url: string,
            method = 'GET',
            body?: unknown,
            key?: string,
        ) => {
            const result = await request(url, method, body, key);
            assert.ok(
                result.status < 300,
                `${method} ${url}: ${result.status} ${JSON.stringify(result.value)}`,
            );
            return result.value;
        };
        async function waitFor(check: () => Promise<boolean>, name: string) {
            for (let i = 0; i < 100; i++) {
                try {
                    if (await check()) return;
                } catch {}
                await delay(500);
            }
            throw new Error(`Timed out: ${name}`);
        }
        const common = [
            '--network',
            'host',
            '-e',
            'GAMEPANEL_TEST_LOOPBACK_NODES=1',
            '-e',
            'DOMAIN=panel.example.com',
            '-e',
            `JWT_SECRET=${master}`,
            '-e',
            'ADMIN_USERNAME=ciadmin',
            '-e',
            `ADMIN_PASSWORD=${password}`,
            '-e',
            'TELEMETRY_ENABLED=false',
            '-v',
            '/var/run/docker.sock:/var/run/docker.sock',
        ];
        let socket: WebSocket | undefined;
        try {
            for (const dir of [
                'panel-data',
                'agent-data',
                'agent-identity',
                'panel-app/servers',
                'agent-app/servers',
            ])
                mkdirSync(path.join(root, dir), { recursive: true });
            docker(
                'run',
                '-d',
                '--name',
                panelName,
                ...common,
                '-e',
                'PORT=32181',
                '-e',
                `GAMEPANEL_APP_ROOT=${root}/panel-app`,
                '-e',
                `GAMEPANEL_GAMES_NETWORK=gp-ci-local-${suffix}`,
                '-v',
                `${root}/panel-data:/data`,
                '-v',
                `${root}/panel-app/servers:${root}/panel-app/servers`,
                image,
            );
            await waitFor(
                async () => (await fetch(panel + '/api/health')).ok,
                'central startup',
            );
            token = (
                await ok(panel + '/api/auth/login', 'POST', {
                    username: 'ciadmin',
                    password,
                })
            ).token;
            assert.ok(token);
            const created = await ok(panel + '/api/nodes', 'POST', {
                name: 'CI agent',
                origin: agent,
            });
            nodeId = created.node.id;
            const identity = await ok(
                panel + `/api/nodes/${nodeId}/enroll`,
                'POST',
                {
                    token: created.enrollmentToken,
                },
            );
            assert.equal(
                (
                    await request(
                        panel + `/api/nodes/${nodeId}/enroll`,
                        'POST',
                        {
                            token: created.enrollmentToken,
                        },
                    )
                ).status,
                401,
            );
            writeFileSync(
                root + '/agent-identity/agent.json',
                JSON.stringify({ ...identity, panel }),
                { mode: 0o600 },
            );
            docker(
                'run',
                '-d',
                '--name',
                agentName,
                ...common,
                '--read-only',
                '--cap-drop=ALL',
                '--cap-add=CHOWN',
                '--cap-add=FOWNER',
                '--cap-add=DAC_OVERRIDE',
                '--security-opt=no-new-privileges:true',
                '--tmpfs',
                '/tmp:rw,nosuid,nodev,size=256m',
                '-e',
                'PORT=32182',
                '-e',
                `GAMEPANEL_APP_ROOT=${root}/agent-app`,
                '-e',
                'GAMEPANEL_AGENT_CONFIG=/identity/agent.json',
                '-e',
                'GAMEPANEL_IP_PORTS={}',
                '-v',
                `${root}/agent-data:/data`,
                '-v',
                `${root}/agent-identity:/identity:ro`,
                '-v',
                `${root}/agent-app/servers:${root}/agent-app/servers`,
                image,
            );
            await waitFor(
                async () => (await fetch(agent + '/api/health')).ok,
                'agent startup',
            );
            assert.equal((await request(agent + '/api/servers')).status, 401);
            assert.equal(
                (
                    await request(agent + '/api/auth/login', 'POST', {
                        username: 'ciadmin',
                        password,
                    })
                ).status,
                404,
            );
            await waitFor(
                async () =>
                    (await ok(panel + '/api/nodes')).nodes[0].status ===
                    'online',
                'heartbeat',
            );
            const runtime = panel + `/api/nodes/${nodeId}/runtime`;
            const settings = await ok(panel + `/api/nodes/${nodeId}/allocations`);
            assert.equal(settings.network.restrictPorts, true);
            assert.equal((await request(runtime + '/api/system/settings', 'PUT', {})).status, 409);
            await ok(panel + `/api/nodes/${nodeId}/allocations`, 'PUT', {
                revision: settings.revision,
                network: {
                    restrictPorts: true,
                    allocations: [
                        { ip: '127.0.0.1', alias: 'CI', tcp: '32280', udp: '' },
                    ],
                },
            });
            const legacySpec = {
                name: 'CI remote nginx',
                provider: 'external',
                dockerImage: 'nginx:alpine',
                runtimeIdentity: { user: 'root', uid: 0, gid: 0 },
                mounts: [{ key: 'data', containerPath: '/test-data' }],
                ports: {
                    tcp: [{ host: 32280, container: 80, hostIp: '127.0.0.1' }],
                    udp: [],
                },
            };
            assert.equal((await ok(runtime + '/api/health')).templatesProtocol, 1);
            assert.equal((await ok(runtime + '/api/health')).nativeRuntimeProtocol, 1);
            assert.equal((await ok(runtime + '/api/health')).templateScriptsProtocol, 1);
            // Operator preloads the reviewed image; Native Runtime never pulls during install.
            for (const image of ['nginxinc/nginx-unprivileged:stable-alpine', 'debian:bookworm-slim']) {
                try { docker('image', 'inspect', image); }
                catch { docker('pull', image); }
            }
            const template = await ok(panel + '/api/game-templates', 'POST', { document: {
                schemaVersion: 2, name: 'CI HTTP runtime', description: '', author: 'CI', source: '',
                runtime: { provider: 'external', image: 'nginxinc/nginx-unprivileged:stable-alpine',
                    catalogId: '', gameServerName: '', architectures: ['x64', 'arm64'], identity: { user: '101', uid: 101, gid: 101 } },
                ports: [{ key: 'http', label: 'HTTP', protocol: 'tcp', container: 8080, suggested: 32280, env: '', linuxgsmKey: '' }],
                variables: [], mounts: [{ key: 'data', containerPath: '/test-data' }],
                lifecycle: { startup: ['/usr/sbin/nginx', '-g', 'daemon off;'], workdir: '/test-data', stopSignal: 'SIGTERM', stopTimeoutSeconds: 10,
                    installerImage: 'debian:bookworm-slim',
                    install: [{ name: 'Create install marker', script: 'test "$(id -u)" = 101\nprintf installed > /test-data/native-marker', timeoutSeconds: 30 }],
                    update: [{ name: 'Update marker', script: 'test "$(id -u)" = 101\nprintf updated > /test-data/native-marker', timeoutSeconds: 30 }] },
            } });
            const templatePath = panel + `/api/game-templates/${template.id}/${template.version}`;
            await ok(templatePath + '/status', 'POST', { status: 'published' });
            const authorization = await ok(templatePath + '/prepare', 'POST', { nodeId });
            const spec = { name: legacySpec.name, templateTicket: authorization.ticket,
                bindings: [{ key: 'http', hostIp: '127.0.0.1', host: 'auto' }], variables: {} };
            const availabilityUrl = runtime + '/api/servers/available-ports?ip=127.0.0.1&protocol=tcp';
            assert.deepEqual((await ok(availabilityUrl)).ports, [32280]);
            assert.equal((await request(panel + '/api/servers/install', 'POST', spec)).status, 409,
                'A remote template ticket cannot create a server on Local');
            const forbidden = await request(
                runtime + '/api/servers/install',
                'POST',
                {
                    ...spec,
                    bindings: [{ key: 'http', host: 8080, hostIp: '127.0.0.1' }],
                },
            );
            assert.equal(forbidden.status, 400);
            const operation = randomUUID();
            const installed = await ok(
                runtime + '/api/servers/install',
                'POST',
                spec,
                operation,
            );
            const id = installed.server.id;
            assert.ok(id);
            assert.equal(installed.server.ports.tcp[0].host, 32280);
            assert.equal(installed.server.ports.tcp[0].container, 8080);
            assert.deepEqual((await ok(availabilityUrl)).ports, [], 'Persistent reservation immediately removes the selected port');
            assert.equal((await request(runtime + '/api/servers/install', 'POST', { ...spec, name: 'Conflicting automatic install' })).status, 409);
            assert.equal(
                (
                    await ok(
                        runtime + '/api/servers/install',
                        'POST',
                        spec,
                        operation,
                    )
                ).server.id,
                id,
            );
            assert.equal(
                (
                    await request(
                        runtime + '/api/servers/install',
                        'POST',
                        { ...spec, name: 'Different' },
                        operation,
                    )
                ).status,
                409,
            );
            await waitFor(async () => {
                const s = await ok(runtime + `/api/servers/${id}`);
                return (s.server || s).status === 'running';
            }, 'game installation');
            const listed = await ok(runtime + '/api/servers');
            assert.ok(JSON.stringify(listed).includes('CI remote nginx'));
            assert.ok(
                !JSON.stringify(await ok(panel + '/api/servers')).includes(
                    'CI remote nginx',
                ),
            );
            gameContainer = docker(
                'ps',
                '-q',
                '--filter',
                `label=gamepanel.node=${nodeId}`,
                '--filter',
                `label=gamepanel.serverId=${id}`,
            ).trim();
            assert.ok(gameContainer);
            const inspected = JSON.parse(docker('inspect', gameContainer))[0];
            assert.ok(inspected.Config.Hostname.length <= 63);
            assert.equal(inspected.Config.User, '101:101');
            assert.deepEqual(inspected.Config.Cmd, ['/usr/sbin/nginx', '-g', 'daemon off;']);
            assert.equal(docker('exec', gameContainer, 'cat', '/test-data/native-marker'), 'installed');
            const savedTemplate = (await ok(runtime + `/api/servers/${id}`)).server.providerMetadata.template;
            assert.equal(savedTemplate.id, template.id);
            assert.equal(savedTemplate.version, template.version);
            assert.equal(savedTemplate.hash, template.hash);
            await waitFor(
                async () => (await fetch('http://127.0.0.1:32280')).ok,
                'published game port',
            );
            assert.equal((await request(runtime + `/api/servers/${id}/native-update`, 'POST', { confirm: true })).status, 409);
            await ok(runtime + `/api/servers/${id}/stop`, 'POST', {});
            await waitFor(async () => (await ok(runtime + `/api/servers/${id}`)).server.status === 'stopped', 'native stop');
            assert.deepEqual((await ok(availabilityUrl)).ports, [], 'Stopping a server must not release its allocation');
            await ok(runtime + `/api/servers/${id}/native-update`, 'POST', { confirm: true });
            await waitFor(async () => {
                const s = (await ok(runtime + `/api/servers/${id}`)).server;
                return !s.runtimeConfig?.nativeOperation && readFileSync(`${root}/agent-app/servers/${id}/data/native-marker`, 'utf8') === 'updated';
            }, 'native explicit update');
            await waitFor(async () => (await request(runtime + `/api/servers/${id}/start`, 'POST', {})).status === 200, 'native restart after update');
            assert.equal(docker('exec', gameContainer, 'cat', '/test-data/native-marker'), 'updated', 'restart must not replay installation');
            docker(
                'run',
                '-d',
                '--name',
                sentinelName,
                '--label',
                'gamepanel.managed=true',
                '--label',
                `gamepanel.serverId=${id}`,
                '--label',
                `gamepanel.node=${randomUUID()}`,
                'nginx:alpine',
            );
            await ok(runtime + `/api/servers/${id}/files/touch`, 'POST', {
                path: '/',
                name: 'agent-test.txt',
            });
            await ok(
                runtime + `/api/servers/${id}/file?path=%2Fagent-test.txt`,
                'PUT',
                {
                    content: 'remote file persists',
                    version: (await request(runtime + `/api/servers/${id}/file?path=%2Fagent-test.txt`)).headers.get('etag'),
                },
            );
            const content = await ok(
                runtime + `/api/servers/${id}/file?path=%2Fagent-test.txt`,
            );
            assert.ok(JSON.stringify(content).includes('remote file persists'));
            const history = await ok(runtime + `/api/servers/${id}/file/history?path=%2Fagent-test.txt`);
            assert.equal(history.entries.length, 1);
            assert.equal(history.entries[0].state, 'committed');
            const snapshot = await ok(runtime + `/api/servers/${id}/file/history?path=%2Fagent-test.txt&entry=${history.entries[0].id}`);
            assert.equal(snapshot.entry.before, '');
            assert.equal(snapshot.entry.after, 'remote file persists');

            const download = await ok(
                runtime + `/api/servers/${id}/files/download-token`,
                'POST',
                {
                    path: '/agent-test.txt',
                },
            );
            assert.match(download.path, /^\/api\/node-download\//);
            assert.equal(
                await (await fetch(panel + download.path)).text(),
                'remote file persists',
            );
            assert.equal((await fetch(panel + download.path)).status, 404);
            socket = new WebSocket(
                panel.replace('http:', 'ws:') + `/api/nodes/${nodeId}/ws`,
            );
            const frames: any[] = [];
            socket.on('message', (data) =>
                frames.push(JSON.parse(data.toString())),
            );
            socket.on('open', () =>
                socket!.send(JSON.stringify({ type: 'auth', token })),
            );
            await waitFor(
                async () => frames.some((f) => f.type === 'auth:success'),
                'remote websocket authentication',
            );
            socket.send(JSON.stringify({ type: 'subscribe:servers' }));
            await waitFor(
                async () =>
                    frames.some(
                        (f) =>
                            f.type === 'servers:snapshot' &&
                            JSON.stringify(f).includes('CI remote nginx'),
                    ),
                'remote websocket snapshot',
            );
            const terminal = await ok(
                runtime + `/api/servers/${id}/terminal/container/sessions`,
                'POST',
            );
            socket.send(
                JSON.stringify({
                    type: 'terminal:attach',
                    sessionId: terminal.sessionId,
                    serverId: id,
                }),
            );
            await waitFor(
                async () => frames.some((f) => f.type === 'terminal:attached'),
                'remote terminal attach',
            );
            socket.send(
                JSON.stringify({
                    type: 'terminal:input',
                    sessionId: terminal.sessionId,
                    serverId: id,
                    dataB64: Buffer.from(
                        "printf 'node-terminal-%s\\n' verified\n",
                    ).toString('base64'),
                }),
            );
            await waitFor(
                async () =>
                    frames
                        .filter((f) => f.type === 'terminal:output')
                        .map((f) => Buffer.from(f.dataB64, 'base64').toString())
                        .join('')
                        .includes('node-terminal-verified'),
                'remote terminal output',
            );
            await ok(runtime + `/api/servers/${id}/stop`, 'POST');
            await ok(runtime + `/api/servers/${id}/start`, 'POST');
            await exerciseNativeBackups({ root, id, runtime, agentName, gameContainer, docker, ok, request, waitFor });
            // User workspace: same numeric ID on two runtimes, central UUIDs and single-server capabilities.
            const localSettings = await ok(panel + '/api/nodes/local/allocations');
            assert.equal((await request(panel + '/api/nodes/local/allocations', 'PUT', {
                revision: localSettings.revision,
                network: { restrictPorts: true, allocations: [{ ip: '127.0.0.1', alias: 'duplicate', tcp: '32281', udp: '' }] },
            })).status, 409, 'An address already owned by a remote node cannot be assigned to Local');
            await ok(panel + '/api/nodes/local/allocations', 'PUT', {
                revision: localSettings.revision,
                network: {
                    restrictPorts: true,
                    allocations: [
                        {
                            ip: '127.0.0.2',
                            alias: 'CI local',
                            tcp: '32281',
                            udp: '',
                        },
                    ],
                },
            });
            const localInstalled = await ok(
                panel + '/api/servers/install',
                'POST',
                {
                    ...legacySpec,
                    name: 'CI local private',
                    ports: {
                        tcp: [
                            { host: 32281, container: 80, hostIp: '127.0.0.2' },
                        ],
                        udp: [],
                    },
                },
            );
            const localId = localInstalled.server.id;
            assert.equal(
                localId,
                id,
                'Fixture must exercise colliding runtime IDs',
            );
            await waitFor(
                async () =>
                    (await ok(panel + `/api/servers/${localId}`)).server
                        .status === 'running',
                'local game startup',
            );
            localGameContainer = (await ok(panel + `/api/servers/${localId}`))
                .server.dockerContainerId;
            await waitFor(async () => {
                await ok(panel + '/api/fleet/refresh', 'POST', {});
                return (await ok(panel + '/api/fleet')).servers.length === 2;
            }, 'central fleet inventory');
            const inventory = (await ok(panel + '/api/fleet')).servers;
            const remoteFleet = inventory.find(
                (s: any) => s.name === spec.name,
            );
            const localFleet = inventory.find(
                (s: any) => s.name === 'CI local private',
            );
            assert.ok(remoteFleet?.id && localFleet?.id);
            assert.notEqual(remoteFleet.id, localFleet.id);
            const apiCredential = await ok(panel + '/api/api-tokens', 'POST', {
                name: 'CI scoped inventory', scopes: ['servers.read', 'resources.read', 'backups.read'], serverIds: [remoteFleet.id],
                expiresAt: Date.now() + 60000,
            });
            const apiHeaders = { Authorization: `Bearer ${apiCredential.secret}` };
            const apiList = await fetch(panel + '/api/v1/servers', { headers: apiHeaders });
            assert.equal(apiList.status, 200);
            const apiInventory = await apiList.json() as any;
            assert.deepEqual(apiInventory.data.map((row: any) => row.id), [remoteFleet.id]);
            assert.equal(apiInventory.requestId, apiList.headers.get('x-request-id'));
            const apiResourceResponse = await fetch(panel + `/api/v1/servers/${remoteFleet.id}/resources`, { headers: apiHeaders });
            assert.equal(apiResourceResponse.status, 200);
            const apiResource = await apiResourceResponse.json() as any;
            assert('observedAt' in apiResource.data && 'resources' in apiResource.data);
            assert(!JSON.stringify(apiResource.data).includes('cpuUsage'));
            assert(!JSON.stringify(apiResource.data).includes('nodeFreeBytes'));
            assert.equal((await fetch(panel + `/api/v1/servers/${localFleet.id}/resources`, { headers: apiHeaders })).status, 404);
            const apiBackupResponse = await fetch(panel + `/api/v1/servers/${remoteFleet.id}/backups?limit=1`, { headers: apiHeaders });
            assert.equal(apiBackupResponse.status, 200);
            const apiBackupPage = await apiBackupResponse.json() as any;
            assert(Array.isArray(apiBackupPage.data)); assert(apiBackupPage.data.length <= 1);
            assert(!JSON.stringify(apiBackupPage.data).includes('root'));
            assert.equal((await fetch(panel + `/api/v1/servers/${localFleet.id}`, { headers: apiHeaders })).status, 404);
            assert.equal((await fetch(panel + '/api/api-tokens', { headers: apiHeaders })).status, 401);
            assert.equal((await fetch(panel + '/api/servers', { headers: apiHeaders })).status, 401);
            const tokenListing = await ok(panel + '/api/api-tokens');
            assert(!JSON.stringify(tokenListing).includes(apiCredential.secret));
            await ok(panel + `/api/api-tokens/${apiCredential.token.id}`, 'DELETE');
            assert.equal((await fetch(panel + '/api/v1/servers', { headers: apiHeaders })).status, 401);
            const backupApiCredential = await ok(panel + '/api/api-tokens', 'POST', {
                name: 'CI Native automation', scopes: ['backups.create', 'operations.read'], serverIds: [remoteFleet.id],
                expiresAt: Date.now() + 300000,
            });
            const apiBackupKey = randomUUID();
            const apiBackupHeaders = { Authorization: `Bearer ${backupApiCredential.secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': apiBackupKey };
            const postApiBackup = (name = 'API acceptance') => fetch(panel + `/api/v1/servers/${remoteFleet.id}/backups`, {
                method: 'POST', headers: apiBackupHeaders, body: JSON.stringify({ name }),
            });
            const apiAccepted = await postApiBackup(); assert.equal(apiAccepted.status, 202);
            const apiOperationLocation = apiAccepted.headers.get('location')!;
            await apiAccepted.body?.cancel();
            const apiReplay = await postApiBackup(); assert.equal(apiReplay.status, 202);
            assert.equal(apiReplay.headers.get('location'), apiOperationLocation);
            assert.equal(apiReplay.headers.get('idempotency-replayed'), 'true');
            assert.equal((await postApiBackup('Other name')).status, 409);
            await waitFor(async () => {
                const response = await fetch(panel + apiOperationLocation, { headers: apiBackupHeaders });
                assert.equal(response.status, 200);
                const value = await response.json() as any;
                assert(!['failed', 'interrupted', 'uncertain'].includes(value.data.status), JSON.stringify(value));
                return value.data.status === 'completed';
            }, 'public API Native backup');
            const countApiArchives = () => readdirSync(`${root}/agent-app/servers/${id}/data/backups`).filter(name => name.includes('API-acceptance') && name.endsWith('.tar.gz')).length;
            assert.equal(countApiArchives(), 1);
            serverHeader = remoteFleet.id;
            assert.equal((await request(runtime + `/api/servers/${id + 1}`)).status, 403, 'selected administrator context is also single-server');
            assert.equal((await ok(runtime + '/api/servers')).servers.length, 1);
            serverHeader = '';
            for (const name of ['alice', 'bob'])
                await ok(panel + '/api/auth/register', 'POST', {
                    username: name,
                    password,
                    confirmPassword: password,
                    globalPermissions: [],
                });
            const users = (await ok(panel + '/api/users')).users;
            const alice = users.find((u: any) => u.username === 'alice'),
                bob = users.find((u: any) => u.username === 'bob');
            const delegatedPermissions = [
                'server.power',
                'container.logs.read',
                'container.terminal',
                'fs.read',
            ];
            await ok(
                panel + `/api/fleet/${remoteFleet.id}/members/${alice.id}`,
                'PUT',
                {
                    permissions: delegatedPermissions,
                },
            );
            await ok(
                panel + `/api/fleet/${localFleet.id}/members/${bob.id}`,
                'PUT',
                {
                    permissions: [],
                },
            );
            const adminToken = token;
            const aliceToken = (
                await ok(panel + '/api/auth/login', 'POST', {
                    username: 'alice',
                    password,
                })
            ).token;
            const bobToken = (
                await ok(panel + '/api/auth/login', 'POST', {
                    username: 'bob',
                    password,
                })
            ).token;
            token = aliceToken;
            serverHeader = remoteFleet.id;
            assert.deepEqual(
                (await ok(panel + '/api/fleet')).servers.map((s: any) => s.id),
                [remoteFleet.id],
            );
            const context = await ok(
                panel + `/api/fleet/${remoteFleet.id}/context`,
            );
            assert.equal(context.nodeId, nodeId);
            assert.equal(context.runtimeId, id);
            assert.equal(
                (await request(panel + `/api/fleet/${localFleet.id}/context`))
                    .status,
                404,
            );
            assert.equal((await request(panel + '/api/nodes')).status, 403);
            assert.equal(
                (await request(runtime + '/api/system/settings')).status,
                403,
            );
            assert.equal(
                (await request(runtime + '/api/servers/install', 'POST', spec))
                    .status,
                403,
            );
            assert.equal(
                (await request(runtime + `/api/servers/${id + 1}`)).status,
                403,
            );
            assert.equal(
                (
                    await request(
                        runtime +
                            `/api/servers/${id}/file?path=%2Fagent-test.txt`,
                        'PUT',
                        { content: 'forbidden' },
                    )
                ).status,
                403,
            );
            assert.equal(
                (await request(panel + `/api/servers/${localId}`)).status,
                403,
            );
            assert.equal((await request(panel + '/api/servers')).status, 403);
            serverHeader = '';
            assert.equal(
                (await request(panel + `/api/servers/${localId}`)).status,
                404,
            );
            assert.deepEqual((await ok(panel + '/api/servers')).servers, []);
            serverHeader = remoteFleet.id;
            const assigned = (await ok(runtime + '/api/servers')).servers;
            assert.equal(assigned.length, 1);
            assert.equal(assigned[0].id, id);
            assert.deepEqual(assigned[0].env, {});
            await ok(runtime + `/api/servers/${id}/stop`, 'POST');
            assert.equal(
                JSON.parse(docker('inspect', localGameContainer))[0].State
                    .Running,
                true,
            );
            await ok(runtime + `/api/servers/${id}/start`, 'POST');
            const delegatedDownload = await ok(
                runtime + `/api/servers/${id}/files/download-token`,
                'POST',
                { path: '/agent-test.txt' },
            );
            assert.equal(
                await (await fetch(panel + delegatedDownload.path)).text(),
                'remote file persists',
            );
            const revokedDownload = await ok(
                runtime + `/api/servers/${id}/files/download-token`,
                'POST',
                { path: '/agent-test.txt' },
            );
            const userSocket = new WebSocket(
                panel.replace('http:', 'ws:') +
                    `/api/nodes/${nodeId}/ws?server=${remoteFleet.id}`,
            );
            const userFrames: any[] = [];
            userSocket.on('message', (data) =>
                userFrames.push(JSON.parse(data.toString())),
            );
            userSocket.on('open', () =>
                userSocket.send(
                    JSON.stringify({ type: 'auth', token: aliceToken }),
                ),
            );
            try {
                await waitFor(
                    async () =>
                        userFrames.some((f) => f.type === 'auth:success'),
                    'delegated websocket authentication',
                );
                userSocket.send(JSON.stringify({ type: 'subscribe:servers' }));
                await waitFor(
                    async () =>
                        userFrames.some((f) => f.type === 'servers:snapshot'),
                    'delegated snapshot',
                );
                const snapshot = userFrames.find(
                    (f) => f.type === 'servers:snapshot',
                );
                assert.equal(snapshot.servers.length, 1);
                assert.deepEqual(snapshot.servers[0].env, {});
                userSocket.send(
                    JSON.stringify({
                        type: 'subscribe:logs',
                        serverId: id + 1,
                    }),
                );
                userSocket.send(
                    JSON.stringify({ type: 'subscribe:system-metrics' }),
                );
                await waitFor(
                    async () =>
                        userFrames.filter((f) => f.type === 'error').length >=
                        2,
                    'cross-server and host metrics denial',
                );
                const session = await ok(
                    runtime + `/api/servers/${id}/terminal/container/sessions`,
                    'POST',
                );
                userSocket.send(
                    JSON.stringify({
                        type: 'terminal:attach',
                        sessionId: session.sessionId,
                        serverId: id,
                    }),
                );
                await waitFor(
                    async () =>
                        userFrames.some((f) => f.type === 'terminal:attached'),
                    'delegated terminal ownership',
                );
                userSocket.send(
                    JSON.stringify({
                        type: 'terminal:input',
                        sessionId: session.sessionId,
                        serverId: id,
                        dataB64: Buffer.from(
                            "printf 'delegated-%s\\n' verified\n",
                        ).toString('base64'),
                    }),
                );
                await waitFor(
                    async () =>
                        userFrames
                            .filter((f) => f.type === 'terminal:output')
                            .map((f) =>
                                Buffer.from(f.dataB64, 'base64').toString(),
                            )
                            .join('')
                            .includes('delegated-verified'),
                    'delegated terminal execution',
                );
                token = adminToken;
                serverHeader = '';
                await ok(
                    panel + `/api/fleet/${remoteFleet.id}/members/${alice.id}`,
                    'DELETE',
                );
                await waitFor(
                    async () => userSocket.readyState === WebSocket.CLOSED,
                    'permission revocation closes live socket',
                );
                assert.equal(
                    (await fetch(panel + revokedDownload.path)).status,
                    403,
                );
            } finally {
                userSocket.terminate();
            }
            token = aliceToken;
            serverHeader = remoteFleet.id;
            assert.equal(
                (await request(runtime + `/api/servers/${id}`)).status,
                403,
            );
            assert.equal(
                (await request(panel + `/api/fleet/${remoteFleet.id}/context`))
                    .status,
                404,
            );
            token = bobToken;
            serverHeader = '';
            assert.deepEqual(
                (await ok(panel + '/api/fleet')).servers.map((s: any) => s.id),
                [localFleet.id],
            );
            assert.equal(
                (await request(runtime + `/api/servers/${id}`)).status,
                403,
            );
            serverHeader = localFleet.id;
            assert.equal((await ok(panel + '/api/servers')).servers.length, 1);
            assert.equal(
                (await request(panel + `/api/servers/${localId}/stop`, 'POST'))
                    .status,
                403,
            );
            token = adminToken;
            serverHeader = '';
            const localSocket = new WebSocket(panel.replace('http:', 'ws:') + `/api?server=${localFleet.id}`);
            const localFrames: any[] = [];
            localSocket.on('message', data => localFrames.push(JSON.parse(data.toString())));
            localSocket.on('open', () => localSocket.send(JSON.stringify({ type: 'auth', token: bobToken })));
            try {
                await waitFor(async () => localFrames.some(f => f.type === 'auth:success'), 'local scoped websocket');
                localSocket.send(JSON.stringify({ type: 'subscribe:servers' }));
                await waitFor(async () => localFrames.some(f => f.type === 'servers:snapshot'), 'local scoped snapshot');
                assert.deepEqual(localFrames.find(f => f.type === 'servers:snapshot').servers.map((s: any) => s.id), [localId]);
                await ok(panel + `/api/fleet/${localFleet.id}/members/${bob.id}`, 'DELETE');
                await waitFor(async () => localSocket.readyState === WebSocket.CLOSED, 'local revocation closes console');
            } finally { localSocket.terminate(); }
            await ok(panel + `/api/servers/${localId}`, 'DELETE');
            docker('restart', agentName);
            await waitFor(
                async () => (await fetch(agent + '/api/health')).ok,
                'agent restart',
            );
            assert.equal(
                JSON.parse(docker('inspect', gameContainer))[0].State.Running,
                true,
            );
            assert.equal(
                JSON.parse(docker('inspect', sentinelName))[0].State.Running,
                true,
                'foreign same-ID container must survive reconciliation',
            );
            assert.equal(
                (await ok(runtime + '/api/operations/' + operation)).state,
                'completed',
            );
            docker('stop', panelName);
            assert.equal(
                JSON.parse(docker('inspect', gameContainer))[0].State.Running,
                true,
            );
            docker('start', panelName);
            await waitFor(
                async () => (await fetch(panel + '/api/health')).ok,
                'panel restart',
            );
            const restartedApiReplay = await postApiBackup();
            assert.equal(restartedApiReplay.status, 202);
            assert.equal(restartedApiReplay.headers.get('location'), apiOperationLocation);
            assert.equal(countApiArchives(), 1, 'panel restart must not dispatch another API backup');
            assert.equal(
                (
                    await ok(
                        runtime + '/api/servers/install',
                        'POST',
                        spec,
                        operation,
                    )
                ).server.id,
                id,
            );
            docker('stop', agentName);
            assert.equal((await request(runtime + '/api/servers')).status, 503);
            docker('start', agentName);
            await waitFor(
                async () => (await fetch(agent + '/api/health')).ok,
                'agent reconnect',
            );
            await ok(panel + `/api/nodes/${nodeId}`, 'PATCH', {
                enabled: false,
            });
            assert.equal((await request(runtime + '/api/servers')).status, 503);
            assert.equal(
                JSON.parse(docker('inspect', gameContainer))[0].State.Running,
                true,
            );
            await ok(panel + `/api/nodes/${nodeId}`, 'PATCH', {
                enabled: true,
            });
            await ok(runtime + `/api/servers/${id}`, 'DELETE');
            assert.equal(
                JSON.parse(docker('inspect', sentinelName))[0].State.Running,
                true,
                'foreign same-ID container must survive remote deletion',
            );
            await ok(panel + `/api/nodes/${nodeId}/credentials`, 'POST', {});
            assert.equal((await request(runtime + '/api/servers')).status, 503);
            console.log(
                'Real node lifecycle, files, replay, WebSocket and outage checks passed',
            );
        } catch (error) {
            for (const name of [panelName, agentName])
                try {
                    console.error(docker('logs', '--tail', '80', name));
                } catch {}
            throw error;
        } finally {
            socket?.terminate();
            if (localGameContainer)
                try {
                    docker('rm', '-f', localGameContainer);
                } catch {}
            for (const name of [panelName, agentName, sentinelName])
                try {
                    docker('rm', '-f', name);
                } catch {}
            if (nodeId) {
                for (const id of docker(
                    'ps',
                    '-aq',
                    '--filter',
                    `label=gamepanel.node=${nodeId}`,
                )
                    .trim()
                    .split('\n')
                    .filter(Boolean))
                    try {
                        docker('rm', '-f', id);
                    } catch {}
                try {
                    docker('network', 'rm', `gp-${nodeId}-games`);
                } catch {}
            }
            try {
                docker('network', 'rm', `gp-ci-local-${suffix}`);
            } catch {}
            // Only our mkdtemp-owned fixture, after all containers have stopped.
            try {
                rmSync(root, { recursive: true });
            } catch {
                console.warn('Fixture retained:', root);
            }
        }
    },
);

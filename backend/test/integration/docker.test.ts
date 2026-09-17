// Opt-in only. Run on a disposable Linux Docker host, never on a production game host.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, test } from 'node:test';
import Docker from 'dockerode';
import { randomUUID } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { setTimeout } from 'node:timers/promises';
import { buildPortMaps } from '../../src/utils/docker/portBindings.js';
import { readFileSync } from 'node:fs';

const previousPolicy = process.env.GAMEPANEL_IP_PORTS;
after(() => { if (previousPolicy === undefined) delete process.env.GAMEPANEL_IP_PORTS; else process.env.GAMEPANEL_IP_PORTS = previousPolicy; });

test('generated Compose passes the JSON policy unchanged', { skip: process.env.GAMEPANEL_DOCKER_TEST !== '1' }, () => {
    const template = readFileSync(new URL('../../../deploy/lib/render-compose.sh', import.meta.url), 'utf8');
    const line = template.split('\n').find((entry) => entry.trimStart().startsWith('GAMEPANEL_IP_PORTS:'));
    assert.ok(line);
    const policy = '{"192.0.2.10":{"tcp":"27015-27030,28015","udp":"27015"}}';
    const config = execFileSync('docker', ['compose', '-p', 'skoczi-policy-test', '-f', '-', 'config', '--format', 'json'], {
        input: `services:\n  test:\n    image: node:22-alpine\n    environment:\n${line}\n`, encoding: 'utf8',
        env: { ...process.env, GAMEPANEL_IP_PORTS: policy },
    });
    assert.equal(JSON.parse(config).services.test.environment.GAMEPANEL_IP_PORTS, policy);
});

test('real Docker publishes the same TCP/UDP port on two loopback IPs', { skip: process.env.GAMEPANEL_DOCKER_TEST !== '1', timeout: 90000 }, async () => {
    const docker = new Docker();
    const image = 'node:22-alpine';
    execFileSync('docker', ['pull', image], { stdio: 'inherit', timeout: 60000 });
    const port = 28080;
    process.env.GAMEPANEL_IP_PORTS = JSON.stringify({ '127.0.0.2': { tcp: '28080', udp: '28080' }, '127.0.0.3': { tcp: '28080', udp: '28080' } });
    assert.throws(() => buildPortMaps({ tcp: [{ host: 8080, container: 8080, hostIp: '127.0.0.2', label: '' }], udp: [] }), /not allowed/);
    const mappings = ['127.0.0.2', '127.0.0.3'].map((hostIp) => ({ host: port, container: 8080, hostIp, label: 'test' }));
    const { portBindings, exposedPorts } = buildPortMaps({ tcp: mappings, udp: mappings });
    const container = await docker.createContainer({
        name: `skoczi-bind-test-${randomUUID()}`, Image: image,
        Cmd: ['node', '-e', "require('http').createServer((q,r)=>r.end('skoczi-ip-test')).listen(8080,'0.0.0.0');const s=require('dgram').createSocket('udp4');s.on('message',(m,r)=>s.send(m,r.port,r.address));s.bind(8080,'0.0.0.0');"],
        ExposedPorts: exposedPorts, HostConfig: { PortBindings: portBindings },
    });
    try {
        await container.start();
        const info = await container.inspect();
        for (const protocol of ['tcp', 'udp']) assert.equal(info.HostConfig.PortBindings[`8080/${protocol}`].length, 2);
        for (const ip of ['127.0.0.2', '127.0.0.3']) {
            let body = '';
            // Hosted CI can take several seconds to start the container process.
            for (let attempt = 0; attempt < 60; attempt++) {
                try { body = execFileSync('curl', ['--noproxy', '*', '--fail', '--silent', '--max-time', '2', `http://${ip}:${port}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); break; }
                catch { await setTimeout(250); }
            }
            if (!body) console.error('Test container logs:', String(await container.logs({ stdout: true, stderr: true, tail: 20 })));
            assert.equal(body.trim(), 'skoczi-ip-test', `TCP response from ${ip}`);
            const socket = createSocket('udp4');
            try {
                const response = await new Promise<string>((resolve, reject) => {
                    const timer = globalThis.setTimeout(() => reject(new Error(`UDP timeout: ${ip}`)), 3000);
                    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
                    socket.once('message', (message) => { clearTimeout(timer); resolve(message.toString()); });
                    socket.send('skoczi-udp-test', port, ip);
                });
                assert.equal(response, 'skoczi-udp-test');
            } finally { socket.close(); }
        }
    } finally {
        await container.remove({ force: true });
    }
});

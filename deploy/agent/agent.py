#!/usr/bin/env python3
"""Explicit, scoped agent install/enrollment. Never changes host firewall, SSH or nginx."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import urllib.request
from urllib.parse import urlsplit


def origin(value):
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('Use an HTTPS origin, without credentials or a path')
    return value.rstrip('/')


def private_json(path, value):
    temporary = path.with_name(path.name + '.new-' + secrets.token_hex(8))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        json.dump(value, out, indent=2)
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, path)


def run(*args):
    subprocess.run(args, check=True)


def compose(root, *args):
    run('docker', 'compose', '-f', str(root / 'compose.json'), *args)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Enrollment redirects are refused; use the canonical HTTPS panel origin')


def enroll(panel, node):
    token = getpass.getpass('One-time enrollment token (hidden): ').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
        raise ValueError('Invalid enrollment token format')
    req = urllib.request.Request(panel + '/api/nodes/' + node + '/enroll',
        data=json.dumps({'token': token}).encode(),
        headers={'Content-Type': 'application/json', 'User-Agent': 'GamePanel-Agent/1'})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(req, timeout=20) as response:
        value = json.loads(response.read(8193))
    if value.get('nodeId') != node or value.get('protocol') != 1 or not re.fullmatch(r'[A-Za-z0-9_-]{43}', value.get('key', '')):
        raise ValueError('Invalid enrollment response')
    value['origin'] = origin(value['origin'])
    value['panel'] = panel
    return value


def compose_config(root, node, image, port, domain):
    return {'name': 'gp-' + node, 'networks': {'games': {'external': True, 'name': 'gp-' + node + '-games'}}, 'services': {'agent': {
        'image': image, 'restart': 'unless-stopped', 'init': True,
        'env_file': ['./runtime.env'],
        'environment': {'NODE_ENV': 'production', 'PORT': '3001', 'DOMAIN': domain,
            'GAMEPANEL_APP_ROOT': str(root), 'GAMEPANEL_AGENT_CONFIG': '/identity/agent.json',
            'GAMEPANEL_NODE_ID': node, 'TELEMETRY_ENABLED': 'false',
            'GAMEPANEL_IP_PORTS': '{}',
            'TRUST_PROXY': 'false'},
        'ports': ['127.0.0.1:' + str(port) + ':3001'],
        'networks': ['games'],
        'volumes': [str(root / 'identity') + ':/identity:ro', str(root / 'data') + ':/data',
            str(root / 'servers') + ':' + str(root / 'servers'), '/var/run/docker.sock:/var/run/docker.sock'],
        'read_only': True, 'tmpfs': ['/tmp:rw,nosuid,nodev,size=256m'],
        'security_opt': ['no-new-privileges:true'], 'cap_drop': ['ALL'],
        'cap_add': ['CHOWN', 'FOWNER', 'DAC_OVERRIDE'],
        'mem_limit': '1g', 'pids_limit': 256,
        'logging': {'driver': 'json-file', 'options': {'max-size': '10m', 'max-file': '3'}}
    }}}


def ensure_network(node):
    name = 'gp-' + node + '-games'
    result = subprocess.run(['docker', 'network', 'inspect', name], capture_output=True, text=True)
    if result.returncode == 0:
        network = json.loads(result.stdout)[0]
        if network.get('Labels', {}).get('gamepanel.node') != node:
            raise ValueError('Existing network belongs to another installation')
    else:
        run('docker', 'network', 'create', '--label', 'gamepanel.managed=true', '--label', 'gamepanel.node=' + node, name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'start', 'status', 'logs', 'stop', 'reenroll', 'upgrade', 'rollback'])
    parser.add_argument('--root', default='/srv/gamepanel-agent')
    parser.add_argument('--panel', type=origin)
    parser.add_argument('--node')
    parser.add_argument('--port', type=int, default=18082)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('Run with sudo on the selected Linux node')
    root = Path(args.root)
    if not re.fullmatch(r'/(?:srv|opt)/[A-Za-z0-9_-]+', str(root)) or root.is_symlink():
        raise ValueError('Use a dedicated non-symlink path directly under /srv or /opt')
    if args.action == 'install':
        if root.exists():
            raise ValueError('Target already exists; nothing overwritten. Use status/start or a fresh dedicated path')
        if not args.panel or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', args.node or ''):
            raise ValueError('--panel and --node UUID are required')
        if not 1024 <= args.port <= 65535:
            raise ValueError('Port must be 1024–65535')
        run('docker', 'compose', 'version')
        # Build before consuming the token. No existing containers are changed.
        source = Path(__file__).resolve().parents[2]
        version = json.loads((source / 'backend/package.json').read_text())['version']
        image = 'gamepanel-agent:' + version + '-' + secrets.token_hex(4)
        run('docker', 'build', '-t', image, '-f', str(source / 'backend/Dockerfile'), str(source))
        root.mkdir(mode=0o700)
        for child in ('identity', 'data', 'servers'):
            (root / child).mkdir(mode=0o700)
        # If enrollment or writing fails, keep the directory for explicit inspection.
        identity = enroll(args.panel, args.node)
        private_json(root / 'identity/agent.json', identity)
        environment = 'JWT_SECRET=' + secrets.token_urlsafe(48) + '\nADMIN_USERNAME=agent-runtime\nADMIN_PASSWORD=' + secrets.token_urlsafe(48) + '\n'
        fd = os.open(root / 'runtime.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as out:
            out.write(environment)
        private_json(root / 'compose.json', compose_config(root, args.node, image, args.port, urlsplit(identity['origin']).netloc))
        ensure_network(args.node)
        shutil.copyfile(__file__, root / 'agent.py')
        os.chmod(root / 'agent.py', 0o700)
        compose(root, 'config', '--quiet')
        compose(root, 'up', '-d', '--pull', 'never', '--no-build')
        print('Agent started on loopback port', args.port)
        print('Configure HTTPS for the registered agent origin. See docs/skoczi/NODES.md.')
    else:
        if not (root / 'compose.json').is_file() or not (root / 'identity/agent.json').is_file():
            raise ValueError('Not an initialized agent installation')
        if args.action == 'reenroll':
            old = json.loads((root / 'identity/agent.json').read_text())
            value = enroll(old['panel'], old['nodeId'])
            if value['origin'] != old['origin']:
                raise ValueError('Origin changed unexpectedly')
            private_json(root / 'identity/agent.json', value)
            compose(root, 'restart', 'agent')
        elif args.action == 'upgrade':
            source = Path(__file__).resolve().parents[2]
            if not (source / 'backend/Dockerfile').is_file():
                raise ValueError('Run upgrade from the newly reviewed release checkout, not the installed script')
            config = json.loads((root / 'compose.json').read_text())
            version = json.loads((source / 'backend/package.json').read_text())['version']
            image = 'gamepanel-agent:' + version + '-' + secrets.token_hex(4)
            run('docker', 'build', '-t', image, '-f', str(source / 'backend/Dockerfile'), str(source))
            previous = root / ('compose.previous-' + secrets.token_hex(6) + '.json')
            private_json(previous, config)
            config['services']['agent']['image'] = image
            private_json(root / 'compose.json', config)
            compose(root, 'up', '-d', '--pull', 'never', '--no-build', 'agent')
            print('Previous Compose retained:', previous)
            print('Game containers were not restarted. Verify heartbeat and console before accepting upgrade.')
        elif args.action == 'rollback':
            raise ValueError('Select the exact saved compose.previous-*.json after reviewing release database compatibility; see NODES.md')
        else:
            commands = {'start': ['up', '-d', '--pull', 'never', '--no-build'],
                'stop': ['stop', 'agent'], 'status': ['ps'], 'logs': ['logs', '--tail', '100', 'agent']}
            compose(root, *commands[args.action])


if __name__ == '__main__':
    try:
        os.umask(0o077)
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        # No response bodies, tokens or config dumps in logs.
        print('Agent setup stopped:', str(error), file=sys.stderr)
        print('No host firewall, nginx, SSH or unrelated containers were changed.', file=sys.stderr)
        sys.exit(1)

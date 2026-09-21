#!/usr/bin/env python3
"""Game Panel PRO: inspect, update and roll back the standard Compose installation.
Never executes the environment file, regenerates Compose, or touches game containers.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import uuid

SERVICES = ('backend', 'frontend')
SOURCE_ITEMS = ('backend', 'frontend', 'deploy', 'docs', 'runtime', 'examples', 'docker-images', '.dockerignore', 'LICENSE', 'LICENSE-2.0.txt', 'NOTICE', 'CHANGELOG.md', 'README.md')
IGNORE = shutil.ignore_patterns('.git', 'node_modules', 'dist', '.env', '.env.*', '*.db', '*.sqlite*', '*.pem', '*.key', '__pycache__', 'test-results', 'playwright-report')


def run(args, capture=True):
    return subprocess.check_output(args, text=True).strip() if capture else subprocess.run(args, check=True)


def version(source):
    values = [json.loads((source / folder / 'package.json').read_text())['version'] for folder in SERVICES_TO_FOLDERS]
    if len(set(values)) != 1:
        raise ValueError('Frontend/backend versions differ')
    return values[0]


SERVICES_TO_FOLDERS = ('backend', 'frontend')


def copy_sources(source, target):
    target.mkdir()
    for name in SOURCE_ITEMS:
        item = source / name
        if not item.exists():
            raise ValueError('Incomplete release source: ' + name)
        if item.is_dir():
            shutil.copytree(item, target / name, ignore=IGNORE, symlinks=True)
        else:
            shutil.copy2(item, target / name)


def save_manifest(folder, manifest):
    temp = folder / 'manifest.tmp'
    with temp.open('w') as output:
        json.dump(manifest, output, indent=2)
        output.flush()
        os.fsync(output.fileno())
    temp.replace(folder / 'manifest.json')
    fd = os.open(folder, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Upgrade:
    def __init__(self, root, project):
        self.root = Path(root).absolute()
        self.project = project
        if self.root == Path('/') or self.root.resolve() != self.root:
            raise ValueError('Use a canonical installation root, without symlinks')
        if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', project):
            raise ValueError('Invalid Compose project name')
        self.deploy = self.root / 'deploy'
        self.env = self.deploy / '.env'
        self.compose_file = self.deploy / 'compose.yml'
        for path in [self.root / 'app', self.root / 'data', self.root / 'servers', self.deploy, self.env, self.compose_file]:
            if not path.exists() or path.is_symlink():
                raise ValueError('Missing or symlinked standard installation path: ' + str(path))

    def compose(self, *args, override=None, capture=True):
        command = ['docker', 'compose', '--project-directory', str(self.deploy), '--env-file', str(self.env), '-p', self.project, '-f', str(self.compose_file)]
        if override:
            command += ['-f', str(override)]
        return run(command + list(args), capture)

    def inspect(self):
        config = json.loads(self.compose('config', '--format', 'json'))
        services = config['services']
        if set(services) != {'backend', 'frontend', 'traefik'}:
            raise ValueError('Custom Compose services require a reviewed migration; expected backend/frontend/traefik')
        for name in SERVICES:
            service = services[name]
            build = service.get('build', {})
            if not isinstance(build, dict) or Path(build.get('context', '')).resolve() != self.root / 'app' or build.get('dockerfile') != name + '/Dockerfile':
                raise ValueError('Unexpected build context: ' + name)
            if service.get('volumes') and name == 'frontend':
                raise ValueError('Custom frontend mounts require a reviewed migration')
        mounts = services['backend'].get('volumes', [])
        expected = {str(self.root / 'data'): '/data', str(self.root / 'servers'): str(self.root / 'servers'), '/var/run/docker.sock': '/var/run/docker.sock'}
        actual = {m.get('source'): m.get('target') for m in mounts if m.get('type') == 'bind'}
        if actual != expected or len(mounts) != len(expected):
            raise ValueError('Custom backend mounts require a reviewed migration')
        env = services['backend'].get('environment', {})
        if env.get('GAMEPANEL_APP_ROOT') != str(self.root) or not env.get('JWT_SECRET'):
            raise ValueError('Unexpected runtime root or missing JWT secret')
        current = version(self.root / 'app')
        if current != '1.5.0' and not re.fullmatch(r'(?:1\.5\.0-skoczi\.\d+|2\.0\.\d+)', current):
            raise ValueError('Unsupported source version: ' + current)
        images = {}
        for name in SERVICES:
            container = self.compose('ps', '-q', name)
            if not container or '\n' in container:
                raise ValueError('Expected one running ' + name + ' container')
            info = json.loads(run(['docker', 'inspect', container]))[0]
            if not info['State']['Running']:
                raise ValueError(name + ' is not running')
            images[name] = info['Image']
        return {'fromVersion': current, 'root': str(self.root), 'project': self.project, 'images': images}

    def healthy(self, expected):
        probe = "const http=require('http');http.get('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
        for _ in range(60):
            try:
                self.compose('exec', '-T', 'backend', 'node', '-e', probe)
                installed = self.compose('exec', '-T', 'backend', 'node', '-p', "require('./package.json').version")
                front = self.compose('ps', '-q', 'frontend')
                self.compose('exec', '-T', 'frontend', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1:8080/')
                if front and installed == expected:
                    return
            except subprocess.CalledProcessError:
                pass
            time.sleep(2)
        raise RuntimeError('New panel failed version/HTTP health checks')

    def drain(self, current):
        # New releases stop accepting changes and scheduling work before restart.
        if current.startswith('2.0.'):
            probe = "const http=require('http');http.get('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health',r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{const d=JSON.parse(b).updateDrain;process.exit(d&&d.maintenance&&d.busy===0?0:1)})}).on('error',()=>process.exit(1))"
            for _ in range(60):
                try:
                    self.compose('exec', '-T', 'backend', 'node', '-e', probe)
                    break
                except subprocess.CalledProcessError:
                    time.sleep(2)
            else:
                raise ValueError('Operations did not drain; leave the running panel unchanged')
        database = self.root / 'data/game-panel.db'
        if database.exists():
            connection = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
            try:
                for table in ('file_transfer_jobs', 'installation_progress'):
                    if connection.execute("SELECT 1 FROM sqlite_master WHERE name=?", (table,)).fetchone():
                        if connection.execute("SELECT 1 FROM " + table + " WHERE status IN ('pending','running') LIMIT 1").fetchone():
                            raise ValueError('Active transfer/installation jobs must finish before updating')
            finally:
                connection.close()

    def rollback(self, snapshot):
        snapshot = Path(snapshot).resolve()
        if snapshot.parent != self.root / 'pro-update-backups':
            raise ValueError('Snapshot must belong to this installation')
        manifest = json.loads((snapshot / 'manifest.json').read_text())
        if manifest['root'] != str(self.root) or manifest['project'] != self.project:
            raise ValueError('Snapshot belongs to a different installation')
        if not manifest.get('dataComplete'):
            raise ValueError('Snapshot has no complete stopped-database copy; do not replace data')
        for path in ['app', 'data', 'deploy', 'images.json']:
            if not (snapshot / path).exists():
                raise ValueError('Incomplete snapshot: ' + path)
        # All required images must still exist before stopping anything.
        for image in manifest['images'].values():
            run(['docker', 'image', 'inspect', image])
        self.compose('stop', *SERVICES, capture=False)
        # Retain the failed/current state instead of deleting it.
        failed = snapshot / ('replaced-' + uuid.uuid4().hex)
        failed.mkdir(mode=0o700)
        for name in ('app', 'data', 'deploy'):
            (self.root / name).rename(failed / name)
            run(['cp', '-a', str(snapshot / name), str(self.root / name)])
        self.compose('up', '-d', '--no-build', '--no-deps', *SERVICES, override=snapshot / 'images.json', capture=False)
        self.healthy(manifest['fromVersion'])
        (self.root / 'data/.panel-upgrade').unlink(missing_ok=True)
        manifest['status'] = 'rolled-back'
        save_manifest(snapshot, manifest)
        print('Rollback complete; replaced state retained at ' + str(failed))

    def apply(self, source):
        if (self.root / 'data/.panel-upgrade').exists():
            raise ValueError('An unfinished update requires recovery before another update can start')
        manifest = self.inspect()
        target_version = version(source)
        if not re.fullmatch(r'2\.0\.\d+', target_version):
            raise ValueError('Use a Game Panel PRO 2.0.X release')
        if manifest['fromVersion'].startswith('2.0.') and int(target_version.split('.')[-1]) <= int(manifest['fromVersion'].split('.')[-1]):
            raise ValueError('Choose a newer PRO release; use explicit rollback for recovery')
        if source == self.root / 'app' or self.root / 'app' in source.parents:
            raise ValueError('Run the release from a separate checkout outside the installation')
        parent = self.root / 'pro-update-backups'
        parent.mkdir(mode=0o700, exist_ok=True)
        if parent.is_symlink():
            raise ValueError('Backup directory must not be a symlink')
        os.chmod(parent, 0o700)
        snapshot = parent / (time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex[:8])
        snapshot.mkdir(mode=0o700)
        manifest.update(toVersion=target_version, status='preparing', dataComplete=False)
        save_manifest(snapshot, manifest)
        print('Rollback snapshot: ' + str(snapshot), flush=True)
        for name in ('app', 'deploy'):
            run(['cp', '-a', str(self.root / name), str(snapshot / name)])
        pins = {}
        for name, image in manifest['images'].items():
            pin = f'gamepanel-pro-rollback:{snapshot.name}-{name}'
            run(['docker', 'tag', image, pin])
            pins[name] = {'image': image, 'pull_policy': 'never'}
        (snapshot / 'images.json').write_text(json.dumps({'services': pins}))
        staged = snapshot / 'candidate'
        copy_sources(source, staged)
        # Build before stopping the working panel; source stays outside runtime mounts.
        build_override = snapshot / 'build.json'
        build_override.write_text(json.dumps({'services': {name: {'build': {'context': str(staged)}} for name in SERVICES}}))
        self.compose('build', *SERVICES, override=build_override, capture=False)
        run(['docker', 'build', '-f', str(staged / 'deploy/updater/Dockerfile'), '-t', 'gamepanel-pro-updater:' + target_version, str(staged)], capture=False)
        data_bytes = int(run(['du', '-sb', str(self.root / 'data')]).split()[0])
        if shutil.disk_usage(self.root).free < data_bytes * 2 + 256 * 1024 * 1024:
            raise ValueError('Insufficient space for stopped database snapshot and recovery')
        stopped = False
        safe_to_resume = True
        maintenance = self.root / 'data/.panel-upgrade'
        maintenance.write_text('Update in progress; remove only after recovery is complete.\n')
        try:
            self.drain(manifest['fromVersion'])
            stopped = True
            self.compose('stop', *SERVICES, capture=False)
            run(['cp', '-a', str(self.root / 'data'), str(snapshot / 'data')])
            run(['sync'])
            manifest.update(dataComplete=True, status='switching')
            safe_to_resume = False
            save_manifest(snapshot, manifest)
            (self.root / 'app').rename(snapshot / 'previous-app')
            staged.rename(self.root / 'app')
            # Preserve JWT, users, domain, mounts and every unrelated setting.
            env = self.env.read_text()
            line = 'GAMEPANEL_REPOSITORY_URL=https://github.com/Skoczi/game-panel-skoczi.git'
            env = re.sub(r'^GAMEPANEL_REPOSITORY_URL=.*$', line, env, flags=re.M) if re.search(r'^GAMEPANEL_REPOSITORY_URL=', env, re.M) else env.rstrip() + '\n' + line + '\n'
            for key, value in [('GAMEPANEL_MANAGED_UPDATES', 'true'), ('GAMEPANEL_PRO_UPDATER_IMAGE', 'gamepanel-pro-updater:' + target_version), ('COMPOSE_PROJECT_NAME', self.project)]:
                env = re.sub(r'^' + key + r'=.*$', key + '=' + value, env, flags=re.M) if re.search(r'^' + key + '=', env, re.M) else env.rstrip() + '\n' + key + '=' + value + '\n'
            self.env.write_text(env)
            compose_text = self.compose_file.read_text()
            if 'GAMEPANEL_MANAGED_UPDATES:' not in compose_text:
                pattern = r'^( +)GAMEPANEL_REPOSITORY_URL:.*$'
                match = re.search(pattern, compose_text, re.M)
                if not match:
                    raise ValueError('Cannot enable updates in a custom Compose file')
                indent = match[1]
                extra = '\n'.join(indent + key + ': "${' + key + '}"' for key in ['GAMEPANEL_MANAGED_UPDATES', 'GAMEPANEL_PRO_UPDATER_IMAGE', 'COMPOSE_PROJECT_NAME'])
                compose_text = re.sub(pattern, lambda m: m[0] + '\n' + extra, compose_text, count=1, flags=re.M)
                self.compose_file.write_text(compose_text)
            self.compose('up', '-d', '--no-build', '--no-deps', *SERVICES, capture=False)
            self.healthy(target_version)
            maintenance.unlink(missing_ok=True)
            safe_to_resume = True
            manifest['status'] = 'complete'
            save_manifest(snapshot, manifest)
            print('Game Panel PRO ' + target_version + ' is ready. Snapshot: ' + str(snapshot))
        except BaseException:
            if manifest['dataComplete']:
                self.rollback(snapshot)
                safe_to_resume = True
            elif stopped:
                self.compose('up', '-d', '--no-build', '--no-deps', *SERVICES, override=snapshot / 'images.json', capture=False)
            raise
        finally:
            if safe_to_resume:
                maintenance.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'update', 'rollback'])
    parser.add_argument('--app-root', default='/opt/gamepanel')
    parser.add_argument('--project-name', default='gamepanel')
    parser.add_argument('--snapshot', type=Path)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    if sys.platform != 'linux' or os.geteuid() != 0:
        parser.error('Run on Linux as root (sudo python3 deploy/upgrade.py ...)')
    os.umask(0o077)
    upgrade = Upgrade(args.app_root, args.project_name)
    if args.action == 'check':
        result = upgrade.inspect()
        print(json.dumps({key: result[key] for key in ['fromVersion', 'root', 'project']}, indent=2))
        print('Compatible standard layout. No files or containers changed.')
        return
    lock = os.open(upgrade.root / '.pro-update.lock', os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: (_ for _ in ()).throw(InterruptedError('Update interrupted')))
        if args.action == 'rollback':
            if not args.snapshot:
                parser.error('--snapshot is required for rollback')
            upgrade.rollback(args.snapshot)
        else:
            upgrade.apply(args.source.resolve())
    finally:
        os.close(lock)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print('Error: ' + str(error), file=sys.stderr)
        sys.exit(1)

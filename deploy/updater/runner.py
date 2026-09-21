#!/usr/bin/env python3
"""Download only a named stable release from the Game Panel PRO repository."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile
import urllib.request

REPOSITORY = 'Skoczi/game-panel-skoczi'
MAX_ARCHIVE = 100 * 1024 * 1024


def fetch(url, limit):
    request = urllib.request.Request(url, headers={'User-Agent': 'Game-Panel-PRO-Updater', 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(request, timeout=60) as response:
        if not response.url.startswith('https://'):
            raise ValueError('Insecure download redirect')
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError('Download exceeds size limit')
        return data


def release_archive(version):
    if not re.fullmatch(r'2\.0\.[0-9]+', version):
        raise ValueError('Only Game Panel PRO 2.0.X releases are accepted')
    release = json.loads(fetch(f'https://api.github.com/repos/{REPOSITORY}/releases/tags/v{version}', 1024 * 1024))
    if release.get('draft') or release.get('prerelease') or release.get('tag_name') != 'v' + version:
        raise ValueError('A published stable release is required')
    name = f'game-panel-pro-{version}.tar.gz'
    assets = {asset['name']: asset['browser_download_url'] for asset in release.get('assets', [])}
    urls = []
    for filename in (name, 'SHA256SUMS'):
        expected = f'https://github.com/{REPOSITORY}/releases/download/v{version}/{filename}'
        if assets.get(filename) != expected:
            raise ValueError('Release is missing a verified source/checksum asset')
        urls.append(expected)
    sums = fetch(urls[1], 16384).decode()
    matches = re.findall(r'^([a-f0-9]{64})  ' + re.escape(name) + r'$', sums, re.M)
    if len(matches) != 1:
        raise ValueError('Missing or ambiguous archive checksum')
    content = fetch(urls[0], MAX_ARCHIVE)
    if hashlib.sha256(content).hexdigest() != matches[0]:
        raise ValueError('Archive checksum mismatch')
    return content


def extract(archive, destination):
    with tarfile.open(archive, 'r:gz') as source:
        members = source.getmembers()
        if len(members) > 20000 or sum(member.size for member in members) > 500 * 1024 * 1024:
            raise ValueError('Expanded archive exceeds limits')
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
                raise ValueError('Unsafe archive member')
        source.extractall(destination, members=members, filter='data')


def main():
    root = Path(os.environ['GP_APP_ROOT'])
    version = os.environ['GP_UPDATE_VERSION']
    project = os.environ['GP_COMPOSE_PROJECT_NAME']
    job_id = int(os.environ['GP_UPDATE_JOB_ID'])
    status_file = root / 'data' / 'panel-updater-status.json'
    def status(state, message):
        temp = status_file.with_suffix('.tmp')
        temp.write_text(json.dumps({'jobId': job_id, 'status': state, 'message': message, 'targetVersion': version}))
        temp.replace(status_file)
    os.umask(0o077)
    status('running', 'Downloading and verifying the release')
    try:
        content = release_archive(version)
        directory = root / 'pro-releases'
        directory.mkdir(exist_ok=True, mode=0o700)
        if directory.is_symlink():
            raise ValueError('Release directory must not be a symlink')
        # Keep source/logs for diagnosis; never download into the active app tree.
        work = Path(tempfile.mkdtemp(prefix='v' + version + '-', dir=directory))
        archive = work / 'source.tar.gz'
        archive.write_bytes(content)
        source = work / 'source'
        source.mkdir()
        extract(archive, source)
        for component in ('backend', 'frontend'):
            if json.loads((source / component / 'package.json').read_text())['version'] != version:
                raise ValueError('Archive version differs from the release tag')
        status('running', 'Building the release; the panel will reconnect after restart')
        with (work / 'update.log').open('w') as log:
            subprocess.run(['python3', str(source / 'deploy/upgrade.py'), 'update', '--source', str(source), '--app-root', str(root), '--project-name', project], check=True, stdout=log, stderr=subprocess.STDOUT)
        status('completed', 'Update completed. Reload the panel.')
    except Exception:
        status('failed', 'Update failed. Check the host update log and rollback snapshot before retrying.')
        raise


if __name__ == '__main__':
    main()

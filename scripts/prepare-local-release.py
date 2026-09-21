#!/usr/bin/env python3
"""Package committed source only. Does not connect, deploy, tag or publish."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def archive(ref, version):
    commit = git('rev-parse', '--verify', ref + '^{commit}').decode().strip()
    raw = git('archive', '--format=tar', commit)
    with tarfile.open(fileobj=io.BytesIO(raw)) as source:
        for member in source.getmembers():
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or member.issym() or member.islnk():
                raise ValueError('Unsafe archive member: ' + member.name)
            if path.name == '.env' or (path.name.startswith('.env.') and path.name not in ('.env.example', '.env.template')) or path.suffix in ('.db', '.sqlite', '.sqlite3', '.pem', '.key', '.p12', '.pfx'):
                raise ValueError('Private data must not be packaged: ' + member.name)
        versions = {}
        for filename in ('backend/package.json', 'frontend/package.json'):
            versions[filename] = json.load(source.extractfile(filename))['version']
        if version and set(versions.values()) != {version}:
            raise ValueError('Candidate versions disagree: ' + repr(versions))
        count = len(source.getmembers())
    content = gzip.compress(raw, compresslevel=9, mtime=0)
    return content, {'commit': commit, 'versions': versions, 'members': count, 'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--rollback', required=True)
    parser.add_argument('--version', default='2.0.50')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if git('status', '--porcelain').strip():
        raise SystemExit('Commit or otherwise resolve local changes before packaging a fixed candidate.')
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        raise SystemExit('Choose a new output directory outside the repository.')
    candidate, candidate_meta = archive(args.candidate, args.version)
    rollback, rollback_meta = archive(args.rollback, None)
    if candidate_meta['commit'] == rollback_meta['commit']:
        raise SystemExit('Candidate and rollback must be different commits.')
    output.mkdir(parents=True, exist_ok=False)
    manifest = {'version': args.version, 'scope': 'Release source with installation tools; rollback archive is source only, not a host/data snapshot.',
                'candidate': candidate_meta, 'rollback': rollback_meta,
                'deploymentGates': ['Coordinate panel and remote-agent updates when agents are configured.',
                                    'Preserve actual host image digests, environment, SQLite and migration ledger before deployment.',
                                    'Preserve game data, backup archives and recovery journals.',
                                    'Validate the target installation with a disposable server and a real game client.']}
    for name, data, metadata in [('candidate', candidate, candidate_meta), ('rollback', rollback, rollback_meta)]:
        filename = f'game-panel-pro-{args.version}.tar.gz' if name == 'candidate' else name + '-' + metadata['commit'][:12] + '.tar.gz'
        (output / filename).write_bytes(data)
        metadata['file'] = filename
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / 'SHA256SUMS').write_text(''.join(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n' for file in sorted(output.iterdir()) if file.is_file()))
    print(output)


if __name__ == '__main__':
    main()

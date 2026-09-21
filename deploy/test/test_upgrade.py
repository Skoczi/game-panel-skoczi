import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

DEPLOY = Path(__file__).resolve().parents[1]
def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value
upgrade = module('upgrade', DEPLOY / 'upgrade.py')
runner = module('runner', DEPLOY / 'updater/runner.py')

class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / 'panel'
        for name in ['app/backend', 'app/frontend', 'data', 'servers', 'deploy']:
            (self.root / name).mkdir(parents=True)
        for name in ['backend', 'frontend']:
            (self.root / 'app' / name / 'package.json').write_text('{"version":"1.5.0"}')
        (self.root / 'deploy/.env').write_text('JWT_SECRET=keep-this\nDOMAIN=panel.example.com\n')
        (self.root / 'deploy/compose.yml').write_text('services:\n  backend:\n    environment:\n      GAMEPANEL_REPOSITORY_URL: "${GAMEPANEL_REPOSITORY_URL}"\n')
        (self.root / 'data/account').write_text('account-before')
        (self.root / 'servers/game').write_text('game-data')
        self.app = upgrade.Upgrade(str(self.root), 'gamepanel')

    def config(self):
        return {'services': {
          'backend': {'build': {'context': str(self.root / 'app'), 'dockerfile':'backend/Dockerfile'},
            'environment': {'GAMEPANEL_APP_ROOT':str(self.root),'JWT_SECRET':'keep-this'},
            'volumes':[{'type':'bind','source':source,'target':target} for source,target in [(str(self.root/'data'),'/data'),(str(self.root/'servers'),str(self.root/'servers')),('/var/run/docker.sock','/var/run/docker.sock')]]},
          'frontend': {'build':{'context':str(self.root/'app'),'dockerfile':'frontend/Dockerfile'}},'traefik': {}}}

    def test_fresh_source_copy_contains_build_inputs_and_excludes_local_secrets(self):
        source = Path(self.temp.name) / 'source'
        target = Path(self.temp.name) / 'installed'
        source.mkdir(); target.mkdir()
        for name in upgrade.SOURCE_ITEMS:
            item = source / name
            if '.' in name or name in ['LICENSE', 'NOTICE']: item.write_text('fixture')
            else: item.mkdir()
        (source / 'backend/.env').write_text('SECRET=must-not-copy')
        (source / 'backend/node_modules').mkdir()
        (source / 'docs/release.md').write_text('release')
        subprocess.run(['bash', '-c', 'source "$1"; SOURCE_ROOT="$2"; APP_SOURCE_DIR="$3"; sync_project_sources', 'test', str(DEPLOY / 'lib/source-tree.sh'), str(source), str(target)], check=True)
        self.assertTrue((target / 'docs/release.md').exists())
        self.assertTrue((target / 'runtime').is_dir())
        self.assertFalse((target / 'backend/.env').exists())
        self.assertFalse((target / 'backend/node_modules').exists())

    def test_preflight_refuses_custom_mounts_without_changes(self):
        config = self.config(); config['services']['backend']['volumes'].append({'type':'bind','source':'/private','target':'/private'})
        with patch.object(self.app,'compose',return_value=json.dumps(config)):
            with self.assertRaisesRegex(ValueError,'Custom backend mounts'): self.app.inspect()
        self.assertEqual((self.root/'data/account').read_text(),'account-before')

    def test_failed_health_restores_data_source_environment_and_pinned_images(self):
        source = Path(self.temp.name).resolve()/'release'; source.mkdir()
        for name in upgrade.SOURCE_ITEMS:
            target=source/name
            if '.' in name or name in ['LICENSE','NOTICE']:target.write_text('source')
            else:target.mkdir()
        for name in ['backend','frontend']:
            (source/name/'package.json').write_text('{"version":"2.0.50"}')
        manifest={'fromVersion':'1.5.0','root':str(self.root),'project':'gamepanel','images':{'backend':'sha256:oldbackend','frontend':'sha256:oldfrontend'}}
        events=[]; real_run=upgrade.run
        def command(args,capture=True):
            if args[0]=='du': return '1000\tdata'
            if args[0]=='sync': return ''
            if args[0]=='docker': events.append(args); return ''
            return real_run(args,capture)
        def compose(*args,**kwargs): events.append(list(args));return ''
        def healthy(expected):
            if expected=='2.0.50':
                (self.root/'data/account').write_text('migrated-account')
                raise RuntimeError('health failed')
            self.assertEqual(expected,'1.5.0')
        with patch.object(self.app,'inspect',return_value=manifest),patch.object(self.app,'compose',side_effect=compose),patch.object(self.app,'healthy',side_effect=healthy),patch.object(upgrade,'run',side_effect=command):
            with self.assertRaisesRegex(RuntimeError,'health failed'):self.app.apply(source)
        self.assertEqual(upgrade.version(self.root/'app'),'1.5.0')
        self.assertEqual((self.root/'data/account').read_text(),'account-before')
        self.assertEqual((self.root/'servers/game').read_text(),'game-data')
        self.assertEqual((self.root/'deploy/.env').read_text(),'JWT_SECRET=keep-this\nDOMAIN=panel.example.com\n')
        self.assertTrue(any(event[:2]==['build','backend'] for event in events))
        self.assertFalse(any('down' in event for event in events))
        self.assertTrue(all('traefik' not in event for event in events))
        snapshot=next((self.root/'pro-update-backups').iterdir())
        self.assertEqual(json.loads((snapshot/'manifest.json').read_text())['status'],'rolled-back')

    def test_archive_rejects_links_and_traversal_before_extraction(self):
        for filename,link in [('../outside',False),('link',True)]:
            archive=Path(self.temp.name)/'archive.tar.gz';dest=Path(self.temp.name)/'extract';dest.mkdir(exist_ok=True)
            with tarfile.open(archive,'w:gz') as tar:
                item=tarfile.TarInfo(filename)
                if link:item.type=tarfile.SYMTYPE;item.linkname='/etc'
                else:item.size=1
                tar.addfile(item,None if link else io.BytesIO(b'x'))
            with self.assertRaisesRegex(ValueError,'Unsafe'):runner.extract(archive,dest)
            self.assertEqual(list(dest.iterdir()),[])

    def test_release_source_must_match_tag_checksum_and_our_repository(self):
        version='2.0.51';name=f'game-panel-pro-{version}.tar.gz'
        release={'tag_name':'v'+version,'assets':[{'name':n,'browser_download_url':f'https://github.com/{runner.REPOSITORY}/releases/download/v{version}/{n}'} for n in [name,'SHA256SUMS']]}
        with patch.object(runner,'fetch',side_effect=[json.dumps(release).encode(),('0'*64+'  '+name+'\n').encode(),b'tampered']):
            with self.assertRaisesRegex(ValueError,'checksum mismatch'):runner.release_archive(version)
        release['assets'][0]['browser_download_url']='https://example.com/untrusted'
        with patch.object(runner,'fetch',return_value=json.dumps(release).encode()):
            with self.assertRaisesRegex(ValueError,'verified source'):runner.release_archive(version)

if __name__=='__main__':unittest.main()

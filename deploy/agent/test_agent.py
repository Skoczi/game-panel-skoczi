import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('agent', Path(__file__).with_name('agent.py'))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class AgentInstallerTests(unittest.TestCase):
    def test_strict_https_origin(self):
        self.assertEqual(agent.origin('https://node.example.com/'), 'https://node.example.com')
        for value in ['http://node.example.com', 'https://user:secret@node.example.com', 'https://node.example.com/api', 'file:///tmp/a']:
            with self.assertRaises(ValueError):
                agent.origin(value)

    def test_private_atomic_identity_replacement(self):
        with tempfile.TemporaryDirectory(prefix='gp-agent-test-') as directory:
            target = Path(directory) / 'agent.json'
            agent.private_json(target, {'nodeId': 'example'})
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            agent.private_json(target, {'nodeId': 'replacement'})
            self.assertEqual(json.loads(target.read_text())['nodeId'], 'replacement')
            self.assertEqual(len(list(Path(directory).iterdir())), 1)

    def test_compose_is_scoped_and_denies_game_ports_by_default(self):
        node = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
        config = agent.compose_config(Path('/srv/example-agent'), node, 'example:reviewed', 18082, 'node.example.com')
        service = config['services']['agent']
        self.assertEqual(service['ports'], ['127.0.0.1:18082:3001'])
        self.assertTrue(service['read_only'])
        self.assertEqual(service['environment']['GAMEPANEL_IP_PORTS'], '{}')
        self.assertEqual(service['environment']['GAMEPANEL_NODE_ID'], node)
        self.assertEqual(config['networks']['games']['name'], 'gp-' + node + '-games')
        self.assertNotIn('privileged', service)
        self.assertNotIn('JWT_SECRET', service['environment'])


if __name__ == '__main__':
    unittest.main()

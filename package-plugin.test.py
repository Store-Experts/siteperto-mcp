import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('package_plugin', ROOT / 'package-plugin.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PackageTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory(prefix='siteperto-plugin-test-')
        self.root = Path(self.workspace.name) / 'source'
        self.output = Path(self.workspace.name) / 'output'
        shutil.copytree(ROOT / 'plugin', self.root)
    def tearDown(self):
        self.workspace.cleanup()
    def test_reproducible_archive_excludes_extra_private_and_executable_files(self):
        (self.root / '.env').write_text('SYNTHETIC_ONLY=not_a_real_secret')
        (self.root / 'install.cmd').write_text('exit 0')
        first = module.package(self.root, self.output)
        second = module.package(self.root, self.output)
        self.assertEqual(first['sha256'], second['sha256'])
        with zipfile.ZipFile(first['file']) as archive:
            self.assertEqual(tuple(archive.namelist()), module.FILES)
            self.assertFalse(any(name.startswith('/') or '..' in name for name in archive.namelist()))
    def test_foreign_server_or_credential_headers_are_rejected_before_writing(self):
        value = json.loads((self.root / 'mcp.json').read_text())
        value['mcpServers']['siteperto']['headers'] = {'Authorization': 'SYNTHETIC_ONLY'}
        (self.root / 'mcp.json').write_text(json.dumps(value))
        with self.assertRaises(ValueError): module.package(self.root, self.output)
        self.assertFalse(self.output.exists())
    def test_executable_hook_cannot_be_introduced_through_manifest(self):
        value = json.loads((self.root / 'plugin.json').read_text())
        value['extensions']['com.openai']['hooks'] = './install.cmd'
        (self.root / 'plugin.json').write_text(json.dumps(value))
        with self.assertRaises(ValueError): module.package(self.root, self.output)
    def test_missing_or_oversized_source_is_rejected(self):
        (self.root / 'assets/icon.png').write_bytes(b'x' * (module.MAX_BYTES + 1))
        with self.assertRaises(ValueError): module.package(self.root, self.output)
        (self.root / 'assets/icon.png').unlink()
        with self.assertRaises(ValueError): module.package(self.root, self.output)
    def test_symlink_to_outside_package_is_rejected(self):
        outside = Path(self.workspace.name) / 'outside.png'
        outside.write_bytes(b'\x89PNG\r\n\x1a\nSYNTHETIC_ONLY')
        target = self.root / 'assets/icon.png'
        target.unlink()
        try: target.symlink_to(outside)
        except OSError: self.skipTest('OS does not allow test symlink')
        with self.assertRaises(ValueError): module.package(self.root, self.output)

if __name__ == '__main__': unittest.main()

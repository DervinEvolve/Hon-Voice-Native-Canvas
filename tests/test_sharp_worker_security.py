"""Exercise the actual worker function without importing Modal or running inference."""
import ast
import os
import re
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]


def worker():
    tree = ast.parse((ROOT / 'modal/sharp_splat.py').read_text())
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'image_to_splat')
    function.decorator_list = []
    scope = {'SplatRequest': SimpleNamespace, 'os': os, 'tempfile': tempfile, 'Path': Path}
    exec(compile(ast.Module(body=[function], type_ignores=[]), 'sharp_splat.py', 'exec'), scope)
    return scope['image_to_splat']


class SharpWorkerSecurityTests(unittest.TestCase):
    def test_unapproved_targets_rejected_before_download(self):
        run = worker()
        requests = MagicMock()
        with patch.dict(sys.modules, {'requests': requests}), patch.dict(os.environ, {'HON_SPLAT_IMAGE_HOSTS': 'images.example'}):
            for url in ['http://images.example/a', 'https://127.0.0.1/a', 'https://images.example.attacker.test/a', 'https://user:pass@images.example/a']:
                with self.assertRaises(HTTPException) as error:
                    run(SimpleNamespace(image_url=url))
                self.assertEqual(error.exception.status_code, 400)
            requests.get.assert_not_called()

    def test_redirects_and_oversize_images_stop_before_inference(self):
        run = worker()
        requests = MagicMock()
        response = requests.get.return_value.__enter__.return_value
        with patch.dict(sys.modules, {'requests': requests}), patch.dict(os.environ, {'HON_SPLAT_IMAGE_HOSTS': 'images.example'}):
            response.status_code = 302
            with self.assertRaises(HTTPException) as error:
                run(SimpleNamespace(image_url='https://images.example/a'))
            self.assertEqual(error.exception.status_code, 502)
            self.assertFalse(requests.get.call_args.kwargs['allow_redirects'])
            response.status_code = 200
            response.headers = {'content-type': 'image/png', 'content-length': str(21 * 1024 * 1024)}
            with self.assertRaises(HTTPException) as error:
                run(SimpleNamespace(image_url='https://images.example/a'))
            self.assertEqual(error.exception.status_code, 413)
            response.iter_content.assert_not_called()


class SharpWorkerPinningTests(unittest.TestCase):
    def constants(self):
        tree = ast.parse((ROOT / 'modal/sharp_splat.py').read_text())
        values = {}
        for node in tree.body:
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        values[target.id] = node.value.value
        return values

    def test_sharp_source_and_checkpoint_are_pinned(self):
        values = self.constants()
        self.assertRegex(values['SHARP_COMMIT'], r'^[0-9a-f]{40}$')
        self.assertRegex(values['SHARP_CHECKPOINT_SHA256'], r'^([0-9a-f]{64})?$')
        self.assertTrue(values['SHARP_CHECKPOINT_URL'].startswith('https://ml-site.cdn-apple.com/'))
        source = (ROOT / 'modal/sharp_splat.py').read_text()
        self.assertIn('git checkout --detach {SHARP_COMMIT}', source)
        self.assertIn('sha256sum -c -', source)
        # Unpinned dependency names in the image definition are not allowed.
        for spec in re.findall(r'pip install ([^"]+)"', source):
            for part in spec.split():
                if part.startswith('-') or part == 'requirements.txt':
                    continue
                self.assertIn('==', part, part)


if __name__ == '__main__':
    unittest.main()

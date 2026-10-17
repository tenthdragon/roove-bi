import importlib.util
import os
import pathlib
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location('cleanup', pathlib.Path(__file__).resolve().parents[1] / 'deploy/staging/cleanup.py')
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class RetentionTest(unittest.TestCase):
    def test_protects_active_rollback_busy_and_recent_releases_and_backups(self):
        with tempfile.TemporaryDirectory() as root:
            releases = pathlib.Path(root).resolve() / 'releases'
            backups = pathlib.Path(root).resolve() / 'backups'
            releases.mkdir()
            backups.mkdir()
            now = time.time()
            for name in ('active', 'rollback', 'busy', 'old', 'preparing'):
                p = releases / name
                p.mkdir()
                stamp = now if name == 'preparing' else now - 30 * 86400
                os.utime(p, (stamp, stamp))
            (releases / 'current').symlink_to(releases / 'active')
            (releases / 'previous').symlink_to(releases / 'rollback')
            for i in range(8):
                p = backups / f'before-{i}.dump'
                p.touch()
                os.utime(p, (now - (20 + i) * 86400,) * 2)
            (backups / 'initial.dump').touch()
            (backups / 'recent.dump').touch()
            actual = set(cleanup.candidates(releases, backups, now, {releases / 'busy'}))
            self.assertEqual(actual, {releases / 'old'} | {backups / f'before-{i}.dump' for i in range(4, 8)})
            (releases / 'previous').unlink()
            with self.assertRaises(FileNotFoundError):
                list(cleanup.candidates(releases, backups, now))


if __name__ == '__main__':
    unittest.main()

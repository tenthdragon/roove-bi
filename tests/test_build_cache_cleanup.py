"""Filesystem safety regressions: all fixtures live in disposable temp directories."""
import contextlib
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('cleanup', Path(__file__).resolve().parents[1] / 'deploy/digitalocean/cleanup_build_cache.py')
cleanup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cleanup)


class CacheCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / 'production'
        self.root.mkdir()
        self.proc = self.base / 'proc'
        self.proc.mkdir()
        self.mountinfo = self.base / 'mountinfo'
        self.mountinfo.write_text('')
        self.lock = self.base / 'lock'
        # Advancing the clock also ages ctime, which cannot be backdated by utime.
        self.now = time.time() + 4 * cleanup.MIN_AGE
        for index, name in enumerate(('active', 'rollback', 'candidate')):
            self.release(name, built=self.now - index * 10)
        (self.root / 'current').symlink_to(self.root / 'active')
        (self.root / 'previous').symlink_to(self.root / 'rollback')

    def release(self, name, built=None):
        release = self.root / name
        release.mkdir()
        (release / 'package.json').write_text(json.dumps({'name': 'roove-bi'}))
        for filename in ('.next/cache/webpack/client/pack', '.next/cache/fetch-cache/report',
                         '.next/server/app.js', '.next/static/app.js', 'node_modules/library.js', '.env.local'):
            path = release / filename
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('preserve except stale webpack pack')
        (release / '.next/BUILD_ID').write_text('build-' + name)
        old = self.now - 3 * cleanup.MIN_AGE
        for folder, dirs, files in os.walk(release):
            for path in [Path(folder), *(Path(folder) / n for n in dirs + files)]:
                os.utime(path, (old, old))
        marker = release / '.next/BUILD_ID'
        os.utime(marker, (built or old, built or old))
        return release

    def run_cleanup(self, apply=True):
        with contextlib.redirect_stdout(io.StringIO()):
            return cleanup.cleanup(self.root, self.lock, self.proc, self.mountinfo, apply, self.now)

    def cache(self, name):
        return self.root / name / '.next/cache/webpack'

    def test_dry_run_then_apply_only_removes_old_webpack_and_is_idempotent(self):
        release = self.release('old')
        before = {p: p.read_bytes() for p in self.base.rglob('*') if p.is_file()}
        dry = self.run_cleanup(False)
        self.assertEqual(dry['eligible'], ['old'])
        self.assertGreater(dry['eligibleBytes'], 0)
        self.assertEqual(dry['removed'], [])
        for path, content in before.items():
            self.assertEqual(path.read_bytes(), content)
        result = self.run_cleanup()
        self.assertEqual(result['removed'], ['old'])
        self.assertFalse(self.cache('old').exists())
        for path, content in before.items():
            if not path.is_relative_to(self.cache('old')):
                self.assertEqual(path.read_bytes(), content)
        self.assertTrue(release.is_dir())
        self.assertEqual(self.run_cleanup()['removed'], [])

    def test_active_rollback_newest_and_extra_aliases_are_protected_even_when_old(self):
        self.release('pinned-old')
        (self.root / 'rollback-extra').symlink_to(self.root / 'pinned-old')
        self.assertEqual(self.run_cleanup()['removed'], [])
        for name in ('active', 'rollback', 'candidate', 'pinned-old'):
            self.assertTrue(self.cache(name).exists())

    def test_recent_file_write_keeps_cache_even_with_old_parent_mtime(self):
        self.release('recent')
        pack = self.cache('recent') / 'client/pack'
        os.utime(pack, (self.now, self.now))
        self.assertEqual(self.run_cleanup()['removed'], [])

    def test_running_release_or_build_is_protected(self):
        release = self.release('running')
        process = self.proc / '1234'
        process.mkdir()
        (process / 'cwd').symlink_to(release / 'node_modules')
        self.assertEqual(self.run_cleanup()['removed'], [])
        self.assertIn('running', self.run_cleanup()['protected'])

    def test_deployment_lock_skips_cleanup(self):
        self.release('old')
        with self.lock.open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.run_cleanup()['reason'], 'release-maintenance-lock-busy')
        self.assertTrue(self.cache('old').exists())

    def test_missing_or_foreign_release_links_fail_closed(self):
        self.release('old')
        previous = self.root / 'previous'
        previous.unlink()
        with self.assertRaisesRegex(RuntimeError, 'Missing release'):
            self.run_cleanup()
        previous.symlink_to(self.base)
        with self.assertRaisesRegex(RuntimeError, 'escapes'):
            self.run_cleanup()
        self.assertTrue(self.cache('old').exists())

    def test_symlinked_root_is_rejected(self):
        alias = self.base / 'alias'
        alias.symlink_to(self.root)
        with self.assertRaisesRegex(RuntimeError, 'canonical'):
            cleanup.cleanup(alias, self.lock, self.proc, self.mountinfo, True, self.now)

    def test_symlinked_ancestor_and_nested_symlink_never_touch_backups(self):
        backup = self.base / 'backups'
        backup.mkdir()
        (backup / 'important').write_text('keep')
        release = self.release('ancestor-link')
        (release / '.next').rename(release / 'original-next')
        (release / '.next').symlink_to(backup)
        self.release('nested-link')
        (self.cache('nested-link') / 'backup').symlink_to(backup)
        self.assertEqual(self.run_cleanup()['removed'], [])
        self.assertEqual((backup / 'important').read_text(), 'keep')

    def test_mount_inside_cache_is_not_traversed(self):
        self.release('mounted')
        self.mountinfo.write_text(f'1 2 8:1 / {self.cache("mounted") / "client"} rw - ext4 /dev/test rw\n')
        self.assertEqual(self.run_cleanup()['removed'], [])

    def test_link_change_immediately_before_delete_aborts(self):
        self.release('old')
        original = cleanup.remove_cache
        def change_link(root, release, info, guard):
            (root / 'current').unlink()
            (root / 'current').symlink_to(release)
            original(root, release, info, guard)
        with patch.object(cleanup, 'remove_cache', side_effect=change_link):
            with self.assertRaisesRegex(RuntimeError, 'links changed'):
                self.run_cleanup()
        self.assertTrue(self.cache('old').exists())

    def test_substituted_cache_symlink_is_rejected_before_deletion(self):
        self.release('old')
        backup = self.base / 'backups'
        backup.mkdir()
        (backup / 'important').write_text('keep')
        original = cleanup.remove_cache
        def substitute(root, release, info, guard):
            target = self.cache('old')
            target.rename(target.with_name('saved-webpack'))
            target.symlink_to(backup)
            original(root, release, info, guard)
        with patch.object(cleanup, 'remove_cache', side_effect=substitute):
            with self.assertRaisesRegex(RuntimeError, 'Cache changed'):
                self.run_cleanup()
        self.assertEqual((backup / 'important').read_text(), 'keep')

    def test_unreadable_process_inventory_aborts_without_deletion(self):
        self.release('old')
        with patch.object(cleanup, 'process_releases', side_effect=PermissionError('proc unavailable')):
            with self.assertRaises(PermissionError):
                self.run_cleanup()
        self.assertTrue(self.cache('old').exists())

    def test_unreadable_cache_subtree_fails_closed(self):
        self.release('old')
        original = os.scandir
        def denied(path):
            if str(path) == str(self.cache('old') / 'client'):
                raise PermissionError('cache unavailable')
            return original(path)
        with patch.object(cleanup.os, 'scandir', side_effect=denied):
            with self.assertRaises(PermissionError):
                self.run_cleanup()
        self.assertTrue(self.cache('old').exists())

    def test_unknown_directories_and_other_release_tree_are_untouched(self):
        unknown = self.root / 'database-copy'
        (unknown / '.next/cache/webpack').mkdir(parents=True)
        (unknown / '.next/cache/webpack/data').write_text('keep')
        staging = self.base / 'roove-bi-staging'
        (staging / '.next/cache/webpack').mkdir(parents=True)
        (staging / '.next/cache/webpack/data').write_text('keep')
        self.assertEqual(self.run_cleanup()['removed'], [])
        self.assertEqual((unknown / '.next/cache/webpack/data').read_text(), 'keep')
        self.assertEqual((staging / '.next/cache/webpack/data').read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()

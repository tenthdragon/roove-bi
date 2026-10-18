import copy
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('preflight', pathlib.Path(__file__).resolve().parents[1] / 'deploy/staging/preflight.py')
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class ReleaseFixture:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.temp.name).resolve()
        self.release = root / 'aaaaaaaaaaaa-staging'
        self.release.mkdir()
        self.root_patch = patch.object(preflight, 'RELEASE_ROOT', root)
        self.root_patch.start()
        (self.release / '.next').mkdir()
        (self.release / '.next/BUILD_ID').write_text('build-a')
        (self.release / '.release-source.json').write_text(json.dumps({'branch': 'staging', 'commit': 'a' * 40, 'build_id': 'build-a'}))
        (self.release / '.env.local').write_text('ROOVE_ENVIRONMENT=staging\nNEXT_PUBLIC_APP_ENV=staging\nROOVE_SOURCE_BRANCH=staging\nROOVE_RELEASE=aaaaaaaaaaaa-staging\nNEXT_PUBLIC_SUPABASE_URL=https://staging-app.rti-hq.com/supabase\n')
        folder = self.release / 'supabase/migrations'
        folder.mkdir(parents=True)
        (folder / '195_snapshot.sql').write_text('Historical snapshot')
        (folder / '196_feature.sql').write_text('CREATE TABLE feature(id int);')
        self.state = {
            'database': 'roove_staging',
            'migrations': preflight.expected_migrations(self.release),
            'columns': [table + '.' + column for table, names in preflight.REQUIRED_COLUMNS.items() for column in names],
            'routines': {name: True for name in preflight.REQUIRED_ROUTINES},
        }

    def tearDown(self):
        self.root_patch.stop()
        self.temp.cleanup()


class PreflightTest(ReleaseFixture, unittest.TestCase):
    def test_verified_history_and_schema_pass_without_replaying_snapshot(self):
        self.assertEqual(preflight.verify_database(self.release, self.state), 1)
        self.assertEqual(list(preflight.expected_migrations(self.release)), ['196_feature.sql'])

    def test_missing_changed_and_untracked_migrations_block_activation(self):
        for actual, expected_error in [({}, 'missing='), ({'196_feature.sql': '0' * 64}, 'checksum_mismatch='),
                                       ({**self.state['migrations'], '197_untracked.sql': '0' * 64}, 'absent_from_release=')]:
            with self.subTest(actual=actual):
                state = {**self.state, 'migrations': actual}
                with self.assertRaisesRegex(ValueError, expected_error):
                    preflight.verify_database(self.release, state)
        (self.release / 'supabase/migrations/196_duplicate.sql').write_text('SELECT 1;')
        with self.assertRaisesRegex(ValueError, 'Duplicate migration'):
            preflight.expected_migrations(self.release)

    def test_history_alone_cannot_hide_missing_tables_columns_or_rpcs(self):
        for kind in ('columns', 'routines'):
            state = copy.deepcopy(self.state)
            if kind == 'columns':
                state[kind].remove('meta_ad_metadata_sync_state.source_fingerprint')
            else:
                state[kind]['public.get_meta_sync_job_tree(uuid,uuid[])'] = False
            with self.assertRaisesRegex(ValueError, 'schema is not ready'):
                preflight.verify_database(self.release, state)
        with self.assertRaisesRegex(ValueError, 'non-staging database'):
            preflight.verify_database(self.release, {**self.state, 'database': 'postgres'})

    def test_other_staging_releases_builds_and_missing_identity_do_not_pass_health(self):
        expected = preflight.release_identity(self.release)
        preflight.verify_health(expected, expected)
        for key, wrong in [('release', 'older-staging'), ('commit', 'b' * 40), ('buildId', 'older-build'),
                           ('environment', 'production'), ('branch', 'main'), ('integrationsEnabled', True)]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, key):
                preflight.verify_health(expected, {**expected, key: wrong})
        with self.assertRaisesRegex(ValueError, 'commit'):
            preflight.verify_health(expected, {key: value for key, value in expected.items() if key != 'commit'})
        with self.assertRaisesRegex(ValueError, 'health response'):
            preflight.verify_health(expected, [])

    def test_non_staging_release_or_environment_is_rejected(self):
        with tempfile.TemporaryDirectory() as outside:
            with self.assertRaisesRegex(ValueError, 'staging release directory'):
                preflight.release_identity(pathlib.Path(outside))
        (self.release / '.env.local').write_text('NEXT_PUBLIC_SUPABASE_URL=https://production.example.com\n')
        with self.assertRaisesRegex(ValueError, 'staging environment'):
            preflight.release_identity(self.release)

    def test_database_inspection_is_read_only_and_fixed_to_the_staging_database(self):
        with patch.object(preflight.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps(self.state))) as run:
            self.assertEqual(preflight.inspect_database(), self.state)
        args, kwargs = run.call_args
        self.assertIn('roove-staging-db-1', args[0])
        self.assertIn('-d roove_staging', args[0][-1])
        self.assertTrue(kwargs['input'].startswith('BEGIN READ ONLY;'))
        self.assertIn("statement_timeout = '10s'", kwargs['input'])


class DeployFlowTest(ReleaseFixture, unittest.TestCase):
    """Exercise real shell switching/rollback against disposable releases and mocked services."""

    def setUp(self):
        super().setUp()
        self.root = self.release.parent
        self.old = self.root / 'old-staging'
        self.old.mkdir()
        shutil.copyfile(self.release / '.env.local', self.old / '.env.local')
        (self.root / 'current').symlink_to(self.old)
        self.database = self.root / 'database.json'
        self.database.write_text(json.dumps(self.state))
        self.events = self.root / 'systemctl.log'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.env = {**os.environ, 'PATH': str(self.bin) + os.pathsep + os.environ['PATH'],
                    'FIXTURE_DATABASE': str(self.database), 'FIXTURE_EVENTS': str(self.events)}
        self.stub('id', "print(0)")
        self.stub('git', "print('" + 'a' * 40 + "\\trefs/heads/staging')")
        self.stub('docker', "import os,pathlib; print(pathlib.Path(os.environ['FIXTURE_DATABASE']).read_text())")
        self.stub('curl', 'pass')
        self.stub('chown', 'pass')
        self.stub('sleep', 'pass')
        self.stub('systemctl', "import os,pathlib,sys; p=pathlib.Path(os.environ['FIXTURE_EVENTS']); p.open('a').write(' '.join(sys.argv[1:])+'\\n')")
        # GNU mv -T is unavailable on the developer's macOS; preserve its replace semantics.
        self.stub('mv', 'import os,sys; os.replace(sys.argv[-2],sys.argv[-1])')
        self.health = preflight.release_identity(self.release)
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(fixture.health).encode())

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        repo = pathlib.Path(__file__).resolve().parents[1]
        helper = (repo / 'deploy/staging/preflight.py').read_text()
        # Only fixture paths and the local HTTP port differ from the actual deployment files.
        helper = helper.replace("pathlib.Path('/var/www/releases/roove-bi-staging')", 'pathlib.Path(' + repr(str(self.root)) + ')')
        helper = helper.replace('http://127.0.0.1:3001', 'http://127.0.0.1:' + str(self.server.server_port))
        (self.release / 'deploy/staging').mkdir(parents=True)
        (self.release / 'deploy/staging/preflight.py').write_text(helper)
        for folder in ('static', 'server'):
            (self.release / '.next' / folder).mkdir()
        (self.release / '.next/static/app.js').write_text('https://staging-app.rti-hq.com/supabase')
        script = (repo / 'deploy/staging/deploy.sh').read_text().replace('/var/www/releases/roove-bi-staging', str(self.root))
        self.script = self.root / 'deploy.sh'
        self.script.write_text(script)

    def stub(self, name, body):
        path = self.bin / name
        path.write_text('#!' + sys.executable + '\n' + body + '\n')
        path.chmod(0o755)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        super().tearDown()

    def deploy(self):
        return subprocess.run(['bash', str(self.script), str(self.release)], env=self.env,
                              capture_output=True, text=True, timeout=30)

    def test_missing_migration_does_not_switch_release_or_restart_service(self):
        self.database.write_text(json.dumps({**self.state, 'migrations': {}}))
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Migration history differs', result.stderr)
        self.assertEqual((self.root / 'current').resolve(), self.old)
        self.assertFalse(self.events.exists())

    def test_different_commit_rolls_back_even_when_branch_and_environment_match(self):
        self.health = {**self.health, 'commit': 'b' * 40}
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('rolled back', result.stdout)
        self.assertEqual((self.root / 'current').resolve(), self.old)
        self.assertEqual(self.events.read_text().splitlines(), ['restart roove-bi-staging'] * 2)

    def test_different_build_rolls_back_even_when_commit_matches(self):
        self.health = {**self.health, 'buildId': 'older-build'}
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('buildId', result.stderr)
        self.assertEqual((self.root / 'current').resolve(), self.old)

    def test_matching_schema_and_running_release_activate_only_staging(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'current').resolve(), self.release)
        self.assertEqual((self.root / 'previous').resolve(), self.old)
        self.assertEqual(self.events.read_text().splitlines(), ['restart roove-bi-staging'])


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Read-only staging migration checks and verification of the running release."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import urllib.request

RELEASE_ROOT = pathlib.Path('/var/www/releases/roove-bi-staging')
REQUIRED_COLUMNS = {
    'meta_landing_page_templates': ('id', 'workspace_id', 'funnel_id', 'match_kind', 'pattern'),
    'meta_ad_metadata_sync_state': ('workspace_id', 'account_id', 'ad_id', 'creative_id', 'adset_id',
                                   'source_fingerprint', 'source_updated_at', 'adset_updated_at', 'observed_at'),
    'meta_sync_job_links': ('workspace_id', 'parent_job_id', 'child_job_id'),
}
REQUIRED_ROUTINES = (
    'public.meta_ad_contact_identity_valid(jsonb,text,text)',
    'public.meta_ctwa_destination(jsonb,jsonb,text,text,text)',
    'public.get_meta_ad_report(uuid,date,date,jsonb,jsonb,text,text,text,text,text)',
    'public.meta_ad_report_add(numeric[],jsonb)',
    'public.meta_ad_report_finish(numeric[])',
    'public.save_meta_instagram_profile_visits(uuid,text,jsonb,timestamptz,text)',
    'public.replace_meta_ad_snapshot(uuid,text,text,date,date,text,text,jsonb)',
    'public.save_meta_ad_metadata_state(uuid,text,jsonb,timestamptz)',
    'public.link_meta_sync_jobs(uuid,uuid,uuid[])',
    'public.complete_meta_sync_bundle(uuid,uuid,uuid[],text)',
    'public.get_meta_sync_job_tree(uuid,uuid[])',
)


def release_identity(release):
    release = release.resolve(strict=True)
    if release.parent != RELEASE_ROOT or not release.is_dir():
        raise ValueError('Expected a release directly inside the staging release directory')
    source = json.loads((release / '.release-source.json').read_text())
    if not isinstance(source, dict):
        raise ValueError('Invalid release source manifest')
    env = dict(line.split('=', 1) for line in (release / '.env.local').read_text().splitlines()
               if '=' in line and not line.startswith('#'))
    commit = source.get('commit', '')
    if source.get('branch') != 'staging' or not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Invalid staging source identity')
    expected = {
        'ROOVE_ENVIRONMENT': 'staging', 'NEXT_PUBLIC_APP_ENV': 'staging',
        'ROOVE_SOURCE_BRANCH': 'staging',
        'NEXT_PUBLIC_SUPABASE_URL': 'https://staging-app.rti-hq.com/supabase',
    }
    if any(env.get(key) != value for key, value in expected.items()):
        raise ValueError('Release must use only the staging environment and API')
    release_name = env.get('ROOVE_RELEASE', '')
    if not re.fullmatch(re.escape(commit[:12]) + r'-[a-zA-Z0-9-]+', release_name):
        raise ValueError('Release identifier does not match source commit')
    build_id = (release / '.next/BUILD_ID').read_text().strip()
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}', build_id):
        raise ValueError('Invalid Next build identifier')
    if source.get('build_id', build_id) != build_id:
        raise ValueError('Source metadata and Next build identifier differ')
    return {'environment': 'staging', 'branch': 'staging', 'release': release_name,
            'commit': commit, 'buildId': build_id, 'integrationsEnabled': False}


def expected_migrations(release):
    expected = {}
    versions = set()
    for path in sorted((release / 'supabase/migrations').glob('*.sql')):
        if not re.fullmatch(r'\d{3,}_[a-z0-9_]+\.sql', path.name):
            raise ValueError('Invalid migration filename: ' + path.name)
        version = int(path.name.split('_')[0])
        if version <= 195:  # Already included in the verified snapshot; never replay these.
            continue
        if version in versions:
            raise ValueError('Duplicate migration version: ' + str(version))
        versions.add(version)
        expected[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    if not expected:
        raise ValueError('Release is missing its post-snapshot migration files')
    return expected


def inspect_database():
    # All identifiers are fixed here. No database URL or credential comes from the release.
    tables = ','.join("'" + name + "'" for name in REQUIRED_COLUMNS)
    routines = ','.join("'" + signature + "',to_regprocedure('" + signature + "') IS NOT NULL"
                        for signature in REQUIRED_ROUTINES)
    sql = f"""BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT json_build_object(
 'database',current_database(),
 'migrations',(SELECT coalesce(json_object_agg(name,sha256),'{{}}'::json) FROM roove_staging_history.migrations),
 'columns',(SELECT coalesce(json_agg(table_name||'.'||column_name),'[]'::json)
            FROM information_schema.columns WHERE table_schema='public' AND table_name IN ({tables})),
 'routines',json_build_object({routines}));
COMMIT;
"""
    result = subprocess.run([
        'docker', 'exec', '-i', 'roove-staging-db-1', 'sh', '-c',
        'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -U supabase_admin -d roove_staging -Atq -v ON_ERROR_STOP=1',
    ], input=sql, text=True, capture_output=True, timeout=30, check=True)
    return json.loads(result.stdout)


def verify_database(release, state):
    if state.get('database') != 'roove_staging':
        raise ValueError('Refusing a non-staging database')
    expected = expected_migrations(release)
    applied = state.get('migrations', {})
    missing = sorted(set(expected) - set(applied))
    changed = sorted(name for name, checksum in expected.items()
                     if name in applied and applied[name] != checksum)
    unexpected = sorted(set(applied) - set(expected))
    if missing or changed or unexpected:
        raise ValueError(f'Migration history differs: missing={missing}, checksum_mismatch={changed}, absent_from_release={unexpected}')
    columns = set(state.get('columns', []))
    missing_columns = [table + '.' + column for table, names in REQUIRED_COLUMNS.items()
                       for column in names if table + '.' + column not in columns]
    missing_routines = [signature for signature in REQUIRED_ROUTINES
                        if state.get('routines', {}).get(signature) is not True]
    if missing_columns or missing_routines:
        raise ValueError(f'Staging schema is not ready: columns={missing_columns}, routines={missing_routines}')
    return len(expected)


def verify_health(expected, actual):
    if not isinstance(actual, dict):
        raise ValueError('Invalid environment health response')
    mismatches = [key for key, value in expected.items()
                  if type(actual.get(key)) is not type(value) or actual.get(key) != value]
    if mismatches:
        raise ValueError('Running staging release differs from target: ' + ', '.join(mismatches))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('release', type=pathlib.Path)
    parser.add_argument('--check-health', action='store_true')
    args = parser.parse_args()
    try:
        expected = release_identity(args.release)
        if args.check_health:
            with urllib.request.urlopen('http://127.0.0.1:3001/api/environment', timeout=5) as response:
                verify_health(expected, json.load(response))
            print('Staging commit, release and build verified')
        else:
            count = verify_database(args.release, inspect_database())
            print(f'Staging preflight passed: {count} migration checksums and required schema verified')
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print('Staging readiness failed: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

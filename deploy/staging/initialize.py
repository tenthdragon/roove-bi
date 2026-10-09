#!/usr/bin/env python3
"""Initialize one new staging database from a local snapshot; never targets cloud."""
import pathlib,subprocess,json,hashlib,datetime
base=pathlib.Path('/opt/roove-staging')
container='roove-staging-db-1'
env=dict(line.split('=',1) for line in (base/'.env').read_text().splitlines() if '=' in line)
def query(sql,db='postgres'):
 cmd=['docker','exec','-i',container,'sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -U supabase_admin -d "$1" -Atq -v ON_ERROR_STOP=1','staging',db]
 return subprocess.run(cmd,input=sql,text=True,capture_output=True,check=True).stdout.strip()
if query("SELECT count(*) FROM pg_database WHERE datname='roove_staging';")!='0':
 raise SystemExit('Staging database already exists; no automatic overwrite.')
query((base/'roles.sql').read_text())
query('CREATE DATABASE roove_staging OWNER postgres TEMPLATE template0;')
with (base/'restore.log').open('w') as log, (base/'backups/initial.dump').open('rb') as dump:
 result=subprocess.run(['docker','exec','-i',container,'sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore -U supabase_admin -d roove_staging --exit-on-error'],stdin=dump,stdout=log,stderr=log)
if result.returncode: raise SystemExit('Restore failed. Private restore.log retained; active staging unchanged.')
password=env['DB_PASSWORD']
query('\n'.join('ALTER ROLE '+role+" PASSWORD '"+password+"';" for role in ['authenticator','supabase_auth_admin','supabase_storage_admin']),db='roove_staging')
query("GRANT CONNECT ON DATABASE roove_staging TO authenticator,supabase_auth_admin,supabase_storage_admin; GRANT anon,authenticated,service_role TO authenticator; TRUNCATE auth.refresh_tokens,auth.sessions CASCADE;",db='roove_staging')
counts=query("SELECT json_build_object('authUsers',(SELECT count(*) FROM auth.users),'workspaces',(SELECT count(*) FROM public.workspaces),'storageObjects',(SELECT count(*) FROM storage.objects));",db='roove_staging')
state={'database':'roove_staging','initializedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'snapshotSha256':hashlib.sha256((base/'backups/initial.dump').read_bytes()).hexdigest(),'counts':json.loads(counts),'sessionsCleared':True}
(base/'state.json').write_text(json.dumps(state,indent=2)+'\n');(base/'state.json').chmod(0o600)
print(json.dumps(state))

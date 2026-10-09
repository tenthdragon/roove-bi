#!/usr/bin/env python3
"""Apply one reviewed feature migration to fixed staging DB, with backup/checksum."""
import pathlib,subprocess,sys,re,hashlib,datetime
base=pathlib.Path('/opt/roove-staging')
file=pathlib.Path(sys.argv[1]).resolve()
release=pathlib.Path('/var/www/releases/roove-bi-staging')
if not file.is_relative_to(release) or not re.fullmatch(r'\d{3,}_[a-z0-9_]+\.sql',file.name):raise SystemExit('Expected a staging release feature migration')
if int(file.name.split('_')[0])<=195:raise SystemExit('Historical replay refused; snapshot already includes migration 195')
def query(sql):
 return subprocess.run(['docker','exec','-i','roove-staging-db-1','sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -U supabase_admin -d roove_staging -Atq -v ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,check=True).stdout.strip()
query('CREATE SCHEMA IF NOT EXISTS roove_staging_history; CREATE TABLE IF NOT EXISTS roove_staging_history.migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());')
checksum=hashlib.sha256(file.read_bytes()).hexdigest()
previous=query("SELECT sha256 FROM roove_staging_history.migrations WHERE name='"+file.name+"';")
if previous:
 if previous!=checksum:raise SystemExit('Previously applied migration checksum differs; write a new migration')
 print('Already applied; unchanged');raise SystemExit(0)
backup=base/'backups'/('before-'+file.stem+'-'+datetime.datetime.now().strftime('%Y%m%d%H%M%S')+'.dump')
with backup.open('xb') as out:
 subprocess.run(['docker','exec','roove-staging-db-1','sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U supabase_admin -d roove_staging -Fc'],stdout=out,check=True)
backup.chmod(0o600)
sql=file.read_text()
# Permit the repository convention of one BEGIN/COMMIT wrapper.
sql=re.sub(r'\A((?:\s|--[^\n]*\n)*)BEGIN\s*;',r'\1',sql,flags=re.I)
sql=re.sub(r'COMMIT\s*;\s*\Z','',sql,flags=re.I)
if re.search(r'^\s*(BEGIN|COMMIT|ROLLBACK)\s*;',sql,flags=re.I|re.M):raise SystemExit('Internal transaction statements require manual review')
query('BEGIN;\n'+sql+"\nINSERT INTO roove_staging_history.migrations(name,sha256) VALUES('"+file.name+"','"+checksum+"');\nCOMMIT;")
print('Applied to isolated staging database; backup retained')

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const sql = await readFile(new URL('meta-ad-contact-identity-db.sql', import.meta.url), 'utf8');
process.stdout.write(execFileSync('docker', ['exec', '-i', 'supabase_db_roove-bi-local', 'sh', '-c',
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'roove-contact-test',
  'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }));

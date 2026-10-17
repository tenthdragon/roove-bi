import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const migration = (await readFile(new URL('../supabase/migrations/214_meta_instagram_profile_visits.sql', import.meta.url), 'utf8')).replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const sql = (await readFile(new URL('meta-instagram-profile-visits-db.sql', import.meta.url), 'utf8')).replace('-- MIGRATION', () => migration);
process.stdout.write(execFileSync('docker', ['exec', '-i', 'supabase_db_roove-bi-local', 'sh', '-c',
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'roove-ig-test', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }));

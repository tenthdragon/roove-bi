import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
// Fixed local Docker clone only; migration and fixtures roll back together.
const migration = process.argv.includes('--with-migration') ? (await readFile(new URL('../supabase/migrations/213_meta_ctwa_destination_groups.sql', import.meta.url), 'utf8')).replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '') : '';
const sql = (await readFile(new URL('meta-ctwa-destinations-db.sql', import.meta.url), 'utf8')).replace('-- MIGRATION', () => migration);
process.stdout.write(execFileSync('docker', ['exec', '-i', 'supabase_db_roove-bi-local', 'sh', '-c',
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'roove-ctwa-test',
  'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }));

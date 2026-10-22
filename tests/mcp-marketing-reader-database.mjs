import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Validate only migration 237 in an empty, disposable database on the local
// Supabase stack. Never apply schema changes to the shared local sample.
const database = `mcp_reader_test_${randomBytes(6).toString('hex')}`;
const docker = (command, args, input) => execFileSync('docker', [
  'exec', '-i', 'supabase_db_roove-bi-local', 'sh', '-c',
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'mcp-reader-test',
  command, '-U', 'supabase_admin', ...args,
], { input, encoding: 'utf8' });
const migration = readFileSync(new URL('../supabase/migrations/237_mcp_marketing_reader.sql', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('./mcp-marketing-reader-db.sql', import.meta.url), 'utf8');

docker('createdb', [database]);
try {
  process.stdout.write(docker('psql', ['-d', database, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'],
    fixture.replace('-- MIGRATION (applied twice by the runner)', `${migration}\n${migration}`)));
} finally {
  docker('dropdb', ['--if-exists', database]);
}

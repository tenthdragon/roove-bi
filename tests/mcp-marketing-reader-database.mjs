import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Validate migrations 237/238 in an empty, disposable database on the local
// Supabase stack. Never apply schema changes to the shared local sample.
const database = `mcp_reader_test_${randomBytes(6).toString('hex')}`;
const container = process.argv.includes('--ci') ? 'roove-access-requests-test' : 'supabase_db_roove-bi-local';
const docker = (command, args, input) => execFileSync('docker', [
  'exec', '-i', container, 'sh', '-c',
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'mcp-reader-test',
  command, '-U', 'supabase_admin', ...args,
], { input, encoding: 'utf8' });
const migration = readFileSync(new URL('../supabase/migrations/237_mcp_marketing_reader.sql', import.meta.url), 'utf8');
const dimensions = readFileSync(new URL('../supabase/migrations/238_mcp_marketing_dimensions.sql', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('./mcp-marketing-reader-db.sql', import.meta.url), 'utf8');

docker('createdb', [database]);
try {
  // Use a replacement function: a replacement string interprets `$$` as `$`,
  // which corrupts every PostgreSQL dollar-quoted block in the migration.
  const sql = fixture.replace(
    '-- MIGRATION (applied twice by the runner)',
    () => `${migration}\n${migration}\n${dimensions}\n${dimensions}`,
  );
  process.stdout.write(docker('psql', ['-d', database, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], sql));
} finally {
  docker('dropdb', ['--if-exists', database]);
}

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const query = input => execFileSync('docker', ['exec', '-i', 'supabase_db_roove-bi-local', 'psql', '-U', 'postgres', '-X', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
assert.equal(query("SELECT to_regnamespace('roove_local') IS NOT NULL;").trim(), 't');
const counts = () => query('SELECT (SELECT count(*) FROM meta_ad_mappings),(SELECT count(*) FROM meta_ad_daily_metrics);').trim();
const before = counts();
let setup = '';
for (const [file, marker] of [
  ['218_meta_brand_taxonomy.sql', "to_regclass('public.meta_ad_cep_catalog') IS NOT NULL"],
  ['219_meta_cep_catalog_lifecycle.sql', "EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='meta_ad_cep_catalog' AND column_name='is_active')"],
]) {
  const migration = fs.readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8');
  const exists = query('SELECT ' + marker + ';').trim() === 't';
  if (exists) assert.equal(query("SELECT checksum FROM roove_local.clone_migrations WHERE name='" + file + "';").trim(), createHash('sha256').update(migration).digest('hex'), 'Installed migration differs: ' + file);
  else setup += migration.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '') + '\n';
}
const sql = 'BEGIN;\n' + setup + fs.readFileSync(new URL('meta-ad-taxonomy-db.sql', import.meta.url), 'utf8') + '\nROLLBACK;';
console.log(query(sql).trim());assert.equal(counts(), before, 'Fixture writes escaped rollback');console.log('PASS: local fixture and schema changes rolled back');

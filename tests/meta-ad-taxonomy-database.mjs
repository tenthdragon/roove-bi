import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('tsx/cjs');
const { resolveTaxonomy } = require('../lib/meta-ad-taxonomy.ts');
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
const parity = `
-- Include both legacy and brand-prefixed identities, archived memberships,
-- aliases, multi-CEP rules, missing tags and explicit JSON null decisions.
INSERT INTO meta_ad_cep_catalog(workspace_id,brand_id,key,label,is_active)
 SELECT workspace_id,id,'b'||id||'.skin','Parity archived skin',false FROM brands
 WHERE workspace_id='00000000-0000-4000-8000-000000000001' AND lower(name)='roove';
WITH inputs AS (
 SELECT b.id AS brand_id,a.auto,o.overrides FROM
 (SELECT id FROM brands WHERE workspace_id='00000000-0000-4000-8000-000000000001' UNION ALL SELECT NULL::int) b
 CROSS JOIN (VALUES ('{}'::jsonb), ('{"tags":[]}'::jsonb),
 ('{"tags":[{"dimension":"cep","key":"skin"},{"dimension":"intention","key":"discovery"}]}'),
 ('{"tags":[{"dimension":"cep","key":"fixture-taxonomy-sport"},{"dimension":"intention","key":"fixture-taxonomy-educ"}]}'),
 ('{"tags":[{"dimension":"cep","key":"fixture-lifecycle"},{"dimension":"intention","key":"constructor"}]}')) a(auto)
 CROSS JOIN (VALUES ('{}'::jsonb), ('{"ceps":[]}'::jsonb), ('{"ceps":["skin","joint","skin","unknown"]}'),
 ('{"cep":" Sendi ","intention":" Conversion "}'), ('{"ceps":null,"intention":null}'),
 ('{"cep":null}'), ('{"intention":"unknown"}'), ('{"cep":"skin","ceps":["joint"]}'),
 (jsonb_build_object('cep',chr(9)||'skin'||chr(9),'intention',chr(9)||'conv'||chr(9))),
 (jsonb_build_object('intention',chr(160)||'conversion'||chr(160)))) o(overrides)
), cases AS (
 SELECT *,resolve_meta_ad_taxonomy('00000000-0000-4000-8000-000000000001',brand_id,auto,overrides) expected FROM inputs
 UNION ALL SELECT brand_id,auto_mapping,overrides,
 jsonb_build_object('cep_keys',cep_keys,'intention_key',intention_key,'cep_source',cep_source,'intention_source',intention_source)
 FROM meta_ad_classifications WHERE workspace_id='00000000-0000-4000-8000-000000000001'
)
SELECT 'PARITY:'||jsonb_build_object(
 'catalog',(SELECT jsonb_agg(c) FROM meta_ad_cep_catalog c WHERE workspace_id='00000000-0000-4000-8000-000000000001'),
 'rules',(SELECT coalesce(jsonb_agg(r),'[]') FROM meta_ad_taxonomy_rules r WHERE workspace_id='00000000-0000-4000-8000-000000000001'),
 'cases',(SELECT jsonb_agg(c) FROM cases c))::text;
`;
const sql = 'BEGIN;\n' + setup + fs.readFileSync(new URL('meta-ad-taxonomy-db.sql', import.meta.url), 'utf8') + parity + '\nROLLBACK;';
const output = query(sql).trim().split('\n');
const payload = output.find(line => line.startsWith('PARITY:'));
assert.ok(payload, 'SQL classification oracle missing');
const { catalog, rules, cases } = JSON.parse(payload.slice(7));
for (const [index, item] of cases.entries()) assert.deepEqual(resolveTaxonomy(item.brand_id, item.auto, item.overrides, catalog, rules), item.expected, `SQL classification parity case ${index}`);
console.log(output.filter(line => !line.startsWith('PARITY:')).join('\n'));
console.log(`PASS: ${cases.length} application classifications match the SQL resolver`);
assert.equal(counts(), before, 'Fixture writes escaped rollback');console.log('PASS: local fixture and schema changes rolled back');

// Fixed local clone only. Schema and fixtures always roll back together.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const query = input => execFileSync('docker', ['exec', '-i', 'supabase_db_roove-bi-local', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
assert.equal(query("SELECT to_regnamespace('roove_local') IS NOT NULL;").trim(), 't');
const snapshot = () => query('SELECT (SELECT count(*) FROM meta_ad_daily_metrics),(SELECT count(*) FROM meta_ad_mappings),to_regclass(\'public.meta_brand_report_days\');').trim();
const before = snapshot();
let migration = '';
if (query("SELECT to_regclass('public.meta_brand_report_days') IS NOT NULL;").trim() !== 't') migration += read('../supabase/migrations/222_meta_brand_overview_incremental.sql').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
migration += read('../supabase/migrations/223_meta_detail_incremental_reports.sql').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
migration += read('../supabase/migrations/230_meta_creative_format_breakdown.sql').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
if (process.argv.includes('--benchmark')) {
  console.log(query('BEGIN;\n' + migration + '\n' + read('meta-detail-mapping-benchmark.sql') + '\nROLLBACK;').trim());
  assert.equal(snapshot(), before); process.exit(0);
}
let fixtures = read('meta-ctwa-destinations-db.sql').split('DO $$ DECLARE w uuid; config')[0].replace(/^\s*BEGIN;\s*$/gm, '');
// Give two accounts the seeded official vocabulary; retain a separate brand.
fixtures += `UPDATE meta_ad_accounts a SET default_brand_id=(SELECT id FROM brands WHERE workspace_id=s.workspace_id AND lower(name)='roove') FROM ctwa_scope s WHERE s.n<3 AND a.workspace_id=s.workspace_id AND a.account_id=s.account_id;
UPDATE meta_ad_mappings SET overrides='{"ceps":["skin","joint"],"intention":"cons"}' WHERE ad_id='99999997301';
UPDATE meta_ad_daily_metrics SET currency='USD' WHERE ad_id='99999997309';
-- A long-paused ad must stay out of the current report and its comparison.
INSERT INTO meta_ad_daily_metrics(workspace_id,account_id,account_name,ad_id,ad_name,metric_date,currency,metrics,raw_insights,landing_page_urls)
SELECT workspace_id,account_id,'Paused','999999973999','Paused','1996-01-01','IDR','{"spend":9000,"impressions":10000}','{}','[]' FROM ctwa_scope WHERE n=1;
`;
console.log(query('BEGIN;\n' + migration + '\n' + fixtures + '\n' + read('meta-creative-format-db.sql') + '\n' + read('meta-detail-mapping-db.sql') + '\n' + read('meta-brand-overview-db.sql') + '\nROLLBACK;').trim());
assert.equal(snapshot(), before, 'Fixtures or schema escaped rollback');
console.log('PASS: all report/cache/schema changes rolled back');

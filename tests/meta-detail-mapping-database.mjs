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
migration += read('../supabase/migrations/231_meta_creative_format_resolution.sql').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
migration += read('../supabase/migrations/232_meta_optimization_breakdown.sql').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const matrixMigration = read('../supabase/migrations/234_meta_format_cep_matrix.sql').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const partnershipMigration = read('../supabase/migrations/235_meta_partnership_breakdown.sql').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const analysisMigration = read('../supabase/migrations/236_meta_analysis_filters.sql').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const nativeMigration = read('../supabase/migrations/241_meta_report_native_aggregation.sql').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const preserveReference = `DO $$ BEGIN EXECUTE replace(pg_get_functiondef('public.get_meta_ad_report_incremental(uuid,date,date,jsonb,jsonb,text,text,text,text,text)'::regprocedure), 'public.get_meta_ad_report_incremental(', 'pg_temp.meta_report_before_241('); EXECUTE replace(pg_get_functiondef('public.get_meta_brand_overview_report(uuid,date,date,jsonb)'::regprocedure), 'public.get_meta_brand_overview_report(', 'pg_temp.meta_overview_before_241('); END $$;`;
const fastAdMigration = read('../supabase/migrations/233_meta_optimization_ad_totals.sql').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
if (process.argv.includes('--benchmark')) {
  migration += fastAdMigration + matrixMigration + partnershipMigration + analysisMigration;
  console.log(query('BEGIN;\n' + migration + '\n' + read('meta-detail-mapping-benchmark.sql') + '\n' + preserveReference + '\n' + nativeMigration + '\n' + read('meta-native-benchmark.sql') + '\nROLLBACK;').trim());
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
console.log(query('BEGIN;\n' + migration + '\n' + fixtures + '\n' + read('meta-optimization-ad-parity-before.sql') + '\n' + 'RESET ROLE;\n' + fastAdMigration + matrixMigration + '\nSET LOCAL ROLE service_role;\n' + read('meta-optimization-ad-parity-after.sql') + '\nRESET ROLE;\n' + partnershipMigration + analysisMigration + '\n' + preserveReference + '\n' + nativeMigration + '\nSET LOCAL ROLE service_role;\nSAVEPOINT analysis_filter_tests;\n' + read('meta-analysis-filters-db.sql') + '\n' + read('meta-native-report-db.sql') + '\nROLLBACK TO SAVEPOINT analysis_filter_tests;\n' + read('meta-partnership-db.sql') + '\n' + read('meta-creative-format-db.sql') + '\n' + read('meta-optimization-db.sql') + '\n' + read('meta-format-cep-matrix-db.sql') + '\n' + read('meta-detail-mapping-db.sql') + '\nSAVEPOINT overview_suite;\n' + read('meta-brand-overview-db.sql') + '\nROLLBACK TO SAVEPOINT overview_suite;\n' + read('advertiser-brand-report-db.sql').split('RESET ROLE;')[0] + '\nROLLBACK;').trim());
assert.equal(snapshot(), before, 'Fixtures or schema escaped rollback');
console.log('PASS: all report/cache/schema changes rolled back');

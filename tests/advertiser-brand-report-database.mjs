// The real local projection/schema and all fixtures are tested in one rollback.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const query = input => execFileSync('docker', ['exec', '-i', 'supabase_db_roove-bi-local', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
assert.equal(query("SELECT to_regnamespace('roove_local') IS NOT NULL;").trim(), 't');
const snapshot = () => query("SELECT (SELECT count(*) FROM meta_ad_daily_metrics),(SELECT count(*) FROM meta_ad_mappings),to_regclass('public.workspace_advertiser_brands'),to_regclass('public.meta_brand_report_days');").trim();
const before = snapshot();
let migration = '';
if (query("SELECT to_regclass('public.meta_brand_report_days') IS NOT NULL;").trim() !== 't') migration += read('../supabase/migrations/222_meta_brand_overview_incremental.sql').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
migration += read('../supabase/migrations/223_meta_detail_incremental_reports.sql').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
migration += read('../supabase/migrations/224_advertiser_brand_access.sql').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const fixtures = read('meta-ctwa-destinations-db.sql').split('DO $$ DECLARE w uuid; config')[0].replace(/^\s*BEGIN;\s*$/gm, '');
console.log(query('BEGIN;\n' + migration + '\n' + fixtures + '\n' + read('advertiser-brand-report-db.sql') + '\nROLLBACK;').trim());
assert.equal(snapshot(), before, 'Fixtures or schema escaped rollback');
console.log('PASS: schema and fixtures rolled back; local data preserved');

// Fixed local sample only. Schema, permissions and fixtures are rolled back together.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const query = input => execFileSync('docker', ['exec','-i','supabase_db_roove-bi-local','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'], { input, encoding:'utf8',maxBuffer:8*1024*1024 });
assert.equal(query("SELECT to_regnamespace('roove_local') IS NOT NULL;").trim(),'t');
const snapshot = () => query("SELECT (SELECT count(*) FROM meta_ad_mappings),(SELECT count(*) FROM meta_ad_funnels),(SELECT count(*) FROM workspace_role_permissions),to_regclass('meta_ad_intention_catalog'),to_regclass('workspace_advertiser_brands');");
const before=snapshot();
let migrations='';
for (const [name,table] of [['222_meta_brand_overview_incremental.sql','meta_brand_report_days'],['224_advertiser_brand_access.sql','workspace_advertiser_brands']]) {
 if (query(`SELECT to_regclass('public.${table}') IS NOT NULL;`).trim()!=='t') migrations+=read('../supabase/migrations/'+name).replace(/^\s*(BEGIN|COMMIT);\s*$/gm,'');
}
migrations+=read('../supabase/migrations/223_meta_detail_incremental_reports.sql').replace(/^\s*(BEGIN|COMMIT);\s*$/gm,'');
for(const name of ['227_meta_brand_edit_permissions.sql','228_meta_brand_intentions.sql']) migrations+=read('../supabase/migrations/'+name).replace(/^\s*(BEGIN|COMMIT);\s*$/gm,'');
console.log(query('BEGIN;\n'+migrations+'\n'+read('meta-brand-edit-db.sql')+'\nROLLBACK;').trim());
assert.equal(snapshot(),before,'Schema or fixtures escaped rollback');
console.log('PASS: permissions/schema/data restored by rollback');

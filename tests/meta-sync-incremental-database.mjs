import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../supabase/migrations/215_meta_incremental_metadata_and_sync_progress.sql',import.meta.url),'utf8')).replace(/^\s*(BEGIN|COMMIT);\s*$/gm,'');
const migration=process.argv.includes('--with-migration')?source:'';
const sql=(await readFile(new URL('meta-sync-incremental-db.sql',import.meta.url),'utf8')).replace('-- MIGRATION',()=>migration);
process.stdout.write(execFileSync('docker',['exec','-i','supabase_db_roove-bi-local','sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"','roove-meta-incremental-test','psql','-U','supabase_admin','-d','postgres','-X','-Atq','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',maxBuffer:8*1024*1024}));

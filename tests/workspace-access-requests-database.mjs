import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const database=`access_requests_test_${randomBytes(6).toString('hex')}`;
const container=process.argv.includes('--ci')?'roove-access-requests-test':'supabase_db_roove-bi-local';
const docker=(command,args,input)=>execFileSync('docker',[
 'exec','-i',container,'sh','-c',
 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"','access-request-test',
 command,'-U','supabase_admin',...args,
],{input,encoding:'utf8'});
const migration=readFileSync(new URL('../supabase/migrations/221_workspace_access_requests.sql',import.meta.url),'utf8');
const fixture=readFileSync(new URL('workspace-access-requests-db.sql',import.meta.url),'utf8');
docker('createdb',[database]);
try{
 process.stdout.write(docker('psql',['-d',database,'-X','-Atq','-v','ON_ERROR_STOP=1'],fixture.replace('-- MIGRATION',()=>migration)));
}finally{docker('dropdb',['--if-exists',database]);}

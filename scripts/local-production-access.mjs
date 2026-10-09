import {execFileSync,spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {cleanEnvironment,PROJECT_ID} from './local-supabase-lib.mjs';
export const PRODUCTION_REF='hpsenndhoyzgnnkrhtly';
export const container=`supabase_db_${PROJECT_ID}`;
export const dockerEnv=cleanEnvironment();
let nextReadRequest=0,readCooldown=0;
export function managementToken() {
  let token=execFileSync('/usr/bin/security',['find-generic-password','-s','Supabase CLI','-a','supabase','-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  if(token.startsWith('go-keyring-encoded:')) token=Buffer.from(token.slice(19),'hex').toString();
  if(token.startsWith('go-keyring-base64:')) token=Buffer.from(token.slice(18),'base64').toString();
  if(!/^sbp_(oauth_)?[a-f0-9]{40}$/.test(token)) throw new Error('Unexpected Management API credential format; value withheld.');
  return token;
}
export async function productionReadOnlyQuery(query) {
  // Keep this fixed project/endpoint below its documented 120 requests/minute.
  // Reserve request starts synchronously so concurrent workers share the budget.
  const start=Math.max(Date.now(),nextReadRequest,readCooldown);
  nextReadRequest=start+600;
  if(start>Date.now())await new Promise(resolve=>setTimeout(resolve,start-Date.now()));
  const response=await fetch(`https://api.supabase.com/v1/projects/${PRODUCTION_REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${managementToken()}`,'Content-Type':'application/json'},body:JSON.stringify({query,read_only:true}),signal:AbortSignal.timeout(90000)});
  const remaining=Number(response.headers.get('x-ratelimit-remaining'));
  const reset=Number(response.headers.get('x-ratelimit-reset') || response.headers.get('retry-after'));
  if((response.status===429 || (response.headers.has('x-ratelimit-remaining') && remaining<=4)) && Number.isFinite(reset) && reset>0)readCooldown=Math.max(readCooldown,Date.now()+Math.min(reset,60)*1000+500);
  if(!response.ok) {
    const body=await response.json().catch(()=>({}));
    const reason=String(body.message || body.error || '').slice(0,500);
    throw new Error(`Read-only query HTTP ${response.status}: ${reason}`);
  }
  return response.json();
}
export async function productionConnection(root) {
  const text=await readFile(path.join(root,'.local/production-db.env'),'utf8');
  let password=text.match(/^\s*SUPABASE_DB_PASSWORD\s*=\s*(.*)$/m)?.[1]?.trim();
  if(password && ((password.startsWith('"') && password.endsWith('"')) || (password.startsWith("'") && password.endsWith("'")))) password=password.slice(1,-1);
  if(!password || /[\r\n\0]/.test(password)) throw new Error('Missing/invalid private PostgreSQL password; value withheld.');
  const token=managementToken();
  const response=await fetch(`https://api.supabase.com/v1/projects/${PRODUCTION_REF}/config/database/pooler`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`Connection metadata HTTP ${response.status}`);
  const configs=await response.json();
  const config=configs.find(c=>c.database_type==='PRIMARY') || configs[0];
  const host=config?.db_host,user=config?.db_user;
  if(!/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(host) || user!==`postgres.${PRODUCTION_REF}`) throw new Error('Unexpected production endpoint; no credentials sent.');
  return {host,user,password};
}
export function remoteProcess(connection,program,args=[],timeout=0) {
  if(!['psql','pg_dump'].includes(program)) throw new Error('Remote access allows only read-only query/dump, never restore');
  const shell='IFS= read -r PGPASSWORD; export PGPASSWORD; export PGSSLMODE=require PGCONNECT_TIMEOUT=15 PGAPPNAME=roove-local-clone-readonly; export PGOPTIONS="-c default_transaction_read_only=on -c lock_timeout=10000 -c statement_timeout=0 -c idle_in_transaction_session_timeout=1200000"; exec "$@"';
  return spawn('docker',['exec','-i',container,'sh','-c',shell,'roove-production-readonly',program,'-h',connection.host,'-p','5432','-U',connection.user,'-d','postgres',...args],{env:dockerEnv,stdio:['pipe','pipe','pipe'],...(timeout?{timeout}: {})});
}
export function localQuery(sql,database='postgres',administrator=false) {
  if(!/^(postgres|template1|roove_clone_\d+|roove_before_clone_\d+)$/.test(database)) throw new Error('Unexpected local database target');
  const command=administrator?['sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"','roove-local-admin','psql','-U','supabase_admin']:['psql','-U','postgres'];
  return execFileSync('docker',['exec','-i',container,...command,'-X','-d',database,'-v','ON_ERROR_STOP=1','-Atq'],{input:sql,env:dockerEnv,encoding:'utf8',maxBuffer:30*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
}

import {execFileSync} from 'node:child_process';
import {readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {container,dockerEnv,localQuery,PRODUCTION_REF} from './local-production-access.mjs';
import {PROJECT_ID,assertProjectConfig,assertLoopbackBindings,sqlLiteral} from './local-supabase-lib.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const local=path.join(root,'.local');
const run=args=>execFileSync('docker',args,{env:dockerEnv,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const quote=name=>`"${name}"`;
let stopped=[];
try {
  assertProjectConfig(await readFile(path.join(local,'supabase/config.toml'),'utf8'));
  if(await access(path.join(local,'clone-state.json')).then(()=>true,()=>false)) throw new Error('An active clone already exists; no automatic replacement.');
  const pending=JSON.parse(await readFile(path.join(local,'pending-clone.json'),'utf8'));
  if(!/^roove_clone_\d{14}$/.test(pending.database) || pending.countDifferences.length || pending.schemaDifferences.length || !Array.isArray(pending.contentDifferences) || pending.contentDifferences.length) throw new Error('Clone is not verified');
  const directory=path.resolve(pending.directory);
  if(path.dirname(directory)!==path.join(local,'production-clones')) throw new Error('Unexpected clone archive path');
  const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
  if(manifest.source!==PRODUCTION_REF) throw new Error('Unexpected clone source');
  if(manifest.format==='schema-and-copy-v1' && pending.verifiedPackages!==manifest.chunks.length)throw new Error('Not every source package passed content verification');
  const stamp=pending.database.slice('roove_clone_'.length),previous=`roove_before_clone_${stamp}`;
  if(localQuery(`SELECT count(*) FROM pg_database WHERE datname=${sqlLiteral(previous)};`,'template1')!=='0') throw new Error('Rollback database already exists; preserving it.');
  const names=run(['ps','--filter',`label=com.supabase.cli.project=${PROJECT_ID}`,'--format','{{.Names}}']).trim().split('\n').filter(Boolean);
  if(!names.includes(container) || names.some(name=>!name.startsWith('supabase_') || !name.endsWith(PROJECT_ID))) throw new Error('Unexpected Docker project container inventory');
  assertLoopbackBindings(JSON.parse(run(['inspect',...names])));
  stopped=names.filter(name=>name!==container);
  if(stopped.length) run(['stop','--time','15',...stopped]);
  const databases=JSON.parse(localQuery("SELECT json_agg(datname) FROM pg_database;",'template1'));
  if(!databases.includes('postgres') || !databases.includes(pending.database)) throw new Error('Expected databases are missing; no cutover');
  try {
    localQuery(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('postgres',${sqlLiteral(pending.database)}) AND pid<>pg_backend_pid();
      ALTER DATABASE postgres RENAME TO ${quote(previous)};
      ALTER DATABASE ${quote(pending.database)} RENAME TO postgres;`,'template1',true);
  } catch(error) {
    const current=JSON.parse(localQuery("SELECT json_agg(datname) FROM pg_database;",'template1'));
    if(!current.includes('postgres') && current.includes(previous)) localQuery(`ALTER DATABASE ${quote(previous)} RENAME TO postgres;`,'template1',true);
    throw error;
  }
  const state={mode:'production-snapshot',source:manifest.source,captured_at:manifest.captured_at,activated_at:new Date().toISOString(),directory,previous_database:previous,verification:pending,local_overlays:[]};
  await writeFile(path.join(local,'clone-state.json'),JSON.stringify(state,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({activated:true,sourceTables:pending.sourceTables,authUsers:pending.authUsers,previousLocalDatabase:previous,productionWrites:0}));
} catch(error) {
  console.error(error.message.startsWith('Command failed:')?'Local cutover failed; previous database preserved and diagnostic details withheld.':error.message);
  process.exitCode=1;
} finally {
  if(stopped.length)run(['start',...stopped]);
}

import {execFileSync,spawn} from 'node:child_process';
import {readFile,writeFile,stat,chmod} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGunzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {container,dockerEnv,localQuery,PRODUCTION_REF} from './local-production-access.mjs';
import {catalogQuery,countQueries} from './local-clone-catalog.mjs';
import {PROJECT_ID,assertProjectConfig,assertLoopbackBindings,sqlLiteral} from './local-supabase-lib.mjs';
import {atomicJson,readJson,batchHashSql,tableName} from './local-clone-checkpoint.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const local=path.join(root,'.local');
const quote=name=>`"${name.replaceAll('"','""')}"`;
const run=(args)=>execFileSync('docker',args,{env:dockerEnv,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});
const digest=async file=>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');};
async function verifyQuery(database,sql) {
  if(!/^roove_clone_\d{14}$/.test(database))throw new Error('Unexpected local verification target');
  const child=spawn('docker',['exec','-i',container,'sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"','roove-local-verify','psql','-X','-U','supabase_admin','-d',database,'-Atq','-v','ON_ERROR_STOP=1'],{env:dockerEnv,stdio:['pipe','pipe','pipe']});
  let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.resume();child.stdin.on('error',()=>{});
  const exit=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Local content checksum query failed')));});
  child.stdin.end(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=public,extensions; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, MDY';\n${sql}\nCOMMIT;`);
  await exit;return output.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
}
async function restoreSchema(database,archive,section,directory) {
  if(section) {
    // DDL and phase checkpoint commit together; a failed phase rolls back completely.
    let sql;
    try {sql=run(['exec',container,'pg_restore',`--section=${section}`,'--file=-',archive]);}
    catch(error) {await writeFile(path.join(directory,'restore-error.log'),error.stderr?.toString() || 'Cannot read schema archive',{mode:0o600});throw new Error('Cannot read local schema archive');}
    try {localQuery(`BEGIN;\n${sql}\nINSERT INTO roove_local_clone.phases(name) VALUES(${sqlLiteral(section)}); COMMIT;`,database,true);}
    catch(error) {await writeFile(path.join(directory,'restore-error.log'),error.stderr?.toString() || 'Schema phase failed',{mode:0o600});throw new Error(`Local ${section} restore failed; entire phase rolled back, completed data packages preserved.`);}
    return;
  }
  const child=spawn('docker',['exec',container,'sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"','roove-local-restore','pg_restore','-U','supabase_admin','--dbname',database,'--jobs=4',...(section?[`--section=${section}`]:['--clean','--if-exists']),'--exit-on-error',archive],{env:dockerEnv,stdio:['ignore','pipe','pipe']});
  let diagnostics='';
  child.stdout.on('data',data=>{diagnostics+=data;});child.stderr.on('data',data=>{diagnostics+=data;});
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  if(code!==0) {await writeFile(path.join(directory,'restore-error.log'),diagnostics,{mode:0o600});throw new Error(`Local restore failed (${code}); previous local database untouched. Private diagnostic saved.`);}
}
async function restoreChunk(database,directory,chunk) {
  const child=spawn('docker',['exec','-i',container,'sh','-c','export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"','roove-local-copy','psql','-X','-U','supabase_admin','-d',database,'-Atq','-v','ON_ERROR_STOP=1'],{env:dockerEnv,stdio:['pipe','pipe','pipe']});
  let diagnostics='';child.stdout.resume();child.stderr.on('data',data=>{diagnostics+=data;});
  const exit=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Local COPY failed (${code}): chunk ${chunk.file}`)));});
  exit.catch(()=>{}); // Pipeline may report a closed pipe before we await exit.
  child.stdin.on('error',()=>{});
  child.stdin.write(`BEGIN; SET LOCAL session_replication_role=replica; COPY ${quote(chunk.schema)}.${quote(chunk.table)} (${chunk.columns.map(quote).join(',')}) FROM STDIN WITH (FORMAT csv);\n`);
  try {await pipeline(createReadStream(path.join(directory,chunk.file)),createGunzip(),child.stdin,{end:false});child.stdin.end(`\\.\nINSERT INTO roove_local_clone.chunks(file,sha256,rows) VALUES(${sqlLiteral(chunk.file)},${sqlLiteral(chunk.sha256)},${chunk.rows});\nCOMMIT;\n`);await exit;}
  catch(error) {child.stdin.destroy();await writeFile(path.join(directory,`${chunk.file}.restore-error.log`),diagnostics,{mode:0o600});throw error;}
}

try {
  assertProjectConfig(await readFile(path.join(local,'supabase/config.toml'),'utf8'));
  const inspected=JSON.parse(run(['inspect',container]));
  if(inspected[0].Config.Labels['com.supabase.cli.project']!==PROJECT_ID) throw new Error('Unexpected local Docker project');
  assertLoopbackBindings(inspected);
  const pointer=JSON.parse(await readFile(path.join(local,'latest-production-clone.json'),'utf8'));
  const directory=path.resolve(pointer.directory);
  const stamp=path.basename(directory);
  if(!/^\d{14}$/.test(stamp) || path.dirname(directory)!==path.join(local,'production-clones')) throw new Error('Unexpected private archive path');
  const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
  const chunked=manifest.format==='schema-and-copy-v1';
  if(manifest.source!==PRODUCTION_REF || (chunked?!manifest.completed_at:!manifest.archive?.sha256)) throw new Error('Incomplete/unexpected production archive');
  const files=chunked?[{file:'schema.dump',...manifest.schema},...manifest.chunks]:[{file:'production.dump',...manifest.archive}];
  for(const entry of files) {
    if(!/^(production\.dump|schema\.dump|chunk-\d{5}\.csv\.gz)$/.test(entry.file)) throw new Error('Unexpected archive filename');
    const file=path.join(directory,entry.file);
    if((await stat(file)).size!==entry.bytes || await digest(file)!==entry.sha256) throw new Error('Archive checksum/size mismatch');
  }
  const archive=path.join(directory,chunked?'schema.dump':'production.dump');
  const database=`roove_clone_${stamp}`;
  const restoreStateFile=path.join(directory,'restore-state.json');
  const existing=localQuery(`SELECT count(*) FROM pg_database WHERE datname=${sqlLiteral(database)};`,'template1')!=='0';
  if(existing) {
    const state=await readJson(restoreStateFile).catch(()=>null);
    if(!chunked || state?.database!==database || state?.schema_sha256!==manifest.schema.sha256 || state?.source!==PRODUCTION_REF)throw new Error('Existing clone target has no matching restore checkpoint; preserving it for inspection.');
  }
  const roles=manifest.catalog.roles.map(r=>r.name);
  for(const role of roles) {
    if(!/^[a-z][a-z0-9_]*$/.test(role)) throw new Error('Unexpected source role name');
    if(localQuery(`SELECT count(*) FROM pg_roles WHERE rolname=${sqlLiteral(role)};`,'template1')==='0') localQuery(`CREATE ROLE ${quote(role)} NOLOGIN;`,'template1',true);
  }
  const locale=manifest.catalog.locale;
  if(locale.encoding!=='UTF8' || locale.collate!=='en_US.UTF-8' || locale.ctype!=='en_US.UTF-8') throw new Error('Review source database locale before restoring');
  if(!existing) {
    await atomicJson(restoreStateFile,{database,source:PRODUCTION_REF,schema_sha256:manifest.schema?.sha256,started_at:new Date().toISOString()});
    localQuery(`CREATE DATABASE ${quote(database)} OWNER postgres TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';`,'template1',true);
  }
  const temporary=`/tmp/roove-clone-${stamp}`;
  run(['exec',container,'mkdir','-p','-m','700',temporary]);
  run(['cp',archive,`${container}:${temporary}/production.dump`]);
  console.log(`Restoring verified archive into a separate LOCAL database (${chunked?manifest.archiveBytes:manifest.archive.bytes} bytes). Current local database is preserved.`);
  if(chunked) {
    localQuery(`CREATE SCHEMA IF NOT EXISTS roove_local_clone;
      REVOKE ALL ON SCHEMA roove_local_clone FROM PUBLIC,anon,authenticated;
      CREATE TABLE IF NOT EXISTS roove_local_clone.phases(name text PRIMARY KEY,completed_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS roove_local_clone.chunks(file text PRIMARY KEY,sha256 text NOT NULL,rows bigint NOT NULL,completed_at timestamptz NOT NULL DEFAULT now());`,database,true);
    const phases=new Set(JSON.parse(localQuery("SELECT coalesce(json_agg(name),'[]') FROM roove_local_clone.phases;",database,true)));
    // pg_dump relies on template0's built-in public schema; preserve it.
    if(!phases.has('pre-data'))await restoreSchema(database,`${temporary}/production.dump`,'pre-data',directory);
    const restored=new Map(JSON.parse(localQuery("SELECT coalesce(json_agg(json_build_array(file,sha256,rows)),'[]') FROM roove_local_clone.chunks;",database,true)).map(([file,hash,rows])=>[file,{hash,rows}]));
    const pendingChunks=manifest.chunks.filter(chunk=>{
      const saved=restored.get(chunk.file);
      if(saved && (saved.hash!==chunk.sha256 || saved.rows!==chunk.rows))throw new Error('Restored package checkpoint does not match archive');
      return !saved;
    });
    console.log(`Local COPY: ${restored.size} completed packages retained, ${pendingChunks.length} remaining.`);
    let next=0,completed=0,failed;
    const results=await Promise.allSettled(Array.from({length:4},async()=>{while(!failed && next<pendingChunks.length){try{await restoreChunk(database,directory,pendingChunks[next++]);completed++;if(completed%40===0 || completed===pendingChunks.length)console.log(`Restored ${completed}/${pendingChunks.length} remaining packages.`);}catch(error){failed=error;throw error;}}}));
    if(failed)throw failed;
    for(const result of results)if(result.status==='rejected')throw result.reason;
    for(const sequence of manifest.sequences) localQuery(`SELECT setval(${sqlLiteral(sequence.sequence)}::regclass,${BigInt(sequence.last_value)},${Boolean(sequence.is_called)});`,database,true);
    if(!phases.has('post-data'))await restoreSchema(database,`${temporary}/production.dump`,'post-data',directory);
    if(!phases.has('analyze'))localQuery("BEGIN; ANALYZE; INSERT INTO roove_local_clone.phases(name) VALUES('analyze'); COMMIT;",database,true);
    const pending=manifest.materialized_views.filter(view=>view.populated);
    const refreshed=new Set();
    while(pending.length) {
      const index=pending.findIndex(view=>view.dependencies.every(dependency=>refreshed.has(dependency)));
      if(index===-1) throw new Error('Review materialized-view refresh dependency order');
      const [view]=pending.splice(index,1);
      const phase=`materialized:${view.schema}.${view.name}`;
      if(!phases.has(phase))localQuery(`BEGIN; REFRESH MATERIALIZED VIEW ${quote(view.schema)}.${quote(view.name)}; INSERT INTO roove_local_clone.phases(name) VALUES(${sqlLiteral(phase)}); COMMIT;`,database,true);
      refreshed.add(`${view.schema}.${view.name}`);
    }
  }
  else await restoreSchema(database,`${temporary}/production.dump`,null,directory);
  console.log('Restore completed. Checking schema fingerprints and every source table count...');
  const catalog=JSON.parse(localQuery(`SET search_path=public,extensions; SET timezone='UTC'; SET datestyle='ISO, MDY';\n${catalogQuery}`,database,true));
  const counts=Object.fromEntries(localQuery(countQueries,database,true).split('\n').filter(line=>line.startsWith('{')).map(line=>{const row=JSON.parse(line);return [row.table,Number(row.count)];}));
  const countDifferences=Object.entries(manifest.counts).filter(([name,count])=>counts[name]!==count);
  const schemaDifferences=Object.entries(manifest.catalog.schema_fingerprints).filter(([schema,fingerprint])=>catalog.schema_fingerprints[schema]!==fingerprint);
  const contentDifferences=[];
  let verifiedPackages=0;
  if(chunked && !countDifferences.length && !schemaDifferences.length) {
    console.log('Table counts and schema match. Checking every restored package against its source CSV SHA-256...');
    const tables=new Map(manifest.copy_tables.map(table=>[tableName(table),table]));
    if(manifest.chunks.some(chunk=>!chunk.csv_sha256 || !tables.get(`${chunk.schema}.${chunk.table}`)?.keys?.length))throw new Error('Complete package content verification requires canonical checksums and stable primary keys');
    let next=0,failed;
    const results=await Promise.allSettled(Array.from({length:4},async()=>{
      while(!failed && next<manifest.chunks.length) {
        const index=next;next+=20;
        const batch=manifest.chunks.slice(index,index+20);
        const sql=batch.map(chunk=>`SELECT jsonb_build_object('file',${sqlLiteral(chunk.file)},'rows',q.rows,'csv_sha256',q.csv_sha256) FROM (${batchHashSql(tables.get(`${chunk.schema}.${chunk.table}`),chunk.offset,chunk.rows)}) q;`).join('\n');
        try {
          const output=await verifyQuery(database,sql),values=new Map(output.map(row=>[row.file,row]));
          for(const chunk of batch) {
            const value=values.get(chunk.file);
            if(value?.rows!==chunk.rows || value.csv_sha256!==chunk.csv_sha256)contentDifferences.push(chunk.file);
          }
          verifiedPackages+=batch.length;
          if(verifiedPackages%80===0 || verifiedPackages===manifest.chunks.length)console.log(`Content verified ${verifiedPackages}/${manifest.chunks.length} packages.`);
        }catch(error){failed=error;throw error;}
      }
    }));
    if(failed)throw failed;
    for(const result of results)if(result.status==='rejected')throw result.reason;
  }
  const result={verified_at:new Date().toISOString(),database,archive_sha256:chunked?manifest.schema.sha256:manifest.archive.sha256,sourceTables:Object.keys(manifest.counts).length,publicTables:manifest.catalog.tables.filter(t=>t.schema==='public').length,authUsers:counts['auth.users'],verifiedPackages,countDifferences,schemaDifferences,contentDifferences};
  await writeFile(path.join(directory,'verification.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  await chmod(path.join(directory,'verification.json'),0o600);
  if(countDifferences.length || schemaDifferences.length || contentDifferences.length) throw new Error(`Clone verification mismatch: ${countDifferences.length} counts, ${schemaDifferences.length} schemas, ${contentDifferences.length} contents. Review private verification.json; no cutover performed.`);
  await writeFile(path.join(local,'pending-clone.json'),JSON.stringify({directory,...result},null,2)+'\n',{mode:0o600});
  // Delete only our verified archive copy inside Docker; preserve the private host archive.
  run(['exec',container,'rm',`${temporary}/production.dump`]);
  run(['exec',container,'rmdir',temporary]);
  console.log(JSON.stringify({restored:true,...result}));
} catch(error) {
  console.error(error.message.startsWith('Command failed:')?'Local database operation failed; diagnostic details withheld.':error.message);
  process.exitCode=1;
}

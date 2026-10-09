import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {createWriteStream,constants} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {productionConnection,remoteProcess,productionReadOnlyQuery,localQuery,PRODUCTION_REF} from './local-production-access.mjs';
import {sqlLiteral} from './local-supabase-lib.mjs';
import {catalogQuery,countQueries} from './local-clone-catalog.mjs';
import {atomicJson,readJson,sha256,batchCompressedSql,batchHashSql,pendingRanges,tableName} from './local-clone-checkpoint.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const archives=path.join(root,'.local/production-clones');
const directory=path.join(archives,new Date().toISOString().replace(/\D/g,'').slice(0,14));
const inheritedDirectory=process.argv[2]==='--continue-active'?path.resolve(process.argv[3] || ''):null;
if(inheritedDirectory && (path.dirname(inheritedDirectory)!==archives || !/^\d{14}$/.test(path.basename(inheritedDirectory))))throw new Error('Unexpected active checkpoint directory');
const sessionSettings="SET search_path=public,extensions; SET timezone='UTC'; SET datestyle='ISO, MDY'; SET statement_timeout=0; SET idle_in_transaction_session_timeout=0;";
const metadataSQL=`SELECT jsonb_build_object('copy_tables',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
 'columns',(SELECT jsonb_agg(a.attname ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated=''),
 'keys',(SELECT jsonb_agg(a.attname ORDER BY k.ordinality) FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum WHERE i.indrelid=c.oid AND i.indisprimary)) ORDER BY n.nspname,c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'),
 'materialized_views',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'populated',c.relispopulated,'dependencies',(SELECT coalesce(jsonb_agg(DISTINCT dn.nspname||'.'||dc.relname),'[]') FROM pg_rewrite r JOIN pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=r.oid JOIN pg_class dc ON dc.oid=d.refobjid JOIN pg_namespace dn ON dn.oid=dc.relnamespace WHERE r.ev_class=c.oid AND d.refclassid='pg_class'::regclass AND dc.relkind='m' AND dc.oid<>c.oid))),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='m'));
SELECT format('SELECT jsonb_build_object(''sequence'',%L,''last_value'',last_value::text,''is_called'',is_called) FROM %I.%I;',n.nspname||'.'||c.relname,n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%' ORDER BY n.nspname,c.relname;
\\gexec
`;
let connection,manifest,currentEpoch,rotation,rotating=false,fatal,stopping=false;
const epochs=[];
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{fatal=new Error('Export stopped; all completed packages remain checkpointed.');});
let saving=Promise.resolve();
const save=()=>{saving=saving.then(()=>atomicJson(path.join(directory,'manifest.json'),manifest));return saving;};
const retire=epoch=>{if(epoch.retired && epoch.active===0){clearInterval(epoch.timer);if(!epoch.child.stdin.destroyed)epoch.child.stdin.end('ROLLBACK;\n');}};
async function keeper(importSnapshot,metadata=false) {
  const child=remoteProcess(connection,'psql',['-X','-Atq','-v','ON_ERROR_STOP=1']);
  const epoch={child,active:0,retired:false,output:'',errors:'',timer:null};epochs.push(epoch);
  child.stdin.on('error',()=>{});
  child.stderr.on('data',data=>{epoch.errors+=data;});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.stdin.end('ROLLBACK;\n');reject(new Error('Read-only snapshot metadata timed out'));},metadata?240000:30000);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.stdout.on('data',data=>{epoch.output+=data;if(epoch.output.includes('ROOVE_READY')){clearTimeout(timer);resolve();}});
    child.on('exit',code=>{clearTimeout(epoch.timer);clearTimeout(timer);if(!epoch.retired && !stopping){fatal=new Error(`Read-only keeper disconnected (${code}); completed packages remain saved.`);}if(!epoch.output.includes('ROOVE_READY'))reject(new Error(`Read-only keeper failed: ${epoch.errors.slice(0,200)}`));});
    child.stdin.write(connection.password+'\n'+`${sessionSettings} BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; ${importSnapshot?`SET TRANSACTION SNAPSHOT ${sqlLiteral(importSnapshot)};`:''} SELECT jsonb_build_object('snapshot',pg_export_snapshot());\n${metadata?`${catalogQuery}\n${countQueries}\n${metadataSQL}`:''}\n\\echo ROOVE_READY\n`);
  });
  epoch.metadata=epoch.output.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
  epoch.snapshot=epoch.metadata.find(row=>row.snapshot)?.snapshot;
  if(!/^[0-9A-F-]+$/i.test(epoch.snapshot))throw new Error('Invalid exported snapshot');
  epoch.timer=setInterval(()=>{if(!epoch.child.stdin.destroyed)epoch.child.stdin.write('SELECT 1;\n');},20000);
  return epoch;
}
async function rotate() {
  if(rotating || stopping || fatal)return;rotating=true;
  try {const previous=currentEpoch,next=await keeper(previous.snapshot);currentEpoch=next;manifest.snapshot=next.snapshot;previous.retired=true;retire(previous);await save();}
  catch(error){fatal=error;}finally{rotating=false;}
}
async function query(sql) {
  for(let attempt=1;attempt<=8;attempt++) {
    if(fatal)throw fatal;
    const epoch=currentEpoch;epoch.active++;
    try {return await productionReadOnlyQuery(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT ${sqlLiteral(epoch.snapshot)}; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, MDY'; SET LOCAL search_path=public,extensions; ${sql};`);}
    catch(error){if(attempt===8 || /invalid snapshot|permission denied|syntax error/i.test(error.message))throw error;await new Promise(resolve=>setTimeout(resolve,Math.min(20000,500*2**attempt)));}
    finally{epoch.active--;retire(epoch);}
  }
}
async function workers(tasks,callback) {
  let next=0,failed;
  const results=await Promise.allSettled(Array.from({length:4},async()=>{while(!failed && next<tasks.length){const task=tasks[next++];try{await callback(task);}catch(error){failed=error;throw error;}}}));
  if(failed)throw failed;
  for(const result of results)if(result.status==='rejected')throw result.reason;
}
async function record(chunk) {
  // Durable sidecars recover packages even if a manifest save is interrupted.
  await atomicJson(path.join(directory,`${chunk.file}.json`),chunk);
  manifest.chunks.push(chunk);await save();
}
try {
  await mkdir(directory,{recursive:true,mode:0o700});
  connection=await productionConnection(root);
  const inherited=inheritedDirectory?await readJson(path.join(inheritedDirectory,'manifest.json')):null;
  if(inherited && (inherited.source!==PRODUCTION_REF || inherited.format!=='schema-and-copy-v1'))throw new Error('Unexpected active checkpoint source');
  currentEpoch=await keeper(inherited?.snapshot,true);
  const rows=currentEpoch.metadata,catalog=rows.find(row=>row.version),metadata=rows.find(row=>row.copy_tables);
  const counts=Object.fromEntries(rows.filter(row=>row.table).map(row=>[row.table,Number(row.count)]));
  if(!catalog || !metadata || Object.keys(counts).length!==catalog.tables.length)throw new Error('Incomplete source metadata');
  if(inherited && (JSON.stringify(counts)!==JSON.stringify(inherited.counts) || JSON.stringify(catalog.schema_fingerprints)!==JSON.stringify(inherited.catalog.schema_fingerprints) || JSON.stringify(metadata.copy_tables)!==JSON.stringify(inherited.copy_tables)))throw new Error('Imported active snapshot metadata does not match its checkpoint');
  manifest={format:'schema-and-copy-v1',transport:'postgres-schema-and-read-only-https-data',source:PRODUCTION_REF,captured_at:new Date().toISOString(),snapshot:currentEpoch.snapshot,catalog,counts,...metadata,sequences:rows.filter(row=>row.sequence),chunk_limit:1000,chunks:[]};
  if(inherited){manifest.captured_at=inherited.captured_at;manifest.sequences=inherited.sequences;manifest.inherited_from=path.basename(inheritedDirectory);}
  await save();
  // Prove import/re-export immediately, before downloading any data.
  await rotate();if(fatal)throw fatal;
  rotation=setInterval(()=>void rotate(),60000);
  console.log(`Read-only snapshot ready: ${catalog.tables.length} tables, ${counts['auth.users']} users. Snapshot renewal tested.`);
  if(inherited)console.log('Active snapshot handover established; completed checkpoint packages can be retained without source re-query.');
  const dump=remoteProcess(connection,'pg_dump',['--schema-only','--format=custom','--compress=gzip:1','--snapshot',currentEpoch.snapshot]);
  let errors='';dump.stderr.on('data',data=>{errors+=data;});dump.stdin.end(connection.password+'\n');
  const exit=new Promise((resolve,reject)=>{dump.on('error',reject);dump.on('exit',code=>code===0?resolve():reject(new Error('Source schema export failed')));});
  try{await Promise.all([pipeline(dump.stdout,createWriteStream(path.join(directory,'schema.dump'),{mode:0o600,flags:'wx'})),exit]);}
  catch(error){await writeFile(path.join(directory,'schema-error.log'),errors,{mode:0o600});throw error;}
  const schemaBuffer=await readFile(path.join(directory,'schema.dump'));
  manifest.schema={bytes:schemaBuffer.length,sha256:sha256(schemaBuffer)};await save();

  // Old snapshots expire. Reuse packages only after matching against this snapshot.
  const candidates=new Map(),tables=new Map(metadata.copy_tables.map(table=>[tableName(table),table]));
  for(const name of (await readdir(archives)).filter(name=>/^\d{14}$/.test(name)).sort().reverse()) {
    if(name===path.basename(directory))continue;
    const previousDirectory=path.join(archives,name);let previous;
    try{previous=await readJson(path.join(previousDirectory,'manifest.json'));}catch{continue;}
    if(previous.source!==PRODUCTION_REF || previous.format!=='schema-and-copy-v1')continue;
    const chunks=[...(previous.chunks || [])];
    for(const sidecar of (await readdir(previousDirectory)).filter(name=>/^chunk-\d{5}\.csv\.gz\.json$/.test(name))) {
      try{const chunk=await readJson(path.join(previousDirectory,sidecar));if(!chunks.some(existing=>existing.file===chunk.file))chunks.push(chunk);}catch{}
    }
    // Legacy psql files have different quoting. Keep them; prefer canonical HTTPS files.
    if(!previous.transport?.includes('https') && name!=='20261008135954')continue;
    for(const chunk of chunks) {
      const table=tables.get(`${chunk.schema}.${chunk.table}`),key=`${chunk.schema}.${chunk.table}:${chunk.offset}:${chunk.rows}`;
      if(!table || !/^chunk-\d{5}\.csv\.gz$/.test(chunk.file) || JSON.stringify(chunk.columns)!==JSON.stringify(table.columns) || chunk.offset+chunk.rows>counts[tableName(table)] || candidates.has(key))continue;
      candidates.set(key,{...chunk,previousDirectory,tableMetadata:table});
    }
  }
  let examined=0,reused=0,changed=0,fileIndex=0;
  const claimed=new Map();
  for(const size of [...new Set([...candidates.values()].map(chunk=>chunk.rows))].sort((a,b)=>b-a))await workers([...candidates.values()].filter(chunk=>chunk.rows===size).sort((a,b)=>a.offset-b.offset),async candidate=>{
    const name=`${candidate.schema}.${candidate.table}`,previousRanges=claimed.get(name) || [];
    if(previousRanges.some(chunk=>candidate.offset>=chunk.offset && candidate.offset+candidate.rows<=chunk.offset+chunk.rows))return;
    const compressed=await readFile(path.join(candidate.previousDirectory,candidate.file));
    if(compressed.length!==candidate.bytes || sha256(compressed)!==candidate.sha256)return;
    const csvHash=sha256(gunzipSync(compressed));
    const result=candidate.previousDirectory===inheritedDirectory?{rows:candidate.rows,csv_sha256:candidate.csv_sha256}: (await query(batchHashSql(candidate.tableMetadata,candidate.offset,candidate.rows)))[0];
    examined++;
    if(result?.rows!==candidate.rows || result.csv_sha256!==csvHash){changed++;}
    else {
      const name=`${candidate.schema}.${candidate.table}`,ranges=claimed.get(name) || [];
      if(!ranges.some(chunk=>candidate.offset<chunk.offset+chunk.rows && candidate.offset+candidate.rows>chunk.offset)) {
        const file=`chunk-${String(fileIndex++).padStart(5,'0')}.csv.gz`;
        const {previousDirectory,tableMetadata,...chunk}=candidate;
        const retained={...chunk,file,csv_sha256:csvHash,reused_from:path.basename(previousDirectory)};
        ranges.push(retained);claimed.set(name,ranges);
        await copyFile(path.join(previousDirectory,candidate.file),path.join(directory,file),constants.COPYFILE_EXCL);
        await record(retained);reused++;
      }
    }
    if(examined%40===0)console.log(`Verified saved packages ${examined}/${candidates.size}; reused ${reused}, changed ${changed}.`);
  });
  console.log(`Reuse complete: ${reused} packages retained without downloading rows; ${changed} changed packages need refreshing.`);
  const tasks=[];
  for(const table of [...metadata.copy_tables].sort((a,b)=>counts[tableName(b)]-counts[tableName(a)])) {
    for(const range of pendingRanges(counts[tableName(table)],manifest.chunks.filter(chunk=>`${chunk.schema}.${chunk.table}`===tableName(table)),1000))tasks.push({...range,table});
  }
  let completed=0;
  console.log(`Downloading ${tasks.length} small packages, at most 1,000 rows each; checkpoint saved after EVERY package.`);
  await workers(tasks,async task=>{
    const key=randomBytes(32).toString('hex');
    const result=(await query(batchCompressedSql(task.table,task.offset,task.rows,sqlLiteral(key))))[0];
    if(result?.rows!==task.rows || typeof result.payload!=='string' || !/^[a-f0-9]{64}$/.test(result.csv_sha256))throw new Error('Unexpected compressed packet shape/count');
    // Decode on this computer using the already-installed pgcrypto extension.
    // Base64 avoids psql trimming/escaping and preserves all bytes of CSV.
    const encoded=localQuery(`SELECT encode(convert_to(extensions.pgp_sym_decrypt(decode(${sqlLiteral(result.payload)},'base64'),${sqlLiteral(key)}),'UTF8'),'base64');`);
    const csv=Buffer.from(encoded,'base64');
    if(sha256(csv)!==result.csv_sha256)throw new Error('Compressed transfer content checksum mismatch');
    const compressed=gzipSync(csv,{level:1}),file=`chunk-${String(fileIndex++).padStart(5,'0')}.csv.gz`;
    await writeFile(path.join(directory,file),compressed,{mode:0o600,flag:'wx'});
    await record({file,schema:task.table.schema,table:task.table.name,columns:task.table.columns,offset:task.offset,rows:task.rows,bytes:compressed.length,sha256:sha256(compressed),csv_sha256:sha256(csv)});
    completed++;if(completed%40===0 || completed===tasks.length)console.log(`Downloaded ${completed}/${tasks.length} small packages; all completed packages checkpointed.`);
  });
  for(const table of metadata.copy_tables)if(pendingRanges(counts[tableName(table)],manifest.chunks.filter(chunk=>`${chunk.schema}.${chunk.table}`===tableName(table))).length)throw new Error('Incomplete package coverage');
  if(fatal)throw fatal;
  manifest.completed_at=new Date().toISOString();manifest.archiveBytes=manifest.schema.bytes+manifest.chunks.reduce((sum,chunk)=>sum+chunk.bytes,0);await save();
  await atomicJson(path.join(root,'.local/latest-production-clone.json'),{directory});
  console.log(JSON.stringify({exported:true,directory,archiveBytes:manifest.archiveBytes,sourceTables:catalog.tables.length,publicTables:catalog.tables.filter(table=>table.schema==='public').length,authUsers:counts['auth.users'],reusedPackages:reused,productionWrites:0}));
}catch(error){console.error(connection?error.message.replaceAll(connection.password,'[withheld]'):error.message);process.exitCode=1;}
finally{stopping=true;clearInterval(rotation);for(const epoch of epochs){clearInterval(epoch.timer);epoch.retired=true;if(!epoch.child.stdin.destroyed)epoch.child.stdin.end('ROLLBACK;\n');}}

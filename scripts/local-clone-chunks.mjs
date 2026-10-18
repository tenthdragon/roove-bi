import {mkdir,writeFile,stat,readFile} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {productionConnection,remoteProcess,PRODUCTION_REF} from './local-production-access.mjs';
import {catalogQuery,countQueries} from './local-clone-catalog.mjs';
import {sqlLiteral} from './local-supabase-lib.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stamp=new Date().toISOString().replace(/\D/g,'').slice(0,14);
const resume=process.argv[2]==='--resume'?path.resolve(process.argv[3] || ''):null;
const directory=resume || path.join(root,'.local/production-clones',stamp);
if(path.dirname(directory)!==path.join(root,'.local/production-clones') || !/^\d{14}$/.test(path.basename(directory))) throw new Error('Unexpected private clone path');
const quote=name=>`"${name.replaceAll('"','""')}"`;
const connection=await productionConnection(root);
await mkdir(directory,{recursive:true,mode:0o700});
let coordinator,keepalive;
const metadataSQL=`SELECT jsonb_build_object('copy_tables',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
 'columns',(SELECT jsonb_agg(a.attname ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated=''),
 'keys',(SELECT jsonb_agg(a.attname ORDER BY k.ordinality) FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum WHERE i.indrelid=c.oid AND i.indisprimary)) ORDER BY n.nspname,c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'),
 'materialized_views',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'populated',c.relispopulated,'dependencies',(SELECT coalesce(jsonb_agg(DISTINCT dn.nspname||'.'||dc.relname),'[]') FROM pg_rewrite r JOIN pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=r.oid JOIN pg_class dc ON dc.oid=d.refobjid JOIN pg_namespace dn ON dn.oid=dc.relnamespace WHERE r.ev_class=c.oid AND d.refclassid='pg_class'::regclass AND dc.relkind='m' AND dc.oid<>c.oid))),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='m'));
SELECT format('SELECT jsonb_build_object(''sequence'',%L,''last_value'',last_value,''is_called'',is_called) FROM %I.%I;',n.nspname||'.'||c.relname,n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%' ORDER BY n.nspname,c.relname;
\\gexec
`;
const digest=async file=>{const hash=createHash('sha256');for await(const chunk of createReadStream(file)) hash.update(chunk);return hash.digest('hex');};
async function transfer(program,args,file,sql,snapshot,gzip=false) {
  const child=remoteProcess(connection,program,args);
  let errors='';
  child.stderr.on('data',chunk=>{errors+=chunk;});
  child.stdin.end(connection.password+'\n'+(sql?`SET statement_timeout=0; SET idle_in_transaction_session_timeout=0; BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT ${sqlLiteral(snapshot)}; ${sql}\nCOMMIT;\n`:''));
  const exit=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Transfer failed (${code})`)));});
  try {
    await Promise.all([gzip?pipeline(child.stdout,createGzip({level:1}),createWriteStream(file,{mode:0o600})):pipeline(child.stdout,createWriteStream(file,{mode:0o600})),exit]);
  } catch(error) {await writeFile(`${file}.error.log`,errors,{mode:0o600});throw error;}
  return {bytes:(await stat(file)).size,sha256:await digest(file)};
}
try {
  let manifest,snapshot,catalog,counts;
  if(resume) {
    manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
    if(manifest.source!==PRODUCTION_REF || manifest.format!=='schema-and-copy-v1' || !/^[0-9A-F-]+$/i.test(manifest.snapshot)) throw new Error('Unexpected resume manifest');
    snapshot=manifest.snapshot;catalog=manifest.catalog;counts=manifest.counts;
    manifest.schema={bytes:(await stat(path.join(directory,'schema.dump'))).size,sha256:await digest(path.join(directory,'schema.dump'))};
  } else {
  coordinator=remoteProcess(connection,'psql',['-X','-Atq','-v','ON_ERROR_STOP=1']);
  let output='',errors='';
  coordinator.stderr.on('data',data=>{errors+=data;});
  const ready=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Snapshot metadata timed out')),240000);
    coordinator.stdout.on('data',data=>{output+=data;if(output.includes('ROOVE_CHUNKS_READY')) {clearTimeout(timeout);resolve();}});
    coordinator.on('error',reject);
    coordinator.on('exit',()=>{clearTimeout(timeout);if(!output.includes('ROOVE_CHUNKS_READY'))reject(new Error('Snapshot coordinator failed'));});
  });
  coordinator.stdin.write(connection.password+'\n'+`SET search_path=public,extensions; SET statement_timeout=0; SET idle_in_transaction_session_timeout=0; BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT jsonb_build_object('snapshot',pg_export_snapshot());\n${catalogQuery}\n${countQueries}\n${metadataSQL}\n\\echo ROOVE_CHUNKS_READY\n`);
  await ready;
  const rows=output.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
  snapshot=rows.find(row=>row.snapshot)?.snapshot;
  catalog=rows.find(row=>row.version);
  const metadata=rows.find(row=>row.copy_tables);
  counts=Object.fromEntries(rows.filter(row=>row.table).map(row=>[row.table,Number(row.count)]));
  if(!/^[0-9A-F-]+$/i.test(snapshot) || !catalog || !metadata || Object.keys(counts).length!==catalog.tables.length) throw new Error('Incomplete snapshot metadata');
  manifest={format:'schema-and-copy-v1',source:PRODUCTION_REF,captured_at:new Date().toISOString(),snapshot,catalog,counts,copy_tables:metadata.copy_tables,materialized_views:metadata.materialized_views,sequences:rows.filter(row=>row.sequence),chunks:[]};
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  keepalive=setInterval(()=>{if(!coordinator.stdin.destroyed)coordinator.stdin.write('SELECT 1;\n');},45000);
  console.log(`Consistent snapshot ready: ${catalog.tables.length} tables, ${counts['auth.users']} users. Exporting resumable chunks with 4 workers.`);
  manifest.schema=await transfer('pg_dump',['--schema-only','--format=custom','--compress=gzip:1','--snapshot',snapshot],path.join(directory,'schema.dump'));
  }
  const save=()=>writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  const tasks=[];
  for(const table of manifest.copy_tables) {
    const count=counts[`${table.schema}.${table.name}`];
    const limit=resume?20000:5000;
    for(let offset=0;offset<count;offset+=limit) tasks.push({table,offset,limit:Math.min(limit,count-offset)});
  }
  // Large datasets first, while each individual COPY remains short-lived.
  tasks.sort((a,b)=>counts[`${b.table.schema}.${b.table.name}`]-counts[`${a.table.schema}.${a.table.name}`] || a.offset-b.offset);
  if(resume) {
    const pending=[];
    manifest.chunks=[];
    for(let index=0;index<tasks.length;index++) {
      const task=tasks[index],file=`chunk-${String(index).padStart(5,'0')}.csv.gz`;
      let rows=0,quoted=false,valid=false;
      try {
        const input=createReadStream(path.join(directory,file));
        const stream=createGunzip();input.on('error',error=>stream.destroy(error));input.pipe(stream);
        for await(const buffer of stream) for(const byte of buffer) {if(byte===34)quoted=!quoted;else if(byte===10 && !quoted)rows++;}
        valid=!quoted && rows===task.limit;
      } catch {valid=false;}
      if(valid) manifest.chunks.push({file,schema:task.table.schema,table:task.table.name,columns:task.table.columns,offset:task.offset,rows:task.limit,bytes:(await stat(path.join(directory,file))).size,sha256:await digest(path.join(directory,file))});
      else for(let part=0;part*5000<task.limit;part++) pending.push({...task,offset:task.offset+part*5000,limit:Math.min(5000,task.limit-part*5000),file:`chunk-${String(10000+index*4+part).padStart(5,'0')}.csv.gz`});
    }
    tasks.splice(0,tasks.length,...pending);
    console.log(`Reusing ${manifest.chunks.length} verified completed chunks from the SAME snapshot; ${tasks.length} smaller chunks remain.`);
    await save();
  }
  let next=0,completed=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(next<tasks.length) {
      const index=next++,task=tasks[index],table=task.table;
      const file=task.file || `chunk-${String(index).padStart(5,'0')}.csv.gz`;
      const order=table.keys?.length?table.keys.map(quote).join(','):'ctid';
      const sql=`COPY (SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.schema)}.${quote(table.name)} ORDER BY ${order} LIMIT ${task.limit} OFFSET ${task.offset}) TO STDOUT WITH (FORMAT csv);`;
      let archive;
      for(let attempt=1;attempt<=3;attempt++) {
        try {archive=await transfer('psql',['-X','-Atq','-v','ON_ERROR_STOP=1'],path.join(directory,file),sql,snapshot,true);break;}
        catch(error) {if(attempt===3)throw error;console.log(`Retrying chunk ${index} (attempt ${attempt+1})...`);}
      }
      manifest.chunks.push({file,schema:table.schema,table:table.name,columns:table.columns,offset:task.offset,rows:task.limit,...archive});
      completed++;
      if(completed%10===0 || completed===tasks.length) {await save();console.log(`Exported ${completed}/${tasks.length} chunks.`);}
    }
  }));
  manifest.chunks.sort((a,b)=>a.file.localeCompare(b.file));
  manifest.completed_at=new Date().toISOString();
  manifest.archiveBytes=manifest.schema.bytes+manifest.chunks.reduce((sum,chunk)=>sum+chunk.bytes,0);
  await save();
  await writeFile(path.join(root,'.local/latest-production-clone.json'),JSON.stringify({directory},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({exported:true,directory,archiveBytes:manifest.archiveBytes,publicTables:catalog.tables.filter(t=>t.schema==='public').length,authUsers:counts['auth.users'],productionWrites:0}));
} catch(error) {console.error(error.message.replaceAll(connection.password,'[withheld]'));process.exitCode=1;}
finally {clearInterval(keepalive);if(coordinator && !coordinator.stdin.destroyed)coordinator.stdin.end('ROLLBACK;\n');}

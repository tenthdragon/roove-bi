import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mkdir,writeFile,chmod,stat} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {productionConnection,remoteProcess,PRODUCTION_REF} from './local-production-access.mjs';
import {catalogQuery,countQueries} from './local-clone-catalog.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stamp=new Date().toISOString().replace(/\D/g,'').slice(0,14);
const directory=path.join(root,'.local/production-clones',stamp);
await mkdir(directory,{recursive:true,mode:0o700});
const connection=await productionConnection(root);
let coordinator;
try {
  coordinator=remoteProcess(connection,'psql',['-X','-v','ON_ERROR_STOP=1','-Atq']);
  let output='',stderr='';
  coordinator.stderr.on('data',d=>{stderr+=d.toString();});
  let readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const deadline=setTimeout(()=>readyReject(new Error('Snapshot metadata timeout')),180000);
  coordinator.stdout.on('data',d=>{output+=d.toString();if(output.includes('ROOVE_SNAPSHOT_READY')) readyResolve();});
  coordinator.on('error',readyReject);
  coordinator.on('exit',code=>{if(!output.includes('ROOVE_SNAPSHOT_READY')) readyReject(new Error(`Snapshot query failed (${code}); details withheld`));});
  // One repeatable-read transaction supplies BOTH metadata/counts and pg_dump.
  coordinator.stdin.write(connection.password+'\n');
  coordinator.stdin.write(`SET search_path=public,extensions; BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT jsonb_build_object('snapshot',pg_export_snapshot());\n${catalogQuery}\n${countQueries}\n\\echo ROOVE_SNAPSHOT_READY\n`);
  await ready.finally(()=>clearTimeout(deadline));
  const entries=output.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
  const snapshot=entries.find(e=>e.snapshot)?.snapshot;
  const catalog=entries.find(e=>e.version);
  const counts=Object.fromEntries(entries.filter(e=>e.table).map(e=>[e.table,Number(e.count)]));
  if(!/^[0-9A-F-]+$/i.test(snapshot) || !catalog || !Object.keys(counts).length) throw new Error('Incomplete snapshot metadata');
  const archive=path.join(directory,'production.dump');
  const manifest={source:PRODUCTION_REF,captured_at:new Date().toISOString(),snapshot,catalog,counts};
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  console.log(`Consistent read-only snapshot: ${catalog.tables.length} tables, ${counts['auth.users']} auth users. Export started.`);
  const dump=remoteProcess(connection,'pg_dump',['--format=custom','--compress=gzip:1','--snapshot',snapshot]);
  let dumpError='';
  dump.stderr.on('data',d=>{dumpError+=d.toString();});
  dump.stdin.end(connection.password+'\n');
  const progress=setInterval(async()=>{const size=await stat(archive).catch(()=>null);if(size) console.log(`Downloaded ${(size.size/1048576).toFixed(1)} MiB...`);},25000);
  try {
    await Promise.all([
      pipeline(dump.stdout,createWriteStream(archive,{flags:'wx',mode:0o600})),
      new Promise((resolve,reject)=>{dump.on('error',reject);dump.on('exit',code=>code===0?resolve():reject(new Error(`pg_dump failed (${code}); private diagnostic saved`)));})
    ]);
  } catch(error) {await writeFile(path.join(directory,'export-error.log'),dumpError,{mode:0o600});throw error;}
  finally {clearInterval(progress);}
  coordinator.stdin.end('ROLLBACK;\n');
  const digest=createHash('sha256');
  for await(const bytes of createReadStream(archive)) digest.update(bytes);
  manifest.archive={name:'production.dump',bytes:(await stat(archive)).size,sha256:digest.digest('hex')};
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  await writeFile(path.join(root,'.local/latest-production-clone.json'),JSON.stringify({directory},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({exported:true,directory,archiveBytes:manifest.archive.bytes,publicTables:catalog.tables.filter(t=>t.schema==='public').length,authUsers:counts['auth.users'],productionWrites:0}));
} catch(error) {console.error(error.message.replaceAll(connection.password,'[withheld]'));process.exitCode=1;}
finally {if(coordinator && !coordinator.stdin.destroyed)coordinator.stdin.end('ROLLBACK;\n');}

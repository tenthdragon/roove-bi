import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const quote=name=>`"${name.replaceAll('"','""')}"`;
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const csvRows=rows=>rows.map(row=>row.cells.map(value=>value===null?'':`"${value.replaceAll('"','""')}"`).join(',')+'\n').join('');
export async function atomicJson(file,value) {
  const temporary=`${file}.pending`;
  await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await rename(temporary,file);
}
export async function readJson(file) {return JSON.parse(await readFile(file,'utf8'));}
export const tableName=table=>`${table.schema}.${table.name}`;
export function batchSql(table,offset,rows) {
  const relation=`${quote(table.schema)}.${quote(table.name)}`;
  if(!table.keys?.length)return `SELECT ARRAY[${table.columns.map(column=>`${quote(column)}::text`).join(',')}] AS cells FROM (SELECT * FROM ${relation} ORDER BY ctid LIMIT ${rows} OFFSET ${offset}) selected`;
  const keys=table.keys.map(quote).join(',');
  // Skip via the primary-key index first. Do not serialize large JSON payloads
  // (or fetch their heap pages) for every preceding OFFSET row.
  return `WITH selected AS MATERIALIZED (SELECT ${keys} FROM ${relation} ORDER BY ${keys} LIMIT ${rows} OFFSET ${offset}) SELECT ARRAY[${table.columns.map(column=>`t.${quote(column)}::text`).join(',')}] AS cells FROM ${relation} t JOIN selected USING (${keys}) ORDER BY ${table.keys.map(column=>`t.${quote(column)}`).join(',')}`;
}
export function batchCsvSql(table,offset,rows) {
  return `WITH batch AS MATERIALIZED (${batchSql(table,offset,rows)}), numbered AS (SELECT cells,row_number() OVER () AS ordinal FROM batch) SELECT count(*)::int AS rows,coalesce(string_agg((SELECT string_agg(CASE WHEN value IS NULL THEN '' ELSE '"'||replace(value,'"','""')||'"' END,',' ORDER BY position) FROM unnest(cells) WITH ORDINALITY AS values(value,position))||chr(10),'' ORDER BY ordinal),'') AS csv FROM numbered`;
}
export const batchHashSql=(table,offset,rows)=>`WITH packed AS (${batchCsvSql(table,offset,rows)}) SELECT rows,encode(extensions.digest(csv,'sha256'),'hex') AS csv_sha256 FROM packed`;
// Compression happens in PostgreSQL before the network transfer. A transient
// random key protects the compressed packet; it is never persisted or logged.
export const batchCompressedSql=(table,offset,rows,keyLiteral)=>`WITH packed AS (${batchCsvSql(table,offset,rows)}) SELECT rows,encode(extensions.digest(csv,'sha256'),'hex') AS csv_sha256,encode(extensions.pgp_sym_encrypt(csv,${keyLiteral},'compress-algo=1,compress-level=1'),'base64') AS payload FROM packed`;
export function pendingRanges(count,chunks,limit=1000) {
  const tasks=[];let cursor=0;
  for(const chunk of [...chunks].sort((a,b)=>a.offset-b.offset)) {
    if(!Number.isSafeInteger(chunk.offset) || !Number.isSafeInteger(chunk.rows) || chunk.rows<=0 || chunk.offset<cursor || chunk.offset+chunk.rows>count)throw new Error('Invalid/overlapping chunk coverage');
    while(cursor<chunk.offset){const rows=Math.min(limit,chunk.offset-cursor);tasks.push({offset:cursor,rows});cursor+=rows;}
    cursor=chunk.offset+chunk.rows;
  }
  while(cursor<count){const rows=Math.min(limit,count-cursor);tasks.push({offset:cursor,rows});cursor+=rows;}
  return tasks;
}

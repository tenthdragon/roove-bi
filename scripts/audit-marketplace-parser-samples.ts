/** Read-only replay. Usage: node --import tsx scripts/audit-marketplace-parser-samples.ts /private/manifest.json
 * Manifest: [{ source, expected, account, date, config: '/.../config-v3.json', catalog: '/.../catalog.json' }]
 * Configuration and catalog snapshots are explicit inputs; expected CSVs never manufacture catalog validity.
 * No customer data, input files or generated exports are written by this command.
 */
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { readMarketplaceFile } from '../lib/marketplace-parser/read';
import { validateParserConfig } from '../lib/marketplace-parser/config';
import { projectMarketplace, orderReady } from '../lib/marketplace-parser/project';
import { moneyCents } from '../lib/marketplace-parser/money';
import type { Catalog, ParserConfig } from '../lib/marketplace-parser/types';

const path=process.argv[2];if(!path)throw new Error('Provide a local manifest JSON path.');
const pairs=JSON.parse(readFileSync(path,'utf8')) as {source:string;expected:string;account:string;date:string;config:string;catalog:string}[];
const results=[];let failures=0;
for(const pair of pairs) {
  const bytes=readFileSync(pair.source);const file=readMarketplaceFile(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,pair.source);
  const csv=XLSX.read(readFileSync(pair.expected),{type:'buffer',raw:true});
  const rows=XLSX.utils.sheet_to_json<Record<string,string>>(csv.Sheets[csv.SheetNames[0]],{defval:''});
  const expected=new Map<string,typeof rows>();let current='';
  for(const r of rows) {if(r.external_id)current=r.external_id;expected.set(current,[...(expected.get(current)||[]),r]);}
  if (!pair.config || !pair.catalog) throw new Error('Each replay needs explicit v3 config and catalog JSON paths. Legacy CSV-derived catalogs are no longer supported.');
  const config = JSON.parse(readFileSync(pair.config,'utf8')) as ParserConfig; validateParserConfig(config);
  const catalog = JSON.parse(readFileSync(pair.catalog,'utf8')) as Catalog;
  if (!catalog.version || !Array.isArray(catalog.loadedStoreIds) || !Array.isArray(catalog.storeSyncs)) throw new Error('Provide a current parser catalog snapshot with Store scope and sync state.');
  const preview=projectMarketplace({file,account:pair.account,date:pair.date,config,revision:0,catalog});
  let comparable=0,missingFinancials=0,priceQtySkuMismatch=0,missingOrder=0,courierReview=0;
  for(const o of preview.orders) {
    const reference=expected.get(o.source.externalId);
    if(!reference || reference.length!==o.lines.length){missingOrder++;continue;}
    expected.delete(o.source.externalId);
    if(o.errors.some(e=>e.includes('kurir')))courierReview++;
    for(let i=0;i<o.lines.length;i++) {
      const l=o.lines[i],r=reference[i];
      if(l.source.quantity===null || l.source.unitCents===null){missingFinancials++;continue;}
      comparable++;
      if(l.quantity!==Number(r.quantity) || l.unitCents!==moneyCents(r.price) || l.sku!==r.sku)priceQtySkuMismatch++;
    }
  }
  const blockedOrders = preview.orders.filter(order => !orderReady(order)).length;
  failures+=priceQtySkuMismatch+missingOrder+expected.size+blockedOrders;
  results.push({file:file.filename.split('/').pop(),orders:preview.orders.length,lines:preview.orders.reduce((n,o)=>n+o.lines.length,0),comparable,missingFinancials,priceQtySkuMismatch,missingOrder,extraCsvOrders:expected.size,courierReview,blockedOrders});
}
console.log(JSON.stringify({catalog:'explicit snapshot supplied in manifest; no live requests',results,failures},null,2));
process.exitCode=failures?1:0;

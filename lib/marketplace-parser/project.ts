import { COURIER_SERVICE_OPTIONS, validateParserConfig } from './config';
import { centsText, moneyCents, quantity } from './money';
import { CSV_HEADERS, type Catalog, type CsvRow, type Edits, type ParsedFile, type ParserConfig, type PreviewOrder, type Projection, type SourceLine } from './types';

const norm=(s:string)=>s.trim().toLocaleLowerCase('id');
function resolveProduct(line: SourceLine, account: string, config: ParserConfig) {
  const candidates=config.products.flatMap(rule=>{
    if (rule.account!=='*' && rule.account!==account) return [];
    const score=rule.sourceSku && rule.sourceSku===line.sku ? 300 : rule.name && !line.sku && norm(rule.name)===norm(line.name) && (!rule.variation || norm(rule.variation)===norm(line.variation)) ? 200 : rule.prefix && line.sku.startsWith(rule.prefix) ? 100+rule.prefix.length : 0;
    return score?[{rule,score:score+(rule.account==='*'?0:1000)}]:[];
  }).sort((a,b)=>b.score-a.score);
  const top=candidates.filter(c=>c.score===candidates[0]?.score);
  if (top.length>1) return {sku:line.sku,family:'',rule:'',error:'Lebih dari satu aturan produk cocok. Perbaiki konfigurasi.'};
  const r=top[0]?.rule;
  return {sku:r?.targetSku || line.sku,family:r?.family || '',rule:r?.id || '',error:''};
}
export function projectMarketplace(input: {file: ParsedFile;account: string;date: string;config: ParserConfig;revision: number;catalog: Catalog;edits?: Edits}): Projection {
  const {file,account,date,config,catalog}=input;const edits=input.edits||{lines:{},orders:{}};
  validateParserConfig(config, { allowUnassignedBusiness: true });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw new Error('Tanggal batch tidak valid.');
  if (!config.accounts.some(a=>a.id===account)) throw new Error('Pilih akun marketplace asal yang valid.');
  const orders: PreviewOrder[]=file.orders.map(source=>{
    const errors=[...source.errors];const warnings=[...source.warnings];
    const lines=source.lines.map(line=>{
      const mapped=resolveProduct(line,account,config);const edit=edits.lines[line.key];
      const replacesFinancials=Boolean(edit?.reason?.trim() && edit.quantity!==undefined && edit.price!==undefined);
      const lineErrors=replacesFinancials?[]:[...line.errors];if(mapped.error && !edit?.sku) lineErrors.push(mapped.error);
      if(replacesFinancials && line.errors.length) warnings.push(`Angka sumber baris ${line.row} diganti dengan koreksi manual: ${edit?.reason}`);
      let q=line.quantity;let unit=line.unitCents;
      try { if(edit?.quantity!==undefined) q=quantity(edit.quantity);if(edit?.price!==undefined) unit=moneyCents(edit.price); }catch(e){lineErrors.push(e instanceof Error?e.message:'Koreksi angka tidak valid.');}
      const sku=(edit?.sku??mapped.sku).trim();const family=(edit?.family??mapped.family).trim();
      if(edit && Object.keys(edit).some(k=>k!=='reason') && !edit.reason?.trim()) lineErrors.push('Isi alasan koreksi item.');
      if(q===null) lineErrors.push('Quantity belum tersedia.');
      if(unit===null) lineErrors.push(line.totalCents!==null?'Harga per unit membutuhkan pecahan di bawah Rp0,01; lengkapi nilai yang menjaga total.':'Harga satuan belum tersedia.');
      if(unit!==null && unit<0) lineErrors.push('Harga tidak boleh negatif.');
      if(!sku) lineErrors.push('SKU Scalev belum dipilih.');
      if(!family) lineErrors.push('Kelompok produk belum dipilih.');
      const total=q!==null && unit!==null?q*unit:null;
      if(total!==null && !Number.isSafeInteger(total)) lineErrors.push('Total item di luar batas angka eksak.');
      if(line.totalCents!==null && total!==line.totalCents && !(edit?.reason?.trim() && (edit.price!==undefined || edit.quantity!==undefined))) lineErrors.push('Total item berbeda dari sumber.');
      if(total!==line.totalCents && edit?.reason?.trim()) warnings.push(`Total item baris ${line.row} dikoreksi: ${edit.reason}`);
      return {source:line,sku,family,quantity:q,unitCents:unit,totalCents:total,mappingRule:mapped.rule,errors:lineErrors,reason:edit?.reason||''};
    });
    const families=[...new Set(lines.map(l=>l.family).filter(f=>f && f!=='accessory'))];
    const matched=config.routes.filter(r=>r.account===account && families.includes(r.family));
    const edit=edits.orders[source.key];
    const targets=[...new Set(matched.map(r=>JSON.stringify([r.business,r.store,r.warehouse])))];
    if (families.some(f=>matched.filter(r=>r.family===f).length!==1) && !edit?.store) errors.push('Routing kelompok produk belum tersedia atau memiliki aturan ganda.');
    if ((targets.length!==1 || !families.length) && !edit?.store) errors.push('Tujuan order belum pasti. Pilih business, store, dan gudang.');
    const route=matched[0];
    const business=(edit?.business ?? route?.business ?? '').trim();
    const store=(edit?.store ?? route?.store ?? '').trim();const warehouse=(edit?.warehouse ?? route?.warehouse ?? '').trim();
    if(edit && Object.keys(edit).some(k=>k!=='reason') && !edit.reason?.trim()) errors.push('Isi alasan koreksi tujuan order.');
    if(!catalog.businesses.some(b=>b.code===business)) errors.push('Business tujuan belum dipilih atau tidak aktif.');
    if(!catalog.stores.some(s=>s.business===business && norm(s.name)===norm(store))) errors.push('Store tidak ditemukan dalam katalog business tujuan.');
    if(!warehouse) errors.push('Gudang tujuan belum diisi.');
    const canonicalStore=catalog.stores.find(s=>s.business===business && norm(s.name)===norm(store))?.name || store;
    for(const line of lines) {
      const bundles=catalog.bundles.filter(b=>b.business===business && b.sku===line.sku);
      if(bundles.length!==1) line.errors.push(bundles.length?'SKU cocok ke beberapa bundle. Periksa katalog.':'SKU tidak ditemukan dalam katalog business tujuan.');
    }
    const couriers=config.couriers.filter(c=>c.platform===source.platform && norm(c.source)===norm(source.provider));
    const courier=(edit?.courier??(couriers.length===1?couriers[0].courier:'')).trim();const service=(edit?.service??(couriers.length===1?couriers[0].service:'')).trim();
    if(!courier || !service) errors.push(`Mapping kurir belum tersedia: ${source.provider||'kosong'}.`);
    else if(!COURIER_SERVICE_OPTIONS.some(c=>c.courier===courier && c.service===service)) errors.push('Pasangan kurir dan layanan tidak tersedia di daftar Scalev.');
    const username=(edit?.username??source.username).trim();
    if(!username) errors.push('Nama/username pembeli belum tersedia.');
    if(!source.tracking) errors.push('Resi kosong. Lengkapi file sumber.');
    for (const value of [source.externalId,source.tracking,username,canonicalStore,warehouse,courier,service,...lines.map(l=>l.sku)]) if (/^[\s]*[=+@-]|[\u0000\t]/.test(value)) errors.push('Teks mengandung awalan formula/karakter kontrol. Periksa sumber sebelum ekspor CSV.');
    const rows: CsvRow[]=lines.map((line,index)=>{
      const row=Object.fromEntries(CSV_HEADERS.map(h=>[h,''])) as CsvRow;
      Object.assign(row,{id:source.key,item_type:'bundle',sku:line.sku,price:line.unitCents===null?'':centsText(line.unitCents),quantity:line.quantity===null?'':String(line.quantity),shipping_cost:'0',other_income:'0',weight_bump:'0'});
      if(index===0) Object.assign(row,{external_id:source.externalId,platform:source.platform,timestamp:date,store:canonicalStore,name:username,username,payment_method:'marketplace',bank:source.platform,courier,courier_service:service,warehouse,shipment_receipt:source.tracking});
      return row;
    });
    const totalCents=lines.reduce((sum,l)=>sum+(l.totalCents??0),0);
    if(!Number.isSafeInteger(totalCents)) errors.push('Total order di luar batas angka eksak.');
    return {source,business,store:canonicalStore,warehouse,courier,service,lines,errors:[...new Set(errors)],warnings:[...new Set(warnings)],totalCents,routeIds:matched.map(r=>r.id),rows};
  });
  // One ID per order, reused for all continuation rows, within each business export.
  const counters=new Map<string,number>();
  for(const order of orders) {const n=(counters.get(order.business)||0)+1;counters.set(order.business,n);order.rows.forEach(row=>{row.id=String(n);});}
  return {orders,date,account,configRevision:input.revision,configSnapshot:structuredClone(config),editsSnapshot:structuredClone(edits)};
}
export const orderReady=(o:PreviewOrder)=>!o.errors.length && o.lines.every(l=>!l.errors.length);
export function exportBusinessCsv(projection: Projection, business: string): string {
  const orders=projection.orders.filter(o=>o.business===business);
  if(!orders.length || projection.orders.some(o=>!orderReady(o))) throw new Error('Selesaikan semua masalah pada batch ini sebelum download.');
  const escape=(v:string)=>/[",\r\n]/.test(v)?`"${v.replace(/"/g,'""')}"`:v;
  return CSV_HEADERS.join(',')+'\r\n'+orders.flatMap(o=>o.rows).map(r=>CSV_HEADERS.map(h=>escape(r[h])).join(',')).join('\r\n')+'\r\n';
}

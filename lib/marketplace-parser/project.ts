import { COURIER_SERVICE_OPTIONS, validateParserConfig } from './config';
import { centsText, moneyCents, quantity } from './money';
import { CSV_HEADERS, type Catalog, type CsvRow, type Edits, type ParsedFile, type ParserConfig, type PreviewLine, type PreviewOrder, type Projection } from './types';

const norm = (s: string) => s.trim().toLocaleLowerCase('id');
export function classifySku(sku: string, account: string, config: ParserConfig) {
  const candidates = config.products.flatMap(rule => {
    if (rule.account !== '*' && rule.account !== account) return [];
    const matches = rule.match === 'sku' ? sku === rule.value : sku.startsWith(rule.value);
    return matches ? [{ rule, score: (rule.account === account ? 10000 : 0) + (rule.match === 'sku' ? 1000 : rule.value.length) }] : [];
  }).sort((a,b) => b.score - a.score);
  const top = candidates.filter(c => c.score === candidates[0]?.score);
  const sets = new Set(top.map(c => JSON.stringify([...c.rule.productIds].sort())));
  return { productIds: sets.size === 1 ? [...top[0].rule.productIds] : [], rule: top.map(c => c.rule.id).join(', '), ambiguous: sets.size > 1 };
}
// Store selection is exclusively based on the saved Product/combination rules.
export function configuredOrderRoute(skus: string[], account: string, config: ParserConfig) {
  const classified = skus.map(sku => classifySku(sku,account,config));
  const productIds = new Set(classified.flatMap(line => line.productIds));
  const allClassified = classified.every(line => line.productIds.length > 0);
  const combinationRules = config.combinations.filter(r => r.account === account);
  const matching = allClassified ? combinationRules.filter(r => r.productIds.every(id => productIds.has(id)) && (r.match === 'contains' || r.productIds.length === productIds.size)).sort((a,b) => b.priority - a.priority) : [];
  const combinations = matching.filter(r => r.priority === matching[0]?.priority);
  const routes = config.routes.filter(r => r.account === account && productIds.has(r.productId));
  const rules = combinations.length ? combinations : routes;
  const targetIds = [...new Set(rules.map(r => r.storeId))], errors: string[] = [];
  if (combinations.length && targetIds.length !== 1) errors.push('Aturan kombinasi dengan prioritas sama memilih Store berbeda. Perbaiki prioritas atau tujuan aturan.');
  if (!combinations.length && routes.length) {
    if (!allClassified || [...productIds].some(id => routes.filter(r => r.productId === id).length !== 1)) errors.push('Routing Produk belum lengkap. Lengkapi pengenalan Produk dan routing akun ini.');
    if (targetIds.length !== 1) errors.push('Produk dalam order memilih Store berbeda. Tambahkan aturan kombinasi untuk menentukan satu Store tujuan.');
  }
  if (!allClassified) errors.push('Produk pada sebagian SKU belum dikenali. Lengkapi pengenalan Produk sebelum menentukan Store.');
  if (!rules.length) errors.push('Routing Produk belum tersedia untuk order ini. Lengkapi mapping Produk atau aturan kombinasi.');
  if (classified.some(line => line.ambiguous)) errors.push('Pengenalan Produk ambigu. Perbaiki aturan Produk.');
  return { targetIds,routeIds: rules.map(r => r.id),errors,hasRules: rules.length > 0 };
}
function validateEdits(edits: Edits) {
  if (!edits || typeof edits !== 'object' || !edits.lines || !edits.orders) throw new Error('Format koreksi tidak valid.');
  for (const [kind, allowed] of [['lines',['quantity','price','reason']],['orders',['courier','service','username','reason']]] as const) {
    for (const edit of Object.values(edits[kind])) {
      if (!edit || Object.entries(edit).some(([key,value]) => !allowed.includes(key as never) || typeof value !== 'string' || value.length > 2000)) throw new Error('SKU, Produk, Business, Store, dan Warehouse tidak boleh dikoreksi per baris. Perbaiki data Scalev atau aturan parsing.');
    }
  }
}
export function projectMarketplace(input: { file: ParsedFile; account: string; date: string; config: ParserConfig; revision: number; catalog: Catalog; edits?: Edits }): Projection {
  const { file,account,date,config,catalog } = input;
  const edits = input.edits || { lines: {}, orders: {} };
  validateParserConfig(config, { allowIncomplete: true }); validateEdits(edits);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('Tanggal batch tidak valid.');
  const sourceAccount = config.accounts.find(a => a.id === account);
  if (!sourceAccount) throw new Error('Pilih akun marketplace asal yang valid.');
  const business = sourceAccount.business;
  const storeScopes = config.stores.filter(scope => catalog.stores.some(s => s.id === scope.storeId && s.business === business));
  const storeIds = new Set(storeScopes.map(scope => scope.storeId));
  // Match exact identifiers within the receiving Business, independent of Store membership.
  const skuIndex = new Map<string, Catalog['bundles']>();
  for (const bundle of catalog.bundles) {
    if (bundle.business !== business || !bundle.sku) continue;
    skuIndex.set(bundle.sku,[...(skuIndex.get(bundle.sku) || []),bundle]);
  }
  const orders: PreviewOrder[] = file.orders.map(source => {
    const errors = [...source.errors], warnings = [...source.warnings];
    if (source.platform !== sourceAccount.marketplace) errors.push(`File ${source.platform} tidak sesuai Marketplace akun ${sourceAccount.label}. Pilih akun asal yang benar.`);
    if (!catalog.businesses.some(b => b.code === business)) errors.push('Business akun asal belum ditetapkan atau tidak aktif. Perbaiki pengaturan akun.');
    if (!storeIds.size) errors.push(`Belum ada Store yang digunakan untuk Business ${business || 'akun ini'}.`);
    const lines: PreviewLine[] = source.lines.map(line => {
      const sku = line.sku.trim(), classified = classifySku(sku,account,config), edit = edits.lines[line.key];
      const replacesFinancials = Boolean(edit?.reason?.trim() && edit.quantity !== undefined && edit.price !== undefined);
      const lineErrors = replacesFinancials ? [] : [...line.errors];
      if (replacesFinancials && line.errors.length) warnings.push(`Angka sumber baris ${line.row} diganti dengan koreksi manual: ${edit?.reason}`);
      let q = line.quantity, unit = line.unitCents;
      try { if (edit?.quantity !== undefined) q = quantity(edit.quantity); if (edit?.price !== undefined) unit = moneyCents(edit.price); }
      catch (e) { lineErrors.push(e instanceof Error ? e.message : 'Koreksi angka tidak valid.'); }
      if (edit && Object.keys(edit).some(k => k !== 'reason') && !edit.reason?.trim()) lineErrors.push('Isi alasan koreksi item.');
      if (q === null || !Number.isSafeInteger(q) || q <= 0) lineErrors.push('Quantity harus berupa bilangan bulat positif.');
      if (unit === null) lineErrors.push(line.totalCents !== null ? 'Harga per unit membutuhkan pecahan di bawah Rp0,01; lengkapi nilai yang menjaga total.' : 'Harga satuan belum tersedia.');
      if (unit !== null && (!Number.isSafeInteger(unit) || unit < 0)) lineErrors.push('Harga harus berupa angka yang valid dan tidak negatif.');
      if (!sku) lineErrors.push('Nomor Referensi SKU kosong. Lengkapi kode pada file marketplace; nama produk tidak digunakan untuk menebak bundle.');
      else if (!skuIndex.has(sku)) lineErrors.push(`Kode ${sku} tidak ditemukan pada bundle di Business ${business}. Selesaikan identifier code/ketersediaan bundle di Scalev lalu sinkronkan.`);
      if (classified.ambiguous) lineErrors.push(`Pengenalan Produk untuk SKU ${sku} ambigu. Perbaiki aturan Produk.`);
      const total = q !== null && unit !== null ? q * unit : null;
      if (total !== null && !Number.isSafeInteger(total)) lineErrors.push('Total item di luar batas angka eksak.');
      if (line.totalCents !== null && total !== line.totalCents && !(edit?.reason?.trim() && (edit.price !== undefined || edit.quantity !== undefined))) lineErrors.push('Total item berbeda dari sumber.');
      if (total !== line.totalCents && edit?.reason?.trim()) warnings.push(`Total item baris ${line.row} dikoreksi: ${edit.reason}`);
      return { source: line, sku, productIds: classified.productIds, bundleId: null, bundleName: '', quantity: q, unitCents: unit, totalCents: total, mappingRule: classified.rule, errors: lineErrors, reason: edit?.reason || '' };
    });
    const routing = configuredOrderRoute(lines.map(line => line.sku),account,config);
    errors.push(...routing.errors);
    const targetIds = routing.targetIds;
    const routeIds = routing.routeIds;
    const storeId = targetIds.length === 1 ? targetIds[0] : null;
    const store = catalog.stores.find(s => s.id === storeId && s.business === business && storeIds.has(s.id));
    if (!store) errors.push('Store tujuan belum pasti atau berada di luar Business akun asal. Perbaiki aturan parsing.');
    const scope = storeScopes.find(s => s.storeId === storeId);
    const warehouse = catalog.warehouses.find(w => w.id === scope?.warehouseId && w.businesses.includes(business));
    if (!warehouse) errors.push('Warehouse untuk Store tujuan belum dipilih atau tidak terhubung dengan Business. Perbaiki pengaturan Store.');
    else if (!warehouse.exportName) errors.push('Nama ekspor Scalev untuk Warehouse belum terkonfirmasi atau ambigu. Lengkapi nama Warehouse pada pengaturan integrasi marketplace di aplikasi.');
    const sync = catalog.businessSyncs.find(s => s.business === business);
    if (!catalog.loadedBusinessCodes.includes(business) || sync?.status !== 'ready') errors.push('Katalog Business tujuan belum siap. Sinkronkan Business atau muat ulang katalog sebelum download.');
    for (const line of lines) {
      const bundles = skuIndex.get(line.sku) || [];
      const uniqueBundles = [...new Map(bundles.map(b => [b.id,b])).values()];
      if (uniqueBundles.length > 1) line.errors.push(`Kode ${line.sku} cocok ke ${uniqueBundles.length} bundle di Business ${business}. Benahi identifier code di Scalev.`);
      else if (uniqueBundles.length === 1) { line.bundleId = uniqueBundles[0].id; line.bundleName = uniqueBundles[0].name; }
    }
    const edit = edits.orders[source.key];
    if (edit && Object.keys(edit).some(k => k !== 'reason') && !edit.reason?.trim()) errors.push('Isi alasan koreksi order.');
    const couriers = config.couriers.filter(c => c.platform === source.platform && norm(c.source) === norm(source.provider));
    const courier = (edit?.courier ?? (couriers.length === 1 ? couriers[0].courier : '')).trim();
    const service = (edit?.service ?? (couriers.length === 1 ? couriers[0].service : '')).trim();
    if (!courier || !service) errors.push(`Mapping kurir belum tersedia: ${source.provider || 'kosong'}.`);
    else if (!COURIER_SERVICE_OPTIONS.some(c => c.courier === courier && c.service === service)) errors.push('Pasangan kurir dan layanan tidak tersedia di daftar Scalev.');
    const username = (edit?.username ?? source.username).trim();
    if (!username) errors.push('Nama/username pembeli belum tersedia.');
    if (!source.tracking) errors.push('Resi kosong. Lengkapi file sumber.');
    for (const value of [source.externalId,source.tracking,username,store?.name || '',warehouse?.name || '',courier,service,...lines.map(l => l.sku)]) if (/^[\s]*[=+@-]|[\u0000\t]/.test(value)) errors.push('Teks mengandung awalan formula/karakter kontrol. Periksa sumber sebelum ekspor CSV.');
    const rows: CsvRow[] = lines.map((line,index) => {
      const row = Object.fromEntries(CSV_HEADERS.map(h => [h,''])) as CsvRow;
      Object.assign(row,{ id: source.key, item_type: 'bundle', sku: line.sku, price: line.unitCents === null ? '' : centsText(line.unitCents), quantity: line.quantity === null ? '' : String(line.quantity), shipping_cost: '0', other_income: '0', weight_bump: '0' });
      if (index === 0) Object.assign(row,{ external_id: source.externalId, platform: source.platform, timestamp: date, store: store?.name || '', name: username, username, payment_method: 'marketplace', bank: source.platform, courier, courier_service: service, warehouse: warehouse?.exportName || '', shipment_receipt: source.tracking });
      return row;
    });
    const totalCents = lines.reduce((sum,l) => sum + (l.totalCents ?? 0),0);
    if (!Number.isSafeInteger(totalCents)) errors.push('Total order di luar batas angka eksak.');
    return { source,business,storeId,store: store?.name || '',warehouse: warehouse?.name || '',courier,service,lines,errors: [...new Set(errors)],warnings: [...new Set(warnings)],totalCents,routeIds,rows };
  });
  orders.forEach((order,index) => order.rows.forEach(row => { row.id = String(index + 1); }));
  return { orders,date,account,configRevision: input.revision,configSnapshot: structuredClone(config),editsSnapshot: structuredClone(edits) };
}
export const orderReady = (order: PreviewOrder) => !order.errors.length && order.lines.length > 0 && order.lines.every(line => !line.errors.length && line.bundleId !== null);
export function exportBusinessCsv(projection: Projection, business: string): string {
  const orders = projection.orders.filter(order => order.business === business);
  if (!orders.length || projection.orders.some(order => !orderReady(order))) throw new Error('Selesaikan semua masalah pada batch ini sebelum download.');
  const escape = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g,'""')}"` : value;
  return CSV_HEADERS.join(',') + '\r\n' + orders.flatMap(order => order.rows).map(row => CSV_HEADERS.map(h => escape(row[h])).join(',')).join('\r\n') + '\r\n';
}

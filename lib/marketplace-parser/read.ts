import * as XLSX from 'xlsx';
import { moneyCents, quantity } from './money';
import type { ParsedFile, Platform, SourceLine, SourceOrder } from './types';

const text = (v: unknown) => String(v ?? '').trim();
function identifier(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('ID pada Excel sudah kehilangan presisi angka. Ekspor ulang dari marketplace dengan ID sebagai teks.');
  return String(value ?? '');
}
export function readMarketplaceFile(buffer: ArrayBuffer, filename: string): ParsedFile {
  if (!/\.xlsx$/i.test(filename)) throw new Error('Gunakan file .xlsx asli dari marketplace.');
  if (!buffer.byteLength || buffer.byteLength > 10*1024*1024) throw new Error('Ukuran file harus antara 1 byte dan 10 MB.');
  return parseWorkbook(XLSX.read(buffer,{type:'array',cellDates:false,sheetRows:20002}),filename);
}
export function parseWorkbook(book: XLSX.WorkBook, filename='marketplace.xlsx'): ParsedFile {
  if (book.SheetNames.length > 50) throw new Error('File memiliki terlalu banyak sheet. Maksimal 50.');
  const orders = new Map<string, SourceOrder>();const sheets: string[]=[];const ignoredSheets: string[]=[];
  const seen = new Set<string>();let lineCount=0;
  for (const sheet of book.SheetNames) {
    const ws=book.Sheets[sheet];
    if (XLSX.utils.decode_range(ws['!fullref'] || ws['!ref'] || 'A1').e.r > 20000) throw new Error('Maksimal 20.000 baris per sheet. Pecah file sebelum upload.');
    const grid=XLSX.utils.sheet_to_json<unknown[]>(ws,{header:1,raw:true,defval:'',blankrows:true});
    const headers=(grid[0] || []).map(text);const has=(key:string)=>headers.includes(key);
    let platform: Platform;let kind: SourceOrder['idKind']='order';
    if (has('No. Pesanan') && has('Jumlah') && has('Harga Setelah Diskon')) platform='shopee';
    else if (has('Order ID') && has('SKU Subtotal Before Discount') && has('Quantity')) platform='tiktokshop';
    else if (has('Booking SN') && has('No. Resi')) { platform='shopee';kind='booking'; }
    else if (has('orderNumber') && has('orderItemId') && has('unitPrice')) { platform='lazada';kind='order_item'; }
    else { ignoredSheets.push(sheet);continue; }
    if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw new Error(`Header ganda di sheet ${sheet}. Periksa file sumber.`);
    sheets.push(sheet);
    for (let i=1;i<grid.length;i++) {
      const values=grid[i];if (!values.some(v=>text(v))) continue;
      const raw=Object.fromEntries(headers.map((h,col)=>[h,values[col]]));
      const idValue=platform==='tiktokshop'?raw['Order ID']:platform==='lazada'?raw.orderItemId:kind==='booking'?raw['Booking SN']:raw['No. Pesanan'];
      if (platform==='tiktokshop' && /platform unique|order id/i.test(text(idValue))) continue; // export description row
      const id=identifier(idValue);
      if (!id.trim()) throw new Error(`${sheet} baris ${i+1}: ID pesanan kosong. Baris tidak diabaikan.`);
      const marketplaceOrderId=platform==='lazada'?identifier(raw.orderNumber):id;
      if (!marketplaceOrderId.trim()) throw new Error(`${sheet} baris ${i+1}: orderNumber kosong.`);
      const key=`${platform}:${kind}:${platform==='lazada'?marketplaceOrderId:id}`;
      const tracking=identifier(platform==='tiktokshop'?raw['Tracking ID']:platform==='lazada'?raw.trackingCode:raw['No. Resi']);
      const provider=text(platform==='tiktokshop'?raw['Shipping Provider Name']:platform==='lazada'?raw.shippingProvider:raw['Opsi Pengiriman']);
      const username=String((platform==='tiktokshop'?raw['Buyer Username']:platform==='lazada'?raw.customerName:raw['Username (Pembeli)']) ?? '');
      const strings=Object.fromEntries(Object.entries(raw).filter(([h])=>h).map(([h,v])=>[h,String(v ?? '')]));
      const source: SourceLine={key:`${sheet}:${i+1}`,sheet,row:i+1,sku:String((platform==='tiktokshop'?raw['Seller SKU']:platform==='lazada'?raw.sellerSku:raw['Nomor Referensi SKU']) ?? ''),name:text(platform==='tiktokshop'?raw['Product Name']:platform==='lazada'?raw.itemName:raw['Nama Produk']),variation:text(platform==='tiktokshop'?raw.Variation:platform==='lazada'?raw.variation:raw['Nama Variasi']),quantity:null,unitCents:null,totalCents:null,raw:strings,errors:[]};
      try {
        source.quantity=kind==='booking'?null:platform==='lazada'?1:quantity(platform==='tiktokshop'?raw.Quantity:raw.Jumlah);
        if (kind!=='booking') {
          if (platform==='tiktokshop') {
            const before=moneyCents(raw['SKU Subtotal Before Discount']);const discount=moneyCents(raw['SKU Seller Discount']);const original=moneyCents(raw['SKU Unit Original Price']);
            if (before!==null && discount!==null && source.quantity!==null) {
              source.totalCents=before-discount;
              // Reject sub-cent unit prices rather than silently rounding the order total.
              if (source.totalCents % source.quantity === 0) source.unitCents=source.totalCents/source.quantity;
              if (original!==null && original*source.quantity!==before) source.errors.push('Subtotal TikTok tidak cocok dengan harga awal × quantity.');
            }
          } else {
            source.unitCents=moneyCents(platform==='lazada'?raw.unitPrice:raw['Harga Setelah Diskon']);
            if (source.unitCents!==null && source.quantity!==null) source.totalCents=source.unitCents*source.quantity;
          }
        }
      } catch (e) { source.errors.push(e instanceof Error?e.message:'Angka sumber tidak valid.'); }
      if (source.totalCents!==null && !Number.isSafeInteger(source.totalCents)) source.errors.push('Total barang terlalu besar.');
      let order=orders.get(key);
      if (!order) {
        order={key,externalId:id,marketplaceOrderId,idKind:kind,platform,tracking,provider,username,lines:[],errors:[],warnings:[]};orders.set(key,order);
        if (kind==='booking') order.warnings.push('Advance Fulfilment: harga dan quantity tidak tersedia di sumber. Lengkapi dengan bukti pesanan.');
        if (platform==='lazada') order.warnings.push('Lazada memakai orderItemId pada CSV contoh. orderNumber tetap disimpan untuk pengelompokan.');
      } else if (order.tracking!==tracking || order.provider!==provider || order.username!==username) {
        order.errors.push('Data header/resi berbeda dalam satu order. Periksa kemungkinan pengiriman terpisah.');
      }
      if (/cancel|batal|refund|return|dikembalikan/i.test(text(raw['Order Status'] || raw['Status Pesanan'] || raw.status))) order.errors.push('Status pesanan dibatalkan/retur. Pisahkan dari batch pengiriman.');
      if (platform==='lazada' && ['sellerDiscountTotal','bundleDiscount'].some(h => { try{return Boolean(moneyCents(raw[h]));}catch{return true;} })) order.errors.push('Lazada dengan seller/bundle discount belum tervalidasi. Lengkapi aturan sebelum ekspor.');
      if (platform==='shopee' && kind==='order' && (moneyCents(raw['Voucher Ditanggung Penjual']) || 0)>0) order.warnings.push('Voucher seller terpisah; harga ekspor mengikuti Harga Setelah Diskon, sesuai contoh CSV.');
      const fingerprint=JSON.stringify([platform,kind,id,strings]);
      if (seen.has(fingerprint)) order.errors.push('Baris sumber identik muncul lebih dari sekali. Periksa duplikasi.');
      seen.add(fingerprint);order.lines.push(source);lineCount++;
      if (lineCount>20000) throw new Error('Maksimal 20.000 item per upload. Pecah file menjadi beberapa batch.');
    }
  }
  if (!orders.size) throw new Error('Tidak ada pesanan pada sheet marketplace yang dikenali. Gunakan ekspor Shopee, TikTok, atau Lazada.');
  const result=[...orders.values()];
  const receipts=new Map<string, SourceOrder[]>();
  for (const o of result) { const k=`${o.platform}:${o.tracking}`;if(o.tracking) receipts.set(k,[...(receipts.get(k)||[]),o]); }
  for (const os of receipts.values()) if (os.length>1) os.forEach(o=>o.errors.push('Resi juga ada pada order/booking lain di file ini. Rekonsiliasi duplikasi sebelum ekspor.'));
  for (const o of result) {
    if (o.platform==='lazada' && o.lines.length>1) o.errors.push('Order Lazada multi-item memerlukan keputusan external_id. Belum boleh diekspor otomatis.');
    o.errors=[...new Set(o.errors)];o.warnings=[...new Set(o.warnings)];
  }
  return {filename,orders:result,sheets,ignoredSheets};
}

// lib/financial-parser.ts
// Label-based parser for RTI Group Monthly Report
// Handles PL, CF, and Rasio sheets from Google Sheets

import { google } from 'googleapis';

function getAuth() {
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!key) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set');
  const creds = JSON.parse(key);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

async function getSheetData(spreadsheetId: string, range: string): Promise<any[][]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return res.data.values || [];
}

function normalizeLabel(label: string): string {
  if (!label) return '';
  return label.trim().toLowerCase()
    .replace(/[^a-z0-9_\s]/g, '')
    .replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function parseMonth(val: string): { year: number; month: number } | null {
  if (!val) return null;
  const str = String(val).trim();
  const enMatch = str.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})$/i);
  if (enMatch) {
    const mm: Record<string,number> = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    const m = mm[enMatch[1].toLowerCase().substring(0,3)];
    if (m) return { year: parseInt(enMatch[2]), month: m };
  }
  const idMatch = str.match(/^(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})$/i);
  if (idMatch) {
    const mm: Record<string,number> = {januari:1,februari:2,maret:3,april:4,mei:5,juni:6,juli:7,agustus:8,september:9,oktober:10,november:11,desember:12};
    const m = mm[idMatch[1].toLowerCase()];
    if (m) return { year: parseInt(idMatch[2]), month: m };
  }
  const isoMatch = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return { year: parseInt(isoMatch[1]), month: parseInt(isoMatch[2]) };
  const num = parseFloat(str);
  if (!isNaN(num) && num > 40000 && num < 50000) {
    const date = new Date(Date.UTC(1899, 11, 30 + Math.floor(num)));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
  }
  return null;
}

function toDateStr(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function safeNumber(val: any): number {
  if (val === null || val === undefined || val === '' || val === '-') return 0;
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

// ============================================================
// PL PARSER
// ============================================================

interface PLRow { month: string; line_item: string; line_item_label: string; section: string; amount: number; pct_sales: number | null; pct_net_sales: number | null; }

const PL_LABEL_MAP: Record<string, { key: string; section: string }> = {
  'penjualan': { key: 'penjualan', section: 'revenue' },
  'diskon penjualan': { key: 'diskon_penjualan', section: 'revenue' },
  'penjualan bersih': { key: 'penjualan_bersih', section: 'revenue' },
  'beban pokok pendapatan': { key: 'beban_pokok_pendapatan', section: 'cogs' },
  'laba bruto': { key: 'laba_bruto', section: 'summary' },
  'total beban': { key: 'total_beban', section: 'summary' },
  'beban penjualan': { key: 'beban_penjualan', section: 'beban_penjualan' },
  'beban iklan dan promosi': { key: 'beban_iklan_dan_promosi', section: 'beban_penjualan' },
  'beban iklan meta': { key: 'beban_iklan_meta', section: 'beban_penjualan' },
  'beban iklan dan admin tiktok': { key: 'beban_iklan_tiktok', section: 'beban_penjualan' },
  'beban iklan mp + cpas': { key: 'beban_iklan_mp_cpas', section: 'beban_penjualan' },
  'beban iklan dan promosi umum': { key: 'beban_iklan_promosi_umum', section: 'beban_penjualan' },
  'beban adm. marketplace': { key: 'beban_adm_marketplace', section: 'beban_penjualan' },
  'beban pengiriman': { key: 'beban_pengiriman', section: 'beban_penjualan' },
  'beban gaji penjualan': { key: 'beban_gaji_penjualan', section: 'beban_penjualan' },
  'beban produksi konten': { key: 'beban_produksi_konten', section: 'beban_penjualan' },
  'beban operasional': { key: 'beban_operasional', section: 'beban_operasional' },
  'beban gaji bod': { key: 'beban_gaji_bod', section: 'beban_operasional' },
  'beban gaji umum dan bpjs': { key: 'beban_gaji_umum_bpjs', section: 'beban_operasional' },
  'beban administrasi dan umum': { key: 'beban_adm_umum', section: 'beban_operasional' },
  'beban kantor': { key: 'beban_kantor', section: 'beban_operasional' },
  'beban lain-lain': { key: 'beban_lain_lain', section: 'beban_operasional' },
  'pendapatan lain-lain': { key: 'pendapatan_lain_lain', section: 'pendapatan_lainnya' },
  'laba / (rugi)': { key: 'laba_rugi', section: 'summary' },
  'beban operasional tanpa gaji': { key: 'beban_operasional_tanpa_gaji', section: 'summary' },
};

function findPLMapping(label: string): { key: string; section: string } | null {
  const clean = label.trim().toLowerCase();
  if (PL_LABEL_MAP[clean]) return PL_LABEL_MAP[clean];
  const stripped = clean.replace(/^\s+/, '');
  if (PL_LABEL_MAP[stripped]) return PL_LABEL_MAP[stripped];
  for (const [k, v] of Object.entries(PL_LABEL_MAP)) {
    if (stripped.includes(k) || k.includes(stripped)) return v;
  }
  const autoKey = normalizeLabel(label);
  if (autoKey) return { key: autoKey, section: 'other' };
  return null;
}

export async function parsePL(spreadsheetId: string): Promise<PLRow[]> {
  const data = await getSheetData(spreadsheetId, 'PL!A1:AM60');
  if (!data || data.length < 8) throw new Error('PL sheet is empty or too short');
  const headerRow = data[3] || [];
  const months: { col: number; date: string }[] = [];
  for (let i = 0; i < headerRow.length; i++) {
    const parsed = parseMonth(String(headerRow[i] || ''));
    if (parsed) months.push({ col: i, date: toDateStr(parsed.year, parsed.month) });
  }
  if (months.length === 0) throw new Error('No month headers found in PL sheet');
  const results: PLRow[] = [];
  for (let r = 6; r < data.length; r++) {
    const row = data[r] || [];
    const rawLabel = String(row[1] || '').trim();
    if (!rawLabel) continue;
    const firstMonthVal = row[months[0].col];
    if (firstMonthVal === undefined || firstMonthVal === null || firstMonthVal === '') continue;
    const mapping = findPLMapping(rawLabel);
    if (!mapping) continue;
    for (const m of months) {
      results.push({
        month: m.date, line_item: mapping.key, line_item_label: rawLabel.trim(),
        section: mapping.section, amount: safeNumber(row[m.col]),
        pct_sales: row[m.col + 1] !== undefined ? safeNumber(row[m.col + 1]) : null,
        pct_net_sales: row[m.col + 2] !== undefined ? safeNumber(row[m.col + 2]) : null,
      });
    }
  }
  return results;
}

// ============================================================
// CF PARSER — Proper parent-based disambiguation
// ============================================================

interface CFRow { month: string; section: string; line_item: string; line_item_label: string; sub_section: string; amount: number; }

export async function parseCF(spreadsheetId: string): Promise<CFRow[]> {
  const data = await getSheetData(spreadsheetId, 'CF!A1:AH143');
  if (!data || data.length < 9) throw new Error('CF sheet is empty or too short');
  const headerRow = data[3] || [];
  const months: { col: number; date: string }[] = [];
  for (let i = 0; i < headerRow.length; i++) {
    const parsed = parseMonth(String(headerRow[i] || ''));
    if (parsed) months.push({ col: i, date: toDateStr(parsed.year, parsed.month) });
  }
  if (months.length === 0) throw new Error('No month headers found in CF sheet');

  const results: CFRow[] = [];
  let currentParent = '';
  let inInternalCF = false;

  // Known unique items (no parent prefix needed)
  const KNOWN_KEYS: Record<string, { key: string; section: string; sub: string }> = {
    'penerimaan dari pelanggan': { key: 'penerimaan_pelanggan', section: 'operasi', sub: 'penerimaan' },
    'refund pelanggan': { key: 'refund_pelanggan', section: 'operasi', sub: 'penerimaan' },
    'penerimaan dari reseller': { key: 'penerimaan_reseller', section: 'operasi', sub: 'penerimaan' },
    'penerimaan dari direksi (pengembalian pinjaman)': { key: 'penerimaan_direksi', section: 'operasi', sub: 'penerimaan' },
    'penerimaan dari karyawan (pengembalian pinjaman)': { key: 'penerimaan_karyawan', section: 'operasi', sub: 'penerimaan' },
    'piutang karyawan & direksi': { key: 'piutang_karyawan_direksi', section: 'operasi', sub: 'piutang' },
    'piutang gts': { key: 'piutang_gts', section: 'operasi', sub: 'piutang' },
    'piutang sai': { key: 'piutang_sai', section: 'operasi', sub: 'piutang' },
    'piutang esh': { key: 'piutang_esh', section: 'operasi', sub: 'piutang' },
    'piutang mpt': { key: 'piutang_mpt', section: 'operasi', sub: 'piutang' },
    'pph 21': { key: 'pph_21', section: 'operasi', sub: 'pajak' },
    'pph 22': { key: 'pph_22', section: 'operasi', sub: 'pajak' },
    'pph 23': { key: 'pph_23', section: 'operasi', sub: 'pajak' },
    'pph 25': { key: 'pph_25', section: 'operasi', sub: 'pajak' },
    'pph 26': { key: 'pph_26', section: 'operasi', sub: 'pajak' },
    'pph 29': { key: 'pph_29', section: 'operasi', sub: 'pajak' },
    'pph 4 (2)': { key: 'pph_4_2', section: 'operasi', sub: 'pajak' },
    'pp 23': { key: 'pp_23', section: 'operasi', sub: 'pajak' },
    'ppn': { key: 'ppn', section: 'operasi', sub: 'pajak' },
    'ppn masukan': { key: 'ppn_masukan', section: 'operasi', sub: 'pajak' },
    'pajak kendaraan bermotor': { key: 'pajak_kendaraan', section: 'operasi', sub: 'pajak' },
    'pbb': { key: 'pbb', section: 'operasi', sub: 'pajak' },
    'denda': { key: 'denda', section: 'operasi', sub: 'pajak' },
    'uang muka pajak': { key: 'uang_muka_pajak', section: 'operasi', sub: 'pajak' },
    'kol & booster': { key: 'iklan_kol_booster', section: 'operasi', sub: 'iklan_promosi' },
    'tiktok': { key: 'iklan_tiktok', section: 'operasi', sub: 'iklan_promosi' },
    'facebook': { key: 'iklan_facebook', section: 'operasi', sub: 'iklan_promosi' },
    'shopee ads': { key: 'iklan_shopee', section: 'operasi', sub: 'iklan_promosi' },
    'lazada ads': { key: 'iklan_lazada', section: 'operasi', sub: 'iklan_promosi' },
    'tokopedia ads': { key: 'iklan_tokopedia', section: 'operasi', sub: 'iklan_promosi' },
    'biaya produksi konten': { key: 'biaya_produksi_konten', section: 'operasi', sub: 'biaya_penjualan' },
    'kurir': { key: 'kurir', section: 'operasi', sub: 'biaya_penjualan' },
    'komisi & fee': { key: 'komisi_fee', section: 'operasi', sub: 'biaya_penjualan' },
    'biaya admin dan marketplace': { key: 'biaya_admin_mp', section: 'operasi', sub: 'biaya_penjualan' },
    'payroll karyawan, bod dan bpjs': { key: 'payroll_total', section: 'operasi', sub: 'biaya_operasional' },
    'thr & bonus': { key: 'thr_bonus', section: 'operasi', sub: 'biaya_operasional' },
    'biaya adm & umum': { key: 'biaya_adm_umum', section: 'operasi', sub: 'biaya_operasional' },
    'beban kantor': { key: 'beban_kantor', section: 'operasi', sub: 'biaya_operasional' },
    'pendapatan bunga': { key: 'pendapatan_bunga', section: 'operasi', sub: 'pendapatan_lainnya' },
    'pembulatan': { key: 'pembulatan', section: 'operasi', sub: 'pendapatan_lainnya' },
    'beban bunga': { key: 'beban_bunga', section: 'operasi', sub: 'pendapatan_lainnya' },
    'penerimaan/(pengeluaran) lain-lain': { key: 'pendapatan_pengeluaran_lainnya', section: 'operasi', sub: 'pendapatan_lainnya' },
    'penjualan aset tetap': { key: 'penjualan_aset_tetap', section: 'investasi', sub: 'investasi' },
    'perolehan aset tetap': { key: 'perolehan_aset_tetap', section: 'investasi', sub: 'investasi' },
    'perolehan aset tak berwujud': { key: 'perolehan_aset_tak_berwujud', section: 'investasi', sub: 'investasi' },
    'pendanaan proyek': { key: 'pendanaan_proyek', section: 'investasi', sub: 'investasi' },
    'pengembalian pokok pendanaan': { key: 'pengembalian_pokok_pendanaan', section: 'investasi', sub: 'investasi' },
    'bagi hasil proyek zhu': { key: 'bagi_hasil_zhu', section: 'investasi', sub: 'investasi' },
    'pembagian dividen': { key: 'pembagian_dividen', section: 'pendanaan', sub: 'pendanaan' },
    'modal disetor': { key: 'modal_disetor', section: 'pendanaan', sub: 'pendanaan' },
    'pendanaan kkb': { key: 'pendanaan_kkb', section: 'pendanaan', sub: 'pendanaan' },
    'cashflow from operation': { key: 'cf_from_operation', section: 'summary', sub: 'fcf' },
    'capital expenditure': { key: 'capital_expenditure', section: 'summary', sub: 'fcf' },
    'free cash flow': { key: 'free_cash_flow', section: 'summary', sub: 'fcf' },
    // Internal CF unique items
    'penerimaan dari perusahaan dalam grup': { key: 'internal_penerimaan_grup', section: 'internal', sub: 'operasi' },
    'pembayaran kepada perusahaan dalam grup': { key: 'internal_pembayaran_grup', section: 'internal', sub: 'operasi' },
    'penyesuaian saldo': { key: 'internal_penyesuaian_saldo', section: 'internal', sub: 'operasi' },
    'pemberian pinjaman': { key: 'internal_pemberian_pinjaman', section: 'internal', sub: 'investasi' },
  };

  // Items that appear multiple times in CF — MUST prefix with parent
  const AMBIGUOUS_ITEMS = ['inventory', 'packaging', 'legal & profesional', 'lainnya'];

  for (let r = 4; r < data.length; r++) {
    const row = data[r] || [];
    let rawLabel = '';
    if (row[2] && typeof row[2] === 'string' && row[2].trim()) rawLabel = row[2].trim();
    else if (row[1] && typeof row[1] === 'string' && row[1].trim()) rawLabel = row[1].trim();
    if (!rawLabel) continue;

    const upperLabel = rawLabel.toUpperCase();

    // Detect internal CF
    if (upperLabel.includes('LAPORAN ARUS KAS INTERNAL')) { inInternalCF = true; currentParent = ''; continue; }

    // Track parent sections (these are headers with NO data)
    if (rawLabel === 'Pengembalian Dari Pemasok') { currentParent = 'pengembalian'; continue; }
    if (rawLabel.startsWith('Pembayaran Uang Muka')) { currentParent = 'uang_muka'; continue; }
    if (rawLabel.startsWith('Pembayaran Kepada Pemasok')) { currentParent = 'pemasok'; continue; }
    if (rawLabel.startsWith('Pembayaran Pajak')) { currentParent = 'pajak'; continue; }
    if (rawLabel.startsWith('Iklan & Promosi')) { currentParent = 'iklan'; continue; }
    if (rawLabel.startsWith('Biaya Penjualan')) { currentParent = 'biaya_penjualan'; continue; }
    if (rawLabel.startsWith('Biaya Operasional')) { currentParent = 'biaya_operasional'; continue; }
    if (rawLabel.startsWith('Pendapatan & Beban')) { currentParent = 'pendapatan_beban'; continue; }

    // Skip other section headers
    if (upperLabel.startsWith('LAPORAN ARUS KAS') || upperLabel.startsWith('ARUS KAS DARI') || rawLabel === 'Free Cash Flow') {
      if (upperLabel.startsWith('ARUS KAS DARI')) currentParent = '';
      continue;
    }

    // Must have data in first month column
    const firstVal = row[months[0].col];
    if (firstVal === undefined || firstVal === null || firstVal === '') continue;

    const cleanLabel = rawLabel.replace(/^\s+/, '');
    const lowerLabel = cleanLabel.toLowerCase();

    let lineItemKey = '';
    let section = 'operasi';
    let subSection = currentParent || 'other';

    // Handle summary rows (appear in col B, not C)
    if (lowerLabel.includes('arus kas bersih dari aktivitas operasi')) {
      lineItemKey = inInternalCF ? 'internal_arus_kas_bersih_operasi' : 'arus_kas_bersih_operasi';
      section = inInternalCF ? 'internal' : 'operasi'; subSection = 'summary';
    } else if (lowerLabel.includes('arus kas bersih dari aktivitas investasi')) {
      lineItemKey = inInternalCF ? 'internal_arus_kas_bersih_investasi' : 'arus_kas_bersih_investasi';
      section = inInternalCF ? 'internal' : 'investasi'; subSection = 'summary';
    } else if (lowerLabel.includes('arus kas bersih dari aktivitas pendanaan')) {
      lineItemKey = inInternalCF ? 'internal_arus_kas_bersih_pendanaan' : 'arus_kas_bersih_pendanaan';
      section = inInternalCF ? 'internal' : 'pendanaan'; subSection = 'summary';
    } else if (lowerLabel.includes('kenaikan') && lowerLabel.includes('penurunan') && lowerLabel.includes('kas')) {
      lineItemKey = inInternalCF ? 'internal_kenaikan_penurunan_kas' : 'kenaikan_penurunan_kas';
      section = inInternalCF ? 'internal' : 'summary'; subSection = 'summary';
    } else if (lowerLabel.includes('saldo kas') && lowerLabel.includes('awal')) {
      lineItemKey = 'saldo_kas_awal'; section = 'summary'; subSection = 'saldo';
    } else if (lowerLabel.includes('saldo kas') && lowerLabel.includes('akhir')) {
      lineItemKey = 'saldo_kas_akhir'; section = 'summary'; subSection = 'saldo';
    }
    // Check known unique items
    else if (KNOWN_KEYS[lowerLabel]) {
      const k = KNOWN_KEYS[lowerLabel];
      lineItemKey = k.key; section = k.section; subSection = k.sub;
    }
    // Ambiguous items — ALWAYS prefix with parent
    else if (AMBIGUOUS_ITEMS.includes(lowerLabel)) {
      lineItemKey = `${currentParent || 'unknown'}_${normalizeLabel(cleanLabel)}`;
      subSection = currentParent || 'other';
    }
    // Unknown items — prefix with parent for safety
    else {
      lineItemKey = currentParent
        ? `${currentParent}_${normalizeLabel(cleanLabel)}`
        : normalizeLabel(cleanLabel);
      subSection = currentParent || 'other';
    }

    if (!lineItemKey) continue;

    for (const m of months) {
      results.push({
        month: m.date, section, line_item: lineItemKey,
        line_item_label: cleanLabel, sub_section: subSection,
        amount: safeNumber(row[m.col]),
      });
    }
  }

  return results;
}

// ============================================================
// RASIO PARSER
// ============================================================

interface RatioRow { month: string; ratio_name: string; ratio_label: string; category: string; value: number; benchmark_min: number | null; benchmark_max: number | null; benchmark_label: string | null; }

const RATIO_MAP: Record<string, { key: string; category: string }> = {
  'gross profit (loss) margin': { key: 'gpm', category: 'rasio_usaha' },
  'net profit (loss)%': { key: 'npm', category: 'rasio_usaha' },
  'roa': { key: 'roa', category: 'rasio_usaha' },
  'roe': { key: 'roe', category: 'rasio_usaha' },
  'cash ratio': { key: 'cash_ratio', category: 'rasio_keuangan' },
  'current ratio': { key: 'current_ratio', category: 'rasio_keuangan' },
  'quick ratio': { key: 'quick_ratio', category: 'rasio_keuangan' },
  'debt ratio': { key: 'debt_ratio', category: 'rasio_keuangan' },
  'cash conversion ratio': { key: 'ccr', category: 'rasio_keuangan' },
  'operating cash flow to asset ratio': { key: 'ocf_to_asset', category: 'rasio_keuangan' },
  'asset turnover ratio': { key: 'asset_turnover', category: 'rasio_keuangan' },
  'inventory turnover ratio': { key: 'inventory_turnover', category: 'rasio_keuangan' },
};

function parseBenchmark(val: string): { min: number | null; max: number | null } {
  if (!val || typeof val !== 'string') return { min: null, max: null };
  const match = val.match(/([\d.]+)%?\s*-\s*([\d.]+)%?/);
  if (!match) return { min: null, max: null };
  let min = parseFloat(match[1]);
  let max = parseFloat(match[2]);
  if (val.includes('%') && min > 1) { min = min / 100; max = max / 100; }
  return { min, max };
}

export async function parseRasio(spreadsheetId: string): Promise<RatioRow[]> {
  const data = await getSheetData(spreadsheetId, 'Rasio!A1:P25');
  if (!data || data.length < 6) throw new Error('Rasio sheet is empty or too short');
  const headerRow = data[2] || [];
  const months: { col: number; date: string }[] = [];
  for (let i = 3; i < headerRow.length; i++) {
    const parsed = parseMonth(String(headerRow[i] || ''));
    if (parsed) months.push({ col: i, date: toDateStr(parsed.year, parsed.month) });
  }
  if (months.length === 0) throw new Error('No month headers found in Rasio sheet');
  const results: RatioRow[] = [];
  for (let r = 3; r < data.length; r++) {
    const row = data[r] || [];
    const rawLabel = String(row[1] || '').trim();
    if (!rawLabel) continue;
    const lowerLabel = rawLabel.toLowerCase();
    let mapping: { key: string; category: string } | null = null;
    for (const [pattern, m] of Object.entries(RATIO_MAP)) {
      if (lowerLabel.startsWith(pattern)) { mapping = m; break; }
    }
    if (!mapping) continue;
    const benchmarkStr = String(row[2] || '');
    const benchmark = parseBenchmark(benchmarkStr);
    for (const m of months) {
      const value = safeNumber(row[m.col]);
      if (value === 0 && !row[m.col]) continue;
      results.push({
        month: m.date, ratio_name: mapping.key, ratio_label: rawLabel,
        category: mapping.category, value,
        benchmark_min: benchmark.min, benchmark_max: benchmark.max,
        benchmark_label: benchmarkStr || null,
      });
    }
  }
  return results;
}

// ============================================================
// MAIN
// ============================================================

export interface FinancialParseResult { pl: PLRow[]; cf: CFRow[]; ratios: RatioRow[]; monthsFound: string[]; errors: string[]; }

export async function parseFinancialReport(spreadsheetId: string): Promise<FinancialParseResult> {
  const errors: string[] = [];
  let pl: PLRow[] = [], cf: CFRow[] = [], ratios: RatioRow[] = [];
  try { pl = await parsePL(spreadsheetId); } catch (e: any) { errors.push(`PL: ${e.message}`); }
  try { cf = await parseCF(spreadsheetId); } catch (e: any) { errors.push(`CF: ${e.message}`); }
  try { ratios = await parseRasio(spreadsheetId); } catch (e: any) { errors.push(`Rasio: ${e.message}`); }
  const allMonths = new Set<string>();
  pl.forEach(r => allMonths.add(r.month));
  cf.forEach(r => allMonths.add(r.month));
  ratios.forEach(r => allMonths.add(r.month));
  return { pl, cf, ratios, monthsFound: Array.from(allMonths).sort(), errors };
}

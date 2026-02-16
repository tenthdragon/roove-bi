// lib/financial-parser.ts
// Label-based parser for RTI Group Monthly Report
// Handles PL, CF, and Rasio sheets from Google Sheets

import { google } from 'googleapis';

// ============================================================
// GOOGLE SHEETS CONNECTION
// ============================================================

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

// ============================================================
// HELPERS
// ============================================================

function normalizeLabel(label: string): string {
  if (!label) return '';
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseMonth(val: string): { year: number; month: number } | null {
  if (!val) return null;
  const str = String(val).trim();

  // Handle "Dec 2025", "Nov 2025", etc.
  const enMatch = str.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})$/i);
  if (enMatch) {
    const monthMap: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const m = monthMap[enMatch[1].toLowerCase().substring(0, 3)];
    if (m) return { year: parseInt(enMatch[2]), month: m };
  }

  // Handle "Januari 2025", "Februari 2025", "Maret 2025", etc.
  const idMatch = str.match(/^(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})$/i);
  if (idMatch) {
    const idMonthMap: Record<string, number> = {
      januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
      juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
    };
    const m = idMonthMap[idMatch[1].toLowerCase()];
    if (m) return { year: parseInt(idMatch[2]), month: m };
  }

  // Handle short Indonesian: "Okt 2024", "Agu 2024"
  const idShortMatch = str.match(/^(Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des)\s+(\d{4})$/i);
  if (idShortMatch) {
    const shortMap: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, jun: 6,
      jul: 7, agu: 8, sep: 9, okt: 10, nov: 11, des: 12,
    };
    const m = shortMap[idShortMatch[1].toLowerCase()];
    if (m) return { year: parseInt(idShortMatch[2]), month: m };
  }

  // Handle ISO-ish dates like "2025-12-01" or datetime strings
  const isoMatch = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return { year: parseInt(isoMatch[1]), month: parseInt(isoMatch[2]) };
  }

  // Handle serial date number from Google Sheets
  const num = parseFloat(str);
  if (!isNaN(num) && num > 40000 && num < 50000) {
    // Google Sheets serial date (days since Dec 30, 1899)
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

interface PLRow {
  month: string;
  line_item: string;
  line_item_label: string;
  section: string;
  amount: number;
  pct_sales: number | null;
  pct_net_sales: number | null;
}

// Map of known PL labels to their normalized keys and sections
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
  // Direct match
  if (PL_LABEL_MAP[clean]) return PL_LABEL_MAP[clean];
  // Fuzzy: try removing leading spaces
  const stripped = clean.replace(/^\s+/, '');
  if (PL_LABEL_MAP[stripped]) return PL_LABEL_MAP[stripped];
  // Try partial match
  for (const [k, v] of Object.entries(PL_LABEL_MAP)) {
    if (stripped.includes(k) || k.includes(stripped)) return v;
  }
  // Auto-generate key for unknown labels
  const autoKey = normalizeLabel(label);
  if (autoKey) {
    return { key: autoKey, section: 'other' };
  }
  return null;
}

export async function parsePL(spreadsheetId: string): Promise<PLRow[]> {
  // Read entire PL sheet
  const data = await getSheetData(spreadsheetId, 'PL!A1:AM60');
  if (!data || data.length < 8) throw new Error('PL sheet is empty or too short');

  // Find month headers (row index 3 = row 4 in sheet)
  const headerRow = data[3] || [];
  const months: { col: number; date: string }[] = [];

  // PL structure: each month has 3 columns (Rp, % penjualan, % penjualan bersih)
  // Headers are at columns C, F, I, L, ... (every 3rd column starting from col 2 = index 2)
  for (let i = 0; i < headerRow.length; i++) {
    const parsed = parseMonth(String(headerRow[i] || ''));
    if (parsed) {
      months.push({ col: i, date: toDateStr(parsed.year, parsed.month) });
    }
  }

  if (months.length === 0) throw new Error('No month headers found in PL sheet');

  const results: PLRow[] = [];

  // Parse data rows (starting from row 7 = index 6)
  for (let r = 6; r < data.length; r++) {
    const row = data[r] || [];
    // Label is in column B (index 1)
    const rawLabel = String(row[1] || '').trim();
    if (!rawLabel) continue;

    // Skip section headers that have no data (like "Penjualan" in row 7 which is just a header)
    // Check if there's actual data in the first month column
    const firstMonthVal = row[months[0].col];
    if (firstMonthVal === undefined || firstMonthVal === null || firstMonthVal === '') {
      // This might be a section header — but also check if label matches a known data row
      // Row 7 "Penjualan" is header, Row 8 "Penjualan" is data
      continue;
    }

    const mapping = findPLMapping(rawLabel);
    if (!mapping) continue;

    for (const m of months) {
      const amount = safeNumber(row[m.col]);
      const pctSales = row[m.col + 1] !== undefined ? safeNumber(row[m.col + 1]) : null;
      const pctNetSales = row[m.col + 2] !== undefined ? safeNumber(row[m.col + 2]) : null;

      results.push({
        month: m.date,
        line_item: mapping.key,
        line_item_label: rawLabel.trim(),
        section: mapping.section,
        amount,
        pct_sales: pctSales,
        pct_net_sales: pctNetSales,
      });
    }
  }

  return results;
}

// ============================================================
// CF PARSER
// ============================================================

interface CFRow {
  month: string;
  section: string;
  line_item: string;
  line_item_label: string;
  sub_section: string;
  amount: number;
}

const CF_SECTIONS: Record<string, { section: string; sub: string }> = {
  'penerimaan dari pelanggan': { section: 'operasi', sub: 'penerimaan' },
  'refund pelanggan': { section: 'operasi', sub: 'penerimaan' },
  'penerimaan dari reseller': { section: 'operasi', sub: 'penerimaan' },
  'penerimaan dari direksi (pengembalian pinjaman)': { section: 'operasi', sub: 'penerimaan' },
  'penerimaan dari karyawan (pengembalian pinjaman)': { section: 'operasi', sub: 'penerimaan' },
  // Uang muka pemasok
  'inventory': { section: 'operasi', sub: 'pembayaran_pemasok' },
  'packaging': { section: 'operasi', sub: 'pembayaran_pemasok' },
  'legal & profesional': { section: 'operasi', sub: 'pembayaran_pemasok' },
  'lainnya': { section: 'operasi', sub: 'lainnya' },
  // Piutang
  'piutang karyawan & direksi': { section: 'operasi', sub: 'piutang' },
  'piutang gts': { section: 'operasi', sub: 'piutang' },
  'piutang sai': { section: 'operasi', sub: 'piutang' },
  'piutang esh': { section: 'operasi', sub: 'piutang' },
  'piutang mpt': { section: 'operasi', sub: 'piutang' },
  // Pajak
  'pph 21': { section: 'operasi', sub: 'pajak' },
  'pph 22': { section: 'operasi', sub: 'pajak' },
  'pph 23': { section: 'operasi', sub: 'pajak' },
  'pph 25': { section: 'operasi', sub: 'pajak' },
  'pph 26': { section: 'operasi', sub: 'pajak' },
  'pph 29': { section: 'operasi', sub: 'pajak' },
  'pph 4 (2)': { section: 'operasi', sub: 'pajak' },
  'pp 23': { section: 'operasi', sub: 'pajak' },
  'ppn': { section: 'operasi', sub: 'pajak' },
  'ppn masukan': { section: 'operasi', sub: 'pajak' },
  'pajak kendaraan bermotor': { section: 'operasi', sub: 'pajak' },
  'pbb': { section: 'operasi', sub: 'pajak' },
  'denda': { section: 'operasi', sub: 'pajak' },
  'uang muka pajak': { section: 'operasi', sub: 'pajak' },
  // Biaya penjualan
  'kol & booster': { section: 'operasi', sub: 'iklan_promosi' },
  'tiktok': { section: 'operasi', sub: 'iklan_promosi' },
  'facebook': { section: 'operasi', sub: 'iklan_promosi' },
  'shopee ads': { section: 'operasi', sub: 'iklan_promosi' },
  'lazada ads': { section: 'operasi', sub: 'iklan_promosi' },
  'tokopedia ads': { section: 'operasi', sub: 'iklan_promosi' },
  'biaya produksi konten': { section: 'operasi', sub: 'biaya_penjualan' },
  'kurir': { section: 'operasi', sub: 'biaya_penjualan' },
  'komisi & fee': { section: 'operasi', sub: 'biaya_penjualan' },
  'biaya admin dan marketplace': { section: 'operasi', sub: 'biaya_penjualan' },
  // Biaya operasional
  'payroll karyawan, bod dan bpjs': { section: 'operasi', sub: 'biaya_operasional' },
  'thr & bonus': { section: 'operasi', sub: 'biaya_operasional' },
  'biaya adm & umum': { section: 'operasi', sub: 'biaya_operasional' },
  'beban kantor': { section: 'operasi', sub: 'biaya_operasional' },
  // Pendapatan lain
  'pendapatan bunga': { section: 'operasi', sub: 'pendapatan_lainnya' },
  'pembulatan': { section: 'operasi', sub: 'pendapatan_lainnya' },
  'beban bunga': { section: 'operasi', sub: 'pendapatan_lainnya' },
  'penerimaan/(pengeluaran) lain-lain': { section: 'operasi', sub: 'pendapatan_lainnya' },
  // Summary operasi
  'arus kas bersih dari aktivitas operasi': { section: 'operasi', sub: 'summary' },
  // Investasi
  'penjualan aset tetap': { section: 'investasi', sub: 'investasi' },
  'perolehan aset tetap': { section: 'investasi', sub: 'investasi' },
  'perolehan aset tak berwujud': { section: 'investasi', sub: 'investasi' },
  'pendanaan proyek': { section: 'investasi', sub: 'investasi' },
  'pengembalian pokok pendanaan': { section: 'investasi', sub: 'investasi' },
  'bagi hasil proyek zhu': { section: 'investasi', sub: 'investasi' },
  'arus kas bersih dari aktivitas investasi': { section: 'investasi', sub: 'summary' },
  // Pendanaan
  'pembagian dividen': { section: 'pendanaan', sub: 'pendanaan' },
  'modal disetor': { section: 'pendanaan', sub: 'pendanaan' },
  'pendanaan kkb': { section: 'pendanaan', sub: 'pendanaan' },
  'arus kas bersih dari aktivitas pendanaan': { section: 'pendanaan', sub: 'summary' },
  // Grand totals
  'kenaikan (penurunan) bersih kas dan setara kas': { section: 'summary', sub: 'summary' },
  'saldo kas dan setara kas awal periode': { section: 'summary', sub: 'saldo' },
  'saldo kas dan setara kas akhir periode': { section: 'summary', sub: 'saldo' },
  'cashflow from operation': { section: 'summary', sub: 'fcf' },
  'capital expenditure': { section: 'summary', sub: 'fcf' },
  'free cash flow': { section: 'summary', sub: 'fcf' },
};

// Normalized key mapping for CF
const CF_KEY_MAP: Record<string, string> = {
  'penerimaan dari pelanggan': 'penerimaan_pelanggan',
  'refund pelanggan': 'refund_pelanggan',
  'penerimaan dari reseller': 'penerimaan_reseller',
  'penerimaan dari direksi (pengembalian pinjaman)': 'penerimaan_direksi',
  'penerimaan dari karyawan (pengembalian pinjaman)': 'penerimaan_karyawan',
  'arus kas bersih dari aktivitas operasi': 'arus_kas_bersih_operasi',
  'arus kas bersih dari aktivitas investasi': 'arus_kas_bersih_investasi',
  'arus kas bersih dari aktivitas pendanaan': 'arus_kas_bersih_pendanaan',
  'kenaikan (penurunan) bersih kas dan setara kas': 'kenaikan_penurunan_kas',
  'saldo kas dan setara kas awal periode': 'saldo_kas_awal',
  'saldo kas dan setara kas akhir periode': 'saldo_kas_akhir',
  'cashflow from operation': 'cf_from_operation',
  'capital expenditure': 'capital_expenditure',
  'free cash flow': 'free_cash_flow',
  'biaya admin dan marketplace': 'biaya_admin_mp',
  'biaya produksi konten': 'biaya_produksi_konten',
  'biaya adm & umum': 'biaya_adm_umum',
  'payroll karyawan, bod dan bpjs': 'payroll_total',
  'thr & bonus': 'thr_bonus',
  'pendapatan bunga': 'pendapatan_bunga',
  'beban bunga': 'beban_bunga',
  'penerimaan/(pengeluaran) lain-lain': 'pendapatan_pengeluaran_lainnya',
  'pembagian dividen': 'pembagian_dividen',
  'modal disetor': 'modal_disetor',
  'pendanaan kkb': 'pendanaan_kkb',
  'penjualan aset tetap': 'penjualan_aset_tetap',
  'perolehan aset tetap': 'perolehan_aset_tetap',
  'perolehan aset tak berwujud': 'perolehan_aset_tak_berwujud',
  'pendanaan proyek': 'pendanaan_proyek',
  'pengembalian pokok pendanaan': 'pengembalian_pokok_pendanaan',
  'bagi hasil proyek zhu': 'bagi_hasil_zhu',
  'piutang karyawan & direksi': 'piutang_karyawan_direksi',
  'piutang gts': 'piutang_gts',
  'piutang sai': 'piutang_sai',
  'piutang esh': 'piutang_esh',
  'piutang mpt': 'piutang_mpt',
  'komisi & fee': 'komisi_fee',
  'kurir': 'kurir',
  'kol & booster': 'kol_booster',
  'tiktok': 'iklan_tiktok',
  'facebook': 'iklan_facebook',
  'shopee ads': 'iklan_shopee',
  'lazada ads': 'iklan_lazada',
  'tokopedia ads': 'iklan_tokopedia',
  'beban kantor': 'beban_kantor',
  'pembulatan': 'pembulatan',
  'pajak kendaraan bermotor': 'pajak_kendaraan',
  'pbb': 'pbb',
  'denda': 'denda',
  'uang muka pajak': 'uang_muka_pajak',
};

function findCFMapping(label: string): { section: string; sub: string; key: string } | null {
  const clean = label.trim().toLowerCase().replace(/^\s+/, '');

  // Check direct match
  if (CF_SECTIONS[clean]) {
    const key = CF_KEY_MAP[clean] || normalizeLabel(clean);
    return { ...CF_SECTIONS[clean], key };
  }

  // Partial match for indented items
  for (const [k, v] of Object.entries(CF_SECTIONS)) {
    if (clean.includes(k) || k.includes(clean)) {
      const key = CF_KEY_MAP[k] || normalizeLabel(clean);
      return { ...v, key };
    }
  }

  return null;
}

export async function parseCF(spreadsheetId: string): Promise<CFRow[]> {
  // Read CF sheet — only external CF (rows 1-100), skip internal CF
  const data = await getSheetData(spreadsheetId, 'CF!A1:AH143');
  if (!data || data.length < 9) throw new Error('CF sheet is empty or too short');

  // Find month headers (row 4 = index 3)
  const headerRow = data[3] || [];
  const months: { col: number; date: string }[] = [];

  for (let i = 0; i < headerRow.length; i++) {
    const parsed = parseMonth(String(headerRow[i] || ''));
    if (parsed) {
      months.push({ col: i, date: toDateStr(parsed.year, parsed.month) });
    }
  }

  if (months.length === 0) throw new Error('No month headers found in CF sheet');

  const results: CFRow[] = [];
  let currentParent = ''; // Track parent for sub-items like "Inventory" under "Pembayaran Uang Muka"

  // Parse rows 5 onwards, stop at internal CF section (row ~100)
  for (let r = 4; r < Math.min(data.length, 143); r++) {
    const row = data[r] || [];

    // Try column C (index 2) first, then column B (index 1) for label
    let rawLabel = '';
    let labelCol = -1;

    // Some rows have label in col C (indented), some in col B
    if (row[2] && typeof row[2] === 'string' && row[2].trim()) {
      rawLabel = row[2].trim();
      labelCol = 2;
    } else if (row[1] && typeof row[1] === 'string' && row[1].trim()) {
      rawLabel = row[1].trim();
      labelCol = 1;
    }

    if (!rawLabel) continue;

    // Skip section headers without data
    const isHeader = ['LAPORAN ARUS KAS', 'ARUS KAS DARI', 'Biaya Penjualan', 'Biaya Operasional',
      'Pembayaran Pajak', 'Pembayaran Kepada Pemasok', 'Pembayaran Uang Muka',
      'Pengembalian Dari Pemasok', 'Pendapatan & Beban', 'Iklan & Promosi',
      'Free Cash Flow', 'LAPORAN ARUS KAS INTERNAL', 'LAPORAN ARUS KAS EKSTERNAL'
    ].some(h => rawLabel.startsWith(h));

    // Track parent context for disambiguation
    if (rawLabel.startsWith('Pembayaran Uang Muka')) currentParent = 'uang_muka';
    else if (rawLabel.startsWith('Pembayaran Kepada Pemasok')) currentParent = 'pembayaran';
    else if (rawLabel.startsWith('Pembayaran Pajak')) currentParent = 'pajak';
    else if (rawLabel.startsWith('Iklan & Promosi')) currentParent = 'iklan';
    else if (rawLabel.startsWith('ARUS KAS DARI')) currentParent = '';

    if (isHeader) continue;

    // Check if first month column has data
    const firstVal = row[months[0].col];
    if (firstVal === undefined || firstVal === null || firstVal === '') continue;

    // For indented items (starts with spaces), prefix with parent context
    const isIndented = rawLabel.startsWith('     ') || rawLabel.startsWith('    ');
    const cleanLabel = rawLabel.replace(/^\s+/, '');

    let lookupLabel = cleanLabel.toLowerCase();

    // Disambiguate common names like "Inventory", "Packaging", "Lainnya"
    if (isIndented && currentParent && ['inventory', 'packaging', 'legal & profesional', 'lainnya'].includes(lookupLabel)) {
      lookupLabel = `${currentParent}_${lookupLabel}`;
    }

    const mapping = findCFMapping(cleanLabel);
    if (!mapping) {
      // Auto-generate for unknown items
      const autoKey = currentParent
        ? `${currentParent}_${normalizeLabel(cleanLabel)}`
        : normalizeLabel(cleanLabel);
      if (!autoKey) continue;

      for (const m of months) {
        const amount = safeNumber(row[m.col]);
        results.push({
          month: m.date,
          section: 'operasi',
          line_item: autoKey,
          line_item_label: cleanLabel,
          sub_section: currentParent || 'other',
          amount,
        });
      }
      continue;
    }

    // Prefix key with parent for disambiguation
    let finalKey = mapping.key;
    if (isIndented && currentParent && ['inventory', 'packaging', 'legal_profesional', 'lainnya'].includes(mapping.key)) {
      finalKey = `${currentParent}_${mapping.key}`;
    }

    for (const m of months) {
      const amount = safeNumber(row[m.col]);
      results.push({
        month: m.date,
        section: mapping.section,
        line_item: finalKey,
        line_item_label: cleanLabel,
        sub_section: mapping.sub,
        amount,
      });
    }
  }

  return results;
}

// ============================================================
// RASIO PARSER
// ============================================================

interface RatioRow {
  month: string;
  ratio_name: string;
  ratio_label: string;
  category: string;
  value: number;
  benchmark_min: number | null;
  benchmark_max: number | null;
  benchmark_label: string | null;
}

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
  // Handle "50% - 70%", "1.2 - 2.0", "0.8% - 1.7%"
  const match = val.match(/([\d.]+)%?\s*-\s*([\d.]+)%?/);
  if (!match) return { min: null, max: null };
  let min = parseFloat(match[1]);
  let max = parseFloat(match[2]);
  // If it has %, convert to decimal
  if (val.includes('%') && min > 1) {
    min = min / 100;
    max = max / 100;
  }
  return { min, max };
}

export async function parseRasio(spreadsheetId: string): Promise<RatioRow[]> {
  const data = await getSheetData(spreadsheetId, 'Rasio!A1:P25');
  if (!data || data.length < 6) throw new Error('Rasio sheet is empty or too short');

  // Find month headers (row 3 = index 2)
  const headerRow = data[2] || [];
  const months: { col: number; date: string }[] = [];

  // Months start from column D (index 3)
  for (let i = 3; i < headerRow.length; i++) {
    const parsed = parseMonth(String(headerRow[i] || ''));
    if (parsed) {
      months.push({ col: i, date: toDateStr(parsed.year, parsed.month) });
    }
  }

  if (months.length === 0) throw new Error('No month headers found in Rasio sheet');

  const results: RatioRow[] = [];

  for (let r = 3; r < data.length; r++) {
    const row = data[r] || [];
    const rawLabel = String(row[1] || '').trim();
    if (!rawLabel) continue;

    // Find matching ratio
    const lowerLabel = rawLabel.toLowerCase();
    let mapping: { key: string; category: string } | null = null;
    for (const [pattern, m] of Object.entries(RATIO_MAP)) {
      if (lowerLabel.startsWith(pattern)) {
        mapping = m;
        break;
      }
    }
    if (!mapping) continue;

    // Benchmark is in column C (index 2)
    const benchmarkStr = String(row[2] || '');
    const benchmark = parseBenchmark(benchmarkStr);

    for (const m of months) {
      const value = safeNumber(row[m.col]);
      if (value === 0 && !row[m.col]) continue; // Skip empty cells

      results.push({
        month: m.date,
        ratio_name: mapping.key,
        ratio_label: rawLabel,
        category: mapping.category,
        value,
        benchmark_min: benchmark.min,
        benchmark_max: benchmark.max,
        benchmark_label: benchmarkStr || null,
      });
    }
  }

  return results;
}

// ============================================================
// MAIN PARSE FUNCTION
// ============================================================

export interface FinancialParseResult {
  pl: PLRow[];
  cf: CFRow[];
  ratios: RatioRow[];
  monthsFound: string[];
  errors: string[];
}

export async function parseFinancialReport(spreadsheetId: string): Promise<FinancialParseResult> {
  const errors: string[] = [];
  let pl: PLRow[] = [];
  let cf: CFRow[] = [];
  let ratios: RatioRow[] = [];

  try {
    pl = await parsePL(spreadsheetId);
  } catch (e: any) {
    errors.push(`PL parse error: ${e.message}`);
  }

  try {
    cf = await parseCF(spreadsheetId);
  } catch (e: any) {
    errors.push(`CF parse error: ${e.message}`);
  }

  try {
    ratios = await parseRasio(spreadsheetId);
  } catch (e: any) {
    errors.push(`Rasio parse error: ${e.message}`);
  }

  // Collect all unique months
  const allMonths = new Set<string>();
  pl.forEach(r => allMonths.add(r.month));
  cf.forEach(r => allMonths.add(r.month));
  ratios.forEach(r => allMonths.add(r.month));

  return {
    pl,
    cf,
    ratios,
    monthsFound: Array.from(allMonths).sort(),
    errors,
  };
}

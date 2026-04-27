// app/api/bank-csv-upload/route.ts
// Parses bank statement CSVs (BCA / BRI / Mandiri) and saves to Supabase
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { classifyTransaction } from '@/lib/transaction-tagger';

type Bank = 'BCA' | 'BRI' | 'MANDIRI';

interface ParsedTransaction {
  transaction_date: string;  // YYYY-MM-DD
  transaction_time: string | null;
  description: string;
  credit_amount: number;
  debit_amount: number;
  running_balance: number | null;
}

interface ParseResult {
  bank: Bank;
  account_no: string;
  period_label: string;
  period_start: string;
  period_end: string;
  opening_balance: number | null;
  closing_balance: number | null;
  transactions: ParsedTransaction[];
}

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ── Strip BOM and normalize line endings ──
function normalizeText(text: string): string {
  // Remove BOM (\uFEFF) if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  // Normalize Windows line endings
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// ── Simple CSV parser (handles quoted fields) ──
function parseCSVLine(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

// Strip outer double-quotes and unescape inner "" → "
function stripOuterQuotes(s: string): string {
  s = s.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).replace(/""/g, '"');
  }
  return s;
}

// Parse number: remove commas, convert "." to 0
function parseNum(s: string): number {
  if (!s || s === '.' || s === '') return 0;
  return parseFloat(s.replace(/,/g, '')) || 0;
}

// DD/MM/YYYY → YYYY-MM-DD
function parseDMY(s: string): string {
  const parts = s.trim().split('/');
  if (parts.length !== 3) return s;
  return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
}

// "08 April 2026 06:27:31" → { date: "2026-04-08", time: "06:27" }
const MONTH_EN_ID: Record<string, string> = {
  january: '01', februari: '02', february: '02', maret: '03', march: '03',
  april: '04', mei: '05', may: '05', juni: '06', june: '06',
  juli: '07', july: '07', agustus: '08', august: '08',
  september: '09', oktober: '10', october: '10',
  november: '11', desember: '12', december: '12',
  januari: '01',
};

function parseLongDate(s: string): { date: string; time: string | null } | null {
  // "08 April 2026 06:27:31" or "08 April 2026"
  const m = s.trim().match(/^(\d{1,2})\s+(\w+)\s+(\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/i);
  if (!m) return null;
  const day = m[1].padStart(2, '0');
  const monthKey = m[2].toLowerCase();
  const month = MONTH_EN_ID[monthKey];
  if (!month) return null;
  const year = m[3];
  const time = m[4] ? m[4].slice(0, 5) : null;
  return { date: `${year}-${month}-${day}`, time };
}

// Period label from date: "APRIL 2026"
const MONTH_NAMES = ['', 'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
  'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];

function periodLabelFromDate(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  return `${MONTH_NAMES[m]} ${y}`;
}

// ── BCA Parser ──
function parseBCA(text: string): ParseResult {
  const normalized = normalizeText(text);
  const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);

  let accountNo = '';
  let periodStart = '';
  let periodEnd = '';
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;
  const transactions: ParsedTransaction[] = [];
  let dataStarted = false;

  for (const rawLine of lines) {
    // Strip quotes from metadata lines (April 8 format wraps each line in quotes)
    const cleanLine = rawLine.replace(/^"(.*)"$/, '$1');
    const rawLower = cleanLine.toLowerCase();

    // Extract account number (try multiple patterns)
    if (rawLower.includes('no. rekening') || rawLower.includes('no.rekening') || rawLower.includes('nomor rekening')) {
      const m = cleanLine.match(/:\s*([\d\s\-]+)/);
      if (m) accountNo = m[1].replace(/\s+/g, '').trim();
      continue;
    }
    // Extract period
    if (rawLower.includes('periode')) {
      const m = cleanLine.match(/(\d{2}\/\d{2}\/\d{4})\s*[-–]\s*(\d{2}\/\d{2}\/\d{4})/);
      if (m) {
        periodStart = parseDMY(m[1]);
        periodEnd   = parseDMY(m[2]);
      }
      continue;
    }

    // Summary lines at bottom
    if (rawLower.includes('saldo awal')) {
      const m = cleanLine.match(/([\d,]+\.?[\d]*)/);
      if (m) openingBalance = parseNum(m[1]);
      continue;
    }
    if (rawLower.includes('saldo akhir')) {
      const m = cleanLine.match(/([\d,]+\.?[\d]*)/);
      if (m) closingBalance = parseNum(m[1]);
      continue;
    }
    if (rawLower.includes('mutasi debet') || rawLower.includes('mutasi kredit')) continue;

    // Data header row — case-insensitive, handles variations
    if (rawLower.includes('tanggal transaksi') || rawLower.includes('tgl transaksi') || (rawLower.includes('tanggal') && rawLower.includes('keterangan'))) {
      dataStarted = true;
      continue;
    }
    if (!dataStarted) continue;

    // BCA has two CSV flavors:
    //   Old: entire row wrapped in outer quotes → "01/04/2026,""Desc"",""0000"",""295,000.00 CR"",""303,067,694.37"""
    //   New: standard CSV with per-field quotes → "08/04/2026","Desc","0000","530,000.00 CR","273,148,411.37"
    // Detect: old format contains "",""  (doubled-quote comma doubled-quote)
    const isOldFormat = rawLine.includes('""');
    let cols: string[];
    if (isOldFormat) {
      // Strip outer quotes then parse
      cols = parseCSVLine(stripOuterQuotes(rawLine), ',');
    } else {
      // Standard CSV — parse directly
      cols = parseCSVLine(rawLine, ',');
    }

    // Find date column: look for DD/MM/YYYY pattern in first few columns
    let dateStr = '';
    let dateColIdx = -1;
    for (let ci = 0; ci < Math.min(cols.length, 3); ci++) {
      if (cols[ci].match(/^\d{2}\/\d{2}\/\d{4}$/)) {
        dateStr = cols[ci];
        dateColIdx = ci;
        break;
      }
    }
    if (!dateStr) continue;

    // BCA format: Tanggal, Keterangan, Cabang, Jumlah (with CR/DB), Saldo
    const remaining = cols.slice(dateColIdx + 1);
    if (remaining.length < 3) continue;

    const desc = remaining[0] || '';
    let amountRaw = '';
    let balanceRaw = '';

    // Find the amount cell (has CR or DB suffix)
    for (let ri = 1; ri < remaining.length; ri++) {
      const cell = remaining[ri].trim().toUpperCase();
      if (cell.endsWith('CR') || cell.endsWith('DB')) {
        amountRaw  = remaining[ri].trim();
        balanceRaw = remaining[ri + 1] || '';
        break;
      }
    }

    if (!amountRaw) continue;

    const date = parseDMY(dateStr);
    const amountClean = amountRaw.trim();
    const isCredit = amountClean.toUpperCase().endsWith('CR');
    const isDebit  = amountClean.toUpperCase().endsWith('DB');
    const amount   = parseNum(amountClean.replace(/\s*(CR|DB)$/i, ''));
    const balance  = parseNum(balanceRaw);

    transactions.push({
      transaction_date: date,
      transaction_time: null,
      description: desc.trim(),
      credit_amount: isCredit ? amount : 0,
      debit_amount:  isDebit  ? amount : 0,
      running_balance: balance || null,
    });
  }

  // Derive period from transactions if not found in header
  if (!periodStart && transactions.length > 0) {
    const dates = transactions.map(t => t.transaction_date).sort();
    periodStart = dates[0];
    periodEnd   = dates[dates.length - 1];
  }

  return {
    bank: 'BCA',
    account_no: accountNo,
    period_label: periodLabelFromDate(periodStart || new Date().toISOString().slice(0, 10)),
    period_start: periodStart,
    period_end:   periodEnd,
    opening_balance: openingBalance,
    closing_balance: closingBalance,
    transactions,
  };
}

// ── BRI Parser ──
function parseBRI(text: string): ParseResult {
  const normalized = normalizeText(text);
  const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('File BRI kosong atau tidak valid');

  const headerCols = parseCSVLine(lines[0]).map(h => h.toUpperCase().trim());
  const idxDate    = headerCols.indexOf('TGL_TRAN');
  const idxDesk    = headerCols.indexOf('REMARK_CUSTOM');
  const idxDebet   = headerCols.indexOf('MUTASI_DEBET');
  const idxKredit  = headerCols.indexOf('MUTASI_KREDIT');
  const idxSaldo   = headerCols.indexOf('SALDO_AKHIR_MUTASI');
  const idxSaldoAw = headerCols.indexOf('SALDO_AWAL_MUTASI');
  const idxNorek   = headerCols.indexOf('NOREK');

  if (idxDate < 0 || idxDebet < 0 || idxKredit < 0) throw new Error('Format BRI tidak dikenali');

  const transactions: ParsedTransaction[] = [];
  let accountNo = '';

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (!cols[idxDate]) continue;

    const rawDate = cols[idxDate].trim();            // "2026-04-01 08:54:00"
    const dateTime = rawDate.split(' ');
    const date = dateTime[0];                         // "2026-04-01"
    const time = dateTime[1] ? dateTime[1].slice(0, 5) : null; // "08:54"

    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

    if (!accountNo && idxNorek >= 0) accountNo = (cols[idxNorek] || '').replace(/"/g, '').trim();

    const credit  = parseNum(cols[idxKredit] || '0');
    const debit   = parseNum(cols[idxDebet]  || '0');
    const balance = idxSaldo >= 0 ? parseNum(cols[idxSaldo] || '0') : null;
    const desc    = idxDesk >= 0 ? (cols[idxDesk] || '').replace(/"/g, '').trim() : (cols[6] || '').trim();

    transactions.push({ transaction_date: date, transaction_time: time, description: desc, credit_amount: credit, debit_amount: debit, running_balance: balance });
  }

  const dates = transactions.map(t => t.transaction_date).sort();
  const periodStart = dates[0] || '';
  const periodEnd   = dates[dates.length - 1] || '';

  // Opening balance: saldo_awal of first row
  let openingBalance: number | null = null;
  if (lines.length >= 2 && idxSaldoAw >= 0) {
    const firstCols = parseCSVLine(lines[1]);
    openingBalance = parseNum(firstCols[idxSaldoAw] || '0');
  }
  const closingBalance = transactions.length > 0 ? transactions[transactions.length - 1].running_balance : null;

  return {
    bank: 'BRI',
    account_no: accountNo,
    period_label: periodLabelFromDate(periodStart || new Date().toISOString().slice(0, 10)),
    period_start: periodStart,
    period_end:   periodEnd,
    opening_balance: openingBalance,
    closing_balance: closingBalance,
    transactions,
  };
}

// ── Mandiri Parser ──
function parseMandiri(text: string): ParseResult {
  const normalized = normalizeText(text);
  const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('File Mandiri kosong atau tidak valid');

  // Detect delimiter: Mandiri usually uses ; but may vary
  const firstLine = lines[0];
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount     = (firstLine.match(/,/g) || []).length;
  const delim = semicolonCount >= commaCount ? ';' : ',';

  // Parse header — normalize: lowercase, trim, remove quotes
  const rawHeader = firstLine.split(delim).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase().trim());

  // Flexible column matching
  const findCol = (keywords: string[], excludes: string[] = []): number => {
    return rawHeader.findIndex(h => {
      const normalized = h.replace(/\s+/g, '').replace(/_/g, '');
      const matches = keywords.some(kw => normalized.includes(kw.toLowerCase().replace(/\s+/g, '')));
      const excluded = excludes.some(ex => normalized.includes(ex.toLowerCase().replace(/\s+/g, '')));
      return matches && !excluded;
    });
  };

  const idxDate   = findCol(['postdate', 'post date', 'tanggal', 'date', 'tgl']);
  const idxRemark = findCol(['remarks', 'keterangan', 'description', 'ket'], ['additional']);
  const idxCredit = findCol(['creditamount', 'credit', 'kredit', 'masuk', 'cr']);
  const idxDebit  = findCol(['debitamount', 'debit', 'debet', 'keluar', 'db']);
  const idxBal    = findCol(['balance', 'closebalance', 'saldo', 'close']);
  const idxAcct   = findCol(['account', 'rekening', 'norek']);

  console.log('[Mandiri] header cols:', rawHeader);
  console.log('[Mandiri] col indices → date:', idxDate, 'remark:', idxRemark, 'credit:', idxCredit, 'debit:', idxDebit, 'bal:', idxBal);

  if (idxDate < 0 || idxCredit < 0 || idxDebit < 0) {
    throw new Error(`Format Mandiri tidak dikenali. Header: ${rawHeader.slice(0, 8).join(' | ')}`);
  }

  const transactions: ParsedTransaction[] = [];
  let accountNo = '';

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim).map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length <= idxDate || !cols[idxDate]) continue;

    const rawDate = cols[idxDate];
    // Handles multiple date formats:
    //   "DD/MM/YYYY HH:MM"           → parseDMY
    //   "YYYY-MM-DD HH:MM:SS"        → ISO
    //   "08 April 2026 06:27:31"     → parseLongDate
    let date = '';
    let time: string | null = null;
    if (rawDate.match(/^\d{2}\/\d{2}\/\d{4}/)) {
      const parts = rawDate.split(' ');
      date = parseDMY(parts[0]);
      time = parts[1] ? parts[1].slice(0, 5) : null;
    } else if (rawDate.match(/^\d{4}-\d{2}-\d{2}/)) {
      const parts = rawDate.split(' ');
      date = parts[0];
      time = parts[1] ? parts[1].slice(0, 5) : null;
    } else {
      // Try "DD Month YYYY HH:MM:SS" format
      const longParsed = parseLongDate(rawDate);
      if (longParsed) {
        date = longParsed.date;
        time = longParsed.time;
      } else {
        continue;
      }
    }

    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

    if (!accountNo && idxAcct >= 0 && cols[idxAcct]) {
      accountNo = cols[idxAcct].replace(/,/g, '').trim();
    }

    const credit  = parseNum(cols[idxCredit] || '0');
    const debit   = parseNum(cols[idxDebit]  || '0');
    const balance = idxBal >= 0 ? parseNum(cols[idxBal] || '0') : null;
    const desc    = idxRemark >= 0 ? (cols[idxRemark] || '').trim() : '';

    transactions.push({ transaction_date: date, transaction_time: time, description: desc, credit_amount: credit, debit_amount: debit, running_balance: balance || null });
  }

  const dates = transactions.map(t => t.transaction_date).sort();
  const periodStart = dates[0] || '';
  const periodEnd   = dates[dates.length - 1] || '';

  // Opening balance from first row: closeBalance - credit + debit
  let openingBalance: number | null = null;
  if (transactions.length > 0 && transactions[0].running_balance !== null) {
    const first = transactions[0];
    openingBalance = (first.running_balance ?? 0) - first.credit_amount + first.debit_amount;
  }
  const closingBalance = transactions.length > 0 ? transactions[transactions.length - 1].running_balance : null;

  return {
    bank: 'MANDIRI',
    account_no: accountNo,
    period_label: periodLabelFromDate(periodStart || new Date().toISOString().slice(0, 10)),
    period_start: periodStart,
    period_end:   periodEnd,
    opening_balance: openingBalance,
    closing_balance: closingBalance,
    transactions,
  };
}

// ── Auto-detect bank format from file content ──
function detectBank(text: string): Bank {
  const normalized = normalizeText(text);
  const first600 = normalized.slice(0, 600).toLowerCase();

  // BCA: has "no. rekening" or "informasi rekening" header
  if (first600.includes('no. rekening') || first600.includes('no.rekening') || first600.includes('informasi rekening')) return 'BCA';
  // BRI: has uppercase column names characteristic of BRI export
  if (normalized.slice(0, 600).includes('MUTASI_DEBET') || normalized.slice(0, 600).includes('MUTASI_KREDIT')) return 'BRI';
  if (normalized.slice(0, 600).includes('TGL_TRAN') || normalized.slice(0, 600).includes('NOREK')) return 'BRI';
  // Mandiri: semicolon-delimited with credit/debit/balance columns
  const semicolons = (first600.match(/;/g) || []).length;
  if (semicolons > 3) return 'MANDIRI';
  if (first600.includes('credit') || first600.includes('postdate') || first600.includes('post date')) return 'MANDIRI';
  // Default BCA
  return 'BCA';
}

// ── Route handler ──
export async function POST(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'bank-csv-upload',
      20,
      10 * 60 * 1000,
      'Terlalu banyak upload bank statement. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    let uploadedById: string | null = null;
    try {
      const { profile } = await requireDashboardPermissionAccess('admin:financial', 'Admin Financial');
      uploadedById = profile.id;
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const text = await file.text();
    if (!text.trim()) return NextResponse.json({ error: 'File kosong' }, { status: 400 });

    // Detect bank
    const bank = detectBank(text);

    // Parse
    let parsed: ParseResult;
    if (bank === 'BCA')     parsed = parseBCA(text);
    else if (bank === 'BRI') parsed = parseBRI(text);
    else                    parsed = parseMandiri(text);

    if (parsed.transactions.length === 0) {
      // Return debug info so we can diagnose the issue
      const normalized = normalizeText(text);
      const allLines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
      return NextResponse.json({
        error: 'Tidak ada transaksi yang berhasil dibaca dari file ini',
        debug: {
          detectedBank: bank,
          totalLines: allLines.length,
          firstLines: allLines.slice(0, 5).map(l => l.slice(0, 200)),
          charCode0: text.charCodeAt(0),
          hasBOM: text.charCodeAt(0) === 0xFEFF,
        }
      }, { status: 422 });
    }

    // Compute totals
    const totalCredit = parsed.transactions.reduce((s, t) => s + t.credit_amount, 0);
    const totalDebit  = parsed.transactions.reduce((s, t) => s + t.debit_amount,  0);

    const supabase = getServiceSupabase();

    // Upsert session (delete old transactions for this bank+period first)
    const { data: session, error: sessionErr } = await supabase
      .from('bank_upload_sessions')
      .upsert({
        bank:              parsed.bank,
        period_label:      parsed.period_label,
        period_start:      parsed.period_start || null,
        period_end:        parsed.period_end   || null,
        account_no:        parsed.account_no   || 'UNKNOWN',
        opening_balance:   parsed.opening_balance,
        closing_balance:   parsed.closing_balance,
        total_credit:      totalCredit,
        total_debit:       totalDebit,
        transaction_count: parsed.transactions.length,
        uploaded_at:       new Date().toISOString(),
        uploaded_by:       uploadedById,
      }, { onConflict: 'bank,account_no,period_label' })
      .select('id')
      .single();

    if (sessionErr) return NextResponse.json({ error: sessionErr.message }, { status: 500 });

    const sessionId = session.id;

    // Delete existing transactions for this session
    await supabase.from('bank_transactions').delete().eq('session_id', sessionId);

    // Batch insert (500 rows at a time) — auto-tag each transaction
    const rows = parsed.transactions.map(t => {
      const tag = classifyTransaction(t.description, t.credit_amount, t.debit_amount);
      return {
        session_id:       sessionId,
        bank:             parsed.bank,
        period_label:     parsed.period_label,
        account_no:       parsed.account_no || 'UNKNOWN',
        transaction_date: t.transaction_date,
        transaction_time: t.transaction_time,
        description:      t.description,
        credit_amount:    t.credit_amount,
        debit_amount:     t.debit_amount,
        running_balance:  t.running_balance,
        tag,
        tag_auto:         tag,
      };
    });

    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await supabase.from('bank_transactions').insert(rows.slice(i, i + BATCH));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success:       true,
      bank:          parsed.bank,
      account_no:    parsed.account_no || 'UNKNOWN',
      period_label:  parsed.period_label,
      inserted:      parsed.transactions.length,
      total_credit:  totalCredit,
      total_debit:   totalDebit,
      opening_balance: parsed.opening_balance,
      closing_balance: parsed.closing_balance,
    });
  } catch (e: any) {
    console.error('[bank-csv-upload]', e);
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}

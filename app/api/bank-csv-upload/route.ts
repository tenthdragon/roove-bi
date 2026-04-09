// app/api/bank-csv-upload/route.ts
// Parses bank statement CSVs (BCA / BRI / Mandiri) and saves to Supabase
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

// Period label from date: "APRIL 2026"
const MONTH_NAMES = ['', 'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
  'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];

function periodLabelFromDate(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  return `${MONTH_NAMES[m]} ${y}`;
}

// ── BCA Parser ──
function parseBCA(text: string): ParseResult {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let accountNo = '';
  let periodStart = '';
  let periodEnd = '';
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;
  const transactions: ParsedTransaction[] = [];
  let dataStarted = false;

  for (const rawLine of lines) {
    // Extract account number
    if (rawLine.includes('No. rekening')) {
      const m = rawLine.match(/:\s*([\d]+)/);
      if (m) accountNo = m[1];
      continue;
    }
    // Extract period
    if (rawLine.includes('Periode')) {
      const m = rawLine.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
      if (m) {
        periodStart = parseDMY(m[1]);
        periodEnd   = parseDMY(m[2]);
      }
      continue;
    }

    // Summary lines at bottom
    if (rawLine.startsWith('Saldo Awal')) {
      const m = rawLine.match(/([\d,]+\.[\d]+)/);
      if (m) openingBalance = parseNum(m[1]);
      continue;
    }
    if (rawLine.startsWith('Saldo Akhir')) {
      const m = rawLine.match(/([\d,]+\.[\d]+)/);
      if (m) closingBalance = parseNum(m[1]);
      continue;
    }
    if (rawLine.startsWith('Mutasi Debet') || rawLine.startsWith('Mutasi Kredit')) continue;

    // Data header row
    if (rawLine.includes('Tanggal Transaksi')) { dataStarted = true; continue; }
    if (!dataStarted) continue;

    // Each BCA data line is wrapped in outer quotes
    const inner = stripOuterQuotes(rawLine);
    const cols = parseCSVLine(inner, ',');
    if (cols.length < 5) continue;

    const [dateStr, desc, , amountRaw, balanceRaw] = cols;
    if (!dateStr || !dateStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) continue;

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
      running_balance: balance,
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
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('File BRI kosong atau tidak valid');

  const headerCols = parseCSVLine(lines[0]).map(h => h.toUpperCase());
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

    // Opening balance from first row
    if (i === 1 && idxSaldoAw >= 0) {
      // Will compute from first row's saldo_awal later
    }

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
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('File Mandiri kosong atau tidak valid');

  // Mandiri uses semicolon delimiter
  const headerCols = lines[0].split(';').map(h => h.trim().toLowerCase());
  const idxDate   = headerCols.findIndex(h => h.includes('postdate') || h.includes('date'));
  const idxRemark = headerCols.findIndex(h => h.includes('remarks') && !h.includes('additional'));
  const idxCredit = headerCols.findIndex(h => h.includes('credit'));
  const idxDebit  = headerCols.findIndex(h => h.includes('debit'));
  const idxBal    = headerCols.findIndex(h => h.includes('balance') || h.includes('close'));
  const idxAcct   = headerCols.findIndex(h => h.includes('account'));

  if (idxDate < 0 || idxCredit < 0 || idxDebit < 0) throw new Error('Format Mandiri tidak dikenali');

  const transactions: ParsedTransaction[] = [];
  let accountNo = '';

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';').map(c => c.trim());
    if (!cols[idxDate]) continue;

    const rawDate = cols[idxDate];  // "01/04/2026 03:49"
    const parts   = rawDate.split(' ');
    const date    = parseDMY(parts[0]);
    const time    = parts[1] ? parts[1].slice(0, 5) : null;

    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

    if (!accountNo && idxAcct >= 0) accountNo = cols[idxAcct].replace(/,/g, '').trim();

    const credit  = parseNum(cols[idxCredit] || '0');
    const debit   = parseNum(cols[idxDebit]  || '0');
    const balance = idxBal >= 0 ? parseNum(cols[idxBal] || '0') : null;
    const desc    = idxRemark >= 0 ? cols[idxRemark].trim() : '';

    transactions.push({ transaction_date: date, transaction_time: time, description: desc, credit_amount: credit, debit_amount: debit, running_balance: balance });
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
  const first500 = text.slice(0, 500);
  if (first500.includes('No. rekening') || first500.includes('Informasi Rekening')) return 'BCA';
  if (first500.includes('MUTASI_DEBET') || first500.includes('MUTASI_KREDIT')) return 'BRI';
  if (first500.includes(';') && first500.toLowerCase().includes('credit amount')) return 'MANDIRI';
  // fallback: count semicolons vs commas
  const semicolons = (first500.match(/;/g) || []).length;
  if (semicolons > 5) return 'MANDIRI';
  if (first500.includes('NOREK') || first500.includes('TGL_TRAN')) return 'BRI';
  return 'BCA';
}

// ── Route handler ──
export async function POST(req: NextRequest) {
  try {
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
      return NextResponse.json({ error: 'Tidak ada transaksi yang berhasil dibaca dari file ini' }, { status: 422 });
    }

    // Compute totals
    const totalCredit = parsed.transactions.reduce((s, t) => s + t.credit_amount, 0);
    const totalDebit  = parsed.transactions.reduce((s, t) => s + t.debit_amount,  0);

    const supabase = getServiceSupabase();

    // Get current user from Authorization header
    const authHeader = req.headers.get('Authorization') || '';
    let userId: string | null = null;
    if (authHeader.startsWith('Bearer ')) {
      const userSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { data } = await userSupabase.auth.getUser(authHeader.replace('Bearer ', ''));
      userId = data.user?.id ?? null;
    }

    // Upsert session (delete old transactions for this bank+period first)
    const { data: session, error: sessionErr } = await supabase
      .from('bank_upload_sessions')
      .upsert({
        bank:              parsed.bank,
        period_label:      parsed.period_label,
        period_start:      parsed.period_start || null,
        period_end:        parsed.period_end   || null,
        account_no:        parsed.account_no   || null,
        opening_balance:   parsed.opening_balance,
        closing_balance:   parsed.closing_balance,
        total_credit:      totalCredit,
        total_debit:       totalDebit,
        transaction_count: parsed.transactions.length,
        uploaded_at:       new Date().toISOString(),
        uploaded_by:       userId,
      }, { onConflict: 'bank,period_label' })
      .select('id')
      .single();

    if (sessionErr) return NextResponse.json({ error: sessionErr.message }, { status: 500 });

    const sessionId = session.id;

    // Delete existing transactions for this session
    await supabase.from('bank_transactions').delete().eq('session_id', sessionId);

    // Batch insert (500 rows at a time)
    const rows = parsed.transactions.map(t => ({
      session_id:       sessionId,
      bank:             parsed.bank,
      period_label:     parsed.period_label,
      transaction_date: t.transaction_date,
      transaction_time: t.transaction_time,
      description:      t.description,
      credit_amount:    t.credit_amount,
      debit_amount:     t.debit_amount,
      running_balance:  t.running_balance,
    }));

    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await supabase.from('bank_transactions').insert(rows.slice(i, i + BATCH));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success:       true,
      bank:          parsed.bank,
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

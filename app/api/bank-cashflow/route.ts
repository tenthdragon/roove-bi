// app/api/bank-cashflow/route.ts
// Returns aggregated bank cash flow data from Supabase
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// GET /api/bank-cashflow?period=APRIL+2026
// GET /api/bank-cashflow?period=APRIL+2026&page=1&limit=50&bank=BCA&type=CR
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const period = url.searchParams.get('period') || null;
  const page   = parseInt(url.searchParams.get('page') || '1', 10);
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
  const bankFilter = url.searchParams.get('bank') || null;
  const typeFilter = url.searchParams.get('type') || null; // 'CR' | 'DB' | null
  const offset = (page - 1) * limit;

  const supabase = getServiceSupabase();

  // ── 1. Available periods ──
  const { data: sessions, error: sessErr } = await supabase
    .from('bank_upload_sessions')
    .select('id, bank, period_label, period_start, period_end, account_no, opening_balance, closing_balance, total_credit, total_debit, transaction_count, uploaded_at')
    .order('period_start', { ascending: false });

  if (sessErr) return NextResponse.json({ error: sessErr.message }, { status: 500 });

  const allPeriods = [...new Set((sessions ?? []).map((s: any) => s.period_label))];

  // Use requested period or default to the most recent
  const activePeriod = period || allPeriods[0] || null;

  if (!activePeriod) {
    return NextResponse.json({
      periods: [],
      currentPeriod: null,
      sessions: [],
      dailyData: [],
      transactions: [],
      total: 0,
      page,
      limit,
    });
  }

  const periodSessions = (sessions ?? []).filter((s: any) => s.period_label === activePeriod);

  // ── 2. Daily aggregated data ──
  let dailyQuery = supabase
    .from('bank_transactions')
    .select('transaction_date, bank, credit_amount, debit_amount')
    .eq('period_label', activePeriod)
    .order('transaction_date', { ascending: true });

  if (bankFilter) dailyQuery = dailyQuery.eq('bank', bankFilter);

  const { data: allTxn, error: txnErr } = await dailyQuery;
  if (txnErr) return NextResponse.json({ error: txnErr.message }, { status: 500 });

  // Group by date → bank
  const dailyMap: Record<string, Record<string, { credit: number; debit: number }>> = {};
  const BANKS = ['BCA', 'BRI', 'MANDIRI'];
  for (const t of (allTxn ?? [])) {
    if (!dailyMap[t.transaction_date]) {
      const blank: Record<string, { credit: number; debit: number }> = {};
      BANKS.forEach(b => { blank[b] = { credit: 0, debit: 0 }; });
      dailyMap[t.transaction_date] = blank;
    }
    dailyMap[t.transaction_date][t.bank].credit += parseFloat(t.credit_amount) || 0;
    dailyMap[t.transaction_date][t.bank].debit  += parseFloat(t.debit_amount)  || 0;
  }

  const dailyData = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, banks]) => ({
      date,
      ...banks,
      total_credit: BANKS.reduce((s, b) => s + banks[b].credit, 0),
      total_debit:  BANKS.reduce((s, b) => s + banks[b].debit,  0),
    }));

  // ── 3. Paginated transaction list ──
  let listQuery = supabase
    .from('bank_transactions')
    .select('transaction_date, transaction_time, bank, description, credit_amount, debit_amount, running_balance', { count: 'exact' })
    .eq('period_label', activePeriod)
    .order('transaction_date', { ascending: true })
    .order('transaction_time', { ascending: true })
    .range(offset, offset + limit - 1);

  if (bankFilter) listQuery = listQuery.eq('bank', bankFilter);
  if (typeFilter === 'CR') listQuery = listQuery.gt('credit_amount', 0);
  if (typeFilter === 'DB') listQuery = listQuery.gt('debit_amount',  0);

  const { data: txList, count, error: listErr } = await listQuery;
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });

  return NextResponse.json({
    periods:       allPeriods,
    currentPeriod: activePeriod,
    sessions:      periodSessions,
    dailyData,
    transactions:  txList ?? [],
    total:         count ?? 0,
    page,
    limit,
  });
}

// DELETE /api/bank-cashflow?bank=BCA&period=APRIL+2026
export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const bank   = url.searchParams.get('bank');
  const period = url.searchParams.get('period');
  if (!bank || !period) return NextResponse.json({ error: 'bank dan period diperlukan' }, { status: 400 });

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('bank_upload_sessions')
    .delete()
    .eq('bank', bank)
    .eq('period_label', period);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

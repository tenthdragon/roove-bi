// app/api/bank-cashflow/route.ts
// Returns aggregated bank cash flow data from Supabase
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDashboardTabAccess } from '@/lib/dashboard-access';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// GET /api/bank-cashflow?period=APRIL+2026
// GET /api/bank-cashflow?period=APRIL+2026&bank=BCA&type=CR&accounts=123,456&business=RTI
export async function GET(req: NextRequest) {
  try {
    await requireDashboardTabAccess('cashflow', 'Cash Flow');

    const url = new URL(req.url);
    const period = url.searchParams.get('period') || null;
    const page   = parseInt(url.searchParams.get('page') || '1', 10);
    const limit  = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
    const bankFilter    = url.searchParams.get('bank') || null;
    const typeFilter    = url.searchParams.get('type') || null;
    const tagFilter     = url.searchParams.get('tag') || null;
    const accountFilter = url.searchParams.get('account') || null;
    const accountsCSV   = url.searchParams.get('accounts') || null;
    const businessName  = url.searchParams.get('business') || null;
    const offset = (page - 1) * limit;

    const supabase = getServiceSupabase();

    let accountNos: string[] | null = null;

    if (businessName) {
      const { data: bizAccounts } = await supabase
        .from('bank_accounts')
        .select('account_no')
        .eq('business_name', businessName);
      accountNos = (bizAccounts ?? []).map((a: any) => a.account_no);
      if (accountNos.length === 0) accountNos = ['__NONE__'];
    } else if (accountsCSV) {
      accountNos = accountsCSV.split(',').map(a => a.trim()).filter(Boolean);
    } else if (accountFilter) {
      accountNos = [accountFilter];
    }

    const { data: sessions, error: sessErr } = await supabase
      .from('bank_upload_sessions')
      .select('id, bank, period_label, period_start, period_end, account_no, opening_balance, closing_balance, total_credit, total_debit, transaction_count, uploaded_at')
      .order('period_start', { ascending: false });

    if (sessErr) return NextResponse.json({ error: sessErr.message }, { status: 500 });

    let scopedSessions = sessions ?? [];
    if (accountNos) scopedSessions = scopedSessions.filter((s: any) => accountNos!.includes(s.account_no));
    if (bankFilter) scopedSessions = scopedSessions.filter((s: any) => s.bank === bankFilter);

    const allPeriods = Array.from(new Set(scopedSessions.map((s: any) => s.period_label)));
    const activePeriod = period || allPeriods[0] || null;

    if (!activePeriod) {
      return NextResponse.json({
        periods: [], currentPeriod: null, sessions: [], dailyData: [],
        transactions: [], total: 0, page, limit,
      });
    }

    const periodSessions = scopedSessions.filter((s: any) => s.period_label === activePeriod);

    let dailyQuery = supabase
      .from('bank_transactions')
      .select('transaction_date, bank, account_no, credit_amount, debit_amount')
      .eq('period_label', activePeriod)
      .order('transaction_date', { ascending: true });

    if (bankFilter) dailyQuery = dailyQuery.eq('bank', bankFilter);
    if (accountNos) dailyQuery = dailyQuery.in('account_no', accountNos);

    const { data: allTxn, error: txnErr } = await dailyQuery;
    if (txnErr) return NextResponse.json({ error: txnErr.message }, { status: 500 });

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

    let listQuery = supabase
      .from('bank_transactions')
      .select('id, transaction_date, transaction_time, bank, account_no, description, credit_amount, debit_amount, running_balance, tag, tag_auto', { count: 'exact' })
      .eq('period_label', activePeriod)
      .order('transaction_date', { ascending: true })
      .order('transaction_time', { ascending: true })
      .range(offset, offset + limit - 1);

    if (bankFilter) listQuery = listQuery.eq('bank', bankFilter);
    if (accountNos) listQuery = listQuery.in('account_no', accountNos);
    if (typeFilter === 'CR') listQuery = listQuery.gt('credit_amount', 0);
    if (typeFilter === 'DB') listQuery = listQuery.gt('debit_amount',  0);
    if (tagFilter) listQuery = listQuery.eq('tag', tagFilter);

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
  } catch (e: any) {
    const status = e?.message?.includes('login') ? 401 : 403;
    return NextResponse.json({ error: e?.message || 'Akses ditolak.' }, { status });
  }
}

// DELETE /api/bank-cashflow?bank=BCA&period=APRIL+2026&account=1234567890
export async function DELETE(req: NextRequest) {
  try {
    await requireDashboardTabAccess('cashflow', 'Cash Flow');

    const url = new URL(req.url);
    const bank    = url.searchParams.get('bank');
    const period  = url.searchParams.get('period');
    const account = url.searchParams.get('account');
    if (!bank || !period) return NextResponse.json({ error: 'bank dan period diperlukan' }, { status: 400 });

    const supabase = getServiceSupabase();

    let query = supabase
      .from('bank_upload_sessions')
      .delete()
      .eq('bank', bank)
      .eq('period_label', period);

    if (account) query = query.eq('account_no', account);

    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    const status = e?.message?.includes('login') ? 401 : 403;
    return NextResponse.json({ error: e?.message || 'Akses ditolak.' }, { status });
  }
}

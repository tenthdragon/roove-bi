// app/api/bank-transactions/route.ts
// PATCH — update transaction tag (manual override)
// POST  — retag all existing transactions with auto-classifier
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDashboardTabAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { createServerSupabase } from '@/lib/supabase-server';
import { classifyTransaction } from '@/lib/transaction-tagger';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function PATCH(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'bank-transactions-write',
      40,
      10 * 60 * 1000,
      'Terlalu banyak perubahan transaksi bank. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    await requireDashboardTabAccess('cashflow', 'Cash Flow');

    const body = await req.json();
    const { id, tag } = body;
    if (!id || !tag) return NextResponse.json({ error: 'id dan tag diperlukan' }, { status: 400 });

    const validTags = ['customer', 'supplier', 'intercompany', 'operasional', 'biaya_bank', 'marketplace', 'refund', 'auto_debit', 'n/a'];
    if (!validTags.includes(tag)) {
      return NextResponse.json({ error: `Tag tidak valid: ${tag}` }, { status: 400 });
    }

    const authSupabase = createServerSupabase();
    const { data: { user } } = await authSupabase.auth.getUser();

    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('bank_transactions')
      .update({
        tag,
        tag_updated_at: new Date().toISOString(),
        tag_updated_by: user?.id ?? null,
      })
      .eq('id', id)
      .select('id, tag, tag_auto, tag_updated_at')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ transaction: data });
  } catch (e: any) {
    const status = e?.message?.includes('login') ? 401 : 403;
    return NextResponse.json({ error: e?.message || 'Akses ditolak.' }, { status });
  }
}

// POST /api/bank-transactions — retag all untagged (or all) transactions
export async function POST(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'bank-transactions-retag',
      6,
      10 * 60 * 1000,
      'Terlalu banyak permintaan retag transaksi. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    await requireDashboardTabAccess('cashflow', 'Cash Flow');

    const body = await req.json().catch(() => ({}));
    const forceAll = body.force === true; // retag even manually-overridden ones

    const supabase = getServiceSupabase();

    // Fetch all transactions (only those not manually overridden, unless force)
    let query = supabase
      .from('bank_transactions')
      .select('id, description, credit_amount, debit_amount, tag, tag_updated_at');

    if (!forceAll) {
      // Only retag transactions that haven't been manually changed
      query = query.is('tag_updated_at', null);
    }

    const { data: txns, error: fetchErr } = await query;
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!txns || txns.length === 0) return NextResponse.json({ updated: 0, message: 'Tidak ada transaksi untuk di-retag' });

    // Classify each and batch update
    let updated = 0;
    const BATCH = 100;
    for (let i = 0; i < txns.length; i += BATCH) {
      const batch = txns.slice(i, i + BATCH);
      for (const t of batch) {
        const newTag = classifyTransaction(
          t.description || '',
          parseFloat(t.credit_amount) || 0,
          parseFloat(t.debit_amount) || 0,
        );
        if (newTag !== t.tag) {
          const { error } = await supabase
            .from('bank_transactions')
            .update({ tag: newTag, tag_auto: newTag })
            .eq('id', t.id);
          if (!error) updated++;
        }
      }
    }

    return NextResponse.json({ updated, total: txns.length, message: `${updated} transaksi di-retag dari ${txns.length} total` });
  } catch (e: any) {
    const status = e?.message?.includes('login') ? 401 : 403;
    return NextResponse.json({ error: e?.message || 'Akses ditolak.' }, { status });
  }
}

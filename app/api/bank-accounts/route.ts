// app/api/bank-accounts/route.ts
// CRUD untuk daftar rekening bank per bisnis
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAnyDashboardTabAccess, requireDashboardTabAccess } from '@/lib/dashboard-access';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// GET — ambil semua rekening
export async function GET() {
  try {
    await requireAnyDashboardTabAccess(['cashflow', 'financial-settings'], 'rekening bank');

    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('bank_accounts')
      .select('*')
      .order('business_name', { ascending: true })
      .order('bank', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ accounts: data ?? [] });
  } catch (e: any) {
    const status = e?.message?.includes('login') ? 401 : 403;
    return NextResponse.json({ error: e?.message || 'Akses ditolak.' }, { status });
  }
}

// POST — tambah rekening baru
export async function POST(req: NextRequest) {
  try {
    await requireDashboardTabAccess('financial-settings', 'Financial Settings');

    const body = await req.json();
    const { bank, account_no, account_name, business_name, description, is_active } = body;

    if (!bank || !account_no || !account_name || !business_name) {
      return NextResponse.json({ error: 'Field bank, account_no, account_name, business_name wajib diisi' }, { status: 400 });
    }

    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('bank_accounts')
      .insert({ bank, account_no: account_no.trim(), account_name: account_name.trim(), business_name: business_name.trim(), description: description?.trim() || null, is_active: is_active ?? true })
      .select('*')
      .single();

    if (error) {
      const msg = error.code === '23505' ? 'Nomor rekening ini sudah terdaftar untuk bank yang sama' : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ account: data });
  } catch (e: any) {
    const status = e?.message?.includes('login') ? 401 : 403;
    return NextResponse.json({ error: e?.message || 'Akses ditolak.' }, { status });
  }
}

// PATCH — edit rekening
export async function PATCH(req: NextRequest) {
  try {
    await requireDashboardTabAccess('financial-settings', 'Financial Settings');

    const body = await req.json();
    const { id, ...fields } = body;
    if (!id) return NextResponse.json({ error: 'id diperlukan' }, { status: 400 });

    const update: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      update[k] = typeof v === 'string' ? v.trim() : v;
    }

    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('bank_accounts')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      const msg = error.code === '23505' ? 'Nomor rekening ini sudah terdaftar untuk bank yang sama' : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ account: data });
  } catch (e: any) {
    const status = e?.message?.includes('login') ? 401 : 403;
    return NextResponse.json({ error: e?.message || 'Akses ditolak.' }, { status });
  }
}

// DELETE — hapus rekening
export async function DELETE(req: NextRequest) {
  try {
    await requireDashboardTabAccess('financial-settings', 'Financial Settings');

    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id diperlukan' }, { status: 400 });

    const supabase = getServiceSupabase();
    const { error } = await supabase.from('bank_accounts').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    const status = e?.message?.includes('login') ? 401 : 403;
    return NextResponse.json({ error: e?.message || 'Akses ditolak.' }, { status });
  }
}

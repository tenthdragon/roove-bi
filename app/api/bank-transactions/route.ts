// app/api/bank-transactions/route.ts
// PATCH — update transaction tag (manual override)
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, tag } = body;
  if (!id || !tag) return NextResponse.json({ error: 'id dan tag diperlukan' }, { status: 400 });

  const validTags = ['customer', 'intercompany', 'operasional', 'biaya_bank', 'marketplace', 'refund', 'auto_debit', 'n/a'];
  if (!validTags.includes(tag)) {
    return NextResponse.json({ error: `Tag tidak valid: ${tag}` }, { status: 400 });
  }

  // Get user from auth header
  let userId: string | null = null;
  const authHeader = req.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const userSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data } = await userSupabase.auth.getUser(authHeader.replace('Bearer ', ''));
    userId = data.user?.id ?? null;
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('bank_transactions')
    .update({
      tag,
      tag_updated_at: new Date().toISOString(),
      tag_updated_by: userId,
    })
    .eq('id', id)
    .select('id, tag, tag_auto, tag_updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ transaction: data });
}

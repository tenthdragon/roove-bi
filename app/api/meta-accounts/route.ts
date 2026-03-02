import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const META_API_VERSION = 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

interface MetaAdAccountRaw {
  id: string;       // "act_xxx"
  name: string;
  account_status: number;
  currency: string;
}

/**
 * GET /api/meta-accounts
 * Fetches all ad accounts accessible by the configured Meta access token.
 * Returns them merged with already-registered accounts from the database.
 */
export async function GET(req: NextRequest) {
  try {
    // ── Auth: owner or finance only ──
    const { createServerSupabase } = await import('@/lib/supabase-server');
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'owner' && profile?.role !== 'finance') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // ── Fetch from Meta API ──
    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!accessToken) {
      return NextResponse.json({ error: 'META_ACCESS_TOKEN not configured' }, { status: 500 });
    }

    const allAccounts: MetaAdAccountRaw[] = [];
    let url: string | null = `${META_API_BASE}/me/adaccounts?fields=id,name,account_status,currency&limit=100&access_token=${accessToken}`;

    while (url) {
      const response: Response = await fetch(url);
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return NextResponse.json({
          error: err?.error?.message || 'Failed to fetch from Meta API',
        }, { status: 502 });
      }
      const json: any = await response.json();
      if (json.data) allAccounts.push(...json.data);
      url = json.paging?.next || null;
    }

    // ── Fetch already-registered accounts from DB ──
    const svc = getServiceSupabase();
    const { data: registered } = await svc
      .from('meta_ad_accounts')
      .select('account_id, account_name, store, default_source, default_advertiser, is_active');

    const registeredMap = new Map(
      (registered || []).map((r: any) => [r.account_id, r])
    );

    // ── Merge: enrich Meta accounts with DB registration status ──
    const merged = allAccounts.map((acc) => ({
      account_id: acc.id,
      name: acc.name,
      account_status: acc.account_status,
      currency: acc.currency,
      // DB status
      is_registered: registeredMap.has(acc.id),
      registration: registeredMap.get(acc.id) || null,
    }));

    // Sort: registered first, then by name
    merged.sort((a, b) => {
      if (a.is_registered !== b.is_registered) return a.is_registered ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      accounts: merged,
      total: merged.length,
      registered_count: merged.filter((a) => a.is_registered).length,
    });

  } catch (err: any) {
    console.error('[meta-accounts] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

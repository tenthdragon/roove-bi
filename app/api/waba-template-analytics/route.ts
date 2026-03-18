import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchTemplateAnalytics } from '@/lib/meta-whatsapp';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function authenticate(req: NextRequest) {
  const { createServerSupabase } = await import('@/lib/supabase-server');
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated', status: 401 };

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'owner' && profile?.role !== 'finance') {
    return { error: 'Only owners and finance users can access analytics', status: 403 };
  }
  return { user, profile };
}

async function getWabaConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
  if (!accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN or META_ACCESS_TOKEN not configured');

  const svc = getServiceSupabase();
  const { data: accounts, error } = await svc
    .from('waba_accounts')
    .select('waba_id')
    .eq('is_active', true)
    .limit(1);

  if (error) throw error;
  if (!accounts || accounts.length === 0) throw new Error('No active WABA account configured');

  return { wabaId: accounts[0].waba_id, accessToken };
}

/** GET — Fetch template performance analytics */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { wabaId, accessToken } = await getWabaConfig();
    const url = new URL(req.url);
    const templateIds = url.searchParams.get('template_ids')?.split(',').filter(Boolean) || [];
    const start = url.searchParams.get('start') || '';
    const end = url.searchParams.get('end') || '';

    if (templateIds.length === 0) {
      return NextResponse.json({ error: 'template_ids required' }, { status: 400 });
    }
    if (!start || !end) {
      return NextResponse.json({ error: 'start and end date required (YYYY-MM-DD)' }, { status: 400 });
    }

    const result = await fetchTemplateAnalytics(wabaId, accessToken, templateIds, start, end);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[waba-template-analytics] GET error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

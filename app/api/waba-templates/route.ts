import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  listMessageTemplates,
  createMessageTemplate,
  deleteMessageTemplate,
  type CreateTemplatePayload,
} from '@/lib/meta-whatsapp';

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
    return { error: 'Only owners and finance users can manage templates', status: 403 };
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

/** GET — List message templates */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { wabaId, accessToken } = await getWabaConfig();
    const after = new URL(req.url).searchParams.get('after') || undefined;
    const result = await listMessageTemplates(wabaId, accessToken, after);

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[waba-templates] GET error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** POST — Create a message template */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { wabaId, accessToken } = await getWabaConfig();
    const body: CreateTemplatePayload = await req.json();

    if (!body.name || !body.category || !body.language || !body.components) {
      return NextResponse.json({ error: 'Missing required fields: name, category, language, components' }, { status: 400 });
    }

    // Sanitize name: lowercase, underscores only
    body.name = body.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    const result = await createMessageTemplate(wabaId, accessToken, body);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[waba-templates] POST error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** DELETE — Delete a message template */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { wabaId, accessToken } = await getWabaConfig();
    const body = await req.json();

    if (!body.hsm_id || !body.name) {
      return NextResponse.json({ error: 'Missing required fields: hsm_id, name' }, { status: 400 });
    }

    const result = await deleteMessageTemplate(wabaId, accessToken, body.hsm_id, body.name);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[waba-templates] DELETE error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

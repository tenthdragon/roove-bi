import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
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

  if (profile?.role !== 'owner' && profile?.role !== 'finance' && profile?.role !== 'sales_manager') {
    return { error: 'Only owners, finance, and sales managers can manage templates', status: 403 };
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

/** GET — List message templates from DB (synced via /api/waba-template-sync) */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { wabaId } = await getWabaConfig();
    const svc = getServiceSupabase();

    const { data, error } = await svc
      .from('waba_templates')
      .select('id, name, status, category, language, components, is_auto_generated, tags')
      .eq('waba_id', wabaId)
      .is('deleted_at', null)
      .order('name');

    if (error) throw error;

    return NextResponse.json({ data: data || [] });
  } catch (err: any) {
    console.error('[waba-templates] GET error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** POST — Create a message template (write-through: Graph API + DB) */
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

    // Write-through: insert into DB so it appears immediately
    const svc = getServiceSupabase();
    await svc.from('waba_templates').upsert({
      id: result.id,
      waba_id: wabaId,
      name: body.name,
      status: result.status || 'PENDING',
      category: result.category || body.category,
      language: body.language,
      components: body.components,
      is_auto_generated: false,
      synced_at: new Date().toISOString(),
      deleted_at: null,
    }, { onConflict: 'id' }).then(({ error }) => {
      if (error) console.error('[waba-templates] Write-through insert error:', error);
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[waba-templates] POST error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** PATCH — Update template tags */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json();
    if (!body.id || !Array.isArray(body.tags)) {
      return NextResponse.json({ error: 'Missing required fields: id, tags (array)' }, { status: 400 });
    }

    const tags = body.tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean);
    const svc = getServiceSupabase();
    const { error } = await svc
      .from('waba_templates')
      .update({ tags })
      .eq('id', body.id);

    if (error) throw error;

    return NextResponse.json({ success: true, tags });
  } catch (err: any) {
    console.error('[waba-templates] PATCH error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** DELETE — Delete a message template (write-through: Graph API + DB soft-delete) */
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

    // Write-through: soft-delete in DB
    const svc = getServiceSupabase();
    await svc.from('waba_templates')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', body.hsm_id)
      .then(({ error }) => {
        if (error) console.error('[waba-templates] Write-through delete error:', error);
      });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[waba-templates] DELETE error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

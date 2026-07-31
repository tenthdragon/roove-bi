import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import {
  createMessageTemplate,
  deleteMessageTemplate,
  type CreateTemplatePayload,
} from '@/lib/meta-whatsapp';
import { resolveWorkspaceCredential } from '@/lib/workspace-integration-server';

type ActiveWabaAccount = {
  waba_id: string;
  waba_name: string;
};

const SUPABASE_PAGE_SIZE = 1000;

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function requireReadAccess() {
  try {
    const { workspaceId } = await requireDashboardTabAccess('waba-management', 'WABA Management');
    return { workspaceId };
  } catch (err: any) {
    return {
      error: err.message,
      status: /sesi|login/i.test(err.message || '') ? 401 : 403,
    };
  }
}

async function requireManageAccess() {
  try {
    const { workspaceId } = await requireDashboardPermissionAccess('admin:meta', 'Admin Meta');
    return { workspaceId };
  } catch (err: any) {
    return {
      error: err.message,
      status: /sesi|login/i.test(err.message || '') ? 401 : 403,
    };
  }
}

async function getAccessToken(workspaceId: string) {
  return resolveWorkspaceCredential({
    supabase: getServiceSupabase(),
    workspaceId,
    provider: 'whatsapp',
    fallbackEnvKeys: ['WHATSAPP_ACCESS_TOKEN', 'META_ACCESS_TOKEN'],
  });
}

async function getActiveWabaAccounts(workspaceId: string): Promise<ActiveWabaAccount[]> {
  const svc = getServiceSupabase();
  const { data: accounts, error } = await svc
    .from('waba_accounts')
    .select('waba_id, waba_name')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('waba_name');

  if (error) throw error;
  return accounts || [];
}

function resolveTargetWabaId(accounts: ActiveWabaAccount[], requestedWabaId?: string | null) {
  if (requestedWabaId) {
    const matched = accounts.find((account) => account.waba_id === requestedWabaId);
    if (!matched) {
      throw new Error('Selected WABA account is not active or not found');
    }
    return matched.waba_id;
  }

  if (accounts.length === 1) {
    return accounts[0].waba_id;
  }
  if (accounts.length === 0) {
    throw new Error('Belum ada akun WABA aktif di workspace ini.');
  }

  throw new Error('Multiple active WABA accounts configured. Please select a target WABA account.');
}

/** GET — List message templates from DB (synced via /api/waba-template-sync) */
export async function GET(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'waba-templates-read',
      30,
      10 * 60 * 1000,
      'Terlalu banyak permintaan template WhatsApp. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    const auth = await requireReadAccess();
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const activeAccounts = await getActiveWabaAccounts(auth.workspaceId);
    const svc = getServiceSupabase();

    const templates = [];
    let offset = 0;

    while (activeAccounts.length > 0) {
      const { data, error } = await svc
        .from('waba_templates')
        .select('id, waba_id, name, status, category, language, components, is_auto_generated, tags')
        .eq('workspace_id', auth.workspaceId)
        .in('waba_id', activeAccounts.map((account) => account.waba_id))
        .is('deleted_at', null)
        .order('name')
        .order('id')
        .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

      if (error) throw error;

      const page = data || [];
      templates.push(...page);
      if (page.length < SUPABASE_PAGE_SIZE) break;
      offset += SUPABASE_PAGE_SIZE;
    }

    const { data: lastSync } = await svc
      .from('waba_template_sync_log')
      .select('created_at')
      .eq('workspace_id', auth.workspaceId)
      .in('status', ['success', 'partial'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      data: templates,
      accounts: activeAccounts,
      lastSynced: lastSync?.created_at || null,
    });
  } catch (err: any) {
    console.error('[waba-templates] GET error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** POST — Create a message template (write-through: Graph API + DB) */
export async function POST(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'waba-templates-write',
      10,
      10 * 60 * 1000,
      'Terlalu banyak perubahan template WhatsApp. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    const auth = await requireManageAccess();
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const accessToken = await getAccessToken(auth.workspaceId);
    const activeAccounts = await getActiveWabaAccounts(auth.workspaceId);
    const body: CreateTemplatePayload & { waba_id?: string } = await req.json();

    if (!body.name || !body.category || !body.language || !body.components) {
      return NextResponse.json({ error: 'Missing required fields: name, category, language, components' }, { status: 400 });
    }

    const wabaId = resolveTargetWabaId(activeAccounts, body.waba_id);

    // Sanitize name: lowercase, underscores only
    body.name = body.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    const result = await createMessageTemplate(wabaId, accessToken, body);

    // Write-through: insert into DB so it appears immediately
    const svc = getServiceSupabase();
    await svc.from('waba_templates').upsert({
      workspace_id: auth.workspaceId,
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
      }, { onConflict: 'workspace_id,id' }).then(({ error }) => {
      if (error) console.error('[waba-templates] Write-through insert error:', error);
    });

    return NextResponse.json({ ...result, waba_id: wabaId });
  } catch (err: any) {
    console.error('[waba-templates] POST error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** PATCH — Update template tags */
export async function PATCH(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'waba-templates-write',
      10,
      10 * 60 * 1000,
      'Terlalu banyak perubahan template WhatsApp. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    const auth = await requireManageAccess();
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
      .eq('id', body.id)
      .eq('workspace_id', auth.workspaceId);

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
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'waba-templates-write',
      10,
      10 * 60 * 1000,
      'Terlalu banyak perubahan template WhatsApp. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    const auth = await requireManageAccess();
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const accessToken = await getAccessToken(auth.workspaceId);
    const activeAccounts = await getActiveWabaAccounts(auth.workspaceId);
    const body = await req.json();

    if (!body.hsm_id || !body.name) {
      return NextResponse.json({ error: 'Missing required fields: hsm_id, name' }, { status: 400 });
    }

    const svc = getServiceSupabase();
    const { data: templateRow, error: templateError } = await svc
      .from('waba_templates')
      .select('waba_id')
      .eq('id', body.hsm_id)
      .eq('workspace_id', auth.workspaceId)
      .single();

    if (templateError) {
      throw templateError;
    }

    const wabaId = resolveTargetWabaId(activeAccounts, templateRow?.waba_id || body.waba_id);
    const result = await deleteMessageTemplate(wabaId, accessToken, body.hsm_id, body.name);

    // Write-through: soft-delete in DB
    await svc.from('waba_templates')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', body.hsm_id)
      .eq('workspace_id', auth.workspaceId)
      .then(({ error }) => {
        if (error) console.error('[waba-templates] Write-through delete error:', error);
      });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[waba-templates] DELETE error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

import { requireDashboardPermissionAccess, requireDashboardRoles } from '@/lib/dashboard-access';
import { listWorkspaceMarketplaceIntakeSourceConfigs } from '@/lib/marketplace-intake-workspace-sources';
import {
  buildMarketplaceIntakeSourceConfig,
  isMarketplaceIntakePlatform,
} from '@/lib/marketplace-intake-sources';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { createServiceSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;
    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;
    const rateLimitError = limitByIp(
      req,
      'marketplace-sources-read',
      40,
      10 * 60 * 1000,
      'Terlalu banyak permintaan source marketplace. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    const access = await requireDashboardPermissionAccess('admin:meta', 'konfigurasi source marketplace');
    const svc = createServiceSupabase();
    const [sources, businessesResult] = await Promise.all([
      listWorkspaceMarketplaceIntakeSourceConfigs(access.workspaceId),
      svc
        .from('scalev_webhook_businesses')
        .select('id, business_code, business_name, is_active')
        .eq('workspace_id', access.workspaceId)
        .order('business_code', { ascending: true }),
    ]);
    if (businessesResult.error) throw businessesResult.error;
    return NextResponse.json({ sources, businesses: businessesResult.data || [] });
  } catch (error: any) {
    const status = /sesi|login/i.test(error?.message || '') ? 401 : 500;
    return NextResponse.json(
      { error: error?.message || 'Gagal memuat source marketplace.' },
      { status },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;
    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;
    const rateLimitError = limitByIp(
      req,
      'marketplace-sources-write',
      20,
      10 * 60 * 1000,
      'Terlalu banyak perubahan source marketplace. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    const access = await requireDashboardRoles(['owner'], 'Hanya owner yang bisa menambahkan source marketplace.');
    const body = await req.json();
    if (!isMarketplaceIntakePlatform(body?.platform)) {
      return NextResponse.json({ error: 'Platform marketplace tidak valid.' }, { status: 400 });
    }
    const businessId = Number(body?.businessId || 0);
    if (!Number.isFinite(businessId) || businessId <= 0) {
      return NextResponse.json({ error: 'Business ScaleV wajib dipilih.' }, { status: 400 });
    }

    const svc = createServiceSupabase();
    const { data: business, error: businessError } = await svc
      .from('scalev_webhook_businesses')
      .select('id, business_code, business_name, is_active')
      .eq('workspace_id', access.workspaceId)
      .eq('id', businessId)
      .single();
    if (businessError) throw businessError;

    const sourceConfig = buildMarketplaceIntakeSourceConfig({
      platform: body.platform,
      businessCode: business.business_code,
      sourceLabel: body?.sourceLabel,
    });
    const { error: insertError } = await svc
      .from('marketplace_intake_sources')
      .insert({
        workspace_id: access.workspaceId,
        source_key: sourceConfig.sourceKey,
        source_label: sourceConfig.sourceLabel,
        platform: sourceConfig.platform,
        business_id: business.id,
        business_code: business.business_code,
        is_active: true,
      });
    if (insertError) {
      if (String(insertError.code || '') === '23505') {
        return NextResponse.json(
          { error: 'Platform dan business tersebut sudah terdaftar sebagai source workspace.' },
          { status: 409 },
        );
      }
      throw insertError;
    }

    const sources = await listWorkspaceMarketplaceIntakeSourceConfigs(access.workspaceId);
    return NextResponse.json({ success: true, sources });
  } catch (error: any) {
    const status = /sesi|login/i.test(error?.message || '') ? 401 : 500;
    return NextResponse.json(
      { error: error?.message || 'Gagal menambahkan source marketplace.' },
      { status },
    );
  }
}

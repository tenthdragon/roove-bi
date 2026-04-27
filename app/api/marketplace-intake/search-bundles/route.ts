import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import {
  guessMarketplaceStoreFromTexts,
} from '@/lib/marketplace-intake-store';
import { resolveMarketplaceIntakeSourceConfig } from '@/lib/marketplace-intake-source-store-scopes';
import { createServiceSupabase } from '@/lib/service-supabase';

export async function GET(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'marketplace-intake-search-bundles',
      60,
      10 * 60 * 1000,
      'Terlalu banyak pencarian bundle Marketplace Intake. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa mencari bundle Marketplace Intake.');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const query = String(req.nextUrl.searchParams.get('q') || '').trim();
    const sourceConfig = await resolveMarketplaceIntakeSourceConfig(req.nextUrl.searchParams.get('sourceKey'));
    if (query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const svc = createServiceSupabase();
    const businessRes = await svc
      .from('scalev_webhook_businesses')
      .select('id, business_code')
      .eq('business_code', sourceConfig.businessCode)
      .maybeSingle();
    if (businessRes.error || !businessRes.data) {
      return NextResponse.json({ error: `Business ${sourceConfig.businessCode} tidak ditemukan.` }, { status: 500 });
    }

    const bundlesRes = await svc
      .from('scalev_catalog_bundles')
      .select('scalev_bundle_id, name, public_name, display, custom_id')
      .eq('business_id', businessRes.data.id)
      .or(`custom_id.ilike.%${query}%,name.ilike.%${query}%,public_name.ilike.%${query}%,display.ilike.%${query}%`)
      .limit(20);

    if (bundlesRes.error) {
      return NextResponse.json({ error: bundlesRes.error.message || 'Gagal mencari bundle.' }, { status: 500 });
    }

    const results = [];
    for (const bundle of (bundlesRes.data || [])) {
      const label = bundle.display || bundle.public_name || bundle.name || bundle.custom_id || 'Bundle';
      const storeResolution = guessMarketplaceStoreFromTexts(
        [bundle.display, bundle.public_name, bundle.name, bundle.custom_id, query],
        sourceConfig.allowedStores,
      );
      const storeCandidates = storeResolution.storeCandidates.length > 0
        ? storeResolution.storeCandidates
        : sourceConfig.allowedStores;
      results.push({
        entityKey: `bundle:${bundle.scalev_bundle_id}`,
        entityLabel: label,
        customId: bundle.custom_id || null,
        scalevBundleId: Number(bundle.scalev_bundle_id || 0),
        storeName: storeResolution.storeName,
        storeCandidates,
        classifierLabel: storeResolution.classifierLabel || 'Pilih store manual',
        score: 0,
        source: 'manual',
      });
    }

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error('Marketplace intake search bundles error:', error);
    return NextResponse.json({ error: error.message || 'Marketplace intake search failed' }, { status: 500 });
  }
}

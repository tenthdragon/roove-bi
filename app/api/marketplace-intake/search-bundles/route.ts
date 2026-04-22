import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import {
  createShopeeRltStoreResolverContext,
  resolveShopeeRltStoreForBundle,
  SHOPEE_RLT_ALLOWED_STORE_NAMES,
} from '@/lib/marketplace-intake-store';
import { createServiceSupabase } from '@/lib/service-supabase';

export async function GET(req: NextRequest) {
  try {
    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa mencari bundle Marketplace Intake.');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const query = String(req.nextUrl.searchParams.get('q') || '').trim();
    if (query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const svc = createServiceSupabase();
    const businessRes = await svc
      .from('scalev_webhook_businesses')
      .select('id, business_code, api_key')
      .eq('business_code', 'RLT')
      .maybeSingle();
    if (businessRes.error || !businessRes.data) {
      return NextResponse.json({ error: 'Business RLT tidak ditemukan.' }, { status: 500 });
    }
    const business = businessRes.data;

    const bundlesRes = await svc
      .from('scalev_catalog_bundles')
      .select('scalev_bundle_id, name, public_name, display, custom_id')
      .eq('business_id', businessRes.data.id)
      .or(`custom_id.ilike.%${query}%,name.ilike.%${query}%,public_name.ilike.%${query}%,display.ilike.%${query}%`)
      .limit(20);

    if (bundlesRes.error) {
      return NextResponse.json({ error: bundlesRes.error.message || 'Gagal mencari bundle.' }, { status: 500 });
    }

    const storeResolver = createShopeeRltStoreResolverContext();
    const results = await Promise.all((bundlesRes.data || []).map(async (bundle: any) => {
      const label = bundle.display || bundle.public_name || bundle.name || bundle.custom_id || 'Bundle';
      const storeResolution = await resolveShopeeRltStoreForBundle(
        {
          id: Number(business.id),
          business_code: String(business.business_code || 'RLT'),
          api_key: business.api_key || null,
        },
        Number(bundle.scalev_bundle_id || 0),
        SHOPEE_RLT_ALLOWED_STORE_NAMES,
        storeResolver,
      );
      return {
        entityKey: `bundle:${bundle.scalev_bundle_id}`,
        entityLabel: label,
        customId: bundle.custom_id || null,
        scalevBundleId: Number(bundle.scalev_bundle_id || 0),
        storeName: storeResolution.storeName,
        storeCandidates: storeResolution.storeCandidates,
        classifierLabel: storeResolution.classifierLabel || 'Exact bundle->store lookup',
        score: 0,
        source: 'manual',
      };
    }));

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error('Marketplace intake search bundles error:', error);
    return NextResponse.json({ error: error.message || 'Marketplace intake search failed' }, { status: 500 });
  }
}

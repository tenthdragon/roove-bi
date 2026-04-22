import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { classifyShopeeRltStoreByCustomId } from '@/lib/marketplace-intake-store';
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
      .select('id')
      .eq('business_code', 'RLT')
      .maybeSingle();
    if (businessRes.error || !businessRes.data) {
      return NextResponse.json({ error: 'Business RLT tidak ditemukan.' }, { status: 500 });
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

    const results = (bundlesRes.data || []).map((bundle: any) => {
      const label = bundle.display || bundle.public_name || bundle.name || bundle.custom_id || 'Bundle';
      return {
        entityKey: `bundle:${bundle.scalev_bundle_id}`,
        entityLabel: label,
        customId: bundle.custom_id || null,
        scalevBundleId: Number(bundle.scalev_bundle_id || 0),
        storeName: classifyShopeeRltStoreByCustomId(bundle.custom_id || null).storeName,
        classifierLabel: 'Manual search',
        score: 0,
        source: 'manual',
      };
    });

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error('Marketplace intake search bundles error:', error);
    return NextResponse.json({ error: error.message || 'Marketplace intake search failed' }, { status: 500 });
  }
}

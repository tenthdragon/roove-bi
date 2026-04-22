import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { createServiceSupabase } from '@/lib/service-supabase';

function normalizeIdentifier(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeLoose(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function classifyShopeeRltStore(customId: string | null, label: string | null) {
  const normalizedCustomId = normalizeLoose(customId);
  const normalizedLabel = normalizeIdentifier(label);
  if (normalizedCustomId.startsWith('rov') || normalizedLabel.includes('roove')) return 'Roove Main Store - Marketplace';
  if (normalizedCustomId.startsWith('glb') || normalizedLabel.includes('globite')) return 'Globite Store - Marketplace';
  if (normalizedCustomId.startsWith('plv') || normalizedLabel.includes('pluve')) return 'Pluve Main Store - Marketplace';
  if (normalizedCustomId.startsWith('ogd') || normalizedLabel.includes('osgard')) return 'Osgard Oil Store';
  if (normalizedCustomId.startsWith('srt') || normalizedLabel.includes('secret')) return 'Purvu The Secret Store - Markerplace';
  if (normalizedCustomId.startsWith('pam') || normalizedLabel.includes('purvu')) return 'Purvu Store - Marketplace';
  if (normalizedCustomId.startsWith('yuv') || normalizedLabel.includes('yuv')) return 'YUV Deodorant Serum Store - Marketplace';
  if (normalizedCustomId.startsWith('drh') || normalizedLabel.includes('drhyun') || normalizedLabel.includes('dr hyun')) return 'drHyun Main Store - Marketplace';
  if (normalizedCustomId.startsWith('clm') || normalizedCustomId.startsWith('cal') || normalizedLabel.includes('calmara')) return 'Calmara Main Store - Marketplace';
  return null;
}

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
        storeName: classifyShopeeRltStore(bundle.custom_id || null, label),
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

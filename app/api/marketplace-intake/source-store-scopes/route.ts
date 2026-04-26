import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import {
  assertMarketplaceIntakeSourceKey,
  listMarketplaceIntakeStoreScope,
  upsertMarketplaceIntakeStoreScope,
} from '@/lib/marketplace-intake-source-store-scopes';

export async function GET(req: NextRequest) {
  try {
    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa melihat store scope Marketplace Intake.');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const sourceKey = assertMarketplaceIntakeSourceKey(req.nextUrl.searchParams.get('sourceKey'));
    const result = await listMarketplaceIntakeStoreScope(sourceKey);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Marketplace intake source store scope GET error:', error);
    return NextResponse.json({ error: error.message || 'Gagal memuat store scope Marketplace Intake.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa mengubah store scope Marketplace Intake.');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const body = await req.json();
    const sourceKey = assertMarketplaceIntakeSourceKey(body?.sourceKey);
    const selectedStoreNames = Array.isArray(body?.selectedStoreNames) ? body.selectedStoreNames : [];
    const result = await upsertMarketplaceIntakeStoreScope({
      sourceKey,
      selectedStoreNames,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Marketplace intake source store scope POST error:', error);
    return NextResponse.json({ error: error.message || 'Gagal menyimpan store scope Marketplace Intake.' }, { status: 500 });
  }
}

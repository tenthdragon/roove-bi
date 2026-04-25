import { NextRequest, NextResponse } from 'next/server';

import { requireDashboardRoles } from '@/lib/dashboard-access';
import { listMarketplaceWebhookQuarantine } from '@/lib/marketplace-intake-quarantine';

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa melihat webhook quarantine marketplace.');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const limitParam = Number(req.nextUrl.searchParams.get('limit') || 100);
    const result = await listMarketplaceWebhookQuarantine({ limit: limitParam });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Marketplace webhook quarantine error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal memuat webhook quarantine marketplace.' },
      { status: 500 },
    );
  }
}

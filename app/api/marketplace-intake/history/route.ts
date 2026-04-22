import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { listMarketplaceIntakeHistory } from '@/lib/marketplace-intake';

function getCurrentMonthValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export const maxDuration = 250;

export async function GET(req: NextRequest) {
  try {
    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa melihat riwayat Marketplace Intake.');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const month = String(req.nextUrl.searchParams.get('month') || getCurrentMonthValue());
    const result = await listMarketplaceIntakeHistory({ month });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Marketplace intake history error:', error);
    return NextResponse.json({ error: error.message || 'Marketplace intake history failed' }, { status: 500 });
  }
}

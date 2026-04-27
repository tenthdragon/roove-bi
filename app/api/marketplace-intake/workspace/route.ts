import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { listMarketplaceIntakeWorkspace } from '@/lib/marketplace-intake';

function getCurrentDateValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const maxDuration = 250;

export async function GET(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'marketplace-intake-workspace-read',
      40,
      10 * 60 * 1000,
      'Terlalu banyak permintaan workspace Marketplace Intake. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa melihat workspace Marketplace Intake.');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const shipmentDate = String(req.nextUrl.searchParams.get('shipmentDate') || getCurrentDateValue());
    const sourceKey = String(req.nextUrl.searchParams.get('sourceKey') || '').trim() || null;
    const result = await listMarketplaceIntakeWorkspace({ shipmentDate, sourceKey });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Marketplace intake workspace error:', error);
    return NextResponse.json({ error: error.message || 'Marketplace intake workspace failed' }, { status: 500 });
  }
}

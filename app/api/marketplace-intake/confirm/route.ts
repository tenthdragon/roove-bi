import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  saveMarketplaceIntakePreview,
  type MarketplaceIntakeManualSelectionInput,
  type MarketplaceIntakePreview,
} from '@/lib/marketplace-intake';

export const maxDuration = 250;

export async function POST(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'marketplace-intake-confirm',
      8,
      10 * 60 * 1000,
      'Terlalu banyak penyimpanan Marketplace Intake. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa menyimpan Marketplace Intake.');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const body = await req.json();
    const preview = body?.preview as MarketplaceIntakePreview | undefined;
    const manualSelections = Array.isArray(body?.manualSelections)
      ? body.manualSelections as MarketplaceIntakeManualSelectionInput[]
      : [];
    if (!preview || !preview.source || !Array.isArray(preview.orders)) {
      return NextResponse.json({ error: 'Payload preview tidak valid.' }, { status: 400 });
    }

    const authSupabase = createServerSupabase();
    const {
      data: { user },
    } = await authSupabase.auth.getUser();

    const result = await saveMarketplaceIntakePreview({
      preview,
      uploadedByEmail: user?.email || null,
      manualSelections,
    });

    return NextResponse.json({
      success: true,
      batchId: result.batchId,
      summary: result.summary,
      message: `Preview ${preview.source.sourceLabel} berhasil disimpan sebagai batch #${result.batchId} dan masuk ke workspace warehouse.`,
    });
  } catch (error: any) {
    console.error('Marketplace intake confirm error:', error);
    const status = /duplikat tidak diizinkan|sudah pernah disimpan/i.test(error.message || '') ? 409 : 500;
    return NextResponse.json({ error: error.message || 'Marketplace intake confirm failed' }, { status });
  }
}

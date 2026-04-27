import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { previewMarketplaceIntake } from '@/lib/marketplace-intake';

export const maxDuration = 250;

const MAX_MARKETPLACE_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function isSupportedShopeeFile(file: File): boolean {
  const lowerName = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();
  return lowerName.endsWith('.xlsx')
    || lowerName.endsWith('.xls')
    || lowerName.endsWith('.csv')
    || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || mime === 'application/vnd.ms-excel'
    || mime === 'text/csv';
}

export async function POST(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'marketplace-intake-preview',
      8,
      10 * 60 * 1000,
      'Terlalu banyak preview Marketplace Intake. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa mengakses Marketplace Intake.');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!isSupportedShopeeFile(file)) {
      return NextResponse.json({ error: 'File harus berformat Excel (.xlsx / .xls) atau CSV Shopee.' }, { status: 400 });
    }

    if (file.size > MAX_MARKETPLACE_FILE_SIZE_BYTES) {
      return NextResponse.json({
        error: `File terlalu besar. Maksimal ${Math.round(MAX_MARKETPLACE_FILE_SIZE_BYTES / (1024 * 1024))}MB`,
      }, { status: 413 });
    }

    const filename = (formData.get('filename') as string | null) || file.name;
    const sourceKey = (formData.get('sourceKey') as string | null) || null;
    const preview = await previewMarketplaceIntake({
      file,
      filenameOverride: filename,
      sourceKey,
    });

    return NextResponse.json(preview);
  } catch (error: any) {
    console.error('Marketplace intake preview error:', error);
    return NextResponse.json({ error: error.message || 'Marketplace intake preview failed' }, { status: 500 });
  }
}

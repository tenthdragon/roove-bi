import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { createServerSupabase } from '@/lib/supabase-server';
import { importMarketplaceWorkbook } from '@/lib/marketplace-upload';

export const maxDuration = 250;

const MAX_MARKETPLACE_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function isLikelyMarketplaceWorkbook(file: File): boolean {
  const lowerName = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();
  return lowerName.endsWith('.xlsx')
    || lowerName.endsWith('.xls')
    || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || mime === 'application/vnd.ms-excel';
}

export async function POST(req: NextRequest) {
  try {
    try {
      await requireDashboardPermissionAccess('admin:daily', 'Admin Daily Data');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const authSupabase = createServerSupabase();
    const {
      data: { user },
    } = await authSupabase.auth.getUser();
    const uploadedBy = user?.email || null;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!isLikelyMarketplaceWorkbook(file)) {
      return NextResponse.json({ error: 'File harus berformat Excel (.xlsx / .xls)' }, { status: 400 });
    }

    if (file.size > MAX_MARKETPLACE_FILE_SIZE_BYTES) {
      return NextResponse.json({
        error: `File terlalu besar. Maksimal ${Math.round(MAX_MARKETPLACE_FILE_SIZE_BYTES / (1024 * 1024))}MB`,
      }, { status: 413 });
    }

    const filename = (formData.get('filename') as string | null) || file.name;
    const result = await importMarketplaceWorkbook({
      file,
      uploadedBy,
      filenameOverride: filename,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Marketplace upload error:', error);
    return NextResponse.json({ error: error.message || 'Marketplace upload failed' }, { status: 500 });
  }
}

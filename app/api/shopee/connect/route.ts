import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import {
  buildShopeeShopAuthUrl,
  getShopeeRuntimeDiagnostics,
  getShopeeSetupInfo,
} from '@/lib/shopee-open-platform';

export const dynamic = 'force-dynamic';

function buildShopeeDetailsRedirect(req: NextRequest, status: 'connected' | 'error', message: string) {
  const url = new URL('/dashboard/shopee-details', req.url);
  url.searchParams.set('tab', 'product');
  url.searchParams.set('shopee_status', status);
  url.searchParams.set('shopee_message', message);
  return url;
}

export async function GET(req: NextRequest) {
  console.info('[shopee-connect] Runtime configuration', getShopeeRuntimeDiagnostics());

  try {
    await requireDashboardPermissionAccess('admin:meta', 'Admin Meta');
  } catch (error: any) {
    return NextResponse.redirect(
      buildShopeeDetailsRedirect(req, 'error', error.message || 'Tidak punya akses untuk menghubungkan Shopee.'),
    );
  }

  try {
    const setup = getShopeeSetupInfo();
    if (!setup.configured) {
      return NextResponse.redirect(
        buildShopeeDetailsRedirect(
          req,
          'error',
          `Shopee belum dikonfigurasi. Missing env: ${setup.missingEnv.join(', ')}`,
        ),
      );
    }

    return NextResponse.redirect(buildShopeeShopAuthUrl());
  } catch (error: any) {
    return NextResponse.redirect(
      buildShopeeDetailsRedirect(req, 'error', error.message || 'Gagal memulai koneksi Shopee.'),
    );
  }
}

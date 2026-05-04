import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { buildShopeeShopAuthUrl, getShopeeSetupInfo } from '@/lib/shopee-open-platform';

export const dynamic = 'force-dynamic';

function buildAdminRedirect(req: NextRequest, status: 'connected' | 'error', message: string) {
  const url = new URL('/dashboard/admin', req.url);
  url.searchParams.set('tab', 'meta');
  url.searchParams.set('shopee_status', status);
  url.searchParams.set('shopee_message', message);
  return url;
}

export async function GET(req: NextRequest) {
  try {
    await requireDashboardPermissionAccess('admin:meta', 'Admin Meta');
  } catch (error: any) {
    return NextResponse.redirect(
      buildAdminRedirect(req, 'error', error.message || 'Tidak punya akses untuk menghubungkan Shopee.'),
    );
  }

  try {
    const setup = getShopeeSetupInfo();
    if (!setup.configured) {
      return NextResponse.redirect(
        buildAdminRedirect(
          req,
          'error',
          `Shopee belum dikonfigurasi. Missing env: ${setup.missingEnv.join(', ')}`,
        ),
      );
    }

    return NextResponse.redirect(buildShopeeShopAuthUrl());
  } catch (error: any) {
    return NextResponse.redirect(
      buildAdminRedirect(req, 'error', error.message || 'Gagal memulai koneksi Shopee.'),
    );
  }
}

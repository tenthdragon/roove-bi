import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  const environment = process.env.ROOVE_ENVIRONMENT || (process.env.ROOVE_LOCAL_DEV === '1' ? 'development' : 'production');
  return NextResponse.json({
    environment,
    release: process.env.ROOVE_RELEASE || null,
    snapshotAt: environment === 'production' ? null : process.env.ROOVE_SNAPSHOT_AT || null,
    integrationsEnabled: environment === 'production',
  }, { headers: { 'Cache-Control': 'no-store' } });
}

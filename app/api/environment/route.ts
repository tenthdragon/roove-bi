import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
export const dynamic = 'force-dynamic';
export async function GET() {
  const environment = process.env.ROOVE_ENVIRONMENT || (process.env.ROOVE_LOCAL_DEV === '1' ? 'development' : 'production');
  const [source, buildId] = await Promise.all([
    readFile(path.join(process.cwd(), '.release-source.json'), 'utf8').then(text => JSON.parse(text)).catch(() => null),
    readFile(path.join(process.cwd(), '.next/BUILD_ID'), 'utf8').then(text => text.trim()).catch(() => null),
  ]);
  return NextResponse.json({
    environment,
    branch: process.env.ROOVE_SOURCE_BRANCH || null,
    release: process.env.ROOVE_RELEASE || null,
    commit: typeof source?.commit === 'string' && /^[0-9a-f]{40}$/.test(source.commit) ? source.commit : null,
    buildId: typeof buildId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(buildId) ? buildId : null,
    snapshotAt: environment === 'production' ? null : process.env.ROOVE_SNAPSHOT_AT || null,
    integrationsEnabled: environment === 'production',
  }, { headers: { 'Cache-Control': 'no-store' } });
}

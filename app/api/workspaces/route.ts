import { NextRequest, NextResponse } from 'next/server';
import {
  getWorkspaceBootstrap,
  setActiveWorkspace,
} from '@/lib/workspace-access';
import {
  rejectMissingDashboardSession,
  rejectUntrustedOrigin,
} from '@/lib/request-hardening';

export async function GET(req: NextRequest) {
  const sessionError = rejectMissingDashboardSession(req);
  if (sessionError) return sessionError;

  try {
    return NextResponse.json(await getWorkspaceBootstrap());
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Gagal memuat workspace.' },
      { status: 403 },
    );
  }
}

export async function POST(req: NextRequest) {
  const originError = rejectUntrustedOrigin(req);
  if (originError) return originError;

  const sessionError = rejectMissingDashboardSession(req);
  if (sessionError) return sessionError;

  try {
    const body = await req.json();
    const workspaceId = String(body?.workspaceId || '').trim();
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'Workspace wajib dipilih.' },
        { status: 400 },
      );
    }

    return NextResponse.json(await setActiveWorkspace(workspaceId));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Gagal mengganti workspace.' },
      { status: 403 },
    );
  }
}

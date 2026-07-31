import { NextRequest, NextResponse } from 'next/server';
import {
  limitByIp,
  rejectMissingDashboardSession,
  rejectUntrustedOrigin,
} from '@/lib/request-hardening';
import { createServerSupabase, createServiceSupabase } from '@/lib/supabase-server';
import { requireWorkspaceAccess } from '@/lib/workspace-access';

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(req: NextRequest) {
  const originError = rejectUntrustedOrigin(req);
  if (originError) return originError;

  const sessionError = rejectMissingDashboardSession(req);
  if (sessionError) return sessionError;

  const rateLimitError = limitByIp(
    req,
    'workspace-provision',
    5,
    60 * 60 * 1000,
    'Terlalu banyak percobaan membuat workspace. Coba lagi nanti.',
  );
  if (rateLimitError) return rateLimitError;

  try {
    const access = await requireWorkspaceAccess();
    if (!access.isPlatformOwner) {
      return NextResponse.json(
        { error: 'Hanya platform owner yang dapat membuat workspace.' },
        { status: 403 },
      );
    }

    const supabase = createServerSupabase();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Sesi login tidak ditemukan. Silakan login ulang.' },
        { status: 401 },
      );
    }

    const body = await req.json();
    const name = normalizeText(body?.name);
    const slug = normalizeText(body?.slug).toLowerCase();
    const inventoryEntity = normalizeText(body?.inventoryEntity).toUpperCase();
    const warehouseCode = normalizeText(body?.warehouseCode || 'BTN').toUpperCase();

    if (!name || !slug || !inventoryEntity || !warehouseCode) {
      return NextResponse.json(
        { error: 'Nama, slug, entity inventory, dan kode warehouse wajib diisi.' },
        { status: 400 },
      );
    }

    const service = createServiceSupabase();
    const { data, error } = await service.rpc('provision_workspace', {
      p_name: name,
      p_slug: slug,
      p_owner_user_id: user.id,
      p_inventory_entity: inventoryEntity,
      p_warehouse_code: warehouseCode,
    });

    if (error) {
      const isConflict = error.code === '23505';
      return NextResponse.json(
        {
          error: isConflict
            ? 'Slug workspace sudah digunakan.'
            : error.message || 'Gagal membuat workspace.',
        },
        { status: isConflict ? 409 : 400 },
      );
    }

    return NextResponse.json({ workspace: data }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Gagal membuat workspace.' },
      { status: 400 },
    );
  }
}

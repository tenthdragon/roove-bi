import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';

const GRAPH_API_VERSION = 'v21.0';
// Keep enough headroom below common serverless request-body limits.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

function getMetaConfig() {
  const appId = process.env.META_APP_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
  if (!appId) throw new Error('META_APP_ID not configured');
  if (!accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN or META_ACCESS_TOKEN not configured');
  return { appId, accessToken };
}

async function readMetaError(response: Response) {
  const body = await response.json().catch(() => ({}));
  return body?.error?.error_user_msg || body?.error?.message || response.statusText;
}

export async function POST(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'waba-template-media',
      10,
      10 * 60 * 1000,
      'Terlalu banyak upload media template. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    try {
      await requireDashboardPermissionAccess('admin:meta', 'Admin Meta');
    } catch (err: any) {
      const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
      return NextResponse.json({ error: err.message }, { status });
    }

    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Image file is required' }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Image must be a JPG or PNG file' }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Image must be no larger than 4 MB' }, { status: 400 });
    }

    const { appId, accessToken } = getMetaConfig();
    const createParams = new URLSearchParams({
      file_name: file.name,
      file_length: String(file.size),
      file_type: file.type,
      access_token: accessToken,
    });
    const createResponse = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${appId}/uploads?${createParams.toString()}`,
      { method: 'POST' },
    );
    if (!createResponse.ok) {
      throw new Error(`Meta upload session failed: ${await readMetaError(createResponse)}`);
    }

    const session = await createResponse.json();
    if (!session?.id) throw new Error('Meta did not return an upload session ID');

    const uploadResponse = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${session.id}`,
      {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${accessToken}`,
          file_offset: '0',
          'Content-Type': 'application/octet-stream',
        },
        body: await file.arrayBuffer(),
      },
    );
    if (!uploadResponse.ok) {
      throw new Error(`Meta media upload failed: ${await readMetaError(uploadResponse)}`);
    }

    const uploaded = await uploadResponse.json();
    if (!uploaded?.h) throw new Error('Meta did not return a media handle');

    return NextResponse.json({ handle: uploaded.h });
  } catch (err: any) {
    console.error('[waba-template-media] POST error:', err.message);
    return NextResponse.json({ error: err.message || 'Image upload failed' }, { status: 500 });
  }
}

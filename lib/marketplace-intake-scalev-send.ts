import { createServiceSupabase } from './service-supabase';
import {
  buildScalevOpsProjectionForBatch,
  SCALEV_OPS_CSV_HEADERS,
  type ScalevOpsProjectionResult,
} from './marketplace-intake-scalev-export';
import {
  reconcileMarketplaceIntakeBatchScalevIdentity,
  type MarketplaceIntakeScalevReconcileResult,
} from './marketplace-intake-scalev-reconcile';

const SCALEV_API_BASE_URL = 'https://api.scalev.id/v2';
const DEFAULT_SCALEV_UPLOAD_TZ = 'Asia/Jakarta';

type SenderBatchRow = {
  id: number;
  source_key: string;
  source_label: string;
  business_id: number;
  business_code: string;
  filename: string;
};

type SenderBusinessRow = {
  id: number;
  business_code: string;
  api_key: string | null;
};

export type MarketplaceIntakeScalevSendInput = {
  batchId: number;
  shipmentDate?: string | null;
  includeWarehouseStatuses?: string[];
  createType?: 'regular' | 'archive';
  sentByEmail?: string | null;
  tz?: string;
};

export type MarketplaceIntakeScalevSendResult = {
  batchId: number;
  businessCode: string;
  shipmentDate: string | null;
  createType: 'regular' | 'archive';
  tz: string;
  rowCount: number;
  warningCount: number;
  responseStatus: number;
  responseBody: unknown;
  csvFilename: string;
  sentAt: string;
  reconcile: MarketplaceIntakeScalevReconcileResult | null;
  reconcileError: string | null;
};

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeShipmentDate(value: string): string {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('shipmentDate tidak valid. Gunakan format YYYY-MM-DD.');
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function buildProjectionSnapshot(
  projection: ScalevOpsProjectionResult,
  input: MarketplaceIntakeScalevSendInput,
  csvFilename: string,
) {
  return {
    kind: 'marketplace_intake_scalev_projection',
    version: 1,
    builtAt: new Date().toISOString(),
    headers: SCALEV_OPS_CSV_HEADERS,
    csvFilename,
    batch: projection.batch,
    shipmentDate: input.shipmentDate || null,
    includeWarehouseStatuses: input.includeWarehouseStatuses || [],
    createType: input.createType || 'regular',
    tz: input.tz || DEFAULT_SCALEV_UPLOAD_TZ,
    rowCount: projection.rows.length,
    warningCount: projection.warnings.length,
    warnings: projection.warnings,
    rows: projection.rows,
  };
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

async function loadSenderBatch(batchId: number): Promise<SenderBatchRow> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('marketplace_intake_batches')
    .select('id, source_key, source_label, business_id, business_code, filename')
    .eq('id', batchId)
    .single<SenderBatchRow>();

  if (error) throw error;
  return data;
}

async function loadSenderBusiness(businessId: number): Promise<SenderBusinessRow> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_webhook_businesses')
    .select('id, business_code, api_key')
    .eq('id', businessId)
    .single<SenderBusinessRow>();

  if (error) throw error;
  if (!cleanText(data?.api_key)) {
    throw new Error(`Business ${data?.business_code || businessId} belum memiliki API key Scalev aktif.`);
  }
  return data;
}

async function persistScalevProjectionSnapshot(batchId: number, snapshot: Record<string, unknown>, csv: string) {
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('marketplace_intake_batches')
    .update({
      scalev_projection_snapshot: snapshot,
      scalev_projection_csv: csv,
      scalev_projection_generated_at: new Date().toISOString(),
    })
    .eq('id', batchId);

  if (error) throw error;
}

async function persistScalevSendResult(batchId: number, payload: Record<string, unknown>) {
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('marketplace_intake_batches')
    .update(payload)
    .eq('id', batchId);

  if (error) throw error;
}

async function logScalevSendSync(input: {
  batch: SenderBatchRow;
  status: 'success' | 'failed';
  sentByEmail: string | null;
  rowCount: number;
  errorMessage: string | null;
}) {
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('scalev_sync_log')
    .insert({
      status: input.status,
      sync_type: 'marketplace_intake_scalev_upload',
      business_code: input.batch.business_code,
      orders_fetched: input.rowCount,
      orders_inserted: 0,
      orders_updated: 0,
      uploaded_by: input.sentByEmail,
      filename: input.batch.filename,
      error_message: input.errorMessage,
      completed_at: new Date().toISOString(),
    });

  if (error) throw error;
}

async function uploadScalevOrdersCsv(input: {
  apiKey: string;
  csv: string;
  csvFilename: string;
  createType: 'regular' | 'archive';
  tz: string;
}): Promise<{ status: number; body: unknown }> {
  const formData = new FormData();
  formData.append('create_type', input.createType);
  formData.append('tz', input.tz);
  formData.append(
    'file',
    new Blob([input.csv], { type: 'text/csv;charset=utf-8' }),
    input.csvFilename,
  );

  const response = await fetch(`${SCALEV_API_BASE_URL}/order/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: formData,
  });

  const rawText = await response.text();
  const body = tryParseJson(rawText);
  if (!response.ok) {
    const errorMessage = typeof body === 'string'
      ? body
      : cleanText((body as any)?.error || (body as any)?.message || rawText);
    throw new Error(`Scalev order/upload gagal (${response.status}): ${errorMessage}`);
  }

  return {
    status: response.status,
    body,
  };
}

export async function sendMarketplaceIntakeBatchToScalev(
  input: MarketplaceIntakeScalevSendInput,
): Promise<MarketplaceIntakeScalevSendResult> {
  const batchId = Number(input.batchId || 0);
  if (!Number.isFinite(batchId) || batchId <= 0) {
    throw new Error('batchId tidak valid.');
  }

  const createType = input.createType || 'regular';
  const tz = cleanText(input.tz) || DEFAULT_SCALEV_UPLOAD_TZ;
  const shipmentDate = cleanText(input.shipmentDate) ? normalizeShipmentDate(String(input.shipmentDate)) : null;
  const includeWarehouseStatuses = Array.from(new Set(
    (input.includeWarehouseStatuses || ['scheduled'])
      .map((status) => cleanText(status))
      .filter(Boolean),
  ));

  const batch = await loadSenderBatch(batchId);
  const business = await loadSenderBusiness(batch.business_id);
  const projection = await buildScalevOpsProjectionForBatch({
    batchId,
    shipmentDate,
    includeWarehouseStatuses,
  });

  if (projection.rows.length === 0) {
    throw new Error('Projection Scalev kosong. Tidak ada row yang siap dikirim untuk batch ini.');
  }
  if (projection.warnings.length > 0) {
    const firstWarning = projection.warnings[0];
    throw new Error(
      `Projection Scalev masih memiliki ${projection.warnings.length} warning. Contoh: ${firstWarning.externalOrderId} - ${firstWarning.message}`,
    );
  }

  const csvFilename = `marketplace-intake-batch-${batchId}${shipmentDate ? `-${shipmentDate}` : ''}.csv`;
  const projectionSnapshot = buildProjectionSnapshot(projection, {
    ...input,
    shipmentDate,
    includeWarehouseStatuses,
    createType,
    tz,
  }, csvFilename);

  await persistScalevProjectionSnapshot(batchId, projectionSnapshot, projection.csv);

  const sentAt = new Date().toISOString();

  try {
    const uploadResult = await uploadScalevOrdersCsv({
      apiKey: String(business.api_key),
      csv: projection.csv,
      csvFilename,
      createType,
      tz,
    });

    await persistScalevSendResult(batchId, {
      scalev_last_send_status: 'success',
      scalev_last_send_mode: createType,
      scalev_last_send_shipment_date: shipmentDate,
      scalev_last_send_row_count: projection.rows.length,
      scalev_last_send_at: sentAt,
      scalev_last_send_error: null,
      scalev_last_response: uploadResult.body,
    });

    await logScalevSendSync({
      batch,
      status: 'success',
      sentByEmail: input.sentByEmail || null,
      rowCount: projection.rows.length,
      errorMessage: null,
    });

    let reconcile: MarketplaceIntakeScalevReconcileResult | null = null;
    let reconcileError: string | null = null;
    try {
      reconcile = await reconcileMarketplaceIntakeBatchScalevIdentity({
        batchId,
        reconciledByEmail: input.sentByEmail || null,
      });
    } catch (error: any) {
      reconcileError = error?.message || 'Reconcile Scalev ID gagal.';
    }

    return {
      batchId,
      businessCode: business.business_code,
      shipmentDate,
      createType,
      tz,
      rowCount: projection.rows.length,
      warningCount: projection.warnings.length,
      responseStatus: uploadResult.status,
      responseBody: uploadResult.body,
      csvFilename,
      sentAt,
      reconcile,
      reconcileError,
    };
  } catch (error: any) {
    await persistScalevSendResult(batchId, {
      scalev_last_send_status: 'failed',
      scalev_last_send_mode: createType,
      scalev_last_send_shipment_date: shipmentDate,
      scalev_last_send_row_count: projection.rows.length,
      scalev_last_send_at: sentAt,
      scalev_last_send_error: error?.message || 'Unknown error',
      scalev_last_response: {
        error: error?.message || 'Unknown error',
      },
    });

    await logScalevSendSync({
      batch,
      status: 'failed',
      sentByEmail: input.sentByEmail || null,
      rowCount: projection.rows.length,
      errorMessage: error?.message || 'Unknown error',
    });

    throw error;
  }
}

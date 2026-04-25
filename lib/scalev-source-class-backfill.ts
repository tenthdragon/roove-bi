import { buildScalevSourceClassFields } from './scalev-source-class';

type StoreChannelRow = {
  business_id: number | null;
  store_name: string | null;
  store_type: string | null;
};

type BusinessRow = {
  id: number;
  business_code: string;
};

type OrderRow = {
  id: number;
  source: string | null;
  business_code: string | null;
  platform: string | null;
  store_name: string | null;
  external_id: string | null;
  financial_entity: any;
  raw_data: any;
  draft_time: string | null;
  pending_time: string | null;
  confirmed_time: string | null;
  paid_time: string | null;
  shipped_time: string | null;
  completed_time: string | null;
  canceled_time: string | null;
  created_at: string | null;
  source_class: string | null;
  source_class_reason: string | null;
};

export type ScalevSourceClassBackfillSummaryBucket = {
  rowsSeen: number;
  inScope: number;
  changed: number;
  unchanged: number;
  updated: number;
};

export type ScalevSourceClassBackfillSummary = {
  apply: boolean;
  batchSize: number;
  fromDate: string;
  toDate: string;
  schemaHasSourceClassColumns: boolean;
  scanned: number;
  inCreatedAtWindow: number;
  inScope: number;
  changed: number;
  unchanged: number;
  updated: number;
  perDate: Record<string, ScalevSourceClassBackfillSummaryBucket>;
};

type RunScalevSourceClassBackfillParams = {
  supabase: any;
  apply: boolean;
  batchSize: number;
  fromDate: string;
  toDate: string;
  onProgress?: (progress: Record<string, any>) => void | Promise<void>;
};

const FLUSH_BATCH_SIZE = 500;
const ORDER_TIMESTAMP_FIELDS = [
  'draft_time',
  'pending_time',
  'confirmed_time',
  'paid_time',
  'shipped_time',
  'completed_time',
  'canceled_time',
] as const;

const BASE_ORDER_SELECT = [
  'id',
  'source',
  'business_code',
  'platform',
  'store_name',
  'external_id',
  'financial_entity',
  'raw_data',
  'draft_time',
  'pending_time',
  'confirmed_time',
  'paid_time',
  'shipped_time',
  'completed_time',
  'canceled_time',
  'created_at',
];

const SOURCE_CLASS_SELECT = [
  'source_class',
  'source_class_reason',
];

function getJakartaDateKey(input: string | Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof input === 'string' ? new Date(input) : input);
}

function cleanNullable(value: unknown): string | null {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
}

function toMs(value: unknown): number | null {
  const cleaned = cleanNullable(value);
  if (!cleaned) return null;
  const parsed = Date.parse(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function earliestReliableTimestamp(row: OrderRow): string | null {
  const orderTimestampMs = ORDER_TIMESTAMP_FIELDS
    .map((field) => toMs(row[field]))
    .filter((value): value is number => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (orderTimestampMs.length > 0) {
    return new Date(orderTimestampMs[0]).toISOString();
  }

  const createdAtMs = toMs(row.created_at);
  return createdAtMs ? new Date(createdAtMs).toISOString() : null;
}

function isMissingSourceClassColumnError(error: any) {
  const message = String(error?.message || error || '');
  return message.includes('scalev_orders.source_class does not exist')
    || message.includes('scalev_orders.source_class_reason does not exist');
}

async function loadStoreTypeMap(supabase: any) {
  const [{ data: businesses, error: businessError }, { data: stores, error: storeError }] = await Promise.all([
    supabase
      .from('scalev_webhook_businesses')
      .select('id, business_code')
      .eq('is_active', true),
    supabase
      .from('scalev_store_channels')
      .select('business_id, store_name, store_type')
      .eq('is_active', true),
  ]);

  if (businessError) throw businessError;
  if (storeError) throw storeError;

  const businessCodeById = new Map<number, string>();
  for (const row of (businesses || []) as BusinessRow[]) {
    businessCodeById.set(Number(row.id), String(row.business_code || ''));
  }

  const storeTypeMap = new Map<string, string>();
  for (const row of (stores || []) as StoreChannelRow[]) {
    const businessCode = businessCodeById.get(Number(row.business_id || 0));
    const storeName = String(row.store_name || '').trim().toLowerCase();
    const storeType = String(row.store_type || '').trim();
    if (!businessCode || !storeName || !storeType) continue;
    storeTypeMap.set(`${businessCode}:${storeName}`, storeType);
  }

  return storeTypeMap;
}

async function fetchOrderBatch(args: {
  supabase: any;
  cursorId: number | null;
  batchSize: number;
  includeSourceClassColumns: boolean;
}) {
  let query = args.supabase
    .from('scalev_orders')
    .select(
      (args.includeSourceClassColumns
        ? [...BASE_ORDER_SELECT, ...SOURCE_CLASS_SELECT]
        : BASE_ORDER_SELECT
      ).join(','),
    )
    .order('id', { ascending: false })
    .limit(args.batchSize);

  if (args.cursorId != null) {
    query = query.lt('id', args.cursorId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return ((data || []) as Array<Partial<OrderRow>>).map((row) => ({
    ...row,
    source_class: row.source_class ?? null,
    source_class_reason: row.source_class_reason ?? null,
  })) as OrderRow[];
}

async function flushUpdates(args: {
  supabase: any;
  updates: Array<{ id: number; source_class: string; source_class_reason: string }>;
}) {
  if (args.updates.length === 0) return 0;
  const chunkSize = 50;
  let updated = 0;

  for (let index = 0; index < args.updates.length; index += chunkSize) {
    const chunk = args.updates.slice(index, index + chunkSize);
    const results = await Promise.all(chunk.map(async (row) => {
      const { error } = await args.supabase
        .from('scalev_orders')
        .update({
          source_class: row.source_class,
          source_class_reason: row.source_class_reason,
        })
        .eq('id', row.id);
      if (error) throw error;
      return row.id;
    }));
    updated += results.length;
  }

  return updated;
}

export async function runScalevSourceClassBackfill(params: RunScalevSourceClassBackfillParams): Promise<ScalevSourceClassBackfillSummary> {
  const storeTypeMap = await loadStoreTypeMap(params.supabase);
  const fromDateMs = Date.parse(`${params.fromDate}T00:00:00+07:00`);
  const toDateMs = Date.parse(`${params.toDate}T23:59:59.999+07:00`);

  const summary: ScalevSourceClassBackfillSummary = {
    apply: params.apply,
    batchSize: params.batchSize,
    fromDate: params.fromDate,
    toDate: params.toDate,
    schemaHasSourceClassColumns: true,
    scanned: 0,
    inCreatedAtWindow: 0,
    inScope: 0,
    changed: 0,
    unchanged: 0,
    updated: 0,
    perDate: {},
  };

  let includeSourceClassColumns = true;
  let cursorId: number | null = null;
  let batchNumber = 0;
  let updateBuffer: Array<{ id: number; dateKey: string; source_class: string; source_class_reason: string }> = [];

  while (true) {
    let rows: OrderRow[];

    try {
      rows = await fetchOrderBatch({
        supabase: params.supabase,
        cursorId,
        batchSize: params.batchSize,
        includeSourceClassColumns,
      });
    } catch (error: any) {
      if (!includeSourceClassColumns || !isMissingSourceClassColumnError(error)) {
        throw error;
      }
      if (params.apply) {
        throw new Error('Migration 131 belum diterapkan di database target. Jalankan migration source_class sebelum backfill --apply.');
      }
      includeSourceClassColumns = false;
      summary.schemaHasSourceClassColumns = false;
      rows = await fetchOrderBatch({
        supabase: params.supabase,
        cursorId,
        batchSize: params.batchSize,
        includeSourceClassColumns: false,
      });
    }

    if (rows.length === 0) break;

    batchNumber += 1;
    cursorId = rows[rows.length - 1]?.id ?? null;
    let batchAllOlderThanFromDate = true;

    for (const row of rows) {
      summary.scanned += 1;

      const createdAtMs = toMs(row.created_at);
      if (createdAtMs == null || createdAtMs < fromDateMs) {
        continue;
      }

      batchAllOlderThanFromDate = false;
      summary.inCreatedAtWindow += 1;

      const effectiveTs = earliestReliableTimestamp(row);
      const effectiveMs = toMs(effectiveTs);
      if (effectiveMs == null || effectiveMs < fromDateMs || effectiveMs > toDateMs) {
        continue;
      }

      const dateKey = getJakartaDateKey(String(effectiveTs));
      const bucket = summary.perDate[dateKey] || {
        rowsSeen: 0,
        inScope: 0,
        changed: 0,
        unchanged: 0,
        updated: 0,
      };
      bucket.rowsSeen += 1;
      bucket.inScope += 1;
      summary.perDate[dateKey] = bucket;
      summary.inScope += 1;

      const storeKey = `${String(row.business_code || '').trim()}:${String(row.store_name || '').trim().toLowerCase()}`;
      const next = buildScalevSourceClassFields({
        source: row.source,
        platform: row.platform,
        externalId: row.external_id,
        financialEntity: row.financial_entity,
        rawData: row.raw_data,
        storeName: row.store_name,
        storeType: storeTypeMap.get(storeKey) || null,
      });

      if (row.source_class === next.source_class && row.source_class_reason === next.source_class_reason) {
        summary.unchanged += 1;
        bucket.unchanged += 1;
        continue;
      }

      summary.changed += 1;
      bucket.changed += 1;
      updateBuffer.push({
        id: row.id,
        dateKey,
        source_class: next.source_class,
        source_class_reason: next.source_class_reason,
      });

      if (params.apply && updateBuffer.length >= FLUSH_BATCH_SIZE) {
        const flushedRows = [...updateBuffer];
        const flushed = await flushUpdates({
          supabase: params.supabase,
          updates: flushedRows.map(({ id, source_class, source_class_reason }) => ({
            id,
            source_class,
            source_class_reason,
          })),
        });
        summary.updated += flushed;
        for (const updatedRow of flushedRows) {
          summary.perDate[updatedRow.dateKey].updated += 1;
        }
        updateBuffer = [];
      }
    }

    if (!params.apply) {
      updateBuffer = [];
    }

    if (params.onProgress && (batchNumber === 1 || batchNumber % 10 === 0)) {
      await params.onProgress({
        phase: params.apply ? 'apply' : 'dry_run',
        batchNumber,
        cursorId,
        scanned: summary.scanned,
        inCreatedAtWindow: summary.inCreatedAtWindow,
        inScope: summary.inScope,
        changed: summary.changed,
        unchanged: summary.unchanged,
      });
    }

    if (batchAllOlderThanFromDate) {
      break;
    }
  }

  if (params.apply && updateBuffer.length > 0) {
    const flushedRows = [...updateBuffer];
    const flushed = await flushUpdates({
      supabase: params.supabase,
      updates: flushedRows.map(({ id, source_class, source_class_reason }) => ({
        id,
        source_class,
        source_class_reason,
      })),
    });
    summary.updated += flushed;
    for (const updatedRow of flushedRows) {
      summary.perDate[updatedRow.dateKey].updated += 1;
    }
  }

  return summary;
}

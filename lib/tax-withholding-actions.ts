'use server';

import * as XLSX from 'xlsx';
import { createServiceSupabase } from './supabase-server';
import { requireDashboardTabAccess } from './dashboard-access';
import {
  FACILITY_CODES,
  TAX_ARTICLES,
  UNIQUE_IDENTITY_TYPES,
  normalizeCounterpartyInput,
  normalizeEntityInput,
  normalizeFacilityInput,
  type CounterpartyInput,
  type FacilityCode,
  type FacilityInput,
  type IdentityType,
  type TaxArticle,
  type WithholdingEntityInput,
} from './tax-withholding-domain';
import {
  parseCounterpartyMaster,
  type ImportIssue,
  type ParsedCounterparty,
  type SheetRow,
} from './tax-withholding-import';

export type {
  CounterpartyInput,
  FacilityInput,
  WithholdingEntityInput,
} from './tax-withholding-domain';

const TAB_ID = 'tax-withholding';
const TAB_LABEL = 'Bukti Potong (PPh)';
const MANAGE_ROLES = ['owner', 'admin', 'direktur_finance', 'staf_finance'];
const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
// PostgREST caps a single response (1,000 rows by default), so every
// whole-workspace read pages until a short page comes back.
const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

async function fetchAllRows<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await page(from, from + PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const chunk = result.data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) return rows;
  }
}

export type TaxBusiness = { id: number; business_code: string; business_name: string; is_active: boolean };

export type TaxWithholdingEntity = {
  id: number;
  business_id: number;
  legal_name: string;
  npwp: string;
  tku_id: string;
  city: string | null;
  signer_name: string | null;
  signer_title: string | null;
  signer_npwp: string | null;
  is_active: boolean;
  updated_at: string;
};

export type TaxCounterpartyFacility = {
  id: number;
  counterparty_id: number;
  facility_code: FacilityCode;
  document_number: string | null;
  applies_to: TaxArticle[];
  rate_override: number | null;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
};

export type TaxCounterparty = {
  id: number;
  name: string;
  identity_type: IdentityType;
  identity_number: string;
  is_pkp: boolean;
  country_code: string;
  address: string | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
  updated_at: string;
  facilities: TaxCounterpartyFacility[];
};

export type TaxWithholdingBootstrap = {
  canManage: boolean;
  businesses: TaxBusiness[];
  entities: TaxWithholdingEntity[];
  counterparties: TaxCounterparty[];
  objectCodeCount: number;
};

async function requireTaxAccess() {
  const ctx = await requireDashboardTabAccess(TAB_ID, TAB_LABEL);
  return { ...ctx, canManage: MANAGE_ROLES.includes(ctx.profile.role) };
}

async function requireTaxManageAccess() {
  const ctx = await requireTaxAccess();
  if (!ctx.canManage) throw new Error('Hanya role finance yang dapat mengubah data bukti potong.');
  return ctx;
}

export async function getTaxWithholdingBootstrap(): Promise<TaxWithholdingBootstrap> {
  const { workspaceId, canManage } = await requireTaxAccess();
  const svc = createServiceSupabase();

  const [businesses, entities, counterparties, facilities, objectCodes] = await Promise.all([
    svc
      .from('scalev_webhook_businesses')
      .select('id, business_code, business_name, is_active')
      .eq('workspace_id', workspaceId)
      .order('business_code'),
    svc
      .from('tax_withholding_entities')
      .select('id, business_id, legal_name, npwp, tku_id, city, signer_name, signer_title, signer_npwp, is_active, updated_at')
      .eq('workspace_id', workspaceId)
      .order('legal_name'),
    fetchAllRows<Omit<TaxCounterparty, 'facilities'>>((from, to) => svc
      .from('tax_counterparties')
      .select('id, name, identity_type, identity_number, is_pkp, country_code, address, phone, notes, is_active, updated_at')
      .eq('workspace_id', workspaceId)
      .order('name')
      .order('id')
      .range(from, to)),
    fetchAllRows<TaxCounterpartyFacility>((from, to) => svc
      .from('tax_counterparty_facilities')
      .select('id, counterparty_id, facility_code, document_number, applies_to, rate_override, valid_from, valid_to, notes')
      .eq('workspace_id', workspaceId)
      .order('valid_from', { ascending: false, nullsFirst: false })
      .order('id')
      .range(from, to)),
    svc
      .from('tax_object_codes')
      .select('code', { count: 'exact', head: true })
      .eq('is_active', true),
  ]);

  if (businesses.error) throw businesses.error;
  if (entities.error) throw entities.error;
  if (objectCodes.error) throw objectCodes.error;

  const facilitiesByCounterparty = new Map<number, TaxCounterpartyFacility[]>();
  for (const facility of facilities) {
    const list = facilitiesByCounterparty.get(facility.counterparty_id) ?? [];
    list.push({ ...facility, rate_override: facility.rate_override === null ? null : Number(facility.rate_override) });
    facilitiesByCounterparty.set(facility.counterparty_id, list);
  }

  return {
    canManage,
    businesses: (businesses.data ?? []) as TaxBusiness[],
    entities: (entities.data ?? []) as TaxWithholdingEntity[],
    counterparties: counterparties.map((row) => ({
      ...row,
      facilities: facilitiesByCounterparty.get(row.id) ?? [],
    })),
    objectCodeCount: objectCodes.count ?? 0,
  };
}

export async function saveWithholdingEntity(input: WithholdingEntityInput): Promise<TaxWithholdingEntity> {
  const { workspaceId, profile } = await requireTaxManageAccess();
  const normalized = normalizeEntityInput(input);
  if (!normalized.value) throw new Error(normalized.errors.join(' '));
  const svc = createServiceSupabase();

  const business = await svc
    .from('scalev_webhook_businesses')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('id', normalized.value.business_id)
    .maybeSingle();
  if (business.error) throw business.error;
  if (!business.data) throw new Error('Business tidak ditemukan di workspace ini.');

  const payload = { ...normalized.value, workspace_id: workspaceId };
  const select = 'id, business_id, legal_name, npwp, tku_id, city, signer_name, signer_title, signer_npwp, is_active, updated_at';

  if (input.id) {
    const result = await svc
      .from('tax_withholding_entities')
      .update(payload)
      .eq('workspace_id', workspaceId)
      .eq('id', input.id)
      .select(select)
      .single();
    if (result.error) throw translateDbError(result.error, 'entity');
    return result.data as TaxWithholdingEntity;
  }

  const result = await svc
    .from('tax_withholding_entities')
    .insert({ ...payload, created_by: profile.id })
    .select(select)
    .single();
  if (result.error) throw translateDbError(result.error, 'entity');
  return result.data as TaxWithholdingEntity;
}

export async function saveCounterparty(input: CounterpartyInput): Promise<TaxCounterparty> {
  const { workspaceId, profile } = await requireTaxManageAccess();
  const normalized = normalizeCounterpartyInput(input);
  if (!normalized.value) throw new Error(normalized.errors.join(' '));
  const svc = createServiceSupabase();
  const payload = { ...normalized.value, workspace_id: workspaceId };
  const select = 'id, name, identity_type, identity_number, is_pkp, country_code, address, phone, notes, is_active, updated_at';

  const query = input.id
    ? svc.from('tax_counterparties').update(payload).eq('workspace_id', workspaceId).eq('id', input.id).select(select).single()
    : svc.from('tax_counterparties').insert({ ...payload, created_by: profile.id }).select(select).single();
  const result = await query;
  if (result.error) throw translateDbError(result.error, 'counterparty');

  const facilities = await svc
    .from('tax_counterparty_facilities')
    .select('id, counterparty_id, facility_code, document_number, applies_to, rate_override, valid_from, valid_to, notes')
    .eq('counterparty_id', result.data.id)
    .order('valid_from', { ascending: false, nullsFirst: false });
  if (facilities.error) throw facilities.error;

  return { ...(result.data as Omit<TaxCounterparty, 'facilities'>), facilities: (facilities.data ?? []) as TaxCounterpartyFacility[] };
}

export async function setCounterpartyActive(id: number, isActive: boolean): Promise<void> {
  const { workspaceId } = await requireTaxManageAccess();
  const svc = createServiceSupabase();
  const result = await svc
    .from('tax_counterparties')
    .update({ is_active: isActive })
    .eq('workspace_id', workspaceId)
    .eq('id', id);
  if (result.error) throw result.error;
}

export async function saveCounterpartyFacility(input: FacilityInput): Promise<TaxCounterpartyFacility> {
  const { workspaceId, profile } = await requireTaxManageAccess();
  const normalized = normalizeFacilityInput(input);
  if (!normalized.value) throw new Error(normalized.errors.join(' '));
  const svc = createServiceSupabase();

  const owner = await svc
    .from('tax_counterparties')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('id', normalized.value.counterparty_id)
    .maybeSingle();
  if (owner.error) throw owner.error;
  if (!owner.data) throw new Error('Lawan transaksi tidak ditemukan di workspace ini.');

  const payload = { ...normalized.value, workspace_id: workspaceId };
  const select = 'id, counterparty_id, facility_code, document_number, applies_to, rate_override, valid_from, valid_to, notes';
  const query = input.id
    ? svc.from('tax_counterparty_facilities').update(payload).eq('workspace_id', workspaceId).eq('id', input.id).select(select).single()
    : svc.from('tax_counterparty_facilities').insert({ ...payload, created_by: profile.id }).select(select).single();
  const result = await query;
  if (result.error) throw result.error;
  return result.data as TaxCounterpartyFacility;
}

export async function deleteCounterpartyFacility(id: number): Promise<void> {
  const { workspaceId } = await requireTaxManageAccess();
  const svc = createServiceSupabase();
  const result = await svc
    .from('tax_counterparty_facilities')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', id);
  if (result.error) throw result.error;
}

// ---------------------------------------------------------------------------
// Import of the legacy MASTER LAWAN TRANSAKSI sheet
// ---------------------------------------------------------------------------

export type CounterpartyImportPreview = {
  fileName: string;
  sheetName: string;
  headerRowNumber: number;
  totalRows: number;
  newCount: number;
  existingCount: number;
  facilityCount: number;
  skipped: number;
  issues: ImportIssue[];
  sample: Array<Pick<ParsedCounterparty, 'rowNumber' | 'name' | 'identity_type' | 'identity_number' | 'is_pkp' | 'country_code'> & { status: 'new' | 'existing' }>;
};

export type CounterpartyImportResult = {
  inserted: number;
  updated: number;
  facilitiesInserted: number;
  skipped: number;
  issues: ImportIssue[];
};

type ExistingCounterparty = {
  id: number;
  name: string;
  identity_type: IdentityType;
  identity_number: string;
  is_pkp: boolean;
  country_code: string;
  address: string | null;
  notes: string | null;
};

async function readMasterSheet(formData: FormData): Promise<{ fileName: string; sheetName: string; rows: SheetRow[] }> {
  const file = formData.get('file');
  if (!(file instanceof File)) throw new Error('File workbook tidak ditemukan.');
  if (file.size === 0) throw new Error('File kosong.');
  if (file.size > MAX_IMPORT_BYTES) throw new Error('Ukuran file melebihi 15 MB.');
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) throw new Error('Format file harus .xlsx atau .xlsm.');

  // Dates stay as Excel serials: the xlsx Date conversion drifts by seconds across time zones.
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const requestedSheet = String(formData.get('sheet') ?? '').trim();
  const candidates = requestedSheet
    ? [requestedSheet]
    : [
      ...workbook.SheetNames.filter((name) => /lawan\s*transaksi/i.test(name)),
      ...workbook.SheetNames.filter((name) => !/lawan\s*transaksi/i.test(name)),
    ];

  for (const sheetName of candidates) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    // blankrows plus the range offset keep Excel row numbers aligned with the issue report.
    const rangeStart = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).s.r : 0;
    const rows: SheetRow[] = [
      ...Array.from({ length: rangeStart }, () => [] as SheetRow),
      ...XLSX.utils.sheet_to_json<SheetRow>(sheet, { header: 1, defval: null, raw: true, blankrows: true }),
    ];
    const headerText = rows.slice(0, 15).map((row) => row.map((cell) => String(cell ?? '').toLowerCase()).join('|')).join('\n');
    if (headerText.includes('nama lawan transaksi')) return { fileName: file.name, sheetName, rows };
  }
  throw new Error('Sheet "MASTER LAWAN TRANSAKSI" tidak ditemukan di workbook ini.');
}

async function loadExistingCounterparties(workspaceId: string): Promise<ExistingCounterparty[]> {
  const svc = createServiceSupabase();
  return fetchAllRows<ExistingCounterparty>((from, to) => svc
    .from('tax_counterparties')
    .select('id, name, identity_type, identity_number, is_pkp, country_code, address, notes')
    .eq('workspace_id', workspaceId)
    .order('id')
    .range(from, to));
}

function matchExisting(row: ParsedCounterparty, existing: ExistingCounterparty[]) {
  const byIdentity = UNIQUE_IDENTITY_TYPES.includes(row.identity_type)
    ? existing.find((item) => item.identity_type === row.identity_type && item.identity_number === row.identity_number)
    : undefined;
  if (byIdentity) return { match: byIdentity, via: 'identity' as const };
  const byName = existing.find((item) => item.name.trim().toLowerCase() === row.name.toLowerCase());
  if (byName) return { match: byName, via: 'name' as const };
  return { match: null, via: null };
}

export async function previewCounterpartyImport(formData: FormData): Promise<CounterpartyImportPreview> {
  const { workspaceId } = await requireTaxManageAccess();
  const { fileName, sheetName, rows } = await readMasterSheet(formData);
  const parsed = parseCounterpartyMaster(rows);
  const existing = await loadExistingCounterparties(workspaceId);

  let newCount = 0;
  let existingCount = 0;
  const sample: CounterpartyImportPreview['sample'] = [];
  for (const row of parsed.rows) {
    const { match, via } = matchExisting(row, existing);
    if (match) {
      existingCount += 1;
      if (via === 'name' && UNIQUE_IDENTITY_TYPES.includes(match.identity_type) && UNIQUE_IDENTITY_TYPES.includes(row.identity_type)
        && (match.identity_type !== row.identity_type || match.identity_number !== row.identity_number)) {
        parsed.issues.push({
          level: 'warning',
          rowNumber: row.rowNumber,
          name: row.name,
          message: 'Nama sudah ada dengan identitas berbeda; identitas lama dipertahankan, hanya fasilitas yang ditambahkan.',
        });
      }
    } else newCount += 1;
    if (sample.length < 25) {
      sample.push({
        rowNumber: row.rowNumber,
        name: row.name,
        identity_type: row.identity_type,
        identity_number: row.identity_number,
        is_pkp: row.is_pkp,
        country_code: row.country_code,
        status: match ? 'existing' : 'new',
      });
    }
  }

  return {
    fileName,
    sheetName,
    headerRowNumber: parsed.headerRowNumber,
    totalRows: parsed.rows.length,
    newCount,
    existingCount,
    facilityCount: parsed.rows.reduce((sum, row) => sum + row.facilities.length, 0),
    skipped: parsed.skipped,
    issues: sortIssues(parsed.issues),
    sample,
  };
}

export async function commitCounterpartyImport(formData: FormData): Promise<CounterpartyImportResult> {
  const { workspaceId, profile } = await requireTaxManageAccess();
  const { rows } = await readMasterSheet(formData);
  const parsed = parseCounterpartyMaster(rows);
  if (parsed.rows.length === 0) throw new Error('Tidak ada baris lawan transaksi yang bisa diimpor.');

  const svc = createServiceSupabase();
  const existing = await loadExistingCounterparties(workspaceId);
  const issues = [...parsed.issues];
  const importNote = 'Diimpor dari MASTER LAWAN TRANSAKSI';

  const toInsert: Array<{ row: ParsedCounterparty; payload: Record<string, unknown> }> = [];
  const toUpdate: Array<{ id: number; payload: Record<string, unknown> }> = [];
  const facilityTargets: Array<{ counterpartyId: number | null; row: ParsedCounterparty }> = [];

  for (const row of parsed.rows) {
    const { match } = matchExisting(row, existing);
    if (match) {
      const payload: Record<string, unknown> = {};
      if (row.is_pkp && !match.is_pkp) payload.is_pkp = true;
      if (row.country_code !== 'IDN' && match.country_code === 'IDN') payload.country_code = row.country_code;
      if (row.address && !match.address) payload.address = row.address;
      if (row.notes && !(match.notes ?? '').includes(row.notes)) payload.notes = [match.notes, row.notes].filter(Boolean).join('; ');
      if (Object.keys(payload).length > 0) toUpdate.push({ id: match.id, payload });
      if (row.facilities.length > 0) facilityTargets.push({ counterpartyId: match.id, row });
      continue;
    }
    toInsert.push({
      row,
      payload: {
        workspace_id: workspaceId,
        name: row.name,
        identity_type: row.identity_type,
        identity_number: row.identity_number,
        is_pkp: row.is_pkp,
        country_code: row.country_code,
        address: row.address,
        notes: [importNote, row.notes].filter(Boolean).join('; '),
        is_active: true,
        created_by: profile.id,
      },
    });
  }

  let inserted = 0;
  for (let offset = 0; offset < toInsert.length; offset += 100) {
    const chunk = toInsert.slice(offset, offset + 100);
    const result = await svc
      .from('tax_counterparties')
      .insert(chunk.map((item) => item.payload))
      .select('id, name, identity_type, identity_number');
    if (result.error) {
      // Fall back to row-by-row so one bad row does not block the batch.
      for (const item of chunk) {
        const single = await svc.from('tax_counterparties').insert(item.payload).select('id').single();
        if (single.error) {
          issues.push({ level: 'error', rowNumber: item.row.rowNumber, name: item.row.name, message: translateDbError(single.error, 'counterparty').message });
          continue;
        }
        inserted += 1;
        if (item.row.facilities.length > 0) facilityTargets.push({ counterpartyId: single.data.id as number, row: item.row });
      }
      continue;
    }
    inserted += result.data.length;
    for (const item of chunk) {
      const created = result.data.find((record: { name: string; identity_type: string; identity_number: string }) =>
        record.identity_type === item.row.identity_type && record.identity_number === item.row.identity_number && record.name === item.row.name);
      if (created && item.row.facilities.length > 0) facilityTargets.push({ counterpartyId: created.id as number, row: item.row });
    }
  }

  let updated = 0;
  for (const item of toUpdate) {
    const result = await svc.from('tax_counterparties').update(item.payload).eq('workspace_id', workspaceId).eq('id', item.id);
    if (result.error) issues.push({ level: 'error', rowNumber: 0, name: String(item.id), message: result.error.message });
    else updated += 1;
  }

  let facilitiesInserted = 0;
  const targetIds = facilityTargets.map((target) => target.counterpartyId).filter((id): id is number => id !== null);
  if (targetIds.length > 0) {
    type FacilityKeyRow = { counterparty_id: number; facility_code: string; document_number: string | null };
    const existingFacilities = await fetchAllRows<FacilityKeyRow>((from, to) => svc
      .from('tax_counterparty_facilities')
      .select('counterparty_id, facility_code, document_number')
      .eq('workspace_id', workspaceId)
      .order('id')
      .range(from, to));
    const seen = new Set(
      existingFacilities.map((item) => `${item.counterparty_id}|${item.facility_code}|${item.document_number ?? ''}`),
    );
    const facilityRows: Record<string, unknown>[] = [];
    for (const target of facilityTargets) {
      if (target.counterpartyId === null) continue;
      for (const facility of target.row.facilities) {
        const key = `${target.counterpartyId}|${facility.facility_code}|${facility.document_number ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        facilityRows.push({ ...facility, counterparty_id: target.counterpartyId, workspace_id: workspaceId, created_by: profile.id });
      }
    }
    for (let offset = 0; offset < facilityRows.length; offset += 100) {
      const result = await svc.from('tax_counterparty_facilities').insert(facilityRows.slice(offset, offset + 100));
      if (result.error) throw result.error;
      facilitiesInserted += Math.min(100, facilityRows.length - offset);
    }
  }

  return { inserted, updated, facilitiesInserted, skipped: parsed.skipped, issues: sortIssues(issues) };
}

function sortIssues(issues: ImportIssue[]): ImportIssue[] {
  return [...issues].sort((a, b) => (a.level === b.level ? a.rowNumber - b.rowNumber : a.level === 'error' ? -1 : 1));
}

function translateDbError(error: { code?: string; message: string }, kind: 'entity' | 'counterparty'): Error {
  if (error.code === '23505') {
    if (kind === 'entity') return new Error('Business ini sudah memiliki data pemotong.');
    if (/identity/.test(error.message)) return new Error('NPWP/NIK ini sudah terdaftar pada lawan transaksi lain.');
    return new Error('Nama lawan transaksi sudah dipakai.');
  }
  if (error.code === '23514') return new Error('Data tidak lolos validasi database: ' + error.message);
  return new Error(error.message);
}

export async function getTaxReferenceOptions(): Promise<{ facilityCodes: readonly FacilityCode[]; articles: readonly TaxArticle[] }> {
  await requireTaxAccess();
  return { facilityCodes: FACILITY_CODES, articles: TAX_ARTICLES };
}

// Pure domain helpers for the Bukti Potong PPh (Coretax BPPU) feature.
// No database or framework imports: everything here is unit-testable.

export const TAX_ARTICLES = ['pph22', 'pph23', 'pph4_2', 'pph15', 'pph26'] as const;
export type TaxArticle = (typeof TAX_ARTICLES)[number];

export const TAX_ARTICLE_LABELS: Record<TaxArticle, string> = {
  pph22: 'PPh 22',
  pph23: 'PPh 23',
  pph4_2: 'PPh 4(2)',
  pph15: 'PPh 15',
  pph26: 'PPh 26',
};

// Coretax <TaxCertificate> enum plus SKD, which Roove tracks for PPh 26
// (tax-treaty residence certificates). SKD is mapped at export time.
export const FACILITY_CODES = [
  'TaxExAr22',
  'TaxExAr23',
  'TaxExIntDep',
  'TaxExIntPhtb',
  'DTP',
  'PP23',
  'ETC',
  'SKD',
] as const;
export type FacilityCode = (typeof FACILITY_CODES)[number];

export const FACILITY_LABELS: Record<FacilityCode, string> = {
  TaxExAr22: 'SKB PPh Pasal 22',
  TaxExAr23: 'SKB PPh Pasal 23',
  TaxExIntDep: 'SKB Bunga Deposito/Tabungan',
  TaxExIntPhtb: 'SKB Pengalihan Hak Tanah/Bangunan',
  DTP: 'PPh Ditanggung Pemerintah',
  PP23: 'Surat Keterangan PP 23/2018',
  ETC: 'Fasilitas Lainnya',
  SKD: 'Surat Keterangan Domisili (P3B)',
};

// Default articles a facility applies to. Users can override per facility.
export const FACILITY_DEFAULT_ARTICLES: Record<FacilityCode, TaxArticle[]> = {
  TaxExAr22: ['pph22'],
  TaxExAr23: ['pph23'],
  TaxExIntDep: ['pph4_2'],
  TaxExIntPhtb: ['pph4_2'],
  DTP: ['pph23', 'pph4_2'],
  PP23: ['pph23', 'pph4_2'],
  ETC: ['pph23'],
  SKD: ['pph26'],
};

export const IDENTITY_TYPES = ['npwp', 'nik', 'foreign_tin', 'unknown'] as const;
export type IdentityType = (typeof IDENTITY_TYPES)[number];

export const IDENTITY_LABELS: Record<IdentityType, string> = {
  npwp: 'NPWP',
  nik: 'NIK',
  foreign_tin: 'TIN luar negeri',
  unknown: 'Belum ada identitas',
};

/** Identity types that can be matched/deduplicated by number. */
export const UNIQUE_IDENTITY_TYPES: readonly IdentityType[] = ['npwp', 'nik'];
export const UNKNOWN_IDENTITY_PLACEHOLDER = 'TIDAK ADA IDENTITAS';

export const DEFAULT_COUNTRY = 'IDN';

// Coretax <Document> enum for the reference document of a slip.
export const DOCUMENT_TYPES = [
  'CommercialInvoice', 'TaxInvoice', 'Contract', 'PaymentProof', 'StatementLetter',
  'Announchment', 'DeedofEngangement', 'DeedofGeneralMeetingStakeholder', 'BankAccountNumber',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type SlipStatus = 'draft' | 'ready' | 'exported' | 'reported' | 'paid';

export function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export type IdentityNormalization = {
  value: string | null;
  error: string | null;
  /** True when a legacy 15-digit NPWP was padded to 16 digits. */
  converted: boolean;
};

/**
 * Normalizes an NPWP to the 16-digit Coretax form.
 * Legacy 15-digit NPWP (`94.042.441.9-429.000`) becomes `0940424419429000`.
 */
export function normalizeNpwp(raw: unknown): IdentityNormalization {
  const digits = digitsOnly(raw);
  if (!digits) return { value: null, error: 'NPWP kosong.', converted: false };
  if (digits.length === 16) return { value: digits, error: null, converted: false };
  if (digits.length === 15) return { value: `0${digits}`, error: null, converted: true };
  return { value: null, error: `NPWP harus 15 atau 16 digit, ditemukan ${digits.length} digit.`, converted: false };
}

export function normalizeNik(raw: unknown): IdentityNormalization {
  const digits = digitsOnly(raw);
  if (!digits) return { value: null, error: 'NIK kosong.', converted: false };
  if (digits.length !== 16) {
    return { value: null, error: `NIK harus 16 digit, ditemukan ${digits.length} digit.`, converted: false };
  }
  return { value: digits, error: null, converted: false };
}

export function normalizeIdentity(type: IdentityType, raw: unknown): IdentityNormalization {
  if (type === 'npwp') return normalizeNpwp(raw);
  if (type === 'nik') return normalizeNik(raw);
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (type === 'unknown') return { value: text || UNKNOWN_IDENTITY_PLACEHOLDER, error: null, converted: false };
  if (!text) return { value: null, error: 'TIN kosong.', converted: false };
  return { value: text, error: null, converted: false };
}

/** Formats a 16-digit NPWP for display; 15-digit legacy values padded with 0 show in the classic format. */
export function formatNpwp(digits: string): string {
  const d = digitsOnly(digits);
  if (d.length === 16 && d.startsWith('0')) {
    const legacy = d.slice(1);
    return `${legacy.slice(0, 2)}.${legacy.slice(2, 5)}.${legacy.slice(5, 8)}.${legacy.slice(8, 9)}-${legacy.slice(9, 12)}.${legacy.slice(12, 15)}`;
  }
  if (d.length === 16) return `${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8, 12)} ${d.slice(12, 16)}`;
  return digits;
}

export function formatIdentity(type: IdentityType, value: string): string {
  if (type === 'npwp') return formatNpwp(value);
  if (type === 'nik') return value.replace(/(\d{4})(?=\d)/g, '$1 ');
  return value;
}

/** ID Tempat Kegiatan Usaha (TKU) pusat = NPWP 16 digit + 000000. */
export function tkuFromNpwp(npwp16: string): string {
  return `${npwp16}000000`;
}

export function isValidTku(value: unknown): boolean {
  return /^[0-9]{22}$/.test(String(value ?? ''));
}

export function isValidCountryCode(value: unknown): boolean {
  return /^[A-Z]{3}$/.test(String(value ?? ''));
}

export type FacilityWindow = {
  valid_from: string | null;
  valid_to: string | null;
};

/** A facility applies on a date when the date falls inside [valid_from, valid_to]; open ends are unbounded. */
export function isFacilityActiveOn(facility: FacilityWindow, isoDate: string): boolean {
  if (facility.valid_from && isoDate < facility.valid_from) return false;
  if (facility.valid_to && isoDate > facility.valid_to) return false;
  return true;
}

export function facilityExpiryStatus(
  facility: FacilityWindow,
  todayIso: string,
  warnDays = 30,
): 'expired' | 'expiring' | 'active' | 'upcoming' {
  if (facility.valid_from && todayIso < facility.valid_from) return 'upcoming';
  if (!facility.valid_to) return 'active';
  if (todayIso > facility.valid_to) return 'expired';
  const today = new Date(`${todayIso}T00:00:00Z`).getTime();
  const end = new Date(`${facility.valid_to}T00:00:00Z`).getTime();
  const days = Math.round((end - today) / 86_400_000);
  return days <= warnDays ? 'expiring' : 'active';
}

export type WithholdingEntityInput = {
  id?: number | null;
  businessId: number;
  legalName: string;
  npwp: string;
  tkuId?: string | null;
  city?: string | null;
  signerName?: string | null;
  signerTitle?: string | null;
  signerNpwp?: string | null;
  isActive?: boolean;
};

export type NormalizedEntity = {
  business_id: number;
  legal_name: string;
  npwp: string;
  tku_id: string;
  city: string | null;
  signer_name: string | null;
  signer_title: string | null;
  signer_npwp: string | null;
  is_active: boolean;
};

export function normalizeEntityInput(input: WithholdingEntityInput): { value: NormalizedEntity | null; errors: string[] } {
  const errors: string[] = [];
  const legalName = String(input.legalName ?? '').trim();
  if (!legalName) errors.push('Nama badan wajib diisi.');
  if (!Number.isInteger(input.businessId) || input.businessId <= 0) errors.push('Business wajib dipilih.');

  const npwp = normalizeNpwp(input.npwp);
  if (npwp.error) errors.push(`NPWP pemotong: ${npwp.error}`);

  const tkuRaw = digitsOnly(input.tkuId);
  const tku = tkuRaw ? tkuRaw : npwp.value ? tkuFromNpwp(npwp.value) : '';
  if (!isValidTku(tku)) errors.push('ID TKU harus 22 digit angka.');
  if (npwp.value && tku && !tku.startsWith(npwp.value)) errors.push('ID TKU harus diawali NPWP pemotong.');

  let signerNpwp: string | null = null;
  if (String(input.signerNpwp ?? '').trim()) {
    const signer = normalizeNpwp(input.signerNpwp);
    if (signer.error) errors.push(`NPWP penandatangan: ${signer.error}`);
    signerNpwp = signer.value;
  }

  if (errors.length > 0 || !npwp.value) return { value: null, errors };
  return {
    value: {
      business_id: input.businessId,
      legal_name: legalName,
      npwp: npwp.value,
      tku_id: tku,
      city: cleanOptional(input.city),
      signer_name: cleanOptional(input.signerName),
      signer_title: cleanOptional(input.signerTitle),
      signer_npwp: signerNpwp,
      is_active: input.isActive ?? true,
    },
    errors,
  };
}

export type CounterpartyInput = {
  id?: number | null;
  name: string;
  identityType: IdentityType;
  identityNumber: string;
  isPkp?: boolean;
  countryCode?: string | null;
  address?: string | null;
  phone?: string | null;
  notes?: string | null;
  isActive?: boolean;
};

export type NormalizedCounterparty = {
  name: string;
  identity_type: IdentityType;
  identity_number: string;
  is_pkp: boolean;
  country_code: string;
  address: string | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
};

export function normalizeCounterpartyInput(input: CounterpartyInput): {
  value: NormalizedCounterparty | null;
  errors: string[];
  converted: boolean;
} {
  const errors: string[] = [];
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) errors.push('Nama lawan transaksi wajib diisi.');
  if (!IDENTITY_TYPES.includes(input.identityType)) errors.push('Jenis identitas tidak valid.');

  const identity = IDENTITY_TYPES.includes(input.identityType)
    ? normalizeIdentity(input.identityType, input.identityNumber)
    : { value: null, error: null, converted: false };
  if (identity.error) errors.push(identity.error);

  const country = String(input.countryCode ?? DEFAULT_COUNTRY).trim().toUpperCase() || DEFAULT_COUNTRY;
  if (!isValidCountryCode(country)) errors.push('Kode negara harus 3 huruf (ISO 3166-1 alpha-3), contoh IDN atau SGP.');
  if (input.identityType === 'foreign_tin' && country === DEFAULT_COUNTRY) {
    errors.push('TIN luar negeri memerlukan kode negara selain IDN.');
  }

  if (errors.length > 0 || !identity.value) return { value: null, errors, converted: false };
  return {
    value: {
      name,
      identity_type: input.identityType,
      identity_number: identity.value,
      is_pkp: Boolean(input.isPkp),
      country_code: country,
      address: cleanOptional(input.address),
      phone: cleanOptional(input.phone),
      notes: cleanOptional(input.notes),
      is_active: input.isActive ?? true,
    },
    errors,
    converted: identity.converted,
  };
}

export type FacilityInput = {
  id?: number | null;
  counterpartyId: number;
  facilityCode: FacilityCode;
  documentNumber?: string | null;
  appliesTo?: TaxArticle[] | null;
  rateOverride?: number | string | null;
  validFrom?: string | null;
  validTo?: string | null;
  notes?: string | null;
};

export type NormalizedFacility = {
  counterparty_id: number;
  facility_code: FacilityCode;
  document_number: string | null;
  applies_to: TaxArticle[];
  rate_override: number | null;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
};

export function normalizeFacilityInput(input: FacilityInput): { value: NormalizedFacility | null; errors: string[] } {
  const errors: string[] = [];
  if (!Number.isInteger(input.counterpartyId) || input.counterpartyId <= 0) errors.push('Lawan transaksi wajib dipilih.');
  if (!FACILITY_CODES.includes(input.facilityCode)) errors.push('Jenis fasilitas tidak valid.');

  // Defaults apply only when the caller did not choose; an explicit empty
  // selection (every checkbox cleared) is an error, not a silent default.
  const appliesToSource = input.appliesTo === null || input.appliesTo === undefined
    ? FACILITY_DEFAULT_ARTICLES[input.facilityCode] ?? []
    : input.appliesTo;
  const appliesTo = appliesToSource.filter((article): article is TaxArticle => TAX_ARTICLES.includes(article));
  if (appliesTo.length === 0) errors.push('Pilih minimal satu pasal PPh yang dikenai fasilitas.');

  let rateOverride: number | null = null;
  if (input.rateOverride !== null && input.rateOverride !== undefined && String(input.rateOverride).trim() !== '') {
    const parsed = Number(String(input.rateOverride).replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) errors.push('Tarif fasilitas harus angka 0 sampai 100.');
    else rateOverride = parsed;
  }

  const validFrom = normalizeIsoDate(input.validFrom);
  const validTo = normalizeIsoDate(input.validTo);
  if (validFrom === undefined) errors.push('Tanggal mulai berlaku tidak valid.');
  if (validTo === undefined) errors.push('Tanggal akhir berlaku tidak valid.');
  if (validFrom && validTo && validTo < validFrom) errors.push('Tanggal akhir berlaku harus setelah tanggal mulai.');

  if (errors.length > 0 || validFrom === undefined || validTo === undefined) return { value: null, errors };
  return {
    value: {
      counterparty_id: input.counterpartyId,
      facility_code: input.facilityCode,
      document_number: cleanOptional(input.documentNumber),
      applies_to: [...new Set(appliesTo)],
      rate_override: rateOverride,
      valid_from: validFrom,
      valid_to: validTo,
      notes: cleanOptional(input.notes),
    },
    errors,
  };
}

export type DateOptions = {
  /** Workbook uses the 1904 date system (Excel for Mac legacy); serials are 1,462 days smaller. */
  date1904?: boolean;
};

const EXCEL_EPOCH_1900 = Date.UTC(1899, 11, 30);
const EXCEL_EPOCH_1904 = Date.UTC(1904, 0, 1);

/** Returns null for empty, the ISO date for valid input, undefined for invalid input. */
export function normalizeIsoDate(value: unknown, options: DateOptions = {}): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    // Excel serial date. Anything numeric outside 1950..2119 is not treated as a date.
    const epoch = options.date1904 ? EXCEL_EPOCH_1904 : EXCEL_EPOCH_1900;
    if (!Number.isFinite(value)) return undefined;
    const date = new Date(epoch + Math.round(value) * 86_400_000);
    if (!Number.isFinite(date.getTime())) return undefined;
    const year = date.getUTCFullYear();
    if (year < 1950 || year > 2119) return undefined;
    return date.toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    // Spreadsheet libraries build Date values in local time and may land a few
    // seconds before midnight; shift by half a day and read the local calendar date.
    const shifted = new Date(value.getTime() + 12 * 3_600_000);
    return checkDate(shifted.getFullYear(), shifted.getMonth() + 1, shifted.getDate());
  }
  const text = String(value).trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return checkDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (dmy) return checkDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  return undefined;
}

function checkDate(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

/**
 * Both preview and commit carry the page's workspace. The active workspace
 * cookie is shared across tabs, so neither request may silently change target.
 */
export function checkImportWorkspace(expected: unknown, actual: string): string | null {
  const text = String(expected ?? '').trim();
  if (!text) return 'Pratinjau impor belum dilakukan untuk workspace ini. Jalankan Pratinjau dahulu.';
  if (text !== actual) {
    return 'Workspace aktif berubah. Muat ulang halaman di workspace tujuan, lalu ulangi Pratinjau.';
  }
  return null;
}

export function cleanOptional(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

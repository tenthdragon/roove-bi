// Parses the legacy "MASTER LAWAN TRANSAKSI" sheet of the REKAP POTPUT
// workbook into normalized counterparties plus facilities. Pure: callers pass
// the sheet as an array of rows (array of cell values).

import {
  DEFAULT_COUNTRY,
  FACILITY_DEFAULT_ARTICLES,
  UNIQUE_IDENTITY_TYPES,
  UNKNOWN_IDENTITY_PLACEHOLDER,
  cleanOptional,
  normalizeIsoDate,
  normalizeNik,
  normalizeNpwp,
  type FacilityCode,
  type IdentityType,
  type TaxArticle,
} from './tax-withholding-domain';

export type SheetCell = string | number | boolean | Date | null | undefined;
export type SheetRow = SheetCell[];

export type ImportIssueLevel = 'error' | 'warning';

export type ImportIssue = {
  level: ImportIssueLevel;
  rowNumber: number;
  name: string;
  message: string;
};

export type ParsedFacility = {
  facility_code: FacilityCode;
  document_number: string | null;
  applies_to: TaxArticle[];
  rate_override: number | null;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
};

export type ParsedCounterparty = {
  rowNumber: number;
  name: string;
  identity_type: IdentityType;
  identity_number: string;
  is_pkp: boolean;
  country_code: string;
  address: string | null;
  notes: string | null;
  facilities: ParsedFacility[];
  warnings: string[];
};

export type ParsedMaster = {
  headerRowNumber: number;
  rows: ParsedCounterparty[];
  issues: ImportIssue[];
  skipped: number;
};

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['nama lawan transaksi', 'nama'],
  npwp: ['npwp'],
  nik: ['ktp', 'nik'],
  status: ['status'],
  pkp: ['status pkp', 'pkp'],
  tin: ['tin'],
  address: ['alamat'],
  country: ['kode negara', 'negara'],
  facility: ['jenis fasilitas'],
  skbNumber: ['no. skd / skb', 'no skd / skb', 'no. skb', 'nomor skb', 'no. skd', 'nomor skd'],
  dtpRule: ['aturan dtp'],
  pp23Number: ['nomor suket pp23', 'no suket pp23', 'suket pp23'],
  validFrom: ['tgl berlaku skd/skb/pp23', 'tgl berlaku', 'tanggal berlaku'],
};

const PLACEHOLDER_FOREIGN_NPWP = /^0?9{3}0{5,8}9{3}0{3}$/; // 999000000999000 and its 16-digit variants

function cellText(cell: SheetCell): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

function normalizeHeader(cell: SheetCell): string {
  return cellText(cell).toLowerCase().replace(/\s+/g, ' ').trim();
}

export function findHeaderRow(rows: SheetRow[]): number {
  for (let index = 0; index < Math.min(rows.length, 15); index += 1) {
    const headers = rows[index].map(normalizeHeader);
    if (headers.includes('nama lawan transaksi') && headers.some((h) => h === 'npwp')) return index;
  }
  return -1;
}

type ColumnMap = Record<string, number[]>;

function mapColumns(headerRow: SheetRow): ColumnMap {
  const map: ColumnMap = {};
  headerRow.forEach((cell, index) => {
    const header = normalizeHeader(cell);
    if (!header) return;
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(header)) (map[key] ||= []).push(index);
    }
  });
  return map;
}

function firstText(row: SheetRow, columns: number[] | undefined): string {
  for (const index of columns ?? []) {
    const text = cellText(row[index]);
    if (text) return text;
  }
  return '';
}

function mapLegacyFacility(label: string): FacilityCode | null {
  const key = label.trim().toUpperCase();
  if (!key || key === 'N' || key === '-') return null;
  if (key === 'SKB') return 'TaxExAr23';
  if (key === 'PP23') return 'PP23';
  if (key === 'SKD') return 'SKD';
  if (key === 'DTP') return 'DTP';
  if (key === 'LAIN' || key === 'LAINNYA' || key === 'ETC') return 'ETC';
  return null;
}

export function parseCounterpartyMaster(rows: SheetRow[]): ParsedMaster {
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) {
    return {
      headerRowNumber: 0,
      rows: [],
      issues: [{ level: 'error', rowNumber: 0, name: '', message: 'Header "NAMA LAWAN TRANSAKSI" dan "NPWP" tidak ditemukan di sheet ini.' }],
      skipped: 0,
    };
  }

  const columns = mapColumns(rows[headerIndex]);
  const issues: ImportIssue[] = [];
  const parsed: ParsedCounterparty[] = [];
  const seenNames = new Map<string, number>();
  const seenIdentities = new Map<string, number>();
  let skipped = 0;

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 1;
    const name = firstText(row, columns.name).replace(/\s+/g, ' ');
    if (!name) {
      skipped += 1;
      continue;
    }

    const warnings: string[] = [];
    const npwpRaw = columns.npwp?.map((c) => row[c]).find((v) => cellText(v));
    const nikRaw = columns.nik?.map((c) => row[c]).find((v) => cellText(v));
    const statusText = firstText(row, columns.status).toUpperCase();
    const tin = firstText(row, columns.tin);
    const countryText = firstText(row, columns.country).toUpperCase();
    const country = /^[A-Z]{3}$/.test(countryText) ? countryText : DEFAULT_COUNTRY;
    const npwpDigits = cellText(npwpRaw).replace(/\D/g, '');
    const isPlaceholderNpwp = PLACEHOLDER_FOREIGN_NPWP.test(npwpDigits);

    let identityType: IdentityType;
    let identityNumber: string | null = null;
    const notesExtra: string[] = [];

    if (country !== DEFAULT_COUNTRY && (tin || isPlaceholderNpwp || !npwpDigits)) {
      identityType = 'foreign_tin';
      identityNumber = tin || (npwpDigits && !isPlaceholderNpwp ? npwpDigits : null);
      if (!identityNumber) {
        identityNumber = npwpDigits || 'TIN-TIDAK-ADA';
        warnings.push('Vendor luar negeri tanpa TIN; NPWP placeholder dipakai sementara, lengkapi TIN sebelum pelaporan PPh 26.');
      }
      if (npwpDigits && !isPlaceholderNpwp) {
        warnings.push(`Vendor luar negeri juga memiliki NPWP ${npwpDigits}; disimpan di catatan.`);
      }
    } else if (isPlaceholderNpwp || (!npwpDigits && !cellText(nikRaw))) {
      identityType = 'unknown';
      identityNumber = UNKNOWN_IDENTITY_PLACEHOLDER;
      warnings.push(isPlaceholderNpwp
        ? 'NPWP placeholder (999...) untuk vendor dalam negeri; lengkapi NPWP/NIK sebelum dipakai di bukti potong.'
        : 'Tidak ada NPWP maupun NIK; lengkapi identitas sebelum dipakai di bukti potong.');
    } else if (statusText === 'NIK' || (!npwpDigits && cellText(nikRaw))) {
      const nikSource = cellText(nikRaw) ? nikRaw : npwpRaw;
      const nik = normalizeNik(nikSource);
      if (nik.error) {
        identityType = 'unknown';
        identityNumber = UNKNOWN_IDENTITY_PLACEHOLDER;
        const rawDigits = cellText(nikSource).replace(/\D/g, '');
        warnings.push(`${nik.error}${rawDigits ? ` Nilai asli ${rawDigits} disimpan di catatan.` : ''} Lengkapi identitas sebelum dipakai di bukti potong.`);
        if (rawDigits) notesExtra.push(`NIK asli (tidak valid): ${rawDigits}`);
      } else {
        identityType = 'nik';
        identityNumber = nik.value;
        if (typeof nikSource === 'number') {
          warnings.push('NIK tersimpan sebagai angka di Excel; digit terakhir mungkin sudah berubah, periksa ulang.');
        }
      }
    } else {
      identityType = 'npwp';
      const npwp = normalizeNpwp(npwpRaw);
      if (npwp.error) {
        issues.push({ level: 'error', rowNumber, name, message: npwp.error });
        continue;
      }
      identityNumber = npwp.value;
      if (npwp.converted) warnings.push('NPWP 15 digit dikonversi ke 16 digit dengan awalan 0.');
      if (isPlaceholderNpwp) warnings.push('NPWP placeholder luar negeri (999...) tanpa kode negara; periksa kode negara vendor.');
    }

    if (!identityNumber) {
      issues.push({ level: 'error', rowNumber, name, message: 'Identitas tidak dapat ditentukan.' });
      continue;
    }

    const nameKey = name.toLowerCase();
    const identityKey = `${identityType}:${identityNumber}`;
    const duplicateNameRow = seenNames.get(nameKey);
    const duplicateIdentityRow = UNIQUE_IDENTITY_TYPES.includes(identityType) ? seenIdentities.get(identityKey) : undefined;
    if (duplicateNameRow || duplicateIdentityRow) {
      issues.push({
        level: 'warning',
        rowNumber,
        name,
        message: duplicateIdentityRow
          ? `Identitas sama dengan baris ${duplicateIdentityRow}; baris ini dilewati.`
          : `Nama sama dengan baris ${duplicateNameRow}; baris ini dilewati.`,
      });
      skipped += 1;
      continue;
    }
    seenNames.set(nameKey, rowNumber);
    if (UNIQUE_IDENTITY_TYPES.includes(identityType)) seenIdentities.set(identityKey, rowNumber);

    const facilities: ParsedFacility[] = [];
    const facilityLabels = (columns.facility ?? []).map((c) => cellText(row[c])).filter(Boolean);
    const facilityCode = facilityLabels.map(mapLegacyFacility).find((code): code is FacilityCode => code !== null) ?? null;
    if (facilityLabels.length > 0 && !facilityCode) {
      warnings.push(`Jenis fasilitas "${facilityLabels[0]}" tidak dikenali dan tidak diimpor.`);
    }
    if (facilityCode) {
      const skbNumber = firstText(row, columns.skbNumber);
      const pp23Number = firstText(row, columns.pp23Number);
      const dtpRule = firstText(row, columns.dtpRule);
      const documentNumber = facilityCode === 'PP23'
        ? pp23Number || skbNumber
        : facilityCode === 'DTP'
          ? dtpRule || skbNumber
          : skbNumber || pp23Number;
      const validFromCell = columns.validFrom?.map((c) => row[c]).find((v) => cellText(v));
      const validFrom = normalizeIsoDate(validFromCell);
      if (validFrom === undefined) warnings.push(`Tanggal berlaku fasilitas "${cellText(validFromCell)}" tidak dikenali; disimpan tanpa tanggal.`);
      if (!documentNumber) warnings.push('Fasilitas tanpa nomor dokumen.');
      facilities.push({
        facility_code: facilityCode,
        document_number: documentNumber || null,
        applies_to: FACILITY_DEFAULT_ARTICLES[facilityCode],
        rate_override: null,
        valid_from: validFrom ?? null,
        valid_to: null,
        notes: 'Diimpor dari MASTER LAWAN TRANSAKSI',
      });
    }

    const pkpText = firstText(row, columns.pkp).toUpperCase();
    const notes: string[] = [...notesExtra];
    if (identityType === 'foreign_tin' && npwpDigits && !isPlaceholderNpwp) notes.push(`NPWP: ${npwpDigits}`);
    if (identityType !== 'foreign_tin' && tin) notes.push(`TIN: ${tin}`);

    parsed.push({
      rowNumber,
      name,
      identity_type: identityType,
      identity_number: identityNumber,
      is_pkp: pkpText === 'PKP',
      country_code: country,
      address: cleanOptional(firstText(row, columns.address)),
      notes: notes.length > 0 ? notes.join('; ') : null,
      facilities,
      warnings,
    });
    for (const warning of warnings) issues.push({ level: 'warning', rowNumber, name, message: warning });
  }

  return { headerRowNumber: headerIndex + 1, rows: parsed, issues, skipped };
}

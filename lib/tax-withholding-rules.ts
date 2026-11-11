// Rule engine for bukti potong amounts. Pure, framework-free and unit-tested.
//
// The rules replicate the REKAPAN workbook (see docs/features/tax-withholding-bupot.md §2):
//   * base rate comes from the tax object code;
//   * an active facility (SKB/PP23/DTP/SKD) replaces the rate (0% unless the
//     facility carries its own rate) and is reported as <TaxCertificate>;
//   * a counterparty identified by NIK (no NPWP) pays double for PPh 23/22/15;
//   * DPP may be entered directly or as a total that includes VAT, in which
//     case DPP = total / (1 + VAT rate), kept with 6 decimals;
//   * PPh = round-half-up(DPP × rate), whole rupiah;
//   * VAT applies only to PKP counterparties: 11%, except 1.1% for freight
//     services under object code 24-104-56.
//
// Money is handled as scaled BigInt ("micro" = 1e-6 rupiah) so that values up
// to hundreds of billions keep their 6 decimals exactly.

import {
  isFacilityActiveOn,
  type FacilityCode,
  type FacilityWindow,
  type IdentityType,
  type TaxArticle,
} from './tax-withholding-domain';

export const MICRO = 1_000_000n;
const PERCENT_SCALE = 1000n; // rates carry 3 decimals: 2.500% → 2500

export type GrossInputMode = 'dpp' | 'total_incl_vat';
export type RateSource = 'object_code' | 'facility' | 'nik_double' | 'override';

export const DOUBLE_RATE_ARTICLES: readonly TaxArticle[] = ['pph23', 'pph22', 'pph15'];
export const FREIGHT_OBJECT_CODE = '24-104-56';
export const VAT_RATE_PERCENT = '11';
export const VAT_RATE_FREIGHT_PERCENT = '1.1';
export const PPH26_DEFAULT_RATE_PERCENT = '20';

export type RuleObjectCode = {
  code: string;
  pph_article: TaxArticle;
  rate_percent: number | string;
};

export type RuleCounterparty = {
  identity_type: IdentityType;
  is_pkp: boolean;
  country_code?: string | null;
};

export type RuleFacility = FacilityWindow & {
  facility_code: FacilityCode;
  document_number: string | null;
  applies_to: TaxArticle[];
  rate_override: number | string | null;
};

export type SlipComputationInput = {
  objectCode: RuleObjectCode;
  counterparty: RuleCounterparty;
  facilities: RuleFacility[];
  /** Transaction date used to pick an active facility, ISO yyyy-mm-dd. */
  transactionDate: string;
  grossInputMode: GrossInputMode;
  /** Amount as entered: DPP, or total including VAT. */
  grossInputAmount: number | string;
  additionalCost?: number | string | null;
  /** Manual rate in percent; requires a reason and marks rate_source = override. */
  rateOverridePercent?: number | string | null;
};

export type SlipComputation = {
  pphArticle: TaxArticle;
  grossAmount: string;
  ratePercent: string;
  rateSource: RateSource;
  facilityCode: FacilityCode | 'N/A';
  facilityDocumentNumber: string | null;
  withholdingAmount: string;
  vatRatePercent: string;
  vatAmount: string;
  additionalCost: string;
  totalAmount: string;
  /** Human-readable trail of which rule fired, for the UI and audit notes. */
  explanation: string[];
};

// ---------------------------------------------------------------------------
// Scaled decimal helpers
// ---------------------------------------------------------------------------

/** Parses a decimal number/string into micro-units (scale 6). Throws on invalid input. */
export function toMicro(value: number | string | bigint): bigint {
  if (typeof value === 'bigint') return value * MICRO;
  const text = typeof value === 'number' ? value.toString() : String(value).trim().replace(/\s/g, '');
  if (!text) throw new Error('Nilai kosong.');
  const match = /^([+-])?(\d+)(?:[.,](\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw new Error(`Nilai "${value}" bukan angka desimal.`);
  const [, sign, whole, fractionRaw = '', exponentRaw] = match;
  let digits = whole + fractionRaw;
  let scale = fractionRaw.length;
  const exponent = exponentRaw ? Number(exponentRaw) : 0;
  scale -= exponent;
  if (scale < 0) { digits += '0'.repeat(-scale); scale = 0; }
  // keep 6 decimals, rounding half up on the discarded part
  let micro: bigint;
  if (scale <= 6) {
    micro = BigInt(digits) * 10n ** BigInt(6 - scale);
  } else {
    const keep = BigInt(digits.slice(0, digits.length - (scale - 6)) || '0');
    const dropped = digits.slice(digits.length - (scale - 6));
    micro = keep + (dropped[0] >= '5' ? 1n : 0n);
  }
  return sign === '-' ? -micro : micro;
}

/** Formats micro-units as a plain decimal string without trailing zeros. */
export function fromMicro(micro: bigint, decimals = 6): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / MICRO;
  let fraction = (abs % MICRO).toString().padStart(6, '0').slice(0, decimals);
  fraction = fraction.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('Pembagian dengan nol.');
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const result = (2n * n + d) / (2n * d);
  return negative ? -result : result;
}

/** Percent string/number → scaled integer with 3 decimals. */
export function percentToScaled(value: number | string): bigint {
  return divideRoundHalfUp(toMicro(value) * PERCENT_SCALE, MICRO);
}

/** Scaled percent → plain string like "2.5". */
export function scaledToPercent(scaled: bigint): string {
  return fromMicro(scaled * (MICRO / PERCENT_SCALE), 3);
}

/** Rounds micro-units to whole rupiah, half up. */
export function roundToRupiah(micro: bigint): bigint {
  return divideRoundHalfUp(micro, MICRO) * MICRO;
}

/** amount × percent, result in micro-units (not rounded to rupiah). */
export function applyPercent(amountMicro: bigint, percentScaled: bigint): bigint {
  return divideRoundHalfUp(amountMicro * percentScaled, 100n * PERCENT_SCALE);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export function resolveVatRatePercent(counterparty: Pick<RuleCounterparty, 'is_pkp'>, objectCode: string): string {
  if (!counterparty.is_pkp) return '0';
  return objectCode === FREIGHT_OBJECT_CODE ? VAT_RATE_FREIGHT_PERCENT : VAT_RATE_PERCENT;
}

/** DPP from the entered amount: as-is, or stripped of VAT when entered as total. */
export function resolveGrossMicro(mode: GrossInputMode, amount: number | string, vatRatePercent: string): bigint {
  const input = toMicro(amount);
  if (input <= 0n) throw new Error('Nominal harus lebih dari nol.');
  if (mode === 'dpp') return input;
  const vat = percentToScaled(vatRatePercent);
  // gross = total / (1 + vat) = total × 100000 / (100000 + vatScaled)
  return divideRoundHalfUp(input * 100n * PERCENT_SCALE, 100n * PERCENT_SCALE + vat);
}

export type RateResolution = {
  ratePercent: string;
  rateSource: RateSource;
  facilityCode: FacilityCode | 'N/A';
  facilityDocumentNumber: string | null;
  explanation: string[];
};

export function resolveRate(input: {
  objectCode: RuleObjectCode;
  counterparty: RuleCounterparty;
  facilities: RuleFacility[];
  transactionDate: string;
  rateOverridePercent?: number | string | null;
}): RateResolution {
  const article = input.objectCode.pph_article;
  const explanation: string[] = [];

  if (input.rateOverridePercent !== null && input.rateOverridePercent !== undefined && String(input.rateOverridePercent).trim() !== '') {
    const rate = scaledToPercent(percentToScaled(input.rateOverridePercent));
    explanation.push(`Tarif ${rate}% diisi manual.`);
    return { ratePercent: rate, rateSource: 'override', facilityCode: 'N/A', facilityDocumentNumber: null, explanation };
  }

  const activeFacility = input.facilities.find((facility) =>
    facility.applies_to.includes(article) && isFacilityActiveOn(facility, input.transactionDate));
  if (activeFacility) {
    const rate = activeFacility.rate_override === null || activeFacility.rate_override === undefined || String(activeFacility.rate_override).trim() === ''
      ? '0'
      : scaledToPercent(percentToScaled(activeFacility.rate_override));
    explanation.push(`Fasilitas ${activeFacility.facility_code}${activeFacility.document_number ? ` ${activeFacility.document_number}` : ''} berlaku pada ${input.transactionDate}: tarif ${rate}%.`);
    return {
      ratePercent: rate,
      rateSource: 'facility',
      facilityCode: activeFacility.facility_code,
      facilityDocumentNumber: activeFacility.document_number,
      explanation,
    };
  }

  let scaled = percentToScaled(input.objectCode.rate_percent);
  explanation.push(`Tarif dasar kode objek ${input.objectCode.code}: ${scaledToPercent(scaled)}%.`);
  if (article === 'pph26' && scaled === 0n) {
    scaled = percentToScaled(PPH26_DEFAULT_RATE_PERCENT);
    explanation.push(`PPh 26 tanpa SKD: tarif ${PPH26_DEFAULT_RATE_PERCENT}%.`);
  }
  if (input.counterparty.identity_type === 'nik' && DOUBLE_RATE_ARTICLES.includes(article)) {
    scaled *= 2n;
    explanation.push(`Penerima tanpa NPWP (NIK): tarif dikali 2 menjadi ${scaledToPercent(scaled)}%.`);
    return { ratePercent: scaledToPercent(scaled), rateSource: 'nik_double', facilityCode: 'N/A', facilityDocumentNumber: null, explanation };
  }
  return { ratePercent: scaledToPercent(scaled), rateSource: 'object_code', facilityCode: 'N/A', facilityDocumentNumber: null, explanation };
}

export function computeSlip(input: SlipComputationInput): SlipComputation {
  const vatRatePercent = resolveVatRatePercent(input.counterparty, input.objectCode.code);
  const grossMicro = resolveGrossMicro(input.grossInputMode, input.grossInputAmount, vatRatePercent);
  const rate = resolveRate(input);
  const withholdingMicro = roundToRupiah(applyPercent(grossMicro, percentToScaled(rate.ratePercent)));
  const vatMicro = roundToRupiah(applyPercent(grossMicro, percentToScaled(vatRatePercent)));
  const additionalMicro = input.additionalCost === null || input.additionalCost === undefined || String(input.additionalCost).trim() === ''
    ? 0n
    : toMicro(input.additionalCost);
  if (additionalMicro < 0n) throw new Error('Biaya tambahan tidak boleh negatif.');
  const totalMicro = grossMicro + additionalMicro + vatMicro;

  const explanation = [...rate.explanation];
  if (input.grossInputMode === 'total_incl_vat') {
    explanation.unshift(`DPP = ${fromMicro(toMicro(input.grossInputAmount))} ÷ (1 + ${vatRatePercent}%) = ${fromMicro(grossMicro)}.`);
  }
  explanation.push(`PPh = ROUND(${fromMicro(grossMicro)} × ${rate.ratePercent}%) = ${fromMicro(withholdingMicro, 0)}.`);
  if (vatMicro > 0n) explanation.push(`PPN ${vatRatePercent}% (PKP) = ${fromMicro(vatMicro, 0)}.`);

  return {
    pphArticle: input.objectCode.pph_article,
    grossAmount: fromMicro(grossMicro),
    ratePercent: rate.ratePercent,
    rateSource: rate.rateSource,
    facilityCode: rate.facilityCode,
    facilityDocumentNumber: rate.facilityDocumentNumber,
    withholdingAmount: fromMicro(withholdingMicro, 0),
    vatRatePercent,
    vatAmount: fromMicro(vatMicro, 0),
    additionalCost: fromMicro(additionalMicro, 2),
    totalAmount: fromMicro(totalMicro),
    explanation,
  };
}

/**
 * Finds a rate (3 decimals) that reproduces `amount` from `gross` under the
 * engine's own rounding. `candidates` (e.g. the workbook TARIF) are tried
 * first, then a derived rate. Returns null when no consistent rate exists, so
 * callers must not store an amount the engine cannot recompute.
 */
export function deriveConsistentRatePercent(
  gross: number | string,
  amount: number | string,
  candidates: Array<number | string | null | undefined> = [],
): string | null {
  const grossMicro = toMicro(gross);
  const amountMicro = roundToRupiah(toMicro(amount));
  if (grossMicro <= 0n || amountMicro < 0n) return null;
  const reproduces = (scaled: bigint) => roundToRupiah(applyPercent(grossMicro, scaled)) === amountMicro;
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || String(candidate).trim() === '') continue;
    try {
      const scaled = percentToScaled(candidate);
      if (scaled >= 0n && reproduces(scaled)) return scaledToPercent(scaled);
    } catch {
      // ignore unparsable candidates
    }
  }
  // derived = amount / gross × 100 at 3 decimals; prefer the simplest rate
  // (whole percent, then 1 and 2 decimals) before the exact 3-decimal value
  // and its neighbours, so 137 on 6,846.85 yields 2% rather than 2.001%.
  const derived = divideRoundHalfUp(amountMicro * 100n * PERCENT_SCALE, grossMicro);
  const tried = new Set<bigint>();
  const attempts: bigint[] = [];
  for (const unit of [1000n, 100n, 10n]) attempts.push(divideRoundHalfUp(derived, unit) * unit);
  for (const delta of [0n, 1n, -1n, 2n, -2n]) attempts.push(derived + delta);
  for (const scaled of attempts) {
    if (scaled < 0n || tried.has(scaled)) continue;
    tried.add(scaled);
    if (reproduces(scaled)) return scaledToPercent(scaled);
  }
  return null;
}

/** Period (masa pajak) defaults to the month of the invoice date. */
export function periodFromDate(isoDate: string): { month: number; year: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Tanggal ${isoDate} tidak valid.`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function periodStartIso(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

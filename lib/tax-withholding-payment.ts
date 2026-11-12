// Phase 5 pure helpers: billing/NTPN formats, group keys shared by the recap
// and payment records, and the facility expiry reminder list.

import { facilityExpiryStatus, type FacilityWindow, type TaxArticle } from './tax-withholding-domain';

/** Kode billing DJP: 15 digits. */
export const BILLING_ID_PATTERN = /^\d{15}$/;
/** Nomor Transaksi Penerimaan Negara: 16 upper-case alphanumerics. */
export const NTPN_PATTERN = /^[0-9A-Z]{16}$/;

export function normalizeBillingId(raw: unknown): string {
  return String(raw ?? '').replace(/[\s.-]/g, '');
}

export function normalizeNtpn(raw: unknown): string {
  return String(raw ?? '').replace(/\s/g, '').toUpperCase();
}

export type PaymentGroupRef = { period_month: number; pph_article: TaxArticle; kap: string | null; kjs: string | null };

/** The recap group a payment pays: masa + pasal + KAP + KJS. */
export function paymentGroupKey(group: PaymentGroupRef): string {
  return `${group.period_month}|${group.pph_article}|${group.kap ?? ''}|${group.kjs ?? ''}`;
}

export type PaymentGroupStatus = 'none' | 'billed' | 'paid' | 'partial';

/** How a recap group stands against its payment records: nothing, billed but unpaid, paid in full, or paid less than due. */
export function paymentGroupStatus(dueAmount: string, records: Array<{ ntpn: string | null; paid_amount: string | null }>): PaymentGroupStatus {
  if (records.length === 0) return 'none';
  const paid = records.filter((record) => record.ntpn).reduce((sum, record) => sum + BigInt(record.paid_amount ?? '0'), 0n);
  if (paid === 0n) return 'billed';
  return paid >= BigInt(dueAmount) ? 'paid' : 'partial';
}

export type ExpiringFacility = {
  counterpartyId: number;
  counterpartyName: string;
  facilityCode: string;
  documentNumber: string | null;
  validTo: string;
  status: 'expiring' | 'expired';
  daysLeft: number;
};

/** Facilities ending within warnDays, plus those that ended within graceDays (likely still being relied on). */
export function listExpiringFacilities(
  counterparties: Array<{ id: number; name: string; is_active: boolean; facilities: Array<FacilityWindow & { facility_code: string; document_number: string | null }> }>,
  todayIso: string,
  warnDays = 30,
  graceDays = 30,
): ExpiringFacility[] {
  const today = new Date(`${todayIso}T00:00:00Z`).getTime();
  const rows: ExpiringFacility[] = [];
  for (const counterparty of counterparties) {
    if (!counterparty.is_active) continue;
    for (const facility of counterparty.facilities) {
      if (!facility.valid_to) continue;
      const status = facilityExpiryStatus(facility, todayIso, warnDays);
      const daysLeft = Math.round((new Date(`${facility.valid_to}T00:00:00Z`).getTime() - today) / 86_400_000);
      if (status === 'expiring' || (status === 'expired' && daysLeft >= -graceDays)) {
        rows.push({
          counterpartyId: counterparty.id,
          counterpartyName: counterparty.name,
          facilityCode: facility.facility_code,
          documentNumber: facility.document_number,
          validTo: facility.valid_to,
          status: status === 'expiring' ? 'expiring' : 'expired',
          daysLeft,
        });
      }
    }
  }
  return rows.sort((a, b) => a.daysLeft - b.daysLeft || a.counterpartyName.localeCompare(b.counterpartyName));
}

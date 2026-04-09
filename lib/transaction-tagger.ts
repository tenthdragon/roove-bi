// lib/transaction-tagger.ts
// Auto-classify bank transactions based on description patterns

export type TransactionTag =
  | 'customer'
  | 'supplier'
  | 'intercompany'
  | 'operasional'
  | 'biaya_bank'
  | 'marketplace'
  | 'refund'
  | 'auto_debit'
  | 'n/a';

export const TAG_LABELS: Record<TransactionTag, string> = {
  customer:     'Customer',
  supplier:     'Supplier',
  intercompany: 'Intercompany',
  operasional:  'Operasional',
  biaya_bank:   'Biaya Bank',
  marketplace:  'Marketplace',
  refund:       'Refund',
  auto_debit:   'Auto Debit',
  'n/a':        'N/A',
};

export const TAG_COLORS: Record<TransactionTag, { bg: string; text: string }> = {
  customer:     { bg: '#dcfce7', text: '#166534' },
  supplier:     { bg: '#fed7aa', text: '#9a3412' },
  intercompany: { bg: '#dbeafe', text: '#1e40af' },
  operasional:  { bg: '#fef9c3', text: '#854d0e' },
  biaya_bank:   { bg: '#f3e8ff', text: '#6b21a8' },
  marketplace:  { bg: '#cffafe', text: '#155e75' },
  refund:       { bg: '#ffe4e6', text: '#9f1239' },
  auto_debit:   { bg: '#fce7f3', text: '#9d174d' },
  'n/a':        { bg: '#f1f5f9', text: '#64748b' },
};

export const ALL_TAGS: TransactionTag[] = [
  'customer', 'supplier', 'intercompany', 'operasional', 'biaya_bank',
  'marketplace', 'refund', 'auto_debit', 'n/a',
];

/**
 * Auto-classify a bank transaction based on its description and amounts.
 * Returns the most likely tag. Rules are applied in priority order.
 */
export function classifyTransaction(
  description: string,
  creditAmount: number,
  debitAmount: number,
): TransactionTag {
  const desc = (description || '').trim();
  const descUpper = desc.toUpperCase();
  const isCredit = creditAmount > 0;
  const isDebit  = debitAmount > 0;
  const amount   = isDebit ? debitAmount : creditAmount;

  // ── Priority 1: Biaya Bank ──
  if (descUpper.includes('BIAYA TXN') || descUpper.includes('BIAYA TRANSAKSI') || descUpper.includes('BIAYA ADMIN')) {
    return 'biaya_bank';
  }
  // Transfer Fee pattern in Mandiri (appears in description alongside MCM InhouseTrf)
  if (descUpper.includes('TRANSFER FEE') && isDebit) {
    return 'biaya_bank';
  }
  // Small fixed bank fee amounts (Rp 2.500 or Rp 6.500) as debit
  if (isDebit && (amount === 2500 || amount === 6500)) {
    return 'biaya_bank';
  }

  // ── Priority 2: Refund ──
  if (/^Refund/i.test(desc) || descUpper.includes('REFUND')) {
    return 'refund';
  }

  // ── Priority 3: Auto Debit (utility/auto-charge) ──
  if (/^UBP\d/.test(desc)) {
    return 'auto_debit';
  }

  // ── Priority 4: Intercompany ──
  // Entity names — match transfers involving group companies
  const ENTITY_PATTERNS = [
    'ROOVE TIJARA',
    'ROOVE LAUTAN',
    'JEJAK HERBA',
    'JEJAK HERBA NUSANTARA',
  ];
  const hasEntity = ENTITY_PATTERNS.some(e => descUpper.includes(e));
  if (hasEntity) {
    // For BRI, "TO ROOVE TIJARA INTE" is part of ALL incoming customer transfers
    // (it's the recipient account name, not the sender).
    // Only classify as intercompany if:
    //   - It's a debit (sending money to another entity), OR
    //   - The entity name is NOT the account owner (e.g., credit FROM another entity)
    // BRI customer pattern: "NBMB <name> TO ROOVE TIJARA INTE" — this is customer
    const isBRICustomerPattern = /NBMB .+ TO ROOVE TIJARA/i.test(desc);
    const isTRFtoSelf = /TRF\d+ROOVE TIJARA/i.test(desc); // BRI ATM transfer pattern

    if (isBRICustomerPattern || isTRFtoSelf) {
      // Fall through — this is a customer transfer, not intercompany
    } else if (isDebit) {
      // Outgoing to another entity = intercompany
      return 'intercompany';
    } else if (isCredit) {
      // Incoming from another entity (e.g., "DARI JEJAK HERBA NUSANTARA")
      // Check it's actually from another entity, not just account owner name
      if (descUpper.includes('DARI JEJAK HERBA') || descUpper.includes('DARI ROOVE LAUTAN') || descUpper.includes('DARI ROOVE TIJARA')) {
        return 'intercompany';
      }
      // "KE ROOVE" in debit context was handled above; in credit context with entity name
      if (descUpper.includes('PERSEDIAAN')) {
        return 'intercompany';
      }
    }
  }

  // ── Priority 5: Marketplace Settlement ──
  if (
    descUpper.includes('VISIONET') ||
    descUpper.includes('ESPAY') ||
    descUpper.includes('EASTERN TRANSGLOBAL') ||
    descUpper.includes('ASTAMA INDO')
  ) {
    return 'marketplace';
  }

  // ── Priority 6: Operasional ──
  if (
    descUpper.includes('KAS GA') ||
    descUpper.includes('OPS CC') ||
    /^ANGSURAN/i.test(desc)
  ) {
    return 'operasional';
  }
  // Large debit not matched above → likely operational
  if (isDebit && amount >= 5_000_000) {
    return 'operasional';
  }

  // ── Priority 7: Customer ──
  if (isCredit) {
    return 'customer';
  }

  // ── Priority 8: Fallback ──
  return 'n/a';
}

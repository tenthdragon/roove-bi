function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizePlatform(value: unknown): string | null {
  const raw = cleanText(value).toLowerCase().replace(/\s+/g, '');
  if (!raw) return null;
  if (raw === 'tiktokshop') return 'tiktok';
  return raw;
}

function parseLocalizedNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = cleanText(value);
  if (!raw) return 0;
  const normalized = raw.replace(/[^0-9,.-]+/g, '');
  if (!normalized) return 0;
  if (normalized.includes(',') && normalized.includes('.')) {
    return Number(normalized.replace(/\./g, '').replace(',', '.')) || 0;
  }
  if (normalized.includes(',') && !normalized.includes('.')) {
    return Number(normalized.replace(',', '.')) || 0;
  }
  const dotParts = normalized.split('.');
  if (dotParts.length > 2) return Number(dotParts.join('')) || 0;
  if (dotParts.length === 2 && dotParts[1] && dotParts[1].length === 3 && /^\d+$/.test(dotParts[0] || '')) {
    return Number(dotParts.join('')) || 0;
  }
  return Number(normalized) || 0;
}

function positiveAmount(value: unknown): number {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return amount;
}

export type MarketplaceFeeLineInput = {
  lineSubtotal?: number | null;
  quantity?: number | null;
  rawRow?: Record<string, string> | null;
};

export type MarketplaceFeeFinancials = {
  present: boolean;
  platform: string | null;
  amount: number | null;
  source: string | null;
  buyerPaidAmount: number;
  payoutAmount: number;
  productSubtotalAmount: number;
  shippingPassThroughAmount: number;
  grossGapAmount: number;
  nonShippingGapAmount: number;
};

type ResolveMarketplaceFeeInput = {
  platform?: string | null;
  orderAmount?: number | null;
  buyerPaidAmount?: number | null;
  totalPaymentAmount?: number | null;
  shippingCost?: number | null;
  lines?: MarketplaceFeeLineInput[];
};

function resolveLineSubtotal(line: MarketplaceFeeLineInput): number {
  const direct = positiveAmount(line.lineSubtotal);
  if (direct > 0) return direct;

  const rawRow = line.rawRow || {};
  const quantity = Math.max(Number(line.quantity || 0) || 1, 1);
  const shopeeUnit = positiveAmount(rawRow['Harga Setelah Diskon']);
  if (shopeeUnit > 0) return shopeeUnit * quantity;

  const tiktokSubtotal = positiveAmount(rawRow['SKU Subtotal After Discount'])
    || positiveAmount(rawRow['SKU Subtotal Before Discount']);
  if (tiktokSubtotal > 0) return tiktokSubtotal;

  return 0;
}

function sumLineSubtotals(lines: MarketplaceFeeLineInput[] | undefined): number {
  return (lines || []).reduce((sum, line) => sum + resolveLineSubtotal(line), 0);
}

export function resolveMarketplaceIntakeFeeFinancials(
  input: ResolveMarketplaceFeeInput,
): MarketplaceFeeFinancials {
  const platform = normalizePlatform(input.platform);
  const productSubtotalAmount = sumLineSubtotals(input.lines);
  const buyerPaidAmount = positiveAmount(input.buyerPaidAmount);
  const payoutAmount = positiveAmount(input.totalPaymentAmount || input.orderAmount);
  const shippingPassThroughAmount = positiveAmount(input.shippingCost);

  if (platform === 'shopee') {
    const resolvedBuyerPaid = buyerPaidAmount || productSubtotalAmount;
    if (resolvedBuyerPaid <= 0 || payoutAmount <= 0) {
      return {
        present: false,
        platform,
        amount: null,
        source: null,
        buyerPaidAmount: resolvedBuyerPaid,
        payoutAmount,
        productSubtotalAmount,
        shippingPassThroughAmount: 0,
        grossGapAmount: 0,
        nonShippingGapAmount: 0,
      };
    }

    const grossGapAmount = resolvedBuyerPaid - payoutAmount;
    return {
      present: true,
      platform,
      amount: Math.max(grossGapAmount, 0),
      source: buyerPaidAmount > 0
        ? 'shopee.buyer_paid_amount_minus_total_payment_amount'
        : 'shopee.line_subtotal_minus_total_payment_amount',
      buyerPaidAmount: resolvedBuyerPaid,
      payoutAmount,
      productSubtotalAmount,
      shippingPassThroughAmount: 0,
      grossGapAmount,
      nonShippingGapAmount: grossGapAmount,
    };
  }

  if (platform === 'tiktok') {
    const buyerGrossAmount = positiveAmount(input.orderAmount);
    return {
      present: false,
      platform,
      amount: null,
      source: 'tiktok.seller_payout_not_available_from_order_export',
      buyerPaidAmount: buyerGrossAmount,
      payoutAmount: 0,
      productSubtotalAmount,
      shippingPassThroughAmount,
      grossGapAmount: buyerGrossAmount > 0 && productSubtotalAmount > 0
        ? buyerGrossAmount - productSubtotalAmount
        : 0,
      nonShippingGapAmount: 0,
    };
  }

  return {
    present: false,
    platform,
    amount: null,
    source: null,
    buyerPaidAmount: buyerPaidAmount || positiveAmount(input.orderAmount),
    payoutAmount,
    productSubtotalAmount,
    shippingPassThroughAmount,
    grossGapAmount: 0,
    nonShippingGapAmount: 0,
  };
}

export function resolveMarketplaceIntakeFeeAmount(input: ResolveMarketplaceFeeInput): number | null {
  const financials = resolveMarketplaceIntakeFeeFinancials(input);
  return financials.present ? financials.amount : null;
}

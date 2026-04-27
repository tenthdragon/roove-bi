type NumericField = {
  present: boolean;
  amount: number;
  source: string | null;
};

type MarketplaceIntakeShippingInput = {
  rawMeta?: Record<string, unknown> | null;
  rawRows?: Array<Record<string, unknown> | null | undefined>;
};

export type MarketplaceIntakeShippingFinancials = {
  platform: 'shopee' | 'tiktok' | 'unknown';
  present: boolean;
  grossAmount: number;
  grossPresent: boolean;
  grossSource: string | null;
  buyerAmount: number;
  buyerPresent: boolean;
  buyerSource: string | null;
  companyDiscountAmount: number;
  companyDiscountPresent: boolean;
  companyDiscountSource: string | null;
  platformDiscountAmount: number;
  platformDiscountPresent: boolean;
  platformDiscountSource: string | null;
  estimatedGrossAmount: number;
  estimatedGrossPresent: boolean;
  estimatedGrossSource: string | null;
  originalGrossAmount: number;
  originalGrossPresent: boolean;
  originalGrossSource: string | null;
};

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function parseLocalizedNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = cleanText(value);
  if (!raw) return 0;

  let normalized = raw.replace(/[^0-9,.-]+/g, '');
  if (!normalized) return 0;

  const hasDot = normalized.includes('.');
  const hasComma = normalized.includes(',');
  if (hasDot && hasComma) {
    const lastDot = normalized.lastIndexOf('.');
    const lastComma = normalized.lastIndexOf(',');
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasDot) {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/\./g, '');
    }
  } else if (hasComma) {
    if (/^-?\d{1,3}(,\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/,/g, '');
    } else if (/^-?\d+,\d+$/.test(normalized)) {
      normalized = normalized.replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function hasOwn(input: unknown, key: string): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, key);
}

function readField(record: Record<string, unknown> | null | undefined, key: string, source: string): NumericField {
  if (!record || !hasOwn(record, key)) {
    return { present: false, amount: 0, source: null };
  }

  const rawValue = record[key];
  if (rawValue == null) {
    return { present: false, amount: 0, source: null };
  }

  if (typeof rawValue === 'string' && !rawValue.trim()) {
    return { present: false, amount: 0, source: null };
  }

  return {
    present: true,
    amount: clampNonNegative(parseLocalizedNumber(rawValue)),
    source,
  };
}

function firstPresent(candidates: NumericField[]): NumericField {
  for (const candidate of candidates) {
    if (candidate.present) return candidate;
  }
  return { present: false, amount: 0, source: null };
}

function maxPresent(candidates: NumericField[]): NumericField {
  const present = candidates.filter((candidate) => candidate.present);
  if (!present.length) return { present: false, amount: 0, source: null };

  return present.reduce((best, candidate) => (
    candidate.amount > best.amount ? candidate : best
  ));
}

function sumPresent(label: string, candidates: NumericField[]): NumericField {
  const present = candidates.filter((candidate) => candidate.present);
  if (!present.length) return { present: false, amount: 0, source: null };

  return {
    present: true,
    amount: clampNonNegative(present.reduce((sum, candidate) => sum + candidate.amount, 0)),
    source: present.map((candidate) => candidate.source).filter(Boolean).join('+') || label,
  };
}

function pickMeta(rawMeta: Record<string, unknown> | null | undefined, keys: string[]): NumericField {
  return firstPresent(keys.map((key) => readField(rawMeta, key, `rawMeta.${key}`)));
}

function pickRows(
  rawRows: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): NumericField {
  for (let rowIndex = 0; rowIndex < rawRows.length; rowIndex += 1) {
    const row = rawRows[rowIndex];
    const candidate = firstPresent(
      keys.map((key) => readField(row || null, key, `rawRow[${rowIndex}].${key}`)),
    );
    if (candidate.present) return candidate;
  }
  return { present: false, amount: 0, source: null };
}

function pickField(
  rawMeta: Record<string, unknown> | null | undefined,
  rawRows: Array<Record<string, unknown> | null | undefined>,
  input: {
    rowKeys?: string[];
    metaKeys?: string[];
  },
): NumericField {
  const rowCandidate = pickRows(rawRows, input.rowKeys || []);
  if (rowCandidate.present) return rowCandidate;
  return pickMeta(rawMeta, input.metaKeys || []);
}

function detectPlatform(
  rawMeta: Record<string, unknown> | null | undefined,
  rawRows: Array<Record<string, unknown> | null | undefined>,
): 'shopee' | 'tiktok' | 'unknown' {
  const platformText = cleanText(rawMeta?.platform).toLowerCase();
  if (platformText === 'shopee' || platformText === 'tiktok') return platformText;

  const shopeeSignals = [
    'shippingFeeEstimatedDeduction',
    'estimatedShippingCost',
    'Ongkos Kirim Dibayar oleh Pembeli',
    'Perkiraan Ongkos Kirim',
    'Estimasi Potongan Biaya Pengiriman',
  ];
  const tiktokSignals = [
    'originalShippingFee',
    'shippingFeeAfterDiscount',
    'shippingFeeSellerDiscount',
    'shippingFeePlatformDiscount',
    'Original Shipping Fee',
    'Shipping Fee After Discount',
    'Shipping Fee Seller Discount',
    'Shipping Fee Platform Discount',
  ];

  for (const key of shopeeSignals) {
    if (hasOwn(rawMeta, key)) return 'shopee';
  }
  for (const key of tiktokSignals) {
    if (hasOwn(rawMeta, key)) return 'tiktok';
  }
  for (const row of rawRows) {
    for (const key of shopeeSignals) {
      if (hasOwn(row, key)) return 'shopee';
    }
    for (const key of tiktokSignals) {
      if (hasOwn(row, key)) return 'tiktok';
    }
  }

  return 'unknown';
}

function resolveShopeeFinancials(input: MarketplaceIntakeShippingInput): MarketplaceIntakeShippingFinancials {
  const rawMeta = input.rawMeta || null;
  const rawRows = input.rawRows || [];

  const buyer = firstPresent([
    pickField(rawMeta, rawRows, {
      rowKeys: ['Ongkos Kirim Dibayar oleh Pembeli'],
      metaKeys: ['shippingCostBuyer'],
    }),
    pickField(rawMeta, rawRows, {
      metaKeys: ['shippingFeeAfterDiscount'],
    }),
  ]);
  const estimatedGross = pickField(rawMeta, rawRows, {
    rowKeys: ['Perkiraan Ongkos Kirim'],
    metaKeys: ['estimatedShippingCost'],
  });
  const companyDiscount = firstPresent([
    pickField(rawMeta, rawRows, {
      rowKeys: ['Estimasi Potongan Biaya Pengiriman'],
      metaKeys: ['shippingDiscountCompany', 'shippingFeeEstimatedDeduction'],
    }),
  ]);
  const explicitGross = pickField(rawMeta, rawRows, {
    metaKeys: ['shippingCostGross'],
  });
  const legacyGross = pickField(rawMeta, rawRows, {
    metaKeys: ['shippingCost'],
  });
  const combinedGross = sumPresent('buyer+company', [buyer, companyDiscount]);
  const gross = maxPresent([explicitGross, combinedGross, estimatedGross, legacyGross, buyer]);

  const inferredCompanyDiscount = !companyDiscount.present && gross.present && buyer.present
    ? {
        present: true,
        amount: clampNonNegative(gross.amount - buyer.amount),
        source: `derived:${gross.source || 'gross'}-buyer`,
      }
    : companyDiscount;
  const inferredBuyer = !buyer.present && gross.present && inferredCompanyDiscount.present
    ? {
        present: true,
        amount: clampNonNegative(gross.amount - inferredCompanyDiscount.amount),
        source: `derived:${gross.source || 'gross'}-company`,
      }
    : buyer;

  return {
    platform: 'shopee',
    present: gross.present || inferredBuyer.present || inferredCompanyDiscount.present || estimatedGross.present,
    grossAmount: gross.present ? gross.amount : 0,
    grossPresent: gross.present,
    grossSource: gross.source,
    buyerAmount: inferredBuyer.present ? inferredBuyer.amount : 0,
    buyerPresent: inferredBuyer.present,
    buyerSource: inferredBuyer.source,
    companyDiscountAmount: inferredCompanyDiscount.present
      ? Math.min(inferredCompanyDiscount.amount, gross.present ? gross.amount : inferredCompanyDiscount.amount)
      : 0,
    companyDiscountPresent: inferredCompanyDiscount.present,
    companyDiscountSource: inferredCompanyDiscount.source,
    platformDiscountAmount: 0,
    platformDiscountPresent: false,
    platformDiscountSource: null,
    estimatedGrossAmount: estimatedGross.present ? estimatedGross.amount : 0,
    estimatedGrossPresent: estimatedGross.present,
    estimatedGrossSource: estimatedGross.source,
    originalGrossAmount: 0,
    originalGrossPresent: false,
    originalGrossSource: null,
  };
}

function resolveTikTokFinancials(input: MarketplaceIntakeShippingInput): MarketplaceIntakeShippingFinancials {
  const rawMeta = input.rawMeta || null;
  const rawRows = input.rawRows || [];

  const buyer = pickField(rawMeta, rawRows, {
    rowKeys: ['Shipping Fee After Discount'],
    metaKeys: ['shippingCostBuyer', 'shippingFeeAfterDiscount'],
  });
  const sellerDiscount = pickField(rawMeta, rawRows, {
    rowKeys: ['Shipping Fee Seller Discount'],
    metaKeys: ['shippingFeeSellerDiscount'],
  });
  const cofundedDiscount = pickField(rawMeta, rawRows, {
    rowKeys: ['Shipping Fee Co-funded Discount'],
    metaKeys: ['shippingFeeCofundedDiscount'],
  });
  const directCompanyDiscount = pickField(rawMeta, rawRows, {
    metaKeys: ['shippingDiscountCompany'],
  });
  const companyDiscount = directCompanyDiscount.present
    ? directCompanyDiscount
    : sumPresent('seller+cofunded', [sellerDiscount, cofundedDiscount]);
  const platformDiscount = pickField(rawMeta, rawRows, {
    rowKeys: ['Shipping Fee Platform Discount'],
    metaKeys: ['shippingDiscountPlatform', 'shippingFeePlatformDiscount'],
  });
  const originalGross = pickField(rawMeta, rawRows, {
    rowKeys: ['Original Shipping Fee'],
    metaKeys: ['originalShippingFee'],
  });
  const explicitGross = pickField(rawMeta, rawRows, {
    metaKeys: ['shippingCostGross'],
  });
  const legacyGross = pickField(rawMeta, rawRows, {
    metaKeys: ['shippingCost'],
  });
  const buyerPlusCompany = sumPresent('buyer+company', [buyer, companyDiscount]);
  const originalLessPlatform = originalGross.present
    ? {
        present: true,
        amount: clampNonNegative(originalGross.amount - (platformDiscount.present ? platformDiscount.amount : 0)),
        source: platformDiscount.present
          ? `${originalGross.source}-minus-${platformDiscount.source}`
          : originalGross.source,
      }
    : { present: false, amount: 0, source: null };
  const gross = maxPresent([explicitGross, buyerPlusCompany, originalLessPlatform, legacyGross, buyer]);

  const inferredCompanyDiscount = !companyDiscount.present && gross.present && buyer.present
    ? {
        present: true,
        amount: clampNonNegative(gross.amount - buyer.amount),
        source: `derived:${gross.source || 'gross'}-buyer`,
      }
    : companyDiscount;
  const inferredBuyer = !buyer.present && gross.present && inferredCompanyDiscount.present
    ? {
        present: true,
        amount: clampNonNegative(gross.amount - inferredCompanyDiscount.amount),
        source: `derived:${gross.source || 'gross'}-company`,
      }
    : buyer;
  const inferredPlatformDiscount = !platformDiscount.present && originalGross.present && gross.present
    ? {
        present: true,
        amount: clampNonNegative(originalGross.amount - gross.amount),
        source: `derived:${originalGross.source || 'original'}-gross`,
      }
    : platformDiscount;

  return {
    platform: 'tiktok',
    present: gross.present || inferredBuyer.present || inferredCompanyDiscount.present || originalGross.present,
    grossAmount: gross.present ? gross.amount : 0,
    grossPresent: gross.present,
    grossSource: gross.source,
    buyerAmount: inferredBuyer.present ? inferredBuyer.amount : 0,
    buyerPresent: inferredBuyer.present,
    buyerSource: inferredBuyer.source,
    companyDiscountAmount: inferredCompanyDiscount.present
      ? Math.min(inferredCompanyDiscount.amount, gross.present ? gross.amount : inferredCompanyDiscount.amount)
      : 0,
    companyDiscountPresent: inferredCompanyDiscount.present,
    companyDiscountSource: inferredCompanyDiscount.source,
    platformDiscountAmount: inferredPlatformDiscount.present
      ? Math.min(inferredPlatformDiscount.amount, originalGross.present ? originalGross.amount : inferredPlatformDiscount.amount)
      : 0,
    platformDiscountPresent: inferredPlatformDiscount.present,
    platformDiscountSource: inferredPlatformDiscount.source,
    estimatedGrossAmount: 0,
    estimatedGrossPresent: false,
    estimatedGrossSource: null,
    originalGrossAmount: originalGross.present ? originalGross.amount : 0,
    originalGrossPresent: originalGross.present,
    originalGrossSource: originalGross.source,
  };
}

function resolveGenericFinancials(input: MarketplaceIntakeShippingInput): MarketplaceIntakeShippingFinancials {
  const rawMeta = input.rawMeta || null;
  const rawRows = input.rawRows || [];

  const buyer = pickField(rawMeta, rawRows, {
    metaKeys: ['shippingCostBuyer', 'shippingFeeAfterDiscount'],
  });
  const companyDiscount = pickField(rawMeta, rawRows, {
    metaKeys: ['shippingDiscountCompany', 'shippingFeeEstimatedDeduction', 'shippingFeeSellerDiscount'],
  });
  const platformDiscount = pickField(rawMeta, rawRows, {
    metaKeys: ['shippingDiscountPlatform', 'shippingFeePlatformDiscount'],
  });
  const estimatedGross = pickField(rawMeta, rawRows, {
    metaKeys: ['estimatedShippingCost'],
  });
  const originalGross = pickField(rawMeta, rawRows, {
    metaKeys: ['originalShippingFee'],
  });
  const explicitGross = pickField(rawMeta, rawRows, {
    metaKeys: ['shippingCostGross'],
  });
  const legacyGross = pickField(rawMeta, rawRows, {
    metaKeys: ['shippingCost'],
  });
  const buyerPlusCompany = sumPresent('buyer+company', [buyer, companyDiscount]);
  const originalLessPlatform = originalGross.present
    ? {
        present: true,
        amount: clampNonNegative(originalGross.amount - (platformDiscount.present ? platformDiscount.amount : 0)),
        source: platformDiscount.present
          ? `${originalGross.source}-minus-${platformDiscount.source}`
          : originalGross.source,
      }
    : { present: false, amount: 0, source: null };
  const gross = maxPresent([explicitGross, buyerPlusCompany, estimatedGross, originalLessPlatform, legacyGross, buyer]);

  const inferredCompanyDiscount = !companyDiscount.present && gross.present && buyer.present
    ? {
        present: true,
        amount: clampNonNegative(gross.amount - buyer.amount),
        source: `derived:${gross.source || 'gross'}-buyer`,
      }
    : companyDiscount;
  const inferredBuyer = !buyer.present && gross.present && inferredCompanyDiscount.present
    ? {
        present: true,
        amount: clampNonNegative(gross.amount - inferredCompanyDiscount.amount),
        source: `derived:${gross.source || 'gross'}-company`,
      }
    : buyer;
  const inferredPlatformDiscount = !platformDiscount.present && originalGross.present && gross.present
    ? {
        present: true,
        amount: clampNonNegative(originalGross.amount - gross.amount),
        source: `derived:${originalGross.source || 'original'}-gross`,
      }
    : platformDiscount;

  return {
    platform: 'unknown',
    present: gross.present || inferredBuyer.present || inferredCompanyDiscount.present || inferredPlatformDiscount.present,
    grossAmount: gross.present ? gross.amount : 0,
    grossPresent: gross.present,
    grossSource: gross.source,
    buyerAmount: inferredBuyer.present ? inferredBuyer.amount : 0,
    buyerPresent: inferredBuyer.present,
    buyerSource: inferredBuyer.source,
    companyDiscountAmount: inferredCompanyDiscount.present
      ? Math.min(inferredCompanyDiscount.amount, gross.present ? gross.amount : inferredCompanyDiscount.amount)
      : 0,
    companyDiscountPresent: inferredCompanyDiscount.present,
    companyDiscountSource: inferredCompanyDiscount.source,
    platformDiscountAmount: inferredPlatformDiscount.present ? inferredPlatformDiscount.amount : 0,
    platformDiscountPresent: inferredPlatformDiscount.present,
    platformDiscountSource: inferredPlatformDiscount.source,
    estimatedGrossAmount: estimatedGross.present ? estimatedGross.amount : 0,
    estimatedGrossPresent: estimatedGross.present,
    estimatedGrossSource: estimatedGross.source,
    originalGrossAmount: originalGross.present ? originalGross.amount : 0,
    originalGrossPresent: originalGross.present,
    originalGrossSource: originalGross.source,
  };
}

export function resolveMarketplaceIntakeShippingFinancials(
  rawMetaOrInput: Record<string, unknown> | null | MarketplaceIntakeShippingInput | undefined,
  maybeRawRows?: Array<Record<string, unknown> | null | undefined>,
): MarketplaceIntakeShippingFinancials {
  const input = (
    rawMetaOrInput
    && typeof rawMetaOrInput === 'object'
    && ('rawMeta' in rawMetaOrInput || 'rawRows' in rawMetaOrInput)
  )
    ? rawMetaOrInput as MarketplaceIntakeShippingInput
    : {
        rawMeta: (rawMetaOrInput as Record<string, unknown> | null | undefined) || null,
        rawRows: maybeRawRows || [],
      };

  const rawMeta = input.rawMeta || null;
  const rawRows = input.rawRows || [];
  const platform = detectPlatform(rawMeta, rawRows);

  if (platform === 'shopee') return resolveShopeeFinancials({ rawMeta, rawRows });
  if (platform === 'tiktok') return resolveTikTokFinancials({ rawMeta, rawRows });
  return resolveGenericFinancials({ rawMeta, rawRows });
}

export function resolveMarketplaceIntakeShippingCost(
  rawMeta: Record<string, unknown> | null | undefined,
  rawRows?: Array<Record<string, unknown> | null | undefined>,
): { amount: number; present: boolean; source: string | null } {
  const shipping = resolveMarketplaceIntakeShippingFinancials({ rawMeta, rawRows });
  return {
    amount: shipping.grossAmount,
    present: shipping.grossPresent,
    source: shipping.grossSource,
  };
}

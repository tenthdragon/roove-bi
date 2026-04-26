type ParsedScalevHeaderField = {
  present: boolean;
  value: number | null;
};

function normalizeScalevMoneyText(input: string): string | null {
  let text = input.trim();
  if (!text) return null;

  text = text.replace(/^rp\.?\s*/i, '');
  text = text.replace(/\s+/g, '');
  text = text.replace(/[^\d,.\-]/g, '');

  if (!text || !/\d/.test(text)) return null;

  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text)) {
    return text.replace(/\./g, '').replace(',', '.');
  }

  if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) {
    return text.replace(/,/g, '');
  }

  if (/^-?\d+,\d{3}$/.test(text)) {
    return text.replace(/,/g, '');
  }

  if (/^-?\d+,\d+$/.test(text)) {
    return text.replace(',', '.');
  }

  return text;
}

export function parseScalevMoneyValue(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : null;
  }
  if (typeof input !== 'string') return null;

  const normalized = normalizeScalevMoneyText(input);
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractScalevHeaderField(data: unknown, key: string): ParsedScalevHeaderField {
  if (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, key)) {
    return {
      present: true,
      value: parseScalevMoneyValue((data as Record<string, unknown>)[key]),
    };
  }

  const messageVariables = data && typeof data === 'object'
    ? (data as Record<string, unknown>).message_variables
    : null;

  if (
    messageVariables
    && typeof messageVariables === 'object'
    && Object.prototype.hasOwnProperty.call(messageVariables, key)
  ) {
    return {
      present: true,
      value: parseScalevMoneyValue((messageVariables as Record<string, unknown>)[key]),
    };
  }

  return { present: false, value: null };
}

export function parseScalevHeaderFinancialFields(data: unknown) {
  const shippingDiscount = extractScalevHeaderField(data, 'shipping_discount');
  const discountCodeDiscount = extractScalevHeaderField(data, 'discount_code_discount');

  return {
    shippingDiscount: shippingDiscount.value,
    shippingDiscountPresent: shippingDiscount.present,
    discountCodeDiscount: discountCodeDiscount.value,
    discountCodeDiscountPresent: discountCodeDiscount.present,
  };
}

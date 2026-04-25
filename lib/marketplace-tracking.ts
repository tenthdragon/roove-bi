function cleanText(value: unknown): string {
  const text = String(value ?? '').trim();
  return text || '';
}

export function normalizeMarketplaceTracking(value: unknown): string | null {
  const text = cleanText(value).toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return text || null;
}

export function extractMarketplaceTrackingFromWebhookData(data: any): string | null {
  return normalizeMarketplaceTracking(
    data?.shipment_receipt
    ?? data?.tracking_number
    ?? data?.receipt_number
    ?? data?.resi
    ?? data?.airway_bill
    ?? data?.shipping_receipt
    ?? data?.delivery_tracking_number
    ?? data?.destination_address?.resi
    ?? data?.destination_address?.tracking_number
    ?? data?.origin_address?.resi
    ?? data?.origin_address?.tracking_number
    ?? null,
  );
}

export function extractMarketplaceTrackingFromProjectionRows(rows: Array<Record<string, any>> | null | undefined): string | null {
  for (const row of rows || []) {
    const value = normalizeMarketplaceTracking(
      row?.shipment_receipt
      ?? row?.tracking_number
      ?? row?.resi
      ?? null,
    );
    if (value) return value;
  }
  return null;
}

export function extractMarketplaceTrackingFromScalevOrderRawData(rawData: any): string | null {
  return (
    extractMarketplaceTrackingFromProjectionRows(Array.isArray(rawData?.projection_rows) ? rawData.projection_rows : [])
    || normalizeMarketplaceTracking(
      rawData?.shipment_receipt
      ?? rawData?.tracking_number
      ?? rawData?.receipt_number
      ?? rawData?.resi
      ?? rawData?.airway_bill
      ?? rawData?.shipping_receipt
      ?? rawData?.delivery_tracking_number
      ?? rawData?.destination_address?.resi
      ?? rawData?.destination_address?.tracking_number
      ?? rawData?.origin_address?.resi
      ?? rawData?.origin_address?.tracking_number
      ?? null,
    )
  );
}

export function shipmentDateToScalevOrderPrefix(value: string | null | undefined): string | null {
  const text = cleanText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return `${match[1].slice(2)}${match[2]}${match[3]}`;
}

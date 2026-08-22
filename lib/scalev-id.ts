export function normalizeScalevNumericId(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? text : null;
}

export function extractScalevNumericId(data: any): string | null {
  const candidates = [
    data?.scalev_id,
    data?.raw_data?.scalev_id,
    data?.id,
    data?.raw_data?.id,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeScalevNumericId(candidate);
    if (normalized) return normalized;
  }
  return null;
}

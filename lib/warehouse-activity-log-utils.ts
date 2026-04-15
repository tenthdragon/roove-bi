export function normalizeWarehouseActivityLogArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

export function areWarehouseActivityLogValuesEqual(left: unknown, right: unknown) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(normalizeWarehouseActivityLogArray(left).sort())
      === JSON.stringify(normalizeWarehouseActivityLogArray(right).sort());
  }

  if (
    left && right
    && typeof left === 'object'
    && typeof right === 'object'
  ) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  return left === right;
}

export function getWarehouseActivityLogChangedFields<T extends Record<string, any>>(
  before: T,
  after: T,
  fields: string[],
) {
  return fields.filter((field) => !areWarehouseActivityLogValuesEqual(before?.[field], after?.[field]));
}

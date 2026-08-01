export type WarehouseBusinessTarget = {
  deduct_entity: string | null;
  deduct_warehouse: string | null;
  is_active: boolean;
  is_primary?: boolean | null;
  notes?: string | null;
};

export type WarehouseMappingProduct = {
  name?: string | null;
  sku?: string | null;
  category?: string | null;
  entity?: string | null;
  warehouse?: string | null;
  scalev_product_names?: string[] | null;
};

function normalizeCode(value: string | null | undefined) {
  return String(value || '').trim().toUpperCase();
}

export function getActiveWarehouseTargets(targets: WarehouseBusinessTarget[] | null | undefined) {
  return (targets || []).filter((target) => (
    target.is_active && normalizeCode(target.deduct_entity)
  ));
}

export function isWarehouseProductAllowedForBusiness(
  product: WarehouseMappingProduct,
  ownerBusinessCode: string | null | undefined,
  targets: WarehouseBusinessTarget[] | null | undefined,
) {
  const activeTargets = getActiveWarehouseTargets(targets);
  const productEntity = normalizeCode(product.entity);
  const productWarehouse = normalizeCode(product.warehouse);

  if (activeTargets.length > 0) {
    return activeTargets.some((target) => {
      const targetEntity = normalizeCode(target.deduct_entity);
      const targetWarehouse = normalizeCode(target.deduct_warehouse);
      return productEntity === targetEntity
        && (!targetWarehouse || productWarehouse === targetWarehouse);
    });
  }

  const fallbackEntity = normalizeCode(ownerBusinessCode);
  return !fallbackEntity || productEntity === fallbackEntity;
}

export function filterWarehouseProductsForMapping<T extends WarehouseMappingProduct>(
  products: T[],
  input: {
    query: string;
    ownerBusinessCode?: string | null;
    targets?: WarehouseBusinessTarget[] | null;
    limit?: number;
  },
) {
  const query = input.query.trim().toLowerCase();
  if (!query) return [];

  const activeTargets = getActiveWarehouseTargets(input.targets);
  const primaryTargets = activeTargets.filter((target) => target.is_primary);

  return [...products]
    .filter((product) => {
      if (!isWarehouseProductAllowedForBusiness(product, input.ownerBusinessCode, activeTargets)) {
        return false;
      }

      const haystack = [
        product.name,
        product.sku,
        product.category,
        product.entity,
        product.warehouse,
        ...(Array.isArray(product.scalev_product_names) ? product.scalev_product_names : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    })
    .sort((left, right) => {
      const getBoost = (product: T) => {
        const productEntity = normalizeCode(product.entity);
        const productWarehouse = normalizeCode(product.warehouse);
        const matchesPrimary = primaryTargets.some((target) => (
          productEntity === normalizeCode(target.deduct_entity)
          && (!normalizeCode(target.deduct_warehouse) || productWarehouse === normalizeCode(target.deduct_warehouse))
        ));
        return (matchesPrimary ? 2 : 0) + (productWarehouse === 'BTN' ? 0.1 : 0);
      };

      const boostDifference = getBoost(right) - getBoost(left);
      if (boostDifference !== 0) return boostDifference;
      return String(left.name || '').localeCompare(String(right.name || ''));
    })
    .slice(0, input.limit ?? 12);
}

export function formatWarehouseTargets(
  ownerBusinessCode: string | null | undefined,
  targets: WarehouseBusinessTarget[] | null | undefined,
) {
  const activeTargets = getActiveWarehouseTargets(targets);
  if (activeTargets.length === 0) {
    return normalizeCode(ownerBusinessCode) || 'semua entity workspace';
  }

  return activeTargets
    .map((target) => `${normalizeCode(target.deduct_entity)} • ${normalizeCode(target.deduct_warehouse) || 'semua gudang'}`)
    .join(', ');
}

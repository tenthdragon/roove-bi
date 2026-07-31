export type WorkspaceWarehouseOrderLine = {
  product_name: string;
  quantity: number;
};

export type WorkspaceWarehouseLegacyMapping = {
  scalev_product_name: string;
  warehouse_product_id: number | null;
  deduct_qty_multiplier: number | null;
  is_ignored: boolean | null;
};

export type WorkspaceWarehouseTarget = {
  warehouse_product_id: number;
  scalev_product_name: string;
  quantity: number;
};

export function buildWorkspaceWarehouseTargets(
  lines: WorkspaceWarehouseOrderLine[],
  mappings: WorkspaceWarehouseLegacyMapping[],
) {
  const mappingByName = new Map(
    mappings.map((mapping) => [mapping.scalev_product_name, mapping]),
  );
  const targetsByProduct = new Map<number, WorkspaceWarehouseTarget>();
  const unmappedProducts = new Set<string>();
  let skippedIgnored = 0;

  for (const line of lines) {
    const productName = String(line.product_name || '').trim();
    const lineQuantity = Number(line.quantity || 0);
    if (!productName || !Number.isFinite(lineQuantity) || lineQuantity <= 0) {
      continue;
    }

    const mapping = mappingByName.get(productName);
    if (mapping?.is_ignored) {
      skippedIgnored += 1;
      continue;
    }

    const productId = Number(mapping?.warehouse_product_id || 0);
    const multiplier = Number(mapping?.deduct_qty_multiplier ?? 1);
    if (!productId || !Number.isFinite(multiplier) || multiplier <= 0) {
      unmappedProducts.add(productName);
      continue;
    }

    const quantity = lineQuantity * multiplier;
    const existing = targetsByProduct.get(productId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      targetsByProduct.set(productId, {
        warehouse_product_id: productId,
        scalev_product_name: productName,
        quantity,
      });
    }
  }

  return {
    targets: Array.from(targetsByProduct.values()),
    desiredByProduct: new Map(
      Array.from(targetsByProduct.entries()).map(([productId, target]) => [
        productId,
        target.quantity,
      ]),
    ),
    unmappedProducts: Array.from(unmappedProducts).sort(),
    skippedIgnored,
  };
}

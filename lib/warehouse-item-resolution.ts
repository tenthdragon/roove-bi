export type WorkspaceCanonicalTarget = {
  warehouse_product_id: number;
  scalev_product_name: string;
};

export type WorkspaceCanonicalProduct = {
  id: number;
  owner_workspace_id: string | null;
  is_active: boolean | null;
};

/**
 * Enforces the tenant boundary after canonical item resolution. Historical
 * compatibility mappings can still reference foreign or inactive products;
 * an independent workspace must never deduct those targets.
 */
export function constrainCanonicalTargetsToWorkspace<
  TTarget extends WorkspaceCanonicalTarget,
>(
  targets: TTarget[],
  products: WorkspaceCanonicalProduct[],
  workspaceId: string,
) {
  const allowedProductIds = new Set(
    products
      .filter((product) => (
        product.owner_workspace_id === workspaceId
        && product.is_active === true
      ))
      .map((product) => Number(product.id)),
  );

  const validTargets: TTarget[] = [];
  const rejectedProductNames = new Set<string>();

  for (const target of targets) {
    if (allowedProductIds.has(Number(target.warehouse_product_id))) {
      validTargets.push(target);
      continue;
    }

    const productName = String(target.scalev_product_name || '').trim();
    if (productName) rejectedProductNames.add(productName);
  }

  return {
    validTargets,
    rejectedProductNames: Array.from(rejectedProductNames),
  };
}

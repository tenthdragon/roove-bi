import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkspaceWarehouseTargets } from '../lib/workspace-warehouse-reconcile';

test('builds workspace-local targets and combines repeated product lines', () => {
  const result = buildWorkspaceWarehouseTargets(
    [
      { product_name: 'Purvu A', quantity: 2 },
      { product_name: 'Purvu A', quantity: 1 },
      { product_name: 'Bonus', quantity: 1 },
    ],
    [
      {
        scalev_product_name: 'Purvu A',
        warehouse_product_id: 42,
        deduct_qty_multiplier: 2,
        is_ignored: false,
      },
      {
        scalev_product_name: 'Bonus',
        warehouse_product_id: null,
        deduct_qty_multiplier: 1,
        is_ignored: true,
      },
    ],
  );

  assert.deepEqual(result.targets, [{
    warehouse_product_id: 42,
    scalev_product_name: 'Purvu A',
    quantity: 6,
  }]);
  assert.equal(result.desiredByProduct.get(42), 6);
  assert.equal(result.skippedIgnored, 1);
  assert.deepEqual(result.unmappedProducts, []);
});

test('never guesses a warehouse product when a mapping is absent', () => {
  const result = buildWorkspaceWarehouseTargets(
    [{ product_name: 'Unknown Purvu SKU', quantity: 3 }],
    [],
  );

  assert.deepEqual(result.targets, []);
  assert.deepEqual(result.unmappedProducts, ['Unknown Purvu SKU']);
});

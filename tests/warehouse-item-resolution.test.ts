import assert from 'node:assert/strict';
import test from 'node:test';
import { constrainCanonicalTargetsToWorkspace } from '../lib/warehouse-item-resolution';

test('keeps active canonical targets owned by the independent workspace', () => {
  const result = constrainCanonicalTargetsToWorkspace(
    [{ warehouse_product_id: 42, scalev_product_name: 'Osgard 60 ml', quantity: 1 }],
    [{ id: 42, owner_workspace_id: 'workspace-a', is_active: true }],
    'workspace-a',
  );

  assert.deepEqual(result.validTargets, [
    { warehouse_product_id: 42, scalev_product_name: 'Osgard 60 ml', quantity: 1 },
  ]);
  assert.deepEqual(result.rejectedProductNames, []);
});

test('rejects canonical targets owned by another workspace', () => {
  const result = constrainCanonicalTargetsToWorkspace(
    [{ warehouse_product_id: 42, scalev_product_name: 'Purvu Arum 50 ml' }],
    [{ id: 42, owner_workspace_id: 'workspace-apurva', is_active: true }],
    'workspace-roove',
  );

  assert.deepEqual(result.validTargets, []);
  assert.deepEqual(result.rejectedProductNames, ['Purvu Arum 50 ml']);
});

test('rejects inactive historical products without duplicating queue labels', () => {
  const result = constrainCanonicalTargetsToWorkspace(
    [
      { warehouse_product_id: 42, scalev_product_name: 'Historical Item' },
      { warehouse_product_id: 42, scalev_product_name: 'Historical Item' },
    ],
    [{ id: 42, owner_workspace_id: 'workspace-a', is_active: false }],
    'workspace-a',
  );

  assert.deepEqual(result.validTargets, []);
  assert.deepEqual(result.rejectedProductNames, ['Historical Item']);
});

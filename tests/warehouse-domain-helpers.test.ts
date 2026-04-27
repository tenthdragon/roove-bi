import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveWarehouseOriginBusinessNameFromOriginName,
  resolveWarehouseOrigin,
  type WarehouseOriginRegistryRow,
} from '../lib/warehouse-domain-helpers';

const registryRows: WarehouseOriginRegistryRow[] = [
  {
    id: 2,
    external_origin_business_name: 'Roove Lautan Barat',
    external_origin_business_name_normalized: 'roove lautan barat',
    external_origin_name: 'Roove Lautan Barat',
    external_origin_name_normalized: 'roove lautan barat',
    operator_business_id: null,
    operator_business_code: 'RLB',
    internal_warehouse_code: 'BTN',
    is_active: true,
    notes: null,
  },
  {
    id: 3,
    external_origin_business_name: 'Jejak Herba Nusantara',
    external_origin_business_name_normalized: 'jejak herba nusantara',
    external_origin_name: 'Jejak Herba Nusantara',
    external_origin_name_normalized: 'jejak herba nusantara',
    operator_business_id: null,
    operator_business_code: 'JHN',
    internal_warehouse_code: 'BTN',
    is_active: true,
    notes: null,
  },
];

test('derives origin business name from warehouse-style origin labels', () => {
  assert.equal(
    deriveWarehouseOriginBusinessNameFromOriginName("Roove Lautan Barat's Warehouse"),
    'Roove Lautan Barat',
  );
  assert.equal(
    deriveWarehouseOriginBusinessNameFromOriginName('Jejak Herba Nusantara Warehouse'),
    'Jejak Herba Nusantara',
  );
  assert.equal(
    deriveWarehouseOriginBusinessNameFromOriginName('Roove Lautan Barat'),
    null,
  );
});

test('resolves origin registry from warehouse name only when unique', () => {
  const resolved = resolveWarehouseOrigin({
    rawOriginBusinessName: null,
    rawOriginName: "Roove Lautan Barat's Warehouse",
    registryRows,
  });

  assert.equal(resolved.id, 2);
  assert.equal(resolved.operator_business_code, 'RLB');
  assert.equal(resolved.internal_warehouse_code, 'BTN');
  assert.equal(resolved.source, 'registry');
});

test('resolves origin registry from explicit business and origin labels', () => {
  const resolved = resolveWarehouseOrigin({
    rawOriginBusinessName: 'Jejak Herba Nusantara',
    rawOriginName: 'Jejak Herba Nusantara',
    registryRows,
  });

  assert.equal(resolved.id, 3);
  assert.equal(resolved.operator_business_code, 'JHN');
  assert.equal(resolved.internal_warehouse_code, 'BTN');
  assert.equal(resolved.source, 'registry');
});

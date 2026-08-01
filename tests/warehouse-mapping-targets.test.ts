import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterWarehouseProductsForMapping,
  isWarehouseProductAllowedForBusiness,
} from '../lib/warehouse-mapping-targets';

const apurvaTarget = [{
  deduct_entity: 'APV',
  deduct_warehouse: 'BTN',
  is_active: true,
  is_primary: true,
}];

test('uses business routing instead of requiring the Scalev business code as product entity', () => {
  assert.equal(isWarehouseProductAllowedForBusiness(
    { entity: 'APV', warehouse: 'BTN' },
    'PRVA',
    apurvaTarget,
  ), true);
});

test('rejects products outside the configured warehouse routing', () => {
  assert.equal(isWarehouseProductAllowedForBusiness(
    { entity: 'JHN', warehouse: 'BTN' },
    'PRVA',
    apurvaTarget,
  ), false);
  assert.equal(isWarehouseProductAllowedForBusiness(
    { entity: 'APV', warehouse: 'SBY' },
    'PRVA',
    apurvaTarget,
  ), false);
});

test('finds a routed warehouse product by its direct name', () => {
  const products = [
    { id: 1, name: 'Purvu - TS Adele 3 ml', sku: 'PUR-ADELE-3', entity: 'APV', warehouse: 'BTN' },
    { id: 2, name: 'Roove Blueberry', sku: 'ROOVE-BLU', entity: 'RLB', warehouse: 'BTN' },
  ];

  const result = filterWarehouseProductsForMapping(products, {
    query: 'adele 3 ml',
    ownerBusinessCode: 'PRVA',
    targets: apurvaTarget,
  });

  assert.deepEqual(result.map((product) => product.id), [1]);
});

test('finds routed products by SKU and Scalev alias', () => {
  const products = [{
    id: 1,
    name: 'Purvu - TS Adele 3 ml',
    sku: 'PUR-ADELE-3',
    entity: 'APV',
    warehouse: 'BTN',
    scalev_product_names: ['Adele Secret - 3ml'],
  }];

  assert.deepEqual(filterWarehouseProductsForMapping(products, {
    query: 'PUR-ADELE-3',
    ownerBusinessCode: 'PRVA',
    targets: apurvaTarget,
  }).map((product) => product.id), [1]);

  assert.deepEqual(filterWarehouseProductsForMapping(products, {
    query: 'Adele Secret',
    ownerBusinessCode: 'PRVA',
    targets: apurvaTarget,
  }).map((product) => product.id), [1]);
});

test('keeps direct entity fallback for businesses without explicit routing', () => {
  assert.equal(isWarehouseProductAllowedForBusiness(
    { entity: 'JHN', warehouse: 'BTN' },
    'JHN',
    [],
  ), true);
  assert.equal(isWarehouseProductAllowedForBusiness(
    { entity: 'RLB', warehouse: 'BTN' },
    'JHN',
    [],
  ), false);
});

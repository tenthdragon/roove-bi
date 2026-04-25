import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveScalevSourceClass } from '../lib/scalev-source-class';

test('classifies marketplace from financial_entity first', () => {
  assert.deepEqual(
    deriveScalevSourceClass({
      financialEntity: { code: 'shopee' },
      platform: 'scalev',
      storeName: 'Roove Direct Store',
    }),
    {
      sourceClass: 'marketplace',
      sourceClassReason: 'financial_entity',
    },
  );
});

test('classifies marketplace from platform', () => {
  assert.deepEqual(
    deriveScalevSourceClass({
      platform: 'tiktokshop',
      storeName: 'Roove Direct Store',
    }),
    {
      sourceClass: 'marketplace',
      sourceClassReason: 'platform',
    },
  );
});

test('classifies marketplace from external_id heuristic', () => {
  assert.deepEqual(
    deriveScalevSourceClass({
      externalId: '2681417797192678',
      storeName: 'Roove Direct Store',
    }),
    {
      sourceClass: 'marketplace',
      sourceClassReason: 'external_id',
    },
  );
});

test('classifies marketplace from courier fallback', () => {
  assert.deepEqual(
    deriveScalevSourceClass({
      courierService: {
        courier: {
          code: 'lazada-logistics',
        },
      },
      storeName: 'Roove Direct Store',
    }),
    {
      sourceClass: 'marketplace',
      sourceClassReason: 'courier',
    },
  );
});

test('classifies non-marketplace on direct fallback', () => {
  assert.deepEqual(
    deriveScalevSourceClass({
      storeName: 'Roove Direct Store',
      storeType: 'scalev',
    }),
    {
      sourceClass: 'non_marketplace',
      sourceClassReason: 'fallback_non_marketplace',
    },
  );
});

test('classifies explicit marketplace_api_upload directly', () => {
  assert.deepEqual(
    deriveScalevSourceClass({
      source: 'marketplace_api_upload',
      storeName: 'Roove Direct Store',
    }),
    {
      sourceClass: 'marketplace',
      sourceClassReason: 'marketplace_api_upload',
    },
  );
});

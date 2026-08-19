import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateProfitabilityTarget } from '../lib/financial-targets';

test('negative CM3 is never on track, even with a configured target', () => {
  const result = calculateProfitabilityTarget({
    currentRevenue: 72_200_000,
    currentCm3: -5_400_000,
    projectedRevenue: 72_200_000,
    monthlyOverhead: 0,
    actualDay: 31,
    daysInMonth: 31,
    target: {
      target_operating_profit: 0,
    },
  });

  assert.equal(result.status, 'negative_unit_economics');
  assert.equal(result.onTrack, false);
  assert.equal(result.minimumRevenue, null);
});

test('weighted CM3 margin keeps the revenue target available when current CM3 is negative', () => {
  const result = calculateProfitabilityTarget({
    currentRevenue: 72_200_000,
    currentCm3: -5_400_000,
    projectedRevenue: 72_200_000,
    monthlyOverhead: 100_000_000,
    actualDay: 31,
    daysInMonth: 31,
    target: {
      target_operating_profit: 50_000_000,
      planned_cm3_margin: 0.25,
    },
  });

  assert.equal(result.targetCm3, 150_000_000);
  assert.equal(result.minimumRevenue, 600_000_000);
  assert.equal(result.status, 'negative_unit_economics');
});

test('positive unit economics without configuration is neutral, not on track', () => {
  const result = calculateProfitabilityTarget({
    currentRevenue: 100_000_000,
    currentCm3: 30_000_000,
    projectedRevenue: 200_000_000,
    monthlyOverhead: 20_000_000,
    actualDay: 15,
    daysInMonth: 30,
    target: null,
  });

  assert.equal(result.status, 'unconfigured');
  assert.equal(result.onTrack, false);
  assert.equal(result.minimumRevenue, null);
});

test('forecast profit uses current performance while revenue target uses the weighted CM3 margin', () => {
  const result = calculateProfitabilityTarget({
    currentRevenue: 100_000_000,
    currentCm3: 30_000_000,
    projectedRevenue: 300_000_000,
    monthlyOverhead: 40_000_000,
    actualDay: 10,
    daysInMonth: 30,
    target: {
      target_operating_profit: 50_000_000,
      planned_cm3_margin: 0.25,
    },
  });

  assert.equal(result.projectedProfit, 50_000_000);
  assert.equal(result.status, 'on_track');
  assert.equal(result.onTrack, true);
  assert.equal(result.minimumRevenue, 360_000_000);
  assert.equal(result.revenueCm3Margin, 0.25);
});

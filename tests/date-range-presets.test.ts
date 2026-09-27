import test from 'node:test';
import assert from 'node:assert/strict';

import { getPresetRanges } from '../lib/utils';

test('getPresetRanges includes the 26th-to-25th cut-off period', () => {
  const presets = getPresetRanges(new Date('2026-09-27T05:00:00.000Z'));

  assert.deepEqual(
    presets.find((preset) => preset.label === 'Cut Off'),
    { label: 'Cut Off', from: '2026-08-26', to: '2026-09-25' },
  );
});

test('getPresetRanges rolls the cut-off start into the previous year in January', () => {
  const presets = getPresetRanges(new Date('2026-01-10T05:00:00.000Z'));

  assert.deepEqual(
    presets.find((preset) => preset.label === 'Cut Off'),
    { label: 'Cut Off', from: '2025-12-26', to: '2026-01-25' },
  );
});

test('getPresetRanges keeps the current-month preset unchanged', () => {
  const presets = getPresetRanges(new Date('2026-09-27T05:00:00.000Z'));

  assert.deepEqual(
    presets.find((preset) => preset.label === 'Bulan Ini'),
    { label: 'Bulan Ini', from: '2026-09-01', to: '2026-09-27' },
  );
});

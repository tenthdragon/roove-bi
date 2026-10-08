import assert from "node:assert/strict";
import { test } from "node:test";
import { isWorkspaceModuleEnabled } from "../lib/workspaces";
import {
  dueInWib,
  workWeek,
  wibDate,
  normalizeRecordInput,
  growthPageSize,
  metricRatio,
} from "../lib/growth-domain";
import {
  marketingTotals,
  selectMarketingScope,
} from "../lib/marketing-metrics";

test("WIB work week crosses UTC and calendar month correctly", () => {
  assert.equal(wibDate(new Date("2026-10-04T17:01:00Z")), "2026-10-05");
  assert.equal(workWeek("2026-10-04"), "2026-09-28");
  assert.equal(workWeek("2026-10-05"), "2026-10-05");
  assert.equal(dueInWib("2026-10-08"), "2026-10-08T16:59:59.999Z");
  assert.equal(dueInWib("2026-10-08T21:30"), "2026-10-08T14:30:00.000Z");
});
test("Growth module requires explicit opt-in and disabled modules override it", () => {
  assert.equal(
    isWorkspaceModuleEnabled({ settings: {} }, "growth-work"),
    false,
  );
  assert.equal(
    isWorkspaceModuleEnabled(
      { settings: { growth_execution_enabled: true } },
      "growth-work",
    ),
    true,
  );
  assert.equal(
    isWorkspaceModuleEnabled(
      {
        settings: {
          growth_execution_enabled: true,
          disabled_modules: ["growth-work"],
        },
      },
      "growth-work",
    ),
    false,
  );
  assert.equal(isWorkspaceModuleEnabled({ settings: {} }, "marketing"), true);
});
test("company and brand scopes use the same active-brand attribution as Marketing", () => {
  const products = [
    { product: "Roove", net_sales: 200, gross_profit: 100 },
    { product: "Retired", net_sales: 900, gross_profit: 800 },
  ];
  const ads = [
    { store: "Shop", brand_id: 1, spent: 40 },
    { store: "Unknown", spent: 10 },
    { store: "Retired", spent: 500 },
  ];
  const brands = [{ id: 1, name: "Roove" }],
    mapping = [
      { store_pattern: "Shop", brand: "Roove", brand_id: 1 },
      { store_pattern: "Retired", brand: "Retired", brand_id: 2 },
    ];
  const company = selectMarketingScope(
    products,
    ads,
    [],
    [],
    brands,
    mapping,
    null,
  );
  assert.equal(company.products.length, 1);
  assert.equal(company.ads.length, 2);
  const brand = selectMarketingScope(products, ads, [], [], brands, mapping, 1);
  assert.equal(marketingTotals(brand.products, brand.ads, [], []).roas, 5);
  assert.throws(
    () => selectMarketingScope(products, ads, [], [], brands, mapping, 999),
    /Brand/,
  );
});
test("record input cannot inject server fields or executable evidence URLs", () => {
  const input = {
    kind: "evidence",
    title: "Bukti",
    status: "recorded",
    payload: {
      evidence_type: "url",
      reference: "https://example.com/asset",
      captured_at: "2026-10-08T20:00",
      snapshot: { revenue: 999 },
      decided_by: "malicious",
    },
  };
  const normalized = normalizeRecordInput(input);
  assert.equal(normalized.payload.snapshot, undefined);
  assert.equal(normalized.payload.decided_by, undefined);
  assert.throws(() =>
    normalizeRecordInput({
      ...input,
      payload: { ...input.payload, reference: "javascript:alert(1)" },
    }),
  );
  assert.throws(() => normalizeRecordInput({ ...input, kind: "unknown" }));
});
test("ratios never treat absent or zero targets as progress", () => {
  assert.equal(metricRatio(100, null), null);
  assert.equal(metricRatio(null, 100), null);
  assert.equal(metricRatio(100, 0), null);
  assert.equal(metricRatio(50, 100), 0.5);
  assert.equal(growthPageSize(1000), 25);
  assert.equal(growthPageSize(50), 50);
});
test("shared marketing totals use ratio of sums and BI CM3 sign conventions", () => {
  const totals = marketingTotals(
    [
      { net_sales: 200, gross_profit: 100 },
      { net_sales: 100, gross_profit: 50 },
    ],
    [{ spent: -40 }, { spent: 10 }],
    [{ mp_admin_cost: -20 }],
    [{ shipping_charge: 10 }],
  );
  assert.equal(totals.revenue, 300);
  assert.equal(totals.mktFee, 50);
  assert.equal(totals.roas, 6);
  assert.equal(totals.cm3, 70);
  assert.equal(marketingTotals([], [], [], []).roas, null);
});

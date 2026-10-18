// Browser QA data. This module is only aliased by the isolated preview script.
import {
  type GrowthRecord,
  normalizeRecordInput,
} from "../../lib/growth-domain";
export const USER = "10000000-0000-4000-8000-000000000001",
  CREATIVE = "10000000-0000-4000-8000-000000000002",
  SALES = "10000000-0000-4000-8000-000000000003",
  PORTFOLIO = "20000000-0000-4000-8000-000000000001",
  WORKSPACE = "30000000-0000-4000-8000-000000000001";
const now = new Date().toISOString();
const base = {
  workspace_id: WORKSPACE,
  portfolio_id: PORTFOLIO,
  brand_id: null,
  parent_id: null,
  pic_id: USER,
  reviewer_id: CREATIVE,
  recipient_id: null,
  blocker_owner_id: null,
  due_at: "2026-10-12T16:59:59Z",
  row_version: 1,
  archived_at: null,
  created_by: USER,
  created_at: now,
  updated_at: now,
};
const records: GrowthRecord[] = [
  {
    ...base,
    id: "40000000-0000-4000-8000-000000000001",
    short_id: 1,
    kind: "priority",
    title: "Perbaiki kualitas lead melalui creative",
    status: "active",
    payload: {
      diagnosis: "Lead bertambah, purchase cohort belum mengikuti.",
      success_criteria: "Purchase matang dengan biaya sesuai guardrail.",
    },
  },
  {
    ...base,
    id: "40000000-0000-4000-8000-000000000002",
    short_id: 2,
    kind: "work",
    title: "Creative pain point pelanggan · versi A",
    status: "review",
    pic_id: CREATIVE,
    reviewer_id: USER,
    parent_id: "40000000-0000-4000-8000-000000000001",
    payload: {
      acceptance_criteria: "Claim valid; CTA sesuai funnel.",
      acknowledgment: "accepted",
      output_version: 1,
    },
  },
  {
    ...base,
    id: "40000000-0000-4000-8000-000000000003",
    short_id: 3,
    kind: "dependency",
    title: "Konfirmasi voucher dan kesiapan stok Sales",
    status: "requested",
    recipient_id: SALES,
    payload: {
      question: "Offer dan batas stok minggu ini?",
      acceptance_criteria: "Voucher disahkan Sales.",
    },
  },
  {
    ...base,
    id: "40000000-0000-4000-8000-000000000004",
    short_id: 4,
    kind: "experiment",
    title: "Uji message A vs B pada cohort baru",
    status: "awaiting_evaluation",
    payload: {
      hypothesis: "Message sesuai kebutuhan meningkatkan purchase.",
      evaluate_after: "2026-10-07T16:59:59Z",
      guardrails: "Mengikuti plafon mandat.",
    },
  },
  {
    ...base,
    id: "40000000-0000-4000-8000-000000000005",
    short_id: 5,
    kind: "decision",
    title: "Persetujuan offer promo marketplace",
    status: "requested",
    recipient_id: SALES,
    payload: {
      domain: "sales_commercial",
      question: "Pilih voucher A atau B?",
      options: "A/B",
      action: "offer",
      amount: 0,
    },
  },
  {
    ...base,
    id: "40000000-0000-4000-8000-000000000006",
    short_id: 6,
    kind: "evidence",
    title: "Asset version A",
    status: "recorded",
    parent_id: "40000000-0000-4000-8000-000000000002",
    payload: {
      evidence_type: "text",
      reference: "Asset A tersimpan di library creative.",
      captured_at: now,
      output_version: 1,
    },
  },
];
export async function getGrowthBootstrap() {
  return {
    workspaceId: WORKSPACE,
    userId: USER,
    portfolios: [
      { id: PORTFOLIO, name: "Roove Growth", workspace_id: WORKSPACE },
    ],
    brands: [
      { id: 1, name: "Roove" },
      { id: 2, name: "Pluve" },
    ],
    people: [
      { id: USER, full_name: "Growth Lead" },
      { id: CREATIVE, full_name: "Creative PIC" },
      { id: SALES, full_name: "Sales Owner" },
    ],
    memberships: [USER, CREATIVE, SALES].map((id, index) => ({
      id: `50000000-0000-4000-8000-00000000000${index + 1}`,
      workspace_id: WORKSPACE,
      portfolio_id: PORTFOLIO,
      user_id: id,
      active: true,
      functions: [index === 0 ? "growth" : index === 1 ? "creative" : "sales"],
      managed_functions: index === 0 ? ["creative", "acquisition"] : [],
      visibility_mode: "team",
      company_scope: true,
      growth_membership_brands: [],
      effective_from: now,
      effective_to: null,
      row_version: 1,
    })),
    mandates: [],
  };
}
export async function listGrowthRecords(params: Record<string, unknown>) {
  let rows = records.filter(
    (r) =>
      (!params.kind || r.kind === params.kind) &&
      (!params.status || r.status === params.status) &&
      (!params.search || r.title.includes(String(params.search))) &&
      (params.archived || !r.archived_at),
  );
  if (params.myWork)
    rows = rows.filter((r) =>
      [r.pic_id, r.reviewer_id, r.recipient_id, r.blocker_owner_id].includes(
        USER,
      ),
    );
  const size = Number(params.pageSize || 25),
    page = Number(params.page || 0);
  return {
    records: rows.slice(page * size, (page + 1) * size),
    count: rows.length,
    page,
    pageSize: size,
  };
}
export async function getGrowthRecord(id: string) {
  const record = records.find((r) => r.id === id);
  if (!record) throw new Error("Record tidak ditemukan.");
  const parent = records.find((r) => r.id === record.parent_id);
  return {
    record,
    parent: parent
      ? {
          id: parent.id,
          short_id: parent.short_id,
          title: parent.title,
          status: parent.status,
        }
      : null,
  };
}
export async function getGrowthRelated(id: string, page = 0) {
  const children = records.filter((r) => r.parent_id === id);
  return {
    records: children.slice(page * 25, (page + 1) * 25),
    count: children.length,
  };
}
export async function getGrowthHistory(id: string) {
  return [
    {
      id: 1,
      object_id: id,
      actor_id: USER,
      action: "save",
      created_at: now,
      after_values: records.find((r) => r.id === id),
    },
  ];
}
export async function saveGrowthRecord(args: {
  input: unknown;
  objectId: string;
  expectedRowVersion: number;
}) {
  const input = normalizeRecordInput(args.input);
  const existing = records.find((r) => r.id === args.objectId);
  if (existing && existing.row_version !== args.expectedRowVersion)
    throw new Error("Conflict: muat ulang.");
  const r = {
    ...base,
    ...input,
    id: args.objectId,
    short_id: existing?.short_id || records.length + 1,
    row_version: args.expectedRowVersion + 1,
    updated_at: new Date().toISOString(),
  } as GrowthRecord;
  if (existing) records[records.indexOf(existing)] = r;
  else records.push(r);
  return r;
}
export async function configureGrowth() {
  return {};
}
export async function getGrowthConfigurationPeople() {
  return (await getGrowthBootstrap()).people;
}
export async function getGrowthOverview() {
  return {
    visibility: "team",
    counts: {
      priority: 1,
      work: 1,
      experiment: 1,
      decision: 1,
      incident: 0,
      dependency: 1,
    },
    summary: {
      active_priorities: records.filter(
        (r) => r.kind === "priority" && r.status === "active",
      ),
      blocked: [],
      overdue: [],
      pending_decisions: records.filter(
        (r) => r.kind === "decision" && r.status === "requested",
      ),
      evaluation_needed: records.filter(
        (r) => r.kind === "experiment" && r.status === "awaiting_evaluation",
      ),
      awaiting_deployment: [],
      last_review: null,
    },
    metrics: {
      workspace_id: WORKSPACE,
      portfolio_id: PORTFOLIO,
      brand_id: null,
      scope: "company",
      source_period: { from: "2026-10-01", to: "2026-10-08" },
      computed_at: now,
      data_as_of: null,
      basis: "Shipped/completed; tanggal pengiriman WIB",
      freshness: "Fixture preview; bukan data produksi",
      status: "loaded",
      reason: null,
      actual: { revenue: 128000000, cm3: 24500000, roas: 3.2 },
      target: null,
    },
  };
}

export const GROWTH_TABS = [
  "overview",
  "priorities",
  "work-board",
  "experiments",
  "decisions",
  "weekly-review",
] as const;
export type GrowthTab = (typeof GROWTH_TABS)[number];
export const GROWTH_KINDS = [
  "goal",
  "priority",
  "work",
  "dependency",
  "evidence",
  "deployment",
  "experiment",
  "result",
  "decision",
  "incident",
  "weekly",
  "link",
  "update",
] as const;
export type GrowthKind = (typeof GROWTH_KINDS)[number];
export type GrowthPayload = Record<
  string,
  string | number | boolean | null | string[] | Record<string, unknown>
>;
export type GrowthRecord = {
  id: string;
  workspace_id: string;
  portfolio_id: string;
  short_id: number;
  kind: GrowthKind;
  title: string;
  status: string;
  brand_id: number | null;
  parent_id: string | null;
  pic_id: string | null;
  reviewer_id: string | null;
  recipient_id: string | null;
  blocker_owner_id: string | null;
  due_at: string | null;
  payload: GrowthPayload;
  row_version: number;
  archived_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export type GrowthSummary = {
  active_priorities: GrowthRecord[];
  blocked: GrowthRecord[];
  overdue: GrowthRecord[];
  pending_decisions: GrowthRecord[];
  evaluation_needed: GrowthRecord[];
  awaiting_deployment: GrowthRecord[];
  last_review: {
    id: string;
    short_id: number;
    title: string;
    week_start: string;
    cutoff_at: string;
  } | null;
};
export const GROWTH_STATUSES: Record<GrowthKind, string[]> = {
  goal: ["draft", "approved", "retired"],
  priority: ["draft", "active", "blocked", "paused", "completed", "cancelled"],
  work: [
    "draft",
    "assigned",
    "in_progress",
    "blocked",
    "review",
    "accepted",
    "cancelled",
  ],
  dependency: ["requested", "committed", "declined", "fulfilled", "cancelled"],
  evidence: ["recorded"],
  deployment: ["deployed"],
  experiment: [
    "draft",
    "ready",
    "running",
    "awaiting_evaluation",
    "evaluated",
    "closed",
    "cancelled",
  ],
  result: ["recorded"],
  decision: ["draft", "requested", "decided", "withdrawn"],
  incident: ["open", "contained", "resolved", "closed"],
  weekly: ["draft", "final"],
  link: ["recorded"],
  update: ["recorded"],
};
export const GROWTH_LABELS: Record<GrowthKind, string> = {
  goal: "Operational Goal",
  priority: "Priority",
  work: "Work Item",
  dependency: "Sales Dependency",
  evidence: "Evidence",
  deployment: "Deployment",
  experiment: "Experiment",
  result: "Experiment Result",
  decision: "Decision",
  incident: "Incident",
  weekly: "Weekly Review",
  link: "Record Link",
  update: "Event Update",
};
export const GROWTH_FIELDS: Record<GrowthKind, string[]> = {
  goal: [
    "metric",
    "unit",
    "target_value",
    "period_from",
    "period_to",
    "notes",
    "supersedes_id",
    "revision_reason",
  ],
  priority: [
    "diagnosis",
    "success_criteria",
    "goal_id",
    "pause_reason",
    "blocker_reason",
    "action_needed",
    "impact",
    "follow_up_at",
  ],
  work: [
    "operational_category",
    "acceptance_criteria",
    "acknowledgment",
    "output_version",
    "progress_note",
    "review_feedback",
    "blocker_reason",
    "action_needed",
    "impact",
    "follow_up_at",
  ],
  dependency: ["question", "acceptance_criteria", "response", "evidence_id"],
  evidence: [
    "evidence_type",
    "reference",
    "captured_at",
    "output_version",
    "notes",
  ],
  deployment: [
    "evidence_id",
    "platform",
    "external_id",
    "deployed_at",
    "notes",
  ],
  experiment: [
    "hypothesis",
    "design",
    "comparator",
    "baseline",
    "cohort",
    "confounders",
    "primary_metric",
    "diagnostic_metrics",
    "success_rule",
    "evidence_rule",
    "guardrails",
    "budget",
    "action",
    "start_at",
    "end_at",
    "evaluate_after",
    "required_ids",
    "partial_design",
    "decision_id",
  ],
  result: [
    "actual",
    "numerator",
    "denominator",
    "cohort",
    "period_from",
    "period_to",
    "source",
    "captured_at",
    "maturity",
    "limitations",
    "outcome",
    "recommendation",
    "supersedes_id",
    "revision_reason",
  ],
  decision: [
    "domain",
    "action",
    "amount",
    "question",
    "options",
    "rationale",
    "outcome",
    "execution_state",
    "implementation_evidence_id",
    "evidence_id",
    "response",
    "supersedes_id",
    "revision_reason",
  ],
  incident: [
    "incident_type",
    "urgency",
    "impact",
    "containment",
    "review",
    "prevention",
    "evidence_id",
    "decision_id",
  ],
  weekly: [
    "week_start",
    "cutoff_at",
    "diagnosis",
    "learning",
    "forecast",
    "forecast_assumptions",
    "next_steps",
    "sales_alignment",
    "data_completeness",
    "supersedes_id",
    "revision_reason",
  ],
  link: ["target_id", "relation"],
  update: ["note"],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value))
    throw new Error("ID tidak valid.");
}
export function growthTab(value: string | null | undefined): GrowthTab {
  return GROWTH_TABS.includes(value as GrowthTab)
    ? (value as GrowthTab)
    : "overview";
}
export function wibDate(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}
export function workWeek(date = wibDate()) {
  const d = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) throw new Error("Tanggal tidak valid.");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function dueInWib(value: string | null) {
  if (!value) return null;
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T23:59:59.999+07:00`
      : /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        ? value
        : `${value}+07:00`,
  );
  if (!Number.isFinite(date.getTime())) throw new Error("Waktu tidak valid.");
  return date.toISOString();
}
export function normalizeRecordInput(raw: unknown) {
  if (!raw || typeof raw !== "object") throw new Error("Record tidak valid.");
  const input = raw as Record<string, unknown>;
  const kind = input.kind as GrowthKind;
  if (!GROWTH_KINDS.includes(kind))
    throw new Error("Jenis record tidak valid.");
  const title = String(input.title || "").trim();
  if (!title || title.length > 240)
    throw new Error("Judul harus 1–240 karakter.");
  if (!GROWTH_STATUSES[kind].includes(String(input.status)))
    throw new Error("Status tidak valid.");
  const payload = input.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Payload tidak valid.");
  if (JSON.stringify(payload).length > 100000)
    throw new Error("Record terlalu besar.");
  // Text is rendered as plain React text, never HTML. Server-generated fields are
  // preserved by RPC from the previous version, not accepted from the browser.
  const clean: GrowthPayload = {};
  for (const field of GROWTH_FIELDS[kind]) {
    const value = (payload as GrowthPayload)[field];
    if (value == null || value === "") continue;
    if (field === "required_ids") {
      if (!Array.isArray(value) || value.length > 100)
        throw new Error("Prerequisite tidak valid.");
      value.forEach(assertUuid);
      clean[field] = value;
      continue;
    }
    if (!["string", "number", "boolean"].includes(typeof value))
      throw new Error(`Field ${field} tidak valid.`);
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error(`Field ${field} tidak valid.`);
    if (typeof value === "string" && value.length > 10000)
      throw new Error(`Field ${field} terlalu panjang.`);
    clean[field] = value;
  }
  for (const field of [
    "captured_at",
    "deployed_at",
    "follow_up_at",
    "start_at",
    "end_at",
    "evaluate_after",
    "cutoff_at",
  ]) {
    if (clean[field]) clean[field] = dueInWib(String(clean[field]));
  }
  if (kind === "evidence" && clean.evidence_type === "url") {
    const url = new URL(String(clean.reference));
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("URL hanya http/https tanpa credential.");
  }
  const ids: Record<string, string | null> = {};
  for (const key of [
    "parent_id",
    "pic_id",
    "reviewer_id",
    "recipient_id",
    "blocker_owner_id",
  ]) {
    const value = input[key];
    if (value) assertUuid(value);
    ids[key] = value ? String(value) : null;
  }
  const brand =
    input.brand_id == null || input.brand_id === ""
      ? null
      : Number(input.brand_id);
  if (brand != null && (!Number.isInteger(brand) || brand <= 0))
    throw new Error("Brand tidak valid.");
  return {
    kind,
    title,
    status: String(input.status),
    brand_id: brand,
    ...ids,
    due_at: dueInWib(input.due_at ? String(input.due_at) : null),
    payload: clean,
    archived_at: input.archived_at ? dueInWib(String(input.archived_at)) : null,
  };
}
export function growthPageSize(value: unknown) {
  return Number(value) === 50 ? 50 : 25;
}
export function metricRatio(actual: number | null, target: number | null) {
  return actual != null &&
    target != null &&
    target > 0 &&
    Number.isFinite(actual) &&
    Number.isFinite(target)
    ? actual / target
    : null;
}

"use server";

import { requireDashboardTabAccess } from "./dashboard-access";
import { createServerSupabase } from "./supabase-server";
import { createServiceSupabase } from "./service-supabase";
import {
  assertUuid,
  GROWTH_KINDS,
  growthPageSize,
  normalizeRecordInput,
  type GrowthKind,
  type GrowthSummary,
} from "./growth-domain";
import { readGrowthMetrics } from "./growth-metrics";

async function access() {
  const context = await requireDashboardTabAccess(
    "growth-work",
    "Growth Execution",
  );
  return { ...context, db: createServerSupabase() };
}
function unwrap<T>(r: {
  data: T | null;
  error: { message: string } | null;
}): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}
async function requireTeam(
  db: ReturnType<typeof createServerSupabase>,
  workspaceId: string,
  portfolioId: string,
  brandId: number | null,
  permission: string,
) {
  const results = await Promise.all([
    db.rpc("growth_team", { w: workspaceId, p: portfolioId, b: brandId }),
    db.rpc("growth_has_permission", { w: workspaceId, permission }),
  ]);
  if (results.some((r) => r.error || r.data !== true))
    throw new Error("Forbidden: akses tim, action, atau scope tidak sah.");
}
export async function getGrowthBootstrap() {
  const { workspaceId, profile, db } = await access();
  const [portfolios, memberships, brands, mandates] = await Promise.all([
    db
      .from("growth_portfolios")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
    db
      .from("growth_memberships")
      .select("*,growth_membership_brands(brand_id)")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
    db
      .from("brands")
      .select("id,name")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("name"),
    db
      .from("growth_mandate_versions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const members = unwrap(memberships);
  const userIds = Array.from(
    new Set([profile.id, ...members.map((m) => m.user_id)]),
  );
  const people = unwrap(
    await db.from("profiles").select("id,full_name").in("id", userIds),
  );
  return {
    workspaceId,
    userId: profile.id,
    portfolios: unwrap(portfolios),
    memberships: members,
    brands: unwrap(brands),
    mandates: unwrap(mandates),
    people,
  };
}
export async function listGrowthRecords(params: {
  portfolioId: string;
  kind?: GrowthKind;
  brandId?: number | null;
  companyOnly?: boolean;
  myWork?: boolean;
  search?: string;
  status?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  archived?: boolean;
}) {
  assertUuid(params.portfolioId);
  const { workspaceId, profile, db } = await access();
  const size = growthPageSize(params.pageSize);
  const page = Math.max(
    0,
    Math.min(10000, Math.floor(Number(params.page) || 0)),
  );
  let query = db
    .from("growth_records")
    .select("*", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .eq("portfolio_id", params.portfolioId);
  if (params.kind) {
    if (!GROWTH_KINDS.includes(params.kind))
      throw new Error("Jenis record tidak valid.");
    query = query.eq("kind", params.kind);
  }
  if (params.brandId != null) query = query.eq("brand_id", params.brandId);
  else if (params.companyOnly) query = query.is("brand_id", null);
  if (!params.archived) query = query.is("archived_at", null);
  if (params.status) query = query.eq("status", params.status);
  if (params.myWork)
    query = query.or(
      `pic_id.eq.${profile.id},reviewer_id.eq.${profile.id},recipient_id.eq.${profile.id},blocker_owner_id.eq.${profile.id}`,
    );
  if (params.search)
    query = query.ilike(
      "title",
      `%${params.search.slice(0, 120).replace(/[%_\\]/g, "")}%`,
    );
  query = query
    .order(params.sort === "due" ? "due_at" : "updated_at", {
      ascending: params.sort === "due",
      nullsFirst: false,
    })
    .order("id")
    .range(page * size, page * size + size - 1);
  const response = await query;
  return {
    records: unwrap(response),
    count: response.count || 0,
    page,
    pageSize: size,
  };
}
export async function getGrowthRecord(id: string) {
  assertUuid(id);
  const { workspaceId, db } = await access();
  const record = unwrap(
    await db
      .from("growth_records")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle(),
  );
  if (!record) throw new Error("Record tidak ditemukan atau akses ditolak.");
  const parent = unwrap(
    await db.rpc("growth_parent_context", { object_id: id }),
  );
  return { record, parent };
}
export async function getGrowthHistory(id: string, beforeId?: number) {
  await getGrowthRecord(id);
  const { workspaceId, db } = await access();
  let q = db
    .from("growth_audit_events")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("object_id", id)
    .order("id", { ascending: false })
    .limit(25);
  if (beforeId) q = q.lt("id", beforeId);
  return unwrap(await q);
}
export async function getGrowthRelated(id: string, page = 0) {
  await getGrowthRecord(id);
  const { workspaceId, db } = await access();
  const offset =
    Math.max(0, Math.min(10000, Math.floor(Number(page) || 0))) * 25;
  const result = await db
    .from("growth_records")
    .select("*", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .eq("parent_id", id)
    .order("created_at", { ascending: false })
    .order("id")
    .range(offset, offset + 24);
  return { records: unwrap(result), count: result.count || 0 };
}
export async function saveGrowthRecord(args: {
  portfolioId: string;
  objectId: string;
  expectedRowVersion: number;
  requestId: string;
  input: unknown;
  refreshSnapshot?: boolean;
}) {
  [args.portfolioId, args.objectId, args.requestId].forEach(assertUuid);
  if (!Number.isInteger(args.expectedRowVersion) || args.expectedRowVersion < 0)
    throw new Error("Versi tidak valid.");
  const { workspaceId, profile, db } = await access();
  const input = normalizeRecordInput(args.input);
  if (input.archived_at)
    return unwrap(
      await db.rpc("growth_archive_record", {
        w: workspaceId,
        p: args.portfolioId,
        object_id: args.objectId,
        expected_version: args.expectedRowVersion,
        request_id: args.requestId,
      }),
    );
  if (
    input.kind === "weekly" &&
    (args.expectedRowVersion === 0 || args.refreshSnapshot)
  ) {
    await requireTeam(
      db,
      workspaceId,
      args.portfolioId,
      input.brand_id,
      "growth:metrics-read",
    );
    await requireTeam(
      db,
      workspaceId,
      args.portfolioId,
      input.brand_id,
      "growth:financial-target-read",
    );
    const cutoff = new Date(String(input.payload.cutoff_at));
    if (!Number.isFinite(cutoff.getTime()) || cutoff.getTime() > Date.now())
      throw new Error("Cutoff wajib valid dan bukan masa depan.");
    const cutoffDate = new Date(cutoff.getTime() + 7 * 3600000)
      .toISOString()
      .slice(0, 10);
    // BI date granularity is daily: exclude the incomplete cutoff day explicitly.
    const completeDay = new Date(`${cutoffDate}T00:00:00Z`);
    completeDay.setUTCDate(completeDay.getUTCDate() - 1);
    const to = completeDay.toISOString().slice(0, 10);
    const from = `${to.slice(0, 7)}-01`;
    const data = await readGrowthMetrics(
      workspaceId,
      args.portfolioId,
      input.brand_id,
      from,
      to,
      true,
    );
    const snapshotId = args.requestId;
    const snapshot = {
      id: snapshotId,
      workspace_id: workspaceId,
      portfolio_id: args.portfolioId,
      actor_id: profile.id,
      brand_id: input.brand_id,
      cutoff_at: cutoff.toISOString(),
      data: {
        ...data,
        cutoff_at: cutoff.toISOString(),
        daily_cutoff_policy:
          "Data harian sampai hari WIB lengkap sebelum cutoff",
        work_week: input.payload.week_start,
      },
    };
    const service = createServiceSupabase();
    const insert = await service
      .from("growth_metric_snapshots")
      .insert(snapshot);
    if (insert.error && insert.error.code !== "23505")
      throw new Error(insert.error.message);
    input.payload.snapshot_id = snapshotId;
  }
  return unwrap(
    await db.rpc("growth_save_record", {
      w: workspaceId,
      p: args.portfolioId,
      object_id: args.objectId,
      expected_version: args.expectedRowVersion,
      request_id: args.requestId,
      input,
    }),
  );
}
export async function configureGrowth(args: {
  portfolioId: string | null;
  objectId: string;
  expectedRowVersion: number;
  requestId: string;
  kind: "portfolio" | "membership" | "mandate";
  input: Record<string, unknown>;
}) {
  [args.objectId, args.requestId].forEach(assertUuid);
  if (args.portfolioId) assertUuid(args.portfolioId);
  const { workspaceId, db } = await access();
  if (
    !["portfolio", "membership", "mandate"].includes(args.kind) ||
    JSON.stringify(args.input).length > 10000
  )
    throw new Error("Konfigurasi tidak valid.");
  return unwrap(
    await db.rpc("growth_configure", {
      w: workspaceId,
      p: args.portfolioId,
      object_id: args.objectId,
      expected_version: args.expectedRowVersion,
      request_id: args.requestId,
      kind: args.kind,
      input: args.input,
    }),
  );
}
export async function getGrowthOverview(
  portfolioId: string,
  brandId: number | null,
  from: string,
  to: string,
) {
  assertUuid(portfolioId);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    from > to ||
    Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) >
      366 * 86400000
  )
    throw new Error("Periode BI tidak valid (maksimal 366 hari).");
  const { workspaceId, db } = await access();
  const kinds = [
    "priority",
    "work",
    "experiment",
    "decision",
    "incident",
    "dependency",
  ] as GrowthKind[];
  const counts = await Promise.all(
    kinds.map(async (kind) => {
      let q = db
        .from("growth_records")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("portfolio_id", portfolioId)
        .eq("kind", kind)
        .is("archived_at", null);
      if (brandId != null) q = q.eq("brand_id", brandId);
      const r = await q;
      if (r.error) throw new Error(r.error.message);
      return [kind, r.count || 0] as const;
    }),
  );
  const canTeam = unwrap(
    await db.rpc("growth_team", { w: workspaceId, p: portfolioId, b: brandId }),
  );
  const canMetric = unwrap(
    await db.rpc("growth_has_permission", {
      w: workspaceId,
      permission: "growth:metrics-read",
    }),
  );
  const canTarget = unwrap(
    await db.rpc("growth_has_permission", {
      w: workspaceId,
      permission: "growth:financial-target-read",
    }),
  );
  const summary = unwrap(
    await db.rpc("growth_overview_summary", {
      w: workspaceId,
      p: portfolioId,
      b: brandId,
    }),
  ) as GrowthSummary;
  const metrics =
    canTeam && canMetric
      ? await readGrowthMetrics(
          workspaceId,
          portfolioId,
          brandId,
          from,
          to,
          canTarget === true,
        )
      : null;
  return {
    counts: Object.fromEntries(counts),
    summary,
    metrics,
    visibility: canTeam ? "team" : "own_or_involved",
  };
}

export async function getGrowthConfigurationPeople() {
  const { workspaceId, db } = await access();
  if (
    unwrap(
      await db.rpc("growth_has_permission", {
        w: workspaceId,
        permission: "growth:configure",
      }),
    ) !== true
  )
    throw new Error("Forbidden");
  const memberships = unwrap(
    await db
      .from("workspace_memberships")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("status", "active"),
  );
  if (!memberships.length) return [];
  return unwrap(
    await db
      .from("profiles")
      .select("id,full_name")
      .in(
        "id",
        memberships.map((m) => m.user_id),
      ),
  );
}

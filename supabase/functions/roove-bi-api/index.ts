// supabase/functions/roove-bi-api/index.ts
// REST API for Customer Analysis — consumed by Custom GPT Actions

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_KEY = Deno.env.get("ROOVE_API_KEY") ?? "";

const svc = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helpers ──

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function err(msg: string, status = 400) {
  return json({ error: msg }, status);
}

function auth(req: Request): boolean {
  if (!API_KEY) return true; // no key configured = open (dev only)
  const header = req.headers.get("Authorization") ?? "";
  return header === `Bearer ${API_KEY}`;
}

function param(url: URL, key: string, fallback?: string): string | undefined {
  return url.searchParams.get(key) ?? fallback;
}

// ── Routes ──

type Handler = (url: URL, req: Request) => Promise<Response>;

const routes: Record<string, Handler> = {
  // ── Customer Overview ──
  "GET /customer/overview": async (url) => {
    const from = param(url, "from");
    const to = param(url, "to");
    if (!from || !to) return err("from and to query params required (YYYY-MM-DD)");

    const { data: rows, error } = await svc
      .from("v_daily_customer_type")
      .select("*")
      .gte("date", from)
      .lte("date", to);
    if (error) return err(error.message, 500);

    let newCust = 0, repeatCust = 0, newRev = 0, repeatRev = 0, newOrd = 0, repeatOrd = 0;
    for (const r of rows ?? []) {
      if (r.customer_type === "new") {
        newCust += r.customer_count ?? 0;
        newRev += r.revenue ?? 0;
        newOrd += r.order_count ?? 0;
      } else if (r.customer_type === "ro") {
        repeatCust += r.customer_count ?? 0;
        repeatRev += r.revenue ?? 0;
        repeatOrd += r.order_count ?? 0;
      }
    }
    const total = newCust + repeatCust;
    const totalOrd = newOrd + repeatOrd;
    const totalRev = newRev + repeatRev;

    return json({
      period: { from, to },
      total_customers: total,
      new_customers: newCust,
      repeat_customers: repeatCust,
      repeat_rate_pct: total > 0 ? Math.round((repeatCust / total) * 10000) / 100 : 0,
      total_revenue: totalRev,
      new_revenue: newRev,
      repeat_revenue: repeatRev,
      avg_order_value: totalOrd > 0 ? Math.round(totalRev / totalOrd) : 0,
      new_orders: newOrd,
      repeat_orders: repeatOrd,
    });
  },

  // ── Customer Daily Breakdown ──
  "GET /customer/daily": async (url) => {
    const from = param(url, "from");
    const to = param(url, "to");
    if (!from || !to) return err("from and to required");

    const { data, error } = await svc
      .from("v_daily_customer_type")
      .select("*")
      .gte("date", from)
      .lte("date", to)
      .order("date");
    if (error) return err(error.message, 500);
    return json(data);
  },

  // ── Customer Cohort Retention ──
  "GET /customer/cohort": async (url) => {
    const byChannel = param(url, "by_channel") === "true";

    const view = byChannel ? "v_monthly_cohort_channel" : "v_monthly_cohort";
    const { data, error } = await svc
      .from(view)
      .select("*")
      .order("cohort_month")
      .order("months_since_first");
    if (error) return err(error.message, 500);
    return json(data);
  },

  // ── Customer List ──
  "GET /customer/list": async (url) => {
    const limit = Math.min(parseInt(param(url, "limit", "100")!), 500);
    const offset = parseInt(param(url, "offset", "0")!);
    const from = param(url, "from");
    const to = param(url, "to");
    const repeatOnly = param(url, "repeat_only") === "true";

    let q = svc
      .from("v_customer_cohort")
      .select("*")
      .order("total_revenue", { ascending: false })
      .range(offset, offset + limit - 1);

    if (from) q = q.gte("first_order_date", from);
    if (to) q = q.lte("first_order_date", to);
    if (repeatOnly) q = q.eq("is_repeat", true);

    const { data, error } = await q;
    if (error) return err(error.message, 500);
    return json(data);
  },

  // ── Customer LTV ──
  "GET /customer/ltv": async (url) => {
    const brand = param(url, "brand") ?? null;
    const includeTrend = param(url, "trend") === "true";

    const { data: ltv, error: e1 } = await svc.rpc("get_channel_ltv_90d", { brand_filter: brand });
    if (e1) return err(e1.message, 500);

    let trend = null;
    if (includeTrend) {
      const { data, error } = await svc.rpc("get_ltv_trend_by_cohort", { brand_filter: brand });
      if (error) return err(error.message, 500);
      trend = data;
    }

    const { data: brands } = await svc.rpc("get_available_brands");

    return json({ ltv_by_channel: ltv, trend_by_cohort: trend, available_brands: brands });
  },

  // ── Customer CAC ──
  "GET /customer/cac": async (url) => {
    const brand = param(url, "brand") ?? null;
    const includeMonthly = param(url, "monthly") === "true";

    const { data: cac, error: e1 } = await svc.rpc("get_channel_cac");
    if (e1) return err(e1.message, 500);

    let monthly = null;
    if (includeMonthly) {
      const { data, error } = await svc.rpc("get_monthly_cac", { brand_filter: brand });
      if (error) return err(error.message, 500);
      monthly = data;
    }

    return json({ cac_by_channel: cac, monthly_cac: monthly });
  },

  // ── Brand Analysis ──
  "GET /customer/brand-analysis": async () => {
    const [matrix, journey, bundled, stats, summary] = await Promise.all([
      svc.from("mv_cross_brand_matrix").select("*"),
      svc.from("mv_brand_journey").select("*").order("transition_count", { ascending: false }).limit(20),
      svc.from("mv_bundled_orders").select("*").order("order_date", { ascending: false }).limit(50),
      svc.from("mv_multi_brand_stats").select("*"),
      svc.from("v_brand_analysis_summary").select("*"),
    ]);

    return json({
      cross_brand_matrix: matrix.data ?? [],
      brand_journey_top20: journey.data ?? [],
      recent_bundled_orders: bundled.data ?? [],
      multi_brand_stats: stats.data ?? [],
      summary: summary.data ?? [],
    });
  },

  // ── Available Brands ──
  "GET /customer/brands": async () => {
    const { data, error } = await svc.rpc("get_available_brands");
    if (error) return err(error.message, 500);
    return json(data);
  },
};

// ── Router ──

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }

  // Auth check
  if (!auth(req)) return err("Unauthorized", 401);

  const url = new URL(req.url);
  // Strip /roove-bi-api prefix from path
  const path = url.pathname.replace(/^\/roove-bi-api/, "") || "/";
  const key = `${req.method} ${path}`;

  const handler = routes[key];
  if (!handler) {
    return json({
      available_endpoints: Object.keys(routes),
      hint: "Use GET with query params. Example: /customer/overview?from=2025-01-01&to=2025-12-31",
    }, 404);
  }

  try {
    return await handler(url, req);
  } catch (e) {
    return err(`Internal error: ${(e as Error).message}`, 500);
  }
});

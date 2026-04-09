#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

// ── Load env from parent .env.local ──
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE env vars in .env.local");
  process.exit(1);
}

const svc: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helper: throw on Supabase error ──
function unwrap<T>(result: { data: T | null; error: any }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

// ════════════════════════════════════════════════════════════════
//  MCP Server
// ════════════════════════════════════════════════════════════════

const server = new McpServer({
  name: "roove-bi",
  version: "1.0.0",
});

// ────────────────────────────────────────────────────────────────
//  PPIC TOOLS
// ────────────────────────────────────────────────────────────────

server.tool(
  "ppic_stock_balance",
  "Get current stock balance for all warehouse products (qty on hand, product info, HPP, price list)",
  {},
  async () => {
    const products = unwrap(
      await svc
        .from("warehouse_products")
        .select("id, name, sku, unit, hpp, price_list, lead_time_days, safety_stock_days")
        .eq("is_active", true)
        .order("name")
    );

    const balances = unwrap(
      await svc.from("v_warehouse_stock_balance").select("*")
    );

    const balMap = new Map((balances as any[]).map((b: any) => [b.product_id, b]));

    const merged = (products as any[]).map((p: any) => ({
      ...p,
      qty_on_hand: balMap.get(p.id)?.qty_on_hand ?? 0,
    }));

    return { content: [{ type: "text" as const, text: JSON.stringify(merged, null, 2) }] };
  }
);

server.tool(
  "ppic_ito",
  "Get Inventory Turn Over data — monthly IN/OUT movements per product. Source: 'warehouse' (ledger) or 'scalev' (ScaleV orders proxy). Returns monthly movements + current stock + ITO ratio.",
  {
    months: z.number().min(1).max(24).default(6).describe("Number of months to look back"),
    source: z.enum(["warehouse", "scalev"]).default("scalev").describe("Data source"),
  },
  async ({ months, source }) => {
    let movements: any[];

    if (source === "scalev") {
      // Try summary table first (fast)
      const now = new Date();
      const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1)
        .toISOString()
        .slice(0, 7);
      const { data } = await svc
        .from("summary_scalev_monthly_movements")
        .select("product_id, yr, mn, total_out")
        .gte("yr", parseInt(cutoff.split("-")[0]))
        .order("yr")
        .order("mn");
      movements = data ?? [];

      if (movements.length === 0) {
        // Fallback to RPC
        movements = unwrap(await svc.rpc("ppic_monthly_movements_scalev", { p_months: months }));
      }
    } else {
      movements = unwrap(await svc.rpc("ppic_monthly_movements", { p_months: months }));
    }

    const balances = unwrap(await svc.from("v_warehouse_stock_balance").select("*"));
    const products = unwrap(
      await svc.from("warehouse_products").select("id, name, hpp, price_list").eq("is_active", true)
    );

    const balMap = new Map((balances as any[]).map((b: any) => [b.product_id, b.qty_on_hand]));
    const prodMap = new Map((products as any[]).map((p: any) => [p.id, p]));

    // Group movements by product
    const byProduct = new Map<number, any[]>();
    for (const m of movements as any[]) {
      const pid = m.product_id;
      if (!byProduct.has(pid)) byProduct.set(pid, []);
      byProduct.get(pid)!.push(m);
    }

    const result = Array.from(byProduct.entries()).map(([pid, rows]) => {
      const prod = prodMap.get(pid);
      const stock = balMap.get(pid) ?? 0;
      const totalOut = rows.reduce((s: number, r: any) => s + (r.total_out ?? 0), 0);
      const avgMonthlyOut = totalOut / rows.length;
      const ito = stock > 0 ? (avgMonthlyOut * 12) / stock : null;
      const daysOfStock = avgMonthlyOut > 0 ? stock / (avgMonthlyOut / 30) : null;

      return {
        product_id: pid,
        product_name: prod?.name ?? "Unknown",
        hpp: prod?.hpp,
        price_list: prod?.price_list,
        current_stock: stock,
        months_data: rows,
        avg_monthly_out: Math.round(avgMonthlyOut),
        ito_ratio: ito ? Math.round(ito * 100) / 100 : null,
        days_of_stock: daysOfStock ? Math.round(daysOfStock) : null,
        ito_status: ito === null ? "no_data" : ito >= 6 ? "green" : ito >= 3 ? "yellow" : "red",
      };
    });

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "ppic_rop",
  "Get Reorder Point analysis — avg daily demand, lead time, safety stock, ROP threshold, and current status per product",
  {
    demand_days: z.number().min(7).max(365).default(90).describe("Days of demand history to average"),
  },
  async ({ demand_days }) => {
    // Try summary table first
    const cutoff = new Date(Date.now() - demand_days * 86400000).toISOString().slice(0, 10);
    let avgDaily: any[];

    const { data: summaryData } = await svc
      .from("summary_scalev_monthly_movements")
      .select("product_id, total_out, yr, mn")
      .gte("yr", parseInt(cutoff.slice(0, 4)));

    if (summaryData && summaryData.length > 0) {
      // Calculate avg daily from monthly summary
      const byProd = new Map<number, number>();
      for (const r of summaryData) {
        byProd.set(r.product_id, (byProd.get(r.product_id) ?? 0) + r.total_out);
      }
      avgDaily = Array.from(byProd.entries()).map(([product_id, total]) => ({
        product_id,
        avg_daily: total / demand_days,
      }));
    } else {
      avgDaily = unwrap(await svc.rpc("ppic_avg_daily_demand", { p_days: demand_days }));
    }

    const balances = unwrap(await svc.from("v_warehouse_stock_balance").select("*"));
    const products = unwrap(
      await svc
        .from("warehouse_products")
        .select("id, name, lead_time_days, safety_stock_days")
        .eq("is_active", true)
    );

    const balMap = new Map((balances as any[]).map((b: any) => [b.product_id, b.qty_on_hand]));
    const demandMap = new Map((avgDaily as any[]).map((d: any) => [d.product_id, d.avg_daily]));

    const result = (products as any[]).map((p: any) => {
      const avgD = demandMap.get(p.id) ?? 0;
      const stock = balMap.get(p.id) ?? 0;
      const lead = p.lead_time_days ?? 14;
      const safetyDays = p.safety_stock_days ?? 7;
      const safetyQty = Math.round(avgD * safetyDays);
      const rop = Math.round(avgD * lead + safetyQty);
      const status =
        stock < safetyQty ? "critical" : stock < rop ? "reorder" : "ok";

      return {
        product_id: p.id,
        product_name: p.name,
        avg_daily_demand: Math.round(avgD * 100) / 100,
        lead_time_days: lead,
        safety_stock_days: safetyDays,
        safety_stock_qty: safetyQty,
        reorder_point: rop,
        current_stock: stock,
        status,
      };
    });

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "ppic_demand_plans",
  "Get demand planning data for a given month — auto demand (weighted avg), manual override, effective demand, and weekly breakdown",
  {
    month: z.number().min(1).max(12).describe("Month (1-12)"),
    year: z.number().min(2024).max(2030).describe("Year"),
  },
  async ({ month, year }) => {
    const plans = unwrap(
      await svc
        .from("warehouse_demand_plans")
        .select("*, warehouse_products(name)")
        .eq("month", month)
        .eq("year", year)
    );

    // Weekly breakdown
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    const { data: weekly } = await svc.rpc("ppic_weekly_demand_scalev", {
      p_month_start: monthStart,
      p_month_end: nextMonth,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ plans, weekly_breakdown: weekly ?? [] }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "ppic_purchase_orders",
  "Get purchase orders with items and vendor info. Filter by status or date range.",
  {
    status: z
      .enum(["draft", "submitted", "partial", "received", "cancelled"])
      .optional()
      .describe("Filter by PO status"),
    limit: z.number().min(1).max(100).default(20).describe("Max results"),
  },
  async ({ status, limit }) => {
    let q = svc
      .from("warehouse_purchase_orders")
      .select(
        "*, warehouse_vendors(name), warehouse_po_items(*, warehouse_products(name))"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) q = q.eq("status", status);

    const data = unwrap(await q);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }
);

// ────────────────────────────────────────────────────────────────
//  CUSTOMER ANALYSIS TOOLS
// ────────────────────────────────────────────────────────────────

server.tool(
  "customer_overview",
  "Get customer KPIs — total/new/repeat customers, revenue split, AOV, order counts. Requires date range.",
  {
    from: z.string().describe("Start date YYYY-MM-DD"),
    to: z.string().describe("End date YYYY-MM-DD"),
  },
  async ({ from, to }) => {
    const rows = unwrap(
      await svc
        .from("v_daily_customer_type")
        .select("*")
        .gte("date", from)
        .lte("date", to)
    ) as any[];

    let newCustomers = 0,
      repeatCustomers = 0,
      newRevenue = 0,
      repeatRevenue = 0,
      newOrders = 0,
      repeatOrders = 0;

    for (const r of rows) {
      if (r.customer_type === "new") {
        newCustomers += r.customer_count ?? 0;
        newRevenue += r.revenue ?? 0;
        newOrders += r.order_count ?? 0;
      } else if (r.customer_type === "ro") {
        repeatCustomers += r.customer_count ?? 0;
        repeatRevenue += r.revenue ?? 0;
        repeatOrders += r.order_count ?? 0;
      }
    }

    const totalCustomers = newCustomers + repeatCustomers;
    const totalOrders = newOrders + repeatOrders;
    const totalRevenue = newRevenue + repeatRevenue;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              period: { from, to },
              totalCustomers,
              newCustomers,
              repeatCustomers,
              repeatRate: totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 10000) / 100 : 0,
              totalRevenue,
              newRevenue,
              repeatRevenue,
              avgOrderValue: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
              newOrders,
              repeatOrders,
              daily_breakdown: rows,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "customer_cohort",
  "Get monthly cohort retention data — how many customers from each acquisition month are still active in subsequent months. Optionally filter by channel.",
  {
    by_channel: z.boolean().default(false).describe("Break down by acquisition channel"),
  },
  async ({ by_channel }) => {
    if (by_channel) {
      const data = unwrap(
        await svc
          .from("v_monthly_cohort_channel")
          .select("*")
          .order("cohort_month")
          .order("months_since_first")
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }

    const data = unwrap(
      await svc.from("v_monthly_cohort").select("*").order("cohort_month").order("months_since_first")
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "customer_list",
  "Get individual customer data — phone, name, channel, total orders, revenue, AOV, first/last order date, repeat status. Supports pagination and date filtering.",
  {
    limit: z.number().min(1).max(500).default(100).describe("Max results"),
    offset: z.number().min(0).default(0).describe("Offset for pagination"),
    from: z.string().optional().describe("Filter first_order_date >= YYYY-MM-DD"),
    to: z.string().optional().describe("Filter first_order_date <= YYYY-MM-DD"),
    repeat_only: z.boolean().default(false).describe("Only show repeat customers"),
  },
  async ({ limit, offset, from, to, repeat_only }) => {
    let q = svc
      .from("v_customer_cohort")
      .select("*")
      .order("total_revenue", { ascending: false })
      .range(offset, offset + limit - 1);

    if (from) q = q.gte("first_order_date", from);
    if (to) q = q.lte("first_order_date", to);
    if (repeat_only) q = q.eq("is_repeat", true);

    const data = unwrap(await q);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "customer_ltv",
  "Get Customer Lifetime Value by acquisition channel — avg first purchase, repeat value, LTV 90d, repeat rate. Optionally filter by brand.",
  {
    brand: z.string().optional().describe("Filter by brand/product_type"),
    trend: z.boolean().default(false).describe("Include monthly cohort trend breakdown"),
  },
  async ({ brand, trend }) => {
    const ltv = unwrap(
      await svc.rpc("get_channel_ltv_90d", { brand_filter: brand ?? null })
    );

    let trendData = null;
    if (trend) {
      trendData = unwrap(
        await svc.rpc("get_ltv_trend_by_cohort", { brand_filter: brand ?? null })
      );
    }

    const brands = unwrap(await svc.rpc("get_available_brands"));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { ltv_by_channel: ltv, trend_by_cohort: trendData, available_brands: brands },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "customer_cac",
  "Get Customer Acquisition Cost by channel — total ad spend, new customers, CAC. Optionally with monthly trend.",
  {
    brand: z.string().optional().describe("Filter by brand"),
    monthly: z.boolean().default(false).describe("Include monthly breakdown"),
  },
  async ({ brand, monthly }) => {
    const cac = unwrap(await svc.rpc("get_channel_cac"));

    let monthlyData = null;
    if (monthly) {
      monthlyData = unwrap(
        await svc.rpc("get_monthly_cac", { brand_filter: brand ?? null })
      );
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { cac_by_channel: cac, monthly_cac: monthlyData },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "customer_brand_analysis",
  "Get multi-brand customer analysis — cross-brand overlap, brand journeys, bundled orders, and multi-brand stats",
  {},
  async () => {
    const [crossMatrix, journey, bundled, stats, summary] = await Promise.all([
      svc.from("mv_cross_brand_matrix").select("*"),
      svc.from("mv_brand_journey").select("*").order("transition_count", { ascending: false }).limit(20),
      svc.from("mv_bundled_orders").select("*").order("order_date", { ascending: false }).limit(50),
      svc.from("mv_multi_brand_stats").select("*"),
      svc.from("v_brand_analysis_summary").select("*"),
    ]);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              cross_brand_matrix: crossMatrix.data ?? [],
              brand_journey_top20: journey.data ?? [],
              recent_bundled_orders: bundled.data ?? [],
              multi_brand_stats: stats.data ?? [],
              summary: summary.data ?? [],
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ────────────────────────────────────────────────────────────────
//  GENERAL / SEARCH
// ────────────────────────────────────────────────────────────────

server.tool(
  "search_products",
  "Search warehouse products by name or SKU",
  {
    query: z.string().describe("Search term"),
  },
  async ({ query }) => {
    const data = unwrap(
      await svc
        .from("warehouse_products")
        .select("id, name, sku, unit, hpp, price_list, lead_time_days, safety_stock_days, is_active")
        .or(`name.ilike.%${query}%,sku.ilike.%${query}%`)
        .order("name")
        .limit(50)
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Start ──
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});

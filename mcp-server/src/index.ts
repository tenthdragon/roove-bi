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

type SafeDataset = {
  table: string;
  description: string;
  defaultSelect: string;
  columns: string[];
  defaultOrder?: string;
};

const SAFE_DATASETS: Record<string, SafeDataset> = {
  daily_product: {
    table: "summary_daily_product_complete",
    description:
      "Daily brand/product performance: net sales, gross profit, marketing cost, marketplace admin cost, GP after marketing/admin.",
    defaultSelect:
      "date, product, net_sales, gross_profit, mkt_cost, mp_admin_cost, net_after_mkt",
    columns: [
      "date",
      "product",
      "net_sales",
      "gross_profit",
      "mkt_cost",
      "mp_admin_cost",
      "net_after_mkt",
      "updated_at",
    ],
    defaultOrder: "date",
  },
  daily_channel: {
    table: "summary_daily_channel_complete",
    description:
      "Daily product x channel performance with sales, COGS, gross profit, marketing/admin costs, and net_after_mkt.",
    defaultSelect:
      "date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit, mp_admin_cost, mkt_cost, net_after_mkt",
    columns: [
      "date",
      "product",
      "channel",
      "gross_sales",
      "discount",
      "net_sales",
      "cogs",
      "gross_profit",
      "mp_admin_cost",
      "mkt_cost",
      "net_after_mkt",
      "updated_at",
    ],
    defaultOrder: "date",
  },
  ads_by_brand: {
    table: "summary_daily_ads_by_brand",
    description: "Daily advertising spend grouped by brand/product.",
    defaultSelect: "date, product, total_ads_spend",
    columns: ["date", "product", "total_ads_spend", "updated_at"],
    defaultOrder: "date",
  },
  daily_ads_spend: {
    table: "daily_ads_spend",
    description:
      "Daily marketing spend rows by source, store/brand mapping key, ad account, and data source. Safe read-only marketing drilldown.",
    defaultSelect:
      "date, source, store, ad_account, spent, data_source, impressions, cpm",
    columns: [
      "date",
      "source",
      "store",
      "ad_account",
      "spent",
      "data_source",
      "impressions",
      "cpm",
      "objective",
      "advertiser",
      "business_code",
    ],
    defaultOrder: "date",
  },
  customer_type_daily: {
    table: "summary_daily_customer_type",
    description:
      "Daily customer split by new/repeat customer type and sales channel. No individual customer PII.",
    defaultSelect:
      "date, customer_type, sales_channel, order_count, customer_count, revenue, cogs",
    columns: [
      "date",
      "customer_type",
      "sales_channel",
      "order_count",
      "customer_count",
      "revenue",
      "cogs",
    ],
    defaultOrder: "date",
  },
  financial_pl: {
    table: "v_pl_summary",
    description: "Monthly profit and loss summary.",
    defaultSelect: "*",
    columns: [
      "month",
      "penjualan_bersih",
      "cogs",
      "laba_kotor",
      "beban_iklan",
      "laba_rugi",
    ],
    defaultOrder: "month",
  },
  financial_cf: {
    table: "v_cf_summary",
    description: "Monthly cash flow summary.",
    defaultSelect: "*",
    columns: ["month", "net_cashflow", "cash_in", "cash_out"],
    defaultOrder: "month",
  },
  financial_ratios: {
    table: "financial_ratios_monthly",
    description: "Monthly financial ratios with benchmark metadata.",
    defaultSelect:
      "month, ratio_name, ratio_label, category, value, benchmark_min, benchmark_max, benchmark_label",
    columns: [
      "month",
      "ratio_name",
      "ratio_label",
      "category",
      "value",
      "benchmark_min",
      "benchmark_max",
      "benchmark_label",
    ],
    defaultOrder: "month",
  },
  warehouse_stock: {
    table: "v_warehouse_stock_balance",
    description: "Current warehouse stock balance by product.",
    defaultSelect: "*",
    columns: ["product_id", "qty_on_hand"],
  },
  warehouse_products: {
    table: "warehouse_products",
    description:
      "Warehouse product master data: SKU, unit, HPP, price list, lead time, safety stock.",
    defaultSelect:
      "id, name, sku, unit, hpp, price_list, lead_time_days, safety_stock_days, is_active",
    columns: [
      "id",
      "name",
      "sku",
      "unit",
      "hpp",
      "price_list",
      "lead_time_days",
      "safety_stock_days",
      "is_active",
    ],
    defaultOrder: "name",
  },
};

const FILTER_VALUE = z.union([z.string(), z.number(), z.boolean()]);

function sumNumber(rows: any[], key: string): number {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function assertSafeColumn(dataset: SafeDataset, column: string): void {
  if (!dataset.columns.includes(column)) {
    throw new Error(
      `Column "${column}" is not allowed for ${dataset.table}. Allowed columns: ${dataset.columns.join(", ")}`
    );
  }
}

function buildSelect(dataset: SafeDataset, requested?: string): string {
  if (!requested || requested.trim() === "") return dataset.defaultSelect;
  if (requested.trim() === "*") return "*";

  const columns = requested.split(",").map((c) => c.trim()).filter(Boolean);
  for (const column of columns) assertSafeColumn(dataset, column);
  return columns.join(", ");
}

// ────────────────────────────────────────────────────────────────
//  LLM WORKFLOW / GENERAL BUSINESS TOOLS
// ────────────────────────────────────────────────────────────────

server.tool(
  "roove_mcp_guide",
  "Explain the Roove BI MCP capabilities, safe datasets, and suggested workflows for Claude/Codex conversations.",
  {},
  async () => {
    const guide = {
      business_context:
        "Roove BI is an Indonesian D2C/FMCG analytics app covering marketplace/Scalev sales, ads, customer cohorts, finance, warehouse, PPIC, and cashflow.",
      recommended_first_steps: [
        "Use business_snapshot for an executive read of a date range.",
        "Use roove_dataset_catalog to discover safe read-only datasets.",
        "Use roove_read_dataset for focused drilldowns instead of guessing table names.",
        "Use PPIC/customer tools for deeper operational or retention questions.",
      ],
      tool_groups: {
        general: [
          "roove_mcp_guide",
          "roove_dataset_catalog",
          "roove_read_dataset",
          "business_snapshot",
          "marketing_spend_summary",
          "meta_ads_spend_by_account",
          "search_products",
        ],
        ppic: [
          "ppic_stock_balance",
          "ppic_ito",
          "ppic_rop",
          "ppic_demand_plans",
          "ppic_purchase_orders",
        ],
        customer: [
          "customer_overview",
          "customer_cohort",
          "customer_list",
          "customer_ltv",
          "customer_cac",
          "customer_brand_analysis",
        ],
      },
      safety:
        "Generic dataset reads are allowlisted and read-only. They avoid individual customer PII and do not expose write operations.",
    };

    return { content: [{ type: "text" as const, text: JSON.stringify(guide, null, 2) }] };
  }
);

server.tool(
  "roove_dataset_catalog",
  "List safe read-only datasets available for flexible business analysis, including allowed columns and default selects.",
  {},
  async () => {
    const catalog = Object.entries(SAFE_DATASETS).map(([key, dataset]) => ({
      dataset: key,
      table: dataset.table,
      description: dataset.description,
      default_select: dataset.defaultSelect,
      allowed_columns: dataset.columns,
      default_order: dataset.defaultOrder ?? null,
    }));

    return { content: [{ type: "text" as const, text: JSON.stringify(catalog, null, 2) }] };
  }
);

server.tool(
  "roove_read_dataset",
  "Read rows from a safe allowlisted dataset with simple filters. Use for ad-hoc drilldowns during LLM discussions. Read-only.",
  {
    dataset: z
      .enum(Object.keys(SAFE_DATASETS) as [string, ...string[]])
      .describe("Dataset key from roove_dataset_catalog"),
    select: z
      .string()
      .optional()
      .describe("Comma-separated allowed columns. Omit for dataset default. Use '*' only when the dataset is already a safe view."),
    filters: z
      .array(
        z.object({
          column: z.string().describe("Allowed column name"),
          op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "ilike"]).describe("Filter operator"),
          value: FILTER_VALUE.describe("Filter value"),
        })
      )
      .default([])
      .describe("Simple AND filters"),
    order_by: z.string().optional().describe("Allowed column to order by"),
    ascending: z.boolean().default(false).describe("Sort ascending"),
    limit: z.number().min(1).max(200).default(50).describe("Maximum rows"),
  },
  async ({ dataset: datasetKey, select, filters, order_by, ascending, limit }) => {
    const dataset = SAFE_DATASETS[datasetKey];
    const selectedColumns = buildSelect(dataset, select);

    let q: any = svc.from(dataset.table).select(selectedColumns).limit(limit);

    for (const filter of filters) {
      assertSafeColumn(dataset, filter.column);
      if (filter.op === "ilike") {
        q = q.ilike(filter.column, `%${String(filter.value)}%`);
      } else {
        q = q[filter.op](filter.column, filter.value);
      }
    }

    const orderColumn = order_by ?? dataset.defaultOrder;
    if (orderColumn) {
      assertSafeColumn(dataset, orderColumn);
      q = q.order(orderColumn, { ascending });
    }

    const data = unwrap(await q);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { dataset: datasetKey, table: dataset.table, rows: data },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "business_snapshot",
  "Get a compact executive snapshot for a date range: sales, gross profit, marketing spend, channel/brand mix, customer split, and latest finance rows.",
  {
    from: z.string().describe("Start date YYYY-MM-DD"),
    to: z.string().describe("End date YYYY-MM-DD"),
    top: z.number().min(3).max(20).default(8).describe("Number of top brands/channels to include"),
  },
  async ({ from, to, top }) => {
    const [dailyProduct, dailyChannel, customerType, pl, cf, ratios] = await Promise.all([
      svc
        .from("summary_daily_product_complete")
        .select("date, product, net_sales, gross_profit, mkt_cost, mp_admin_cost, net_after_mkt")
        .gte("date", from)
        .lte("date", to)
        .limit(10000),
      svc
        .from("summary_daily_channel_complete")
        .select("date, product, channel, net_sales, gross_profit, mkt_cost, mp_admin_cost, net_after_mkt")
        .gte("date", from)
        .lte("date", to)
        .limit(10000),
      svc
        .from("summary_daily_customer_type")
        .select("date, customer_type, sales_channel, order_count, customer_count, revenue")
        .gte("date", from)
        .lte("date", to)
        .limit(10000),
      svc.from("v_pl_summary").select("*").order("month", { ascending: false }).limit(6),
      svc.from("v_cf_summary").select("*").order("month", { ascending: false }).limit(6),
      svc
        .from("financial_ratios_monthly")
        .select("month, ratio_name, ratio_label, category, value, benchmark_label")
        .order("month", { ascending: false })
        .limit(72),
    ]);

    const productRows = unwrap(dailyProduct) as any[];
    const channelRows = unwrap(dailyChannel) as any[];
    const customerRows = unwrap(customerType) as any[];

    const byProduct = new Map<string, any>();
    for (const row of productRows) {
      const key = row.product ?? "Unknown";
      const bucket = byProduct.get(key) ?? {
        product: key,
        net_sales: 0,
        gross_profit: 0,
        mkt_cost: 0,
        mp_admin_cost: 0,
        net_after_mkt: 0,
      };
      bucket.net_sales += Number(row.net_sales ?? 0);
      bucket.gross_profit += Number(row.gross_profit ?? 0);
      bucket.mkt_cost += Number(row.mkt_cost ?? 0);
      bucket.mp_admin_cost += Number(row.mp_admin_cost ?? 0);
      bucket.net_after_mkt += Number(row.net_after_mkt ?? 0);
      byProduct.set(key, bucket);
    }

    const byChannel = new Map<string, any>();
    for (const row of channelRows) {
      const key = row.channel ?? "Unknown";
      const bucket = byChannel.get(key) ?? {
        channel: key,
        net_sales: 0,
        gross_profit: 0,
        mkt_cost: 0,
        mp_admin_cost: 0,
        net_after_mkt: 0,
      };
      bucket.net_sales += Number(row.net_sales ?? 0);
      bucket.gross_profit += Number(row.gross_profit ?? 0);
      bucket.mkt_cost += Number(row.mkt_cost ?? 0);
      bucket.mp_admin_cost += Number(row.mp_admin_cost ?? 0);
      bucket.net_after_mkt += Number(row.net_after_mkt ?? 0);
      byChannel.set(key, bucket);
    }

    const customerSplit = new Map<string, any>();
    for (const row of customerRows) {
      const key = row.customer_type ?? "unknown";
      const bucket = customerSplit.get(key) ?? {
        customer_type: key,
        order_count: 0,
        customer_count: 0,
        revenue: 0,
      };
      bucket.order_count += Number(row.order_count ?? 0);
      bucket.customer_count += Number(row.customer_count ?? 0);
      bucket.revenue += Number(row.revenue ?? 0);
      customerSplit.set(key, bucket);
    }

    const netSales = sumNumber(productRows, "net_sales");
    const grossProfit = sumNumber(productRows, "gross_profit");
    const mktCost = sumNumber(productRows, "mkt_cost");
    const mpAdminCost = sumNumber(productRows, "mp_admin_cost");
    const netAfterMkt = sumNumber(productRows, "net_after_mkt");

    const result = {
      period: { from, to },
      totals: {
        net_sales: round(netSales),
        gross_profit: round(grossProfit),
        gross_profit_margin_pct: netSales > 0 ? round((grossProfit / netSales) * 100) : null,
        marketing_cost: round(mktCost),
        marketplace_admin_cost: round(mpAdminCost),
        net_after_mkt: round(netAfterMkt),
        net_after_mkt_margin_pct: netSales > 0 ? round((netAfterMkt / netSales) * 100) : null,
      },
      top_products: Array.from(byProduct.values())
        .sort((a, b) => b.net_sales - a.net_sales)
        .slice(0, top),
      top_channels: Array.from(byChannel.values())
        .sort((a, b) => b.net_sales - a.net_sales)
        .slice(0, top),
      customer_split: Array.from(customerSplit.values()).sort(
        (a, b) => b.revenue - a.revenue
      ),
      latest_finance: {
        pl: pl.data ?? [],
        cashflow: cf.data ?? [],
        ratios: ratios.data ?? [],
      },
      warnings: [
        "Shipment-based sales can be lumpy because warehouse operations may batch shipments after weekends/holidays.",
        "Marketplace CR can look artificially high when marketplace orders are manually entered after fulfillment.",
      ],
    };

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "marketing_spend_summary",
  "Get marketing spend totals for a date range, grouped by source, store, and data_source. Use this for total marketing cost and marketing channel cost breakdown.",
  {
    from: z.string().describe("Start date YYYY-MM-DD"),
    to: z.string().describe("End date YYYY-MM-DD"),
    source: z.string().optional().describe("Optional source filter, e.g. Facebook Ads, TikTok Ads, Shopee"),
    store: z.string().optional().describe("Optional store/brand mapping key filter"),
  },
  async ({ from, to, source, store }) => {
    let q = svc
      .from("daily_ads_spend")
      .select("date, source, store, ad_account, spent, data_source, impressions, cpm")
      .gte("date", from)
      .lte("date", to)
      .limit(20000);

    if (source) q = q.ilike("source", `%${source}%`);
    if (store) q = q.ilike("store", `%${store}%`);

    const rows = unwrap(await q) as any[];

    function groupedBy(key: "source" | "store" | "data_source") {
      const buckets = new Map<string, any>();
      for (const row of rows) {
        const group = row[key] || "Unknown";
        const bucket = buckets.get(group) ?? {
          [key]: group,
          spent: 0,
          impressions: 0,
          rows: 0,
        };
        bucket.spent += Math.abs(Number(row.spent ?? 0));
        bucket.impressions += Number(row.impressions ?? 0);
        bucket.rows += 1;
        buckets.set(group, bucket);
      }

      return Array.from(buckets.values())
        .map((bucket) => ({
          ...bucket,
          avg_cpm: bucket.impressions > 0 ? round((bucket.spent / bucket.impressions) * 1000) : null,
        }))
        .sort((a, b) => b.spent - a.spent);
    }

    const totalSpent = rows.reduce(
      (total, row) => total + Math.abs(Number(row.spent ?? 0)),
      0
    );
    const totalImpressions = sumNumber(rows, "impressions");

    const result = {
      period: { from, to },
      filters: { source: source ?? null, store: store ?? null },
      totals: {
        spent: round(totalSpent),
        impressions: totalImpressions,
        avg_cpm: totalImpressions > 0 ? round((totalSpent / totalImpressions) * 1000) : null,
        rows: rows.length,
      },
      by_source: groupedBy("source"),
      by_store: groupedBy("store"),
      by_data_source: groupedBy("data_source"),
    };

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "meta_ads_spend_by_account",
  "Get Meta Ads spend breakdown by ad account for a date range. Includes spend, impressions, CPM, mapped store, and configured account metadata when available.",
  {
    from: z.string().describe("Start date YYYY-MM-DD"),
    to: z.string().describe("End date YYYY-MM-DD"),
    include_daily: z.boolean().default(false).describe("Include daily rows per ad account"),
  },
  async ({ from, to, include_daily }) => {
    const [spendRes, accountRes] = await Promise.all([
      svc
        .from("daily_ads_spend")
        .select("date, source, store, ad_account, spent, data_source, impressions, cpm")
        .gte("date", from)
        .lte("date", to)
        .eq("data_source", "meta_api")
        .limit(20000),
      svc
        .from("meta_ad_accounts")
        .select("account_id, account_name, store, default_source, default_advertiser, is_active"),
    ]);

    const spendRows = unwrap(spendRes) as any[];
    const accounts = (accountRes.data ?? []) as any[];
    const accountMap = new Map(accounts.map((account) => [account.account_name, account]));
    const byAccount = new Map<string, any>();

    for (const row of spendRows) {
      const accountName = row.ad_account || "Unknown";
      const account = accountMap.get(accountName);
      const bucket = byAccount.get(accountName) ?? {
        ad_account: accountName,
        account_id: account?.account_id ?? null,
        configured_store: account?.store ?? null,
        observed_stores: new Set<string>(),
        default_source: account?.default_source ?? null,
        is_active: account?.is_active ?? null,
        spent: 0,
        impressions: 0,
        rows: 0,
        daily: new Map<string, any>(),
      };

      if (row.store) bucket.observed_stores.add(row.store);
      bucket.spent += Math.abs(Number(row.spent ?? 0));
      bucket.impressions += Number(row.impressions ?? 0);
      bucket.rows += 1;

      if (include_daily) {
        const day = row.date;
        const daily = bucket.daily.get(day) ?? {
          date: day,
          spent: 0,
          impressions: 0,
        };
        daily.spent += Math.abs(Number(row.spent ?? 0));
        daily.impressions += Number(row.impressions ?? 0);
        bucket.daily.set(day, daily);
      }

      byAccount.set(accountName, bucket);
    }

    const accountsBreakdown = Array.from(byAccount.values())
      .map((bucket) => ({
        ad_account: bucket.ad_account,
        account_id: bucket.account_id,
        configured_store: bucket.configured_store,
        observed_stores: Array.from(bucket.observed_stores),
        default_source: bucket.default_source,
        is_active: bucket.is_active,
        spent: round(bucket.spent),
        impressions: bucket.impressions,
        avg_cpm: bucket.impressions > 0 ? round((bucket.spent / bucket.impressions) * 1000) : null,
        rows: bucket.rows,
        daily: include_daily
          ? Array.from(bucket.daily.values()).sort((a: any, b: any) =>
              a.date.localeCompare(b.date)
            )
          : undefined,
      }))
      .sort((a, b) => b.spent - a.spent);

    const totalSpent = accountsBreakdown.reduce((total, row) => total + row.spent, 0);
    const totalImpressions = accountsBreakdown.reduce(
      (total, row) => total + Number(row.impressions ?? 0),
      0
    );

    const result = {
      period: { from, to },
      totals: {
        spent: round(totalSpent),
        impressions: totalImpressions,
        avg_cpm: totalImpressions > 0 ? round((totalSpent / totalImpressions) * 1000) : null,
        accounts: accountsBreakdown.length,
      },
      accounts: accountsBreakdown,
      note:
        "Rows are filtered to daily_ads_spend.data_source = meta_api, which is the app's Meta Marketing API ingestion path.",
    };

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

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

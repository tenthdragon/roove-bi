# App Logic Review Master Checklist

Dokumen ini adalah source of truth untuk mereview seluruh logika halaman di app `roove-bi`.

Jika sesi/chat baru perlu dibuat, gunakan dokumen ini sebagai basis kelanjutan kerja. Prompt handoff yang disarankan:

`Lanjutkan review logic app berdasarkan APP_LOGIC_REVIEW_MASTER_CHECKLIST.md. Mulai dari item yang masih NS/IP, update statusnya, lalu temukan bug/risk/regression dengan bukti file yang spesifik.`

## 1. Tujuan Review

Review dinyatakan selesai hanya jika semua hal berikut terpenuhi:

- Semua route public dan dashboard sudah dipetakan.
- Semua page file sudah dibaca bersama dependency logic utamanya.
- Semua mutation path sudah ditelusuri sampai action/API route/DB contract.
- Semua gate akses sudah diverifikasi di UI layer dan server layer.
- Semua kalkulasi turunan, filter, agregasi, cache, dan refresh flow sudah diperiksa.
- Semua empty state, loading state, error state, dan race condition utama sudah diperiksa.
- Semua integrasi eksternal yang mempengaruhi halaman sudah diperiksa.
- Semua temuan dicatat dengan file, dampak, dan asumsi yang jelas.

## 2. Snapshot Arsitektur

- Framework: Next.js App Router (`next@14`).
- Auth: Supabase SSR + client auth.
- Routing guard: `middleware.ts`.
- Dashboard shell dan access gating utama: `app/dashboard/layout.tsx`.
- Shared state utama:
  - `lib/PermissionsContext.tsx`
  - `lib/DateRangeContext.tsx`
  - `lib/ActiveBrandsContext.tsx`
  - `lib/dashboard-cache.ts`
- Access check server-side untuk API:
  - `lib/dashboard-access.ts`
- Data layer dominan:
  - Supabase tables/views/RPC
  - External integrations: Scalev, Google Sheets, Meta Ads, WhatsApp, bank CSV, Telegram, Anthropic

## 3. Aturan Review Wajib Untuk Setiap Halaman

Gunakan checklist ini untuk setiap halaman sebelum dinyatakan "covered":

1. Validasi route entry, redirect, dan siapa yang boleh mengakses.
2. Identifikasi semua source data: context, Supabase query langsung, lib action, API route, external service.
3. Telusuri lifecycle load:
   - initial load
   - refresh manual
   - perubahan filter/date range/search
   - route change
   - reload browser
4. Audit semua derived logic:
   - mapping
   - grouping
   - sorting
   - aggregation
   - previous-period comparison
   - brand/channel filtering
   - status classification
   - percentage/rate math
5. Audit semua mutation flow:
   - create
   - update
   - delete
   - toggle active/inactive
   - sync
   - refresh materialized data
   - upload/import
6. Pastikan state UI aman:
   - loading
   - empty
   - partial failure
   - retry
   - duplicate submit
   - stale state setelah mutation
7. Pastikan permission dicek konsisten:
   - hidden tab di UI
   - direct URL access
   - API route guard
   - owner-only vs role_permissions
8. Pastikan cache/refresh konsisten:
   - `dashboard-cache`
   - invalidation setelah sync/upload/mutation
   - dependency array `useEffect`
   - stale closure
9. Pastikan tanggal/waktu aman:
   - WIB/Jakarta vs browser local time
   - current month fallback
   - previous month calculation
   - string date vs ISO timestamp
10. Pastikan DB contract jelas:
   - table/view/RPC yang dipakai
   - field penting
   - nullability
   - uniqueness/idempotency
11. Pastikan security dan safety:
   - service-role usage
   - auth header / cron secret
   - webhook verification
   - destructive action confirmation
12. Siapkan minimal manual test matrix:
   - happy path
   - unauthorized path
   - no data
   - malformed data
   - duplicate/retry path

## 4. Urutan Review Yang Disarankan

Urutan ini dipilih berdasarkan impact arsitektural dan ukuran file:

1. Shared shell, auth, permission, cache, dan context.
2. Halaman operasional paling berat:
   - `app/dashboard/warehouse/page.tsx` (~2257 lines)
   - `app/dashboard/ppic/page.tsx` (~1508 lines)
   - `app/dashboard/admin/page.tsx` (~1439 lines)
   - `app/dashboard/waba-management/page.tsx` (~1306 lines)
3. Halaman analitik besar:
   - `app/dashboard/customers/page.tsx` (~1119 lines)
   - `app/dashboard/marketing/page.tsx` (~1014 lines)
   - `app/dashboard/finance/page.tsx` (~947 lines)
   - `app/dashboard/channels/page.tsx` (~897 lines)
   - `app/dashboard/pulse/page.tsx` (~897 lines)
4. Halaman setup domain:
   - `app/dashboard/warehouse-settings/page.tsx` (~779 lines)
   - `app/dashboard/business-settings/page.tsx` (~562 lines)
   - `app/dashboard/page.tsx` (~550 lines)
   - `app/dashboard/brand-analysis/page.tsx` (~392 lines)
5. Wrapper/redirect pages dan public pages.
6. Semua API route pendukung.
7. DB/RPC/migration verification untuk area yang masih ambigu.

## 5. Scope Inventaris

### 5.1 Public/Auth Routes

- `app/page.tsx` - login
- `app/register/page.tsx` - register internal domain
- `app/forgot-password/page.tsx` - request reset
- `app/reset-password/page.tsx` - password recovery flow
- `app/privacy/page.tsx` - static policy page

### 5.2 Dashboard Shell dan Shared Logic

- `app/layout.tsx`
- `app/dashboard/layout.tsx`
- `middleware.ts`
- `lib/utils.ts`
- `lib/PermissionsContext.tsx`
- `lib/DateRangeContext.tsx`
- `lib/ActiveBrandsContext.tsx`
- `lib/dashboard-cache.ts`
- `lib/dashboard-access.ts`
- `lib/supabase-browser.ts`
- `lib/supabase-server.ts`
- `components/ThemeProvider.tsx`
- `components/ThemeToggle.tsx`
- `components/DateRangePicker.tsx`

### 5.3 Dashboard Pages Dalam Navigasi

- Overview:
  - `app/dashboard/page.tsx`
  - `lib/overview-actions.ts`
  - `components/CashFlowSection.tsx`
  - `lib/cashflow-actions.ts`
- Marketing:
  - `app/dashboard/marketing/page.tsx`
  - `lib/marketing-actions.ts`
- Sales Channel:
  - `app/dashboard/channels/page.tsx`
  - `lib/channels-actions.ts`
  - `components/ChannelSlaSection.tsx`
  - `lib/sla-actions.ts`
  - `components/ShipmentStatusSection.tsx`
  - `lib/shipment-actions.ts`
- WABA Management:
  - `app/dashboard/waba-management/page.tsx`
  - API routes WABA/Meta terkait
- Financial Report group:
  - `app/dashboard/financial-report/page.tsx` - redirect shell
  - `app/dashboard/cashflow/page.tsx`
  - `components/BankCashFlowDashboard.tsx`
  - `app/dashboard/financial-settings/page.tsx`
  - `components/FinancialSettingsPage.tsx`
- PPIC:
  - `app/dashboard/ppic/page.tsx`
  - `lib/ppic-actions.ts`
  - `lib/warehouse-ledger-actions.ts`
- Warehouse:
  - `app/dashboard/warehouse/page.tsx`
  - `lib/warehouse-actions.ts`
  - `lib/warehouse-ledger-actions.ts`
- Warehouse Settings:
  - `app/dashboard/warehouse-settings/page.tsx`
  - `components/BrandManager.tsx`
  - `lib/brand-actions.ts`
  - `lib/warehouse-ledger-actions.ts`
- Business Pulse:
  - `app/dashboard/pulse/page.tsx`
  - `lib/scalev-actions.ts`
  - `lib/warehouse-ledger-actions.ts`
- Customer Analysis:
  - `app/dashboard/customers/page.tsx`
  - `lib/scalev-actions.ts`
- Brand Analysis:
  - `app/dashboard/brand-analysis/page.tsx`
  - `lib/scalev-actions.ts`
- Finance Analysis:
  - `app/dashboard/finance/page.tsx`
  - `lib/financial-actions.ts`
  - `app/api/financial-analysis/route.ts`
- Business Settings:
  - `app/dashboard/business-settings/page.tsx`
  - `lib/webhook-actions.ts`
  - `lib/warehouse-ledger-actions.ts`
- Admin:
  - `app/dashboard/admin/page.tsx`
  - `components/SheetManager.tsx`
  - `components/ConnectionManager.tsx`
  - `components/SyncManager.tsx`
  - `components/FinancialSheetManager.tsx`
  - `components/CsvOrderUploader.tsx`
  - `components/MetaManager.tsx`
  - `components/WarehouseSheetManager.tsx`
  - `lib/actions.ts`
  - `lib/sheet-actions.ts`
  - `lib/warehouse-actions.ts`
  - `lib/financial-actions.ts`
  - `lib/scalev-actions.ts`
  - `lib/webhook-actions.ts`

### 5.4 Route Yang Tidak Muncul Di Nav Tapi Tetap Harus Direview

- `app/dashboard/products/page.tsx`
  - Route legacy/hidden, tetap perlu dicek karena masih hidup di codebase.

### 5.5 API Routes Yang Mempengaruhi Logic Halaman/Data

- Admin / upload / sync:
  - `app/api/sync/route.ts`
  - `app/api/csv-upload/route.ts`
  - `app/api/xlsx-ads-upload/route.ts`
  - `app/api/meta-sync/route.ts`
  - `app/api/meta-accounts/route.ts`
  - `app/api/scalev-sync/route.ts`
  - `app/api/invite/route.ts`
- Scalev inbound:
  - `app/api/scalev-webhook/route.ts`
- Cashflow / financial settings:
  - `app/api/bank-accounts/route.ts`
  - `app/api/bank-cashflow/route.ts`
  - `app/api/bank-csv-upload/route.ts`
  - `app/api/bank-transactions/route.ts`
  - `app/api/cashflow-snapshot/route.ts`
- Financial analysis / sync:
  - `app/api/financial-analysis/route.ts`
  - `app/api/financial-sync/route.ts`
- Warehouse:
  - `app/api/warehouse-sync/route.ts`
- WABA / WhatsApp:
  - `app/api/waba-templates/route.ts`
  - `app/api/waba-template-sync/route.ts`
  - `app/api/waba-template-analytics/route.ts`
  - `app/api/whatsapp-sync/route.ts`
- Summary refresh:
  - `app/api/refresh-single-view/route.ts`
  - `app/api/refresh-views/route.ts`
- Reporting / automation side effects:
  - `app/api/telegram-report/route.ts`
  - `app/api/telegram-webhook/route.ts`

## 6. Review Task Breakdown Per Area

### A. Shared Shell, Auth, Permission, Cache

Files:

- `app/layout.tsx`
- `app/dashboard/layout.tsx`
- `middleware.ts`
- `lib/utils.ts`
- `lib/PermissionsContext.tsx`
- `lib/DateRangeContext.tsx`
- `lib/ActiveBrandsContext.tsx`
- `lib/dashboard-cache.ts`
- `lib/dashboard-access.ts`
- `lib/supabase-browser.ts`
- `lib/supabase-server.ts`

Tasks:

- Review redirect matrix: unauthenticated, authenticated root, pending user, owner, non-owner.
- Review how `ALL_TABS`, `canAccessTab`, `role_permissions`, dan child tab berinteraksi.
- Review `DashboardLayout` race conditions:
  - profile load
  - permissions load
  - redirect ke first accessible tab
  - mobile/desktop nav sync
- Review `RefreshViewsButton`:
  - parallel sync ke `/api/sync` dan `/api/meta-sync`
  - success/error/skipped semantics
  - window reload timing
- Review `DateRangeContext`:
  - source of earliest/latest
  - fallback current month vs latest available month
  - timezone/date boundary
- Review `ActiveBrandsContext`:
  - behavior sebelum brands loaded
  - filtering consistency antar halaman
- Review `dashboard-cache`:
  - key design
  - invalidation discipline
  - stale data risk
- Review server-side access helpers di `dashboard-access.ts` vs UI-level permission hiding.

### B. Public/Auth Pages

Files:

- `app/page.tsx`
- `app/register/page.tsx`
- `app/forgot-password/page.tsx`
- `app/reset-password/page.tsx`
- `middleware.ts`

Tasks:

- Review sign-in, sign-up, reset-password, dan session exchange flow end-to-end.
- Validasi domain restriction register (`@roove.co.id`) dan potensi bypass.
- Validasi pending-user UX dan role activation dependency terhadap `profiles`.
- Review password recovery edge cases:
  - expired token
  - page reload
  - auth state listener timing
  - redirect after success
- Pastikan middleware tidak mengganggu forgot/reset/register route.

### C. Overview

Files:

- `app/dashboard/page.tsx`
- `lib/overview-actions.ts`
- `components/CashFlowSection.tsx`
- `lib/cashflow-actions.ts`

Tasks:

- Review date-range handling dan previous-range derivation.
- Review KPI math, overhead per-day allocation, shipment per-day lookup, ads fee, marketplace fee, margin logic.
- Review active brand filtering consistency antara raw rows dan derived aggregates.
- Review cache key design untuk current range vs previous range.
- Review profile/role loading yang dilakukan terpisah dari data loading.
- Review empty/error handling dan kemungkinan stale cache setelah upload/sync.

### D. Marketing

Files:

- `app/dashboard/marketing/page.tsx`
- `lib/marketing-actions.ts`

Tasks:

- Review semua query yang menggabungkan sales, ads spend, dan channel cost.
- Review brand filter, date filter, grouping, dan per-channel/per-brand attribution.
- Review formula ROAS, margin, blended spend, dan semua denominator nol/null.
- Review permission check di action layer bila ada query sensitif.
- Cocokkan logic marketing dengan data source Meta/WA/XLSX upload.

### E. Sales Channel

Files:

- `app/dashboard/channels/page.tsx`
- `lib/channels-actions.ts`
- `components/ChannelSlaSection.tsx`
- `lib/sla-actions.ts`
- `components/ShipmentStatusSection.tsx`
- `lib/shipment-actions.ts`

Tasks:

- Review agregasi channel-level sales, ads, dan shipment counts.
- Review dependency ke RPC:
  - `get_daily_shipment_counts`
  - `get_channel_sla`
  - `get_shipment_status`
- Review channel color mapping dan unknown-channel behavior.
- Review SLA/status classification logic dan date-range consistency.
- Pastikan widget bawahan memakai range dan brand scope yang sama dengan halaman utama.

### F. WABA Management

Files:

- `app/dashboard/waba-management/page.tsx`
- `app/api/waba-templates/route.ts`
- `app/api/waba-template-sync/route.ts`
- `app/api/waba-template-analytics/route.ts`
- `app/api/whatsapp-sync/route.ts`
- `lib/meta-whatsapp.ts`
- `lib/meta-marketing.ts`

Tasks:

- Review template listing, sync, create, delete, analytics fetch, dan status refresh.
- Review auth/role gate owner-finance-sales_manager pada template management.
- Review how WABA spend masuk ke `daily_ads_spend` dan mempengaruhi dashboard lain.
- Review data joins antara templates, analytics harian, dan selected date range.
- Review long-running sync behavior, partial success, log tables, dan retry safety.
- Review active WABA account assumptions dan failure mode jika env/token/config tidak lengkap.

### G. Financial Report Redirect + Cashflow + Financial Settings

Files:

- `app/dashboard/financial-report/page.tsx`
- `app/dashboard/cashflow/page.tsx`
- `components/BankCashFlowDashboard.tsx`
- `app/dashboard/financial-settings/page.tsx`
- `components/FinancialSettingsPage.tsx`
- `app/api/bank-accounts/route.ts`
- `app/api/bank-cashflow/route.ts`
- `app/api/bank-csv-upload/route.ts`
- `app/api/bank-transactions/route.ts`
- `app/api/cashflow-snapshot/route.ts`
- `lib/transaction-tagger.ts`

Tasks:

- Review redirect precedence `financial-report -> cashflow -> financial-settings -> dashboard`.
- Review bank account CRUD, access control, and duplicate constraints.
- Review bank CSV parser per bank format:
  - normalization
  - parsing quoted CSV
  - session dedupe/replacement
  - transaction batch insert
- Review cashflow dashboard filters:
  - period
  - bank
  - type
  - tag
  - account
  - business
  - pagination
- Review transaction tagging:
  - auto classifier
  - manual override
  - retag-all logic
  - audit fields
- Review snapshot generation:
  - manual vs cron
  - period selection
  - RPC side effects
  - idempotency

### H. PPIC

Files:

- `app/dashboard/ppic/page.tsx`
- `lib/ppic-actions.ts`
- `lib/warehouse-ledger-actions.ts`
- `lib/actions.ts`

Tasks:

- Review purchase order lifecycle:
  - create
  - submit
  - cancel
  - receive
  - landed cost updates
- Review demand planning, weekly demand, monthly demand, ITO, ROP, and vendor logic.
- Review stock dependency to warehouse balance dan apakah semua angka sinkron dengan warehouse module.
- Review RPC usage:
  - `ppic_weekly_demand_scalev`
  - `ppic_monthly_demand`
  - `ppic_monthly_movements`
  - `ppic_avg_daily_demand`
- Review mutation concurrency saat receiving PO dan pembentukan batch stock.
- Review owner/role assumptions untuk aksi kritis.

### I. Warehouse

Files:

- `app/dashboard/warehouse/page.tsx`
- `lib/warehouse-actions.ts`
- `lib/warehouse-ledger-actions.ts`
- `lib/ppic-actions.ts`
- `lib/actions.ts`

Tasks:

- Review semua sub-tab:
  - daily summary
  - saldo stock
  - WIP
  - batch and expiry
  - stock opname
  - movement log
- Review ledger mutations:
  - stock in
  - stock out
  - dispose
  - transfer
  - conversion
  - batch creation
- Review stock deduction logic dari order Scalev:
  - FIFO deduction
  - reverse order
  - backfill order
  - undeducted alerts
- Review stock opname lifecycle:
  - create session
  - count
  - submit
  - revert
  - approve
  - cancel
- Review dependency ke tables/views/RPC:
  - `v_warehouse_stock_balance`
  - `v_warehouse_batch_stock`
  - `warehouse_deduct_fifo`
  - `warehouse_find_product_for_deduction`
  - `warehouse_find_product_by_scalev_name`
  - `warehouse_reverse_order`
- Review user permission keys:
  - `wh:*`
  - approval permissions
  - opname manage/approve
- Review date-specific daily summary, deduction log, and alert freshness.

### J. Warehouse Settings

Files:

- `app/dashboard/warehouse-settings/page.tsx`
- `components/BrandManager.tsx`
- `lib/brand-actions.ts`
- `lib/warehouse-ledger-actions.ts`

Tasks:

- Review semua sub-tab:
  - master produk
  - brand
  - vendor
  - active warehouse
  - mapping
- Review CRUD produk, vendor, brand, active/inactive, dan mapping ke Scalev.
- Review permission keys:
  - `whs:brands`
  - `whs:vendors`
  - `whs:products`
  - `whs:warehouses`
  - `whs:mapping`
- Review dampak deactivation pada halaman warehouse/ppic lainnya.
- Review sync nama produk Scalev dan mapping frequencies/price tiers.

### K. Business Pulse

Files:

- `app/dashboard/pulse/page.tsx`
- `lib/scalev-actions.ts`
- `lib/warehouse-ledger-actions.ts`

Tasks:

- Review KPI bisnis gabungan lintas sales, CAC, LTV, stock.
- Review query langsung ke Supabase dan action helper agar tidak ada mismatch sumber data.
- Review brand/date filtering terhadap CAC/LTV/stock.
- Review formula cross-source yang mudah mismatch karena beda grain data.
- Review dependency ke RPC `get_channel_ltv_90d` dan `get_channel_cac`.

### L. Customer Analysis

Files:

- `app/dashboard/customers/page.tsx`
- `lib/scalev-actions.ts`
- `components/DateRangePicker.tsx`

Tasks:

- Review cohort logic, customer KPIs, segmentation, retention/churn style calculations.
- Review semua query customer-type dan cohort range.
- Review chart/table synchronization dengan date range.
- Review denominator nol/null dan partial data periods.
- Review apakah halaman memakai picker sendiri atau shared range dengan aman.

### M. Brand Analysis

Files:

- `app/dashboard/brand-analysis/page.tsx`
- `lib/scalev-actions.ts`

Tasks:

- Review refresh flow `refreshBrandAnalysis`.
- Review materialized sources:
  - `mv_cross_brand_matrix`
  - `v_brand_analysis_summary`
  - `mv_brand_journey`
  - `mv_customer_brand_map`
  - `mv_refresh_log`
- Review filter `all/bundle_only/separate_only/mixed`.
- Review single vs multi-brand aggregation dan journey lookup.
- Review stale refresh time dan no-data state.

### N. Finance Analysis

Files:

- `app/dashboard/finance/page.tsx`
- `lib/financial-actions.ts`
- `app/api/financial-analysis/route.ts`

Tasks:

- Review P&L, CF, BS, ratios, AI analysis save/load flow.
- Review all summary/detail queries:
  - `v_pl_summary`
  - `v_cf_summary`
  - `financial_ratios_monthly`
  - `financial_bs_monthly`
  - `financial_analyses`
- Review AI endpoint:
  - prompt building mode
  - streaming collection
  - JSON extraction robustness
  - timeout risk
  - model/env dependency
- Review stale saved analysis vs current financial data mismatch risk.
- Review security dan cost control untuk Anthropic call.

### O. Business Settings

Files:

- `app/dashboard/business-settings/page.tsx`
- `lib/webhook-actions.ts`
- `lib/warehouse-ledger-actions.ts`

Tasks:

- Review webhook business CRUD:
  - business code
  - webhook secret
  - API key
  - tax rate binding
  - active toggle
- Review store-channel management:
  - store type
  - channel override
  - fetch stores from Scalev
  - inactive filtering
- Review warehouse business mapping create/update flow.
- Review impact ke Scalev webhook ingestion dan warehouse deduction.
- Review owner-only assumption dan direct URL access.

### P. Admin

Files:

- `app/dashboard/admin/page.tsx`
- `components/SheetManager.tsx`
- `components/ConnectionManager.tsx`
- `components/SyncManager.tsx`
- `components/FinancialSheetManager.tsx`
- `components/CsvOrderUploader.tsx`
- `components/MetaManager.tsx`
- `components/WarehouseSheetManager.tsx`
- `lib/actions.ts`
- `lib/sheet-actions.ts`
- `lib/warehouse-actions.ts`
- `lib/financial-actions.ts`
- `lib/scalev-actions.ts`

Tasks:

- Review tab-level access di admin:
  - daily
  - meta
  - financial
  - warehouse
  - sync
  - data_ref
  - users
  - permissions
  - logs
- Review upload/import flows:
  - Excel upload
  - CSV upload
  - sheet sync
  - financial sync
  - warehouse sync
  - Scalev sync
  - Meta sync
  - WhatsApp sync
- Review user/role management:
  - invite
  - role update
  - telegram_chat_id update
  - permission matrix persistence
- Review data reference editors:
  - marketplace commission
  - tax rates
  - monthly overhead
  - business tax config
  - warehouse mapping
- Review logs completeness:
  - `scalev_sync_log`
  - `data_imports`
  - meta/waba logs
- Review cache invalidation (`invalidateAll`) setelah perubahan admin.

### Q. Hidden Legacy Route: Products

Files:

- `app/dashboard/products/page.tsx`

Tasks:

- Tentukan apakah route ini masih dipakai, legacy, atau seharusnya dihapus.
- Review apakah data/logic-nya overlap atau konflik dengan Overview.
- Review akses direct URL karena tab-nya disembunyikan dari `ALL_TABS`.
- Jika logic masih penting, map dependency dan regression risk-nya.

## 7. Integrasi Backend Yang Wajib Direview Walau Bukan UI Langsung

### Scalev

Files:

- `app/api/scalev-webhook/route.ts`
- `app/api/scalev-sync/route.ts`
- `lib/scalev-api.ts`
- `lib/scalev-actions.ts`

Tasks:

- Review idempotency webhook, order update semantics, line-item upsert semantics.
- Review business config loading, tax mapping, store-channel mapping, brand derivation.
- Review interaction dengan warehouse deduction.
- Review sync log insertion/update consistency.
- Review cron/manual sync auth.

### Google Sheets / Financial / Warehouse Sheet Sync

Files:

- `app/api/sync/route.ts`
- `app/api/financial-sync/route.ts`
- `app/api/warehouse-sync/route.ts`
- `lib/google-sheets.ts`
- `lib/financial-parser.ts`
- `lib/warehouse-parser.ts`

Tasks:

- Review active connection loading.
- Review parser assumptions dan failure mode per spreadsheet format.
- Review delete-before-insert/upsert strategy dan partial failure handling.
- Review cron auth vs app auth consistency.

### Meta / WhatsApp / XLSX Ads

Files:

- `app/api/meta-accounts/route.ts`
- `app/api/meta-sync/route.ts`
- `app/api/whatsapp-sync/route.ts`
- `app/api/xlsx-ads-upload/route.ts`
- `lib/meta-marketing.ts`
- `lib/meta-whatsapp.ts`

Tasks:

- Review token health, active account filtering, date range sync, batch insert, and log tables.
- Review normalization store-to-brand mapping.
- Review how WABA analytics ditulis sebagai ads spend dan dampaknya ke dashboard marketing/channels/pulse.

### Telegram / AI Ops

Files:

- `app/api/telegram-report/route.ts`
- `app/api/telegram-webhook/route.ts`
- `lib/daily-report.ts`
- `lib/opus-analyst.ts`

Tasks:

- Review report correctness vs dashboard sources.
- Review command handling, callback flow, allowed chat gate, and failure messages.
- Review AI analysis costs, timeout, and error fallback.

## 8. DB / RPC Contract Review Checklist

Ketika perilaku halaman belum jelas, telusuri migration/RPC/view yang relevan di `supabase/migrations/`.

Minimal contract yang harus dipahami per domain:

- Dashboard core:
  - `daily_product_summary`
  - `daily_channel_data`
  - `daily_ads_spend`
  - `monthly_overhead`
  - `get_daily_shipment_counts`
- Customer/brand analytics:
  - `v_daily_customer_type`
  - `v_customer_cohort`
  - `v_monthly_cohort`
  - `v_monthly_cohort_channel`
  - `mv_cross_brand_matrix`
  - `v_brand_analysis_summary`
  - `mv_brand_journey`
  - `mv_customer_brand_map`
  - `refresh_brand_analysis`
- Finance:
  - `financial_pl_monthly`
  - `financial_cf_monthly`
  - `financial_bs_monthly`
  - `financial_ratios_monthly`
  - `v_pl_summary`
  - `v_cf_summary`
  - `monthly_cashflow_snapshot`
  - `generate_cashflow_snapshot`
  - `get_live_cashflow`
  - `get_live_cashflow_by_channel`
- Warehouse/PPIC:
  - `warehouse_products`
  - `warehouse_batches`
  - `warehouse_stock_ledger`
  - `warehouse_stock_opname`
  - `warehouse_stock_opname_sessions`
  - `warehouse_purchase_orders`
  - `warehouse_po_items`
  - `warehouse_vendors`
  - `warehouse_scalev_mapping`
  - `v_warehouse_stock_balance`
  - `v_warehouse_batch_stock`
  - `warehouse_deduct_fifo`
  - `warehouse_find_product_for_deduction`
  - `warehouse_find_product_by_scalev_name`
  - `warehouse_reverse_order`
  - `ppic_weekly_demand_scalev`
  - `ppic_monthly_demand`
  - `ppic_monthly_movements`
  - `ppic_avg_daily_demand`
- Admin/settings/auth:
  - `profiles`
  - `role_permissions`
  - `sheet_connections`
  - `financial_sheet_connections`
  - `warehouse_sheet_connections`
  - `scalev_webhook_businesses`
  - `scalev_store_channels`
  - `meta_ad_accounts`
  - `waba_accounts`
  - `waba_templates`
  - `waba_template_daily_analytics`
  - `scalev_sync_log`
  - `data_imports`

## 9. Review Ledger

Status legend:

- `NS` = not started
- `IP` = in progress
- `RV` = reviewed, temuan belum dirapikan
- `DN` = done
- `BLK` = blocked

| Area | Primary files | Status | Notes |
| --- | --- | --- | --- |
| Shared shell/auth/cache/access | `app/dashboard/layout.tsx`, `middleware.ts`, `lib/*Context*`, `lib/dashboard-access.ts`, `lib/dashboard-cache.ts` | DN | Direview dan dipatch lokal: fail-open authz/profile/permission, child-tab visibility, refresh meta false-success, date-range WIB/latest-data, active-brand fail-open. Runtime verification masih disarankan |
| Public/auth routes | `app/page.tsx`, `app/register/page.tsx`, `app/forgot-password/page.tsx`, `app/reset-password/page.tsx` | DN | Direview dan dipatch lokal: public auth redirect saat session aktif, email normalization, reset-password recovery handling untuk `code`/`token_hash`/hash session, invite flow/admin UI tidak lagi mengklaim email terkirim padahal hanya generate link. Runtime verification bersama user disarankan |
| Overview | `app/dashboard/page.tsx`, `lib/overview-actions.ts`, `components/CashFlowSection.tsx` | DN | Direview dan dipatch lokal: previous-range comparison aman untuk month-end, previous-overhead mengikuti seluruh comparison window + proration harian, cash-flow widget dibatasi ke range 1 bulan dari tanggal 1, dan error brand-filter tidak lagi tersamar sebagai empty state. Runtime verification disarankan |
| Marketing | `app/dashboard/marketing/page.tsx`, `lib/marketing-actions.ts` | DN | Direview dan dipatch lokal: comparison range month-end/custom multi-month kini pakai previous-range yang ter-clamp aman, baseline delta/ROAS previous period memakai window pembanding yang setara, active-brand lookup failure kini tampil sebagai error state, dan ads breakdown kini memakai hybrid brand resolution: baris yang berhasil dimap tetap masuk chart/matrix per-brand, sementara spend yang belum termap tetap masuk total Marketing/traffic-source breakdown dengan warning eksplisit agar source seperti TikTok Ads/WABA MM Cost tidak hilang diam-diam. Runtime verification disarankan |
| Channels | `app/dashboard/channels/page.tsx`, `lib/channels-actions.ts`, SLA/shipment components | DN | Direview dan dipatch lokal: previous-range month-end kini di-clamp aman, all-brand `Mkt Cost` tidak lagi membuang ads spend unmapped, error active-brand kini tampil jelas, widget shipment/SLA disembunyikan saat filter brand aktif agar tidak misleading, dan action SLA/shipment kini ikut enforce akses tab Channels. Runtime verification disarankan |
| WABA Management | `app/dashboard/waba-management/page.tsx`, WABA API routes | NS |  |
| Financial Report redirect | `app/dashboard/financial-report/page.tsx` | NS |  |
| Cashflow | `components/BankCashFlowDashboard.tsx`, bank API routes | NS |  |
| Financial Settings | `components/FinancialSettingsPage.tsx`, `app/api/bank-accounts/route.ts` | NS |  |
| PPIC | `app/dashboard/ppic/page.tsx`, `lib/ppic-actions.ts` | NS |  |
| Warehouse | `app/dashboard/warehouse/page.tsx`, `lib/warehouse-actions.ts`, `lib/warehouse-ledger-actions.ts` | NS |  |
| Warehouse Settings | `app/dashboard/warehouse-settings/page.tsx`, `lib/brand-actions.ts`, `lib/warehouse-ledger-actions.ts` | NS |  |
| Business Pulse | `app/dashboard/pulse/page.tsx`, `lib/scalev-actions.ts` | NS |  |
| Customer Analysis | `app/dashboard/customers/page.tsx`, `lib/scalev-actions.ts` | NS |  |
| Brand Analysis | `app/dashboard/brand-analysis/page.tsx`, `lib/scalev-actions.ts` | NS |  |
| Finance Analysis | `app/dashboard/finance/page.tsx`, `lib/financial-actions.ts`, `app/api/financial-analysis/route.ts` | NS |  |
| Business Settings | `app/dashboard/business-settings/page.tsx`, `lib/webhook-actions.ts` | NS |  |
| Admin | `app/dashboard/admin/page.tsx`, admin components and upload/sync APIs | NS |  |
| Hidden products route | `app/dashboard/products/page.tsx` | NS |  |
| Scalev integration backend | `app/api/scalev-webhook/route.ts`, `app/api/scalev-sync/route.ts`, `lib/scalev-api.ts` | NS |  |
| Sheets/financial/warehouse sync backend | `/api/sync`, `/api/financial-sync`, `/api/warehouse-sync`, parsers | NS |  |
| Meta/WhatsApp/XLSX backend | meta/waba/xlsx routes + libs | NS |  |
| Telegram/AI ops backend | telegram routes + `lib/daily-report.ts` + `lib/opus-analyst.ts` | NS |  |
| DB/RPC/migrations verification | `supabase/migrations/*` | NS |  |

## 10. Template Bukti Review Per Item

### Review Notes - Shared shell/auth/cache/access

- Status: `RV`
- Files read:
  - `app/layout.tsx`
  - `app/dashboard/layout.tsx`
  - `middleware.ts`
  - `lib/utils.ts`
  - `lib/PermissionsContext.tsx`
  - `lib/DateRangeContext.tsx`
  - `lib/ActiveBrandsContext.tsx`
  - `lib/dashboard-cache.ts`
  - `lib/dashboard-access.ts`
  - `lib/supabase-browser.ts`
  - `lib/supabase-server.ts`
- Findings summary:
  - dashboard layout fail-open ketika profile tidak ada / gagal dimuat
  - dashboard layout fail-open untuk role yang tidak punya permission tab sama sekali
  - child permission (`cashflow`, `waba-management`, `warehouse-settings`) bergantung implisit pada permission parent sehingga nav/access model tidak konsisten
  - refresh button menganggap Meta sync `failed` sebagai sukses dan tetap reload
  - date-range default memakai browser local date dan fallback sampai akhir bulan, bukan latest actual date
  - active brand filter fail-open jika query `brands` gagal
- Patch status:
  - patched locally
  - runtime verification pending
- Next step:
  - lanjut review area public/auth routes
  - saat sempat, lakukan smoke test manual untuk role tanpa profile, role tanpa permission, child-only permission, dan default date range

### Review Notes - Public/auth routes

- Status: `DN`
- Files read:
  - `app/page.tsx`
  - `app/register/page.tsx`
  - `app/forgot-password/page.tsx`
  - `app/reset-password/page.tsx`
  - `middleware.ts`
  - `app/api/invite/route.ts`
  - `app/dashboard/admin/page.tsx`
  - `lib/supabase-browser.ts`
  - `supabase/migrations/001_initial_schema.sql`
  - `supabase/migrations/002_add_pending_admin_roles.sql`
- Findings summary:
  - authenticated user masih bisa balik ke `register`/`forgot-password` walau session aktif, sehingga flow publik membingungkan
  - login/register/forgot-password belum menormalkan email input, sehingga whitespace/casing bisa bikin auth flow tidak konsisten
  - `reset-password` hanya menunggu `PASSWORD_RECOVERY`/session umum dan tidak menangani variasi callback `code`, `token_hash`, atau session di URL hash
  - `/api/invite` mengklaim invite sukses seolah email sudah dikirim, padahal implementasi hanya generate recovery link dan tidak pernah mengirimkannya ke user
  - admin UI tidak memberi owner cara praktis untuk membagikan recovery link hasil invite
- Patch status:
  - patched locally
  - runtime verification pending
- Next step:
  - lanjut review area `Overview`
  - saat verifikasi runtime, uji login/register/forgot-password dengan email bercampur spasi/huruf besar, uji recovery link biasa, dan uji flow invite + copy link dari admin

### Review Notes - Overview

- Status: `DN`
- Files read:
  - `app/dashboard/page.tsx`
  - `lib/overview-actions.ts`
  - `components/CashFlowSection.tsx`
  - `lib/cashflow-actions.ts`
  - `components/DateRangePicker.tsx`
- Data sources:
  - `daily_product_summary`
  - `daily_ads_spend`
  - `daily_channel_data`
  - `monthly_overhead`
  - RPC `get_daily_shipment_counts`
  - RPC `get_live_cashflow`
  - RPC `get_live_cashflow_by_channel`
- Findings summary:
  - previous-period range dihitung dengan `Date(..., month - 1, sameDay)` sehingga tanggal akhir bulan bisa rollover ke bulan yang salah
  - previous overhead hanya diambil dari satu `year_month` pertama dan dihitung sebagai full-month amount, padahal current period memakai proration harian dan UI mengizinkan custom multi-month range
  - widget `Cash Flow Status` selalu mengambil bulan dari `dateRange.from`, tetapi persentasenya dibagi oleh `netSales` seluruh range terpilih sehingga menyesatkan untuk range lintas bulan
  - ketika `ActiveBrandsContext` error, Overview jatuh ke empty-state "Belum Ada Data" alih-alih menjelaskan bahwa filter brand gagal dimuat
- Patch status:
  - patched locally
  - runtime verification pending
- Next step:
  - lanjut review area `Marketing`
  - verifikasi manual untuk custom range lintas bulan, tanggal 31→bulan sebelumnya, dan simulasi error query `brands`

### Review Notes - Marketing

- Status: `DN`
- Files read:
  - `app/dashboard/marketing/page.tsx`
  - `lib/marketing-actions.ts`
- Data sources:
  - `daily_product_summary`
  - `daily_ads_spend`
  - `daily_channel_data`
- Findings summary:
  - comparison range `prevRangeFrom/prevRangeTo` masih memakai `Date(..., month - 1, sameDay)` sehingga tanggal akhir bulan bisa rollover ke bulan yang salah
  - baseline previous-period untuk KPI/delta rusak pada custom range lintas bulan karena `prevFullFrom/prevFullTo` hanya mengambil satu bulan penuh sebelum `from`, lalu revenue/admin previous period disaring pakai day-of-month saja
  - delta ROAS pada breakdown traffic-source membandingkan current selected range melawan full previous month, sehingga tidak apples-to-apples untuk range partial/custom
  - hanya revenue product yang difilter dengan `activeBrands`; ads spend dan admin fee tetap menghitung brand nonaktif sehingga KPI dan breakdown bisa mismatch
  - saat `ActiveBrandsContext` error, halaman tidak menampilkan error state khusus dan tetap bisa merender metrik spend melawan revenue yang sudah fail-closed
- Patch status:
  - patched locally
  - runtime verification pending
- Next step:
  - lanjut review area `Channels`
  - verifikasi manual untuk range partial-month, range lintas bulan, brand nonaktif, simulasi error query `brands`, pastikan matrix/filter brand tidak lagi menampilkan entity code seperti `RTI`, dan pastikan spend unmapped tetap muncul di total Marketing dengan warning eksplisit

### Review Notes - Channels

- Status: `DN`
- Files read:
  - `app/dashboard/channels/page.tsx`
  - `lib/channels-actions.ts`
  - `components/ChannelSlaSection.tsx`
  - `components/ShipmentStatusSection.tsx`
  - `lib/sla-actions.ts`
  - `lib/shipment-actions.ts`
  - `supabase/migrations/016_shipment_status_rpc.sql`
  - `supabase/migrations/017_shipment_status_overdue.sql`
- Data sources:
  - `daily_channel_data`
  - `daily_ads_spend`
  - `ads_store_brand_mapping`
  - RPC `get_daily_shipment_counts`
  - RPC `get_channel_sla`
  - RPC `get_shipment_status`
- Findings summary:
  - previous comparison range masih memakai `Date(..., month - 1, sameDay)` sehingga tanggal akhir bulan bisa rollover ke bulan yang salah
  - all-brand `Mkt Cost` dan delta previous-period membuang ads spend yang belum punya brand mapping, sehingga angka channel-level bisa understate seperti bug yang sempat muncul di Marketing
  - saat `ActiveBrandsContext` error, halaman jatuh ke empty-state biasa alih-alih menjelaskan bahwa filter brand gagal dimuat
  - widget `Shipment Status` dan `Order SLA` hanya mengikuti date range, tidak mengikuti filter brand, sehingga saat user memilih satu produk/brand bagian bawah halaman bisa misleading
  - action SLA/shipment belum enforce akses tab `Channels` di layer server action
- Patch status:
  - patched locally
  - runtime verification pending
- Next step:
  - lanjut review area `WABA Management`
  - verifikasi manual untuk custom range yang berakhir tanggal 31, all-brand view dengan ads unmapped, simulasi error `brands`, dan pastikan widget shipment/SLA hilang saat filter produk selain `Semua Produk`

Saat mereview satu area, catat minimal format ini:

### [Nama area]

- Status: `NS | IP | RV | DN | BLK`
- Files read:
  - `path/a`
  - `path/b`
- Data sources:
  - table/view/RPC/API/action yang dipakai
- Mutation paths:
  - create/update/delete/sync/import yang disentuh
- Permission model:
  - UI gate
  - route/API gate
- Risks found:
  - bug
  - regression
  - race condition
  - stale cache
  - security gap
- Open questions:
  - hal yang perlu dibuktikan dari DB/migration/runtime
- Next step:
  - tugas konkret berikutnya

## 11. Rule Tambahan Agar Tidak Ada Scope Yang Bocor

- Jangan menandai halaman selesai hanya karena page file sudah dibaca. Dependency logic utamanya juga wajib dibaca.
- Jika page memakai `fetch('/api/...')`, API route tersebut otomatis masuk scope halaman itu.
- Jika page memakai lib action yang query view/RPC penting, contract DB-nya juga masuk scope.
- Jika ada wrapper page 1-10 baris, review diarahkan ke component/API/redirect target di belakangnya.
- Route yang tidak ada di sidebar tetap dianggap hidup sampai dibuktikan obsolete.
- Semua temuan harus ditulis dengan file dan dampak, bukan hanya intuisi.

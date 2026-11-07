# Marketplace Data Parser

The tool at `/dashboard/marketplace-data-parser` converts original marketplace
XLSX exports into reviewed Scalev CSV files. It is a child of **Sales Channel**
with the sidebar label **MP Data Parser**, and inherits `tab:channels` access and the workspace's `channels` module. Both
loading context and saving shared configuration enforce access on the server
and reject a changed workspace.

## Workflow and scope

1. Select the marketplace account and batch date; the date initially uses
   `Asia/Jakarta` today. Upload one `.xlsx` file, up to 10 MB.
2. Review grouped orders, item quantity, unit price, total, destination and
   validation messages. Search and status filters operate on the preview;
   pagination shows 25 orders at a time. The alternate view exposes all 28 CSV
   columns. Neither filtering nor pagination limits the exported batch.
3. Open an order to inspect raw source fields and source sheet/row, correct an
   item or destination, and record a correction reason. An item mapping can
   become a proposed reusable rule. Corrections remain separate from source
   evidence, and can be reset to the automatic result.
4. Resolve every blocking issue, confirm the review checkbox, then download a
   separate CSV for each destination business. The CSV serializes the same rows
   shown in the preview. Any data, account, date or applied-rule change clears
   review approval. A failed replacement upload retains the old preview with an
   error and also clears approval.

XLSX bytes, parsed customer/order data, corrections and previews stay in browser
memory. Reloading or switching workspace discards the session. The optional
parsing-notes JSON download includes source fields, file SHA-256, configuration
and correction snapshots, revision and projected rows for an internal archive.
Only explicitly saved shared mapping configuration is sent to persistence.

This tool does not insert or update orders, promote legacy intake records, call
Scalev, upload CSVs to Scalev, or reconcile earlier downloads/imports. Repeated
download is available; successful import into Scalev is not tracked here.

## Source and financial rules

Recognized sheets are identified by headers, not sheet names. All recognized
sheets are parsed; unrecognized sheet names are shown as unprocessed. Limits are
50 sheets, 20,000 rows per sheet and 20,000 items per upload.

| Source | Identity and item calculation |
| --- | --- |
| Shopee orders | `No. Pesanan`; quantity from `Jumlah`; unit price from `Harga Setelah Diskon`. A separate seller voucher is reported without subtracting it again. |
| TikTok Shop | Text `Order ID`; unit price is (`SKU Subtotal Before Discount` − `SKU Seller Discount`) ÷ `Quantity`. Platform subsidy remains separate. Original unit price × quantity is checked against the subtotal. |
| Shopee Advance Fulfilment | `Booking SN`; missing quantity and price stay unknown and block export until evidence-backed correction. |
| Lazada | Group by `orderNumber`, use `orderItemId` as external ID for the supported single-item case; quantity 1 and `unitPrice`, not `paidPrice`. |

Money uses integer hundredths of IDR. Genuine zero-priced items stay zero;
missing amounts never become zero, and SKU suffixes never determine price.
Nonintegral quantities, unsafe totals and unit prices requiring fractions below
Rp0.01 block export instead of being silently rounded. Replacing malformed
source financials requires both quantity and price plus a reason.

Each order has one group `id`, repeated on continuation item rows. Order-header
fields appear only on the first row. IDs restart within each business CSV.
`item_type` is `bundle`, `payment_method` is `marketplace`, `bank` follows the
platform, and shipping cost, other income and weight bump export as zero. The
batch date supplies `timestamp`. CSV escaping preserves commas, quotes and line
breaks; unsafe formula prefixes/control characters are blocked. Long numeric
Excel IDs that have already lost precision must be re-exported as text.

## Current defaults

Defaults live in `lib/marketplace-parser/config.ts` and can be edited in the
configuration panel. They encode the supplied operational rules; they are not
proof that the named business, store, SKU or warehouse is present in a workspace.

- Accounts start as **MP Roove**, **MP Pluve** and **MP Purvu**. The user must
  select the actual source account; it is not inferred from the filename.
- **Business Roove is intentionally unset** and must be chosen from the active
  business catalog. Lazada overrides destination business to **RLT** by default.
- MP Pluve + Pluve routes to **JHN / Pluve Main Store JHN**. MP Roove routes by
  product family using the selected Business Roove, including Pluve products.
  MP Purvu has no default routes, and Dr Hyun has product mapping without a
  default route; these need an explicit destination rule or correction.

| MP Roove product family | Default store |
| --- | --- |
| Roove | Roove Main Store - Marketplace |
| Globite | Globite Store - Marketplace |
| Osgard | Osgard Oil Store |
| Pluve | Pluve Main Store - Marketplace |
| Purvu | Purvu Store - Marketplace |
| Purvu The Secret | Purvu The Secret Store - Markerplace |

The supplied store spelling `Markerplace` is preserved. The default warehouse
is **Roove Lautan Barat's Warehouse**, except Purvu The Secret uses **Jejak Herba
Nusantara's Warehouse**. Warehouse names from existing enabled intake scopes are
suggestions only; this feature does not fetch or validate a live warehouse list.

Product rules support exact SKU, exact name/optional variation only when the
source SKU is empty, or SKU prefix. Account-specific rules outrank shared rules;
within that scope exact SKU outranks name and prefix, and longer prefixes win.
Ties block. Defaults include `SRTARM-250` → `SRTARM-185`, known name/variant
fallbacks, and accessory `SMini-0`; accessories follow the other product family's
route and do not independently choose a destination.

Courier mapping uses platform plus the source provider text. Confirmed defaults
map **Gojek/Grab → Shopee Express / REGULER** while retaining the original
provider in the source evidence. Other defaults cover the listed Shopee SPX,
JNE and SiCepat names, TikTok J&T names, and Lazada J&T. Unknown provider names
require a rule or reasoned correction. `COURIER_SERVICE_OPTIONS` defines the
accepted Scalev pairs; `REGULAR` and `REGULER` are intentionally distinct.

## Configuration and setup

The app reads active businesses, active stores and bundle SKUs from the existing
workspace-scoped Scalev catalog tables. Ensure **Catalog & Master Data** has
the required records. Business and store must exist together, and each SKU must
match exactly one bundle in the selected business. No business API keys or
webhook secrets are returned to the browser.

Review and apply only
`supabase/migrations/20261107195500_marketplace_parser_config.sql` to the intended
database through the normal [release workflow](../runbooks/development-staging-production.md).
Before local database work, run `npm run db:local:verify` and coordinate against
the existing local snapshot; do not reset it or replay historical migrations.

The migration adds `marketplace_parser_configs` and
`marketplace_parser_config_history`, with workspace scoping and RLS. Anonymous
and authenticated clients receive no direct table access. Authorized server
actions use the service role. Each save increments a revision and the database
trigger records its configuration and actor in history. Updates compare the
expected revision, so another user's save causes a reload-required conflict
instead of an overwrite. History is retained in the database; there is no
history browser or restore UI in this feature.

Without the configuration tables, the page uses defaults and allows session-only
rules while disabling team saves. Other configuration/catalog load failures
show a retryable error. Configurations allow at most 2,000 rules per type and a
1 MB server-side save payload. Session edits and team configuration saves are
separate actions.

## Deliberate blockers

The entire batch must be ready before any business CSV can be downloaded. The
tool does not silently drop unresolved orders. In addition to missing mappings,
required values and catalog failures, blockers include:

- Advance Fulfilment lines without evidenced quantity/price.
- Lazada multi-item orders pending an `external_id` policy, and Lazada nonzero
  seller/bundle discounts pending validated calculation rules.
- Unknown source accounts, unrouted product families, conflicting destinations
  and unsupported courier/service pairs.
- Identical duplicate source rows, a receipt shared across orders/bookings in
  the same platform/file, inconsistent header data within an order, and canceled
  or returned orders.

## UI inheritance and validation

This is an ordinary dashboard extension. It uses the existing dashboard shell,
Inter typography and light/dark semantic colors from `app/globals.css`, with
compact tables, bordered panels, labeled inputs, visible keyboard focus and
text-plus-icon status indicators. Forms stack at smaller widths; wide preview
and configuration tables scroll within their region. Reduced-motion preference
removes button transitions. No project-wide visual identity or tokens change.

Local checks for this feature:

```sh
node --import tsx --test tests/marketplace-data-parser.test.ts tests/marketplace-parser-interaction.test.ts
npm run typecheck:app
npm run lint
npm run build
```

At implementation review on 7 November 2026, all 22 core and React interaction
tests plus nine shared ad-spend/navigation tests passed. The final app typecheck,
lint and production build passed, with pre-existing lint warnings. A private
local replay covered seven XLSX/CSV pairs,
402 orders and 418 lines: all 414 lines with source financials matched expected
SKU, quantity and price; four Advance lines remained incomplete. That replay
used a synthetic catalog derived from the comparison CSVs, so it does not
establish live catalog or warehouse validity. Customer samples are not tracked.

Release review on 7 November 2026 completed the authenticated local browser
check using the existing reduced Supabase sample. The parser configuration
migration was applied locally; the real business catalog loaded, configuration
revision 1 and its audit record were saved, and the revision survived a reload.
Transaction-scoped database checks verified RLS, denied direct client access,
history creation, stale-revision protection, and rejection of invalid revision
increments; test changes were rolled back. All 31 parser/component and shared
navigation tests, app typecheck, lint, and build passed. The sidebar and page
titles were verified as **MP Data Parser** and **Marketplace Data Parser**.

Operational acceptance with warehouse files remains separate: select the actual
Business Roove and review store, warehouse, product, and courier mappings before
the first production export. Local configuration and test records are not part
of the release. Development uses the isolated local clone on
`codex/marketplace-data-parser`; the original checkout and its uncommitted work
are preserved.

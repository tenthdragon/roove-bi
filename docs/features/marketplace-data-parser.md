# Marketplace Data Parser

The page at `/dashboard/marketplace-data-parser` converts marketplace XLSX into
reviewed Scalev CSV. Its sidebar label is **MP Data Parser** and it inherits
`tab:channels` plus the workspace `channels` module. All context, configuration,
catalog sync, and download actions enforce access and current workspace.

The current design fixes Business on the source account. Product and combination
rules choose one Store within that Business. All SKU codes must identify exactly
one bundle available in that destination Store. Configuration starts without
customer-specific accounts, Products, Stores, or Warehouse names.

See [configuration, routing, synchronization and release instructions](../runbooks/marketplace-data-parser.md)
for the full v3 workflow. The entire batch must be valid before download. Admins
cannot override SKU or routing per order. Quantity, price, courier/service, and
buyer corrections require a reason. Team configuration changes are global and
require fresh review; there is no session-only routing mode.

Search/status filters and pagination (25 orders) affect only the preview, never
the exported batch. The alternate CSV view exposes all 28 output columns.
A failed replacement upload retains the old preview with an explicit error and
clears review approval. Reloading or switching workspace discards the file session.

XLSX bytes stay in browser memory. At download, parsed orders and corrections are
sent to the app server for validation against the latest saved rules and catalog;
they are not persisted. The optional audit JSON contains source fields, file hash,
config/correction snapshots, revision and projected rows. Only shared rules and
catalog synchronization state are persisted by this feature.

The tool can refresh bundle–Store relations from Scalev. It does not insert or
update orders, upload CSVs to Scalev, or track whether an earlier CSV was imported.

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

This ordinary dashboard extension preserves the existing shell, Inter typography,
light/dark semantic colors, compact tables, labeled inputs and visible focus.
Forms stack at smaller widths; wide configuration/preview tables scroll inside
their regions. No project-wide visual identity or tokens change.

The 9 November implementation was checked with 50 domain, React interaction,
server-action and catalog tests, plus an isolated PostgreSQL migration/history/RLS
test. Typecheck, lint and production build passed; unrelated existing lint warnings
remain. Authenticated browser tests against the local database verified:

- Two marketplace SKUs remain two bundle rows within one RTI order and Store.
- Shopee Pluve resolves to JHN / Pluve Main Store JHN.
- Unknown SKU disables review confirmation and the whole download.
- Server-validated CSV contains both bundle rows and the exact Rp835,000 total.
- Team save and reload retain v3 configuration.

Browser orders were explicitly synthetic. The local catalog used existing synced
Scalev data copied read-only from the app database: 331 bundle records and 298
available links across seven selected Stores. No test order was sent to Scalev
or persisted in production. Local config and catalog copies are excluded from Git.

The private sample replay script now requires explicit v3 configuration and
catalog snapshot paths in each manifest entry. It no longer fabricates a catalog
from the expected CSV. Existing sample comparisons that depended on old SKU
aliases must be corrected at the source/Scalev identifier before they can pass.

Production activation is separate from this implementation. Apply only pending
reviewed migrations and review the migrated config draft before its first team save.
Restoring old app code after saving v3 also requires a compatible config restored
through a new audited revision; never overwrite or delete existing history.

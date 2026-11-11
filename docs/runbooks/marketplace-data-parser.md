# Marketplace Data Parser

The sidebar is **MP Data Parser**; the page title is **Marketplace Data Parser**.
Configuration is shared by the workspace and versioned with compare-and-swap
saves. There is no session-only routing override.

## Configure the workspace

1. Add each source account with its Marketplace and exactly one connected
   Business. For example, the agreed Roove workspace setup is Shopee Roove →
   RTI and Shopee Pluve → JHN. These are configuration data, not code defaults.
2. Select the Stores used within those Businesses. Choose a connected Warehouse
   once per Store. Names and IDs come from the application's master data.
   Warehouse CSV labels come from configured marketplace integration data;
   an absent or ambiguous label blocks export rather than adding a guessed suffix.
3. Load or synchronize the bundle catalog for the selected Stores. Only their
   available bundle links and referenced bundles are loaded. An unfinished or
   failed Store sync prevents exporting orders to that Store. Successfully synced
   empty Stores are distinguishable from Stores not yet checked.
4. Define Products and classify bundle identifier codes using exact SKU or code
   prefixes. A code may represent more than one Product. This classification
   never rewrites the marketplace SKU. Account-specific classification takes
   precedence over shared classification; exact rules beat prefixes, and longer
   prefixes beat shorter ones. Equally specific conflicting rules block export.
5. Set account + Product → Store routes. Store choices stay inside the account's
   Business and the selected Store scope.
6. Set combination rules where needed: contains all selected Products or exactly
   the selected Product set, target Store, and numeric priority (larger wins).
   A contains-Roove rule may select Roove Main Store for any matching order;
   Globite + Pluve and other combinations are separate configurable rules.
   Equally prioritized matching rules choosing different Stores block export.
7. Maintain Marketplace courier/service mappings and save the team configuration.

Combination rules are evaluated before individual Product routes. Without an
applicable route, the parser can discover a destination only when all bundle
codes share exactly one selected Store. It never chooses the first candidate.
If an account has combination rules, every item must be classified before they
can be evaluated. An incomplete classification must not bypass those rules.

## Upload, validate, download

Select an account and batch date, then upload the original marketplace XLSX.
Business follows the account. The entire order receives one Store; each distinct
marketplace SKU remains its own bundle item with its original quantity.
Every SKU must match exactly one Scalev bundle identifier code in that destination
Store. Matching is case-sensitive after surrounding whitespace is removed.
Product-name guessing and SKU aliases are not supported.

Missing codes, unavailable bundles, ambiguous identifiers, incomplete routes,
conflicting combinations, invalid warehouses, and existing source/financial
errors block download for the whole batch. Fix bundle codes/availability in
Scalev and reload/synchronize, or correct the global configuration. Admins cannot
override SKU, Business, Store, Product or Warehouse per order. Numeric and
courier/buyer corrections still require an audit reason.

After reviewing all orders, download the CSV for the account's Business. The
server rechecks access, workspace, saved config revision and catalog fingerprint,
then regenerates and validates every order. A config or catalog change requires
fresh review. The audit JSON becomes available only after a successful CSV.
The parser does not create Scalev orders or upload the CSV to Scalev.

## Migration and operation

This branch contains `20261107220000_marketplace_parser_route_business.sql`
and `20261109220000_marketplace_parser_account_stores.sql`. Inspect migration
history and apply only pending files in that order. The latter migration:
permits schema version 3, retains old revisions/history, adds service-only
per-Store sync status, and adds an available-link lookup index. Apply only the pending
reviewed migrations before activating the feature; do not replay history.

Version 1/2 configurations are converted to a **draft**, never silently saved.
Legacy generic accounts are expanded by Marketplace and require review. Conflicting
Business or Store assignments stay incomplete. Exact existing master-data names
resolve to IDs. Legacy SKU substitutions and name rules are removed; the original
marketplace code must now exist in Scalev. Team save activates the reviewed draft.
An application rollback does not reverse a saved v3 config: restore the previous
config through a new audited revision if an old app release must be used.

Store synchronization uses the Business connection on the server, reads the full
Scalev Store bundle list before cache writes, and updates only the selected Store's
availability links. A failed sync is marked failed and can be retried. Credentials
never enter the browser catalog. Existing successful bundle–Store links can be
used before the first parser-specific sync. The app's normal local network guard
remains active: local tests may use an explicitly copied catalog snapshot; do not
enable production integrations in local development or copy local records back
to production.

## Validation

### Database diagnosis and explicit Scalev repair

**Periksa masalah** and **Muat ulang data aplikasi** perform indexed, exact
`custom_id` lookups in the application database. They read only requested SKUs,
active workspace Businesses and configured Store links. They do not load API
credentials, call Scalev, scan whole Business catalogs, or expire completed
snapshots based on age. Orders reuse the same synchronized database catalog.
Missing cache data means **not recorded in the app**, not confirmed absent in
Scalev. Failed/running Business syncs cannot authorize a missing/unique conclusion;
Store syncs and catalog generation changes prevent partial snapshots from
unlocking download. Names and SKU price suffixes are not matching rules.

Ownership uses verified `scalev_owner_uid`, matched to the connections'
`scalev_business_uid`. Legacy `owner_business_id/code` fields were sometimes
inferred from the receiving Business and are not trusted for diagnosis or sharing.
Missing owner/BPO metadata remains unknown, without fabricated options or prices.

- **Sinkronkan Store dari Scalev** refreshes known diagnosed bundle IDs (including
  those not yet installed), then synchronizes the selected Store. A completely
  unknown SKU points to **Katalog & Master Data → External Catalog · Scalev** for
  explicit Business catalog sync, then database reload. It does not scan every
  connected Business automatically.
- Full Business and Store syncs use paginated `/v3/bundles` (ownership and full
  metadata) plus `/v3/bundles/simplified` (active BPOs). Store sync supplies
  `store_id` to both lists. IDs/codes must agree before cache replacement. No
  per-bundle detail fan-out is used to fill a whole catalog.
- Available to the receiving Business: install a chosen bundle price option.
  Not yet shared: verify the owner identity live, then share with
  `POST /v3/bundles/{id}/partners`, passing the receiver's `partner_unique_id`
  with the owner's credential. A reseller cannot authorize sharing.
- Install with `POST /v3/stores/{id}/bundle-price-options` and explicit `bpo_ids`
  using the receiving Business credential. Multiple BPOs require a choice;
  hidden storefront options remain valid. Marketplace transaction prices remain.
- Repairs revalidate identities, bundle IDs/codes, options and Store membership
  live. Direct bundle-by-ID reads replace full Business scans; exact database
  identifiers plus the selected Store's live catalog guard against duplicates.
  New/changed codes outside the synchronized data require a Business catalog sync.

Diagnosis/sync require parser access and the enabled Channels module. Sharing
and installation also require `whs:mapping` (or platform owner access). Local
development permits database diagnosis and blocks live Scalev calls. Credentials
stay server-side. The signed, actor/workspace-bound diagnosis expires after ten
minutes and binds the config revision, account, SKU, bundle, options and Stores.
Optional legacy identifiers are resolved live before an explicit action, never
guessed. Per-Store leases cover repair plus sync. Request/outcome audits use
`warehouse_activity_log`.

The compact panel shows Bundle → Business → Store status before repair controls.
A unique configured Store or active BPO is selected automatically; otherwise the
Store precedes the BPO choice. The single primary action applies to the selected
missing bundles; a single-bundle case has no batch checkbox unless previously
excluded. Explicit exclusions survive Store changes and reloads; multi-bundle
cases retain checkboxes even with one remaining candidate. **Detail & aksi lain**
contains ownership, sync timestamps, database reload, explicit Store sync and
global routing settings. Unknown cached BPOs promote Store sync to the main
action. Incomplete snapshots never show a successful installed status. The order
total is displayed separately and is not replaced by the selected BPO price.

Writes are not automatically replayed. Partial results identify completed
sharing/attachment stages. Sync failure keeps download blocked. A successful sync
replaces the catalog, reprojects the entire uploaded batch (including filtered
orders), and clears download confirmation. Server-side download validation stays
mandatory. Routing/combination/Warehouse issues use global parser settings;
there are no per-order destination overrides.

### Shared API request budget and rollout

Apply **only** `20261110120000_parser_cached_diagnosis.sql` before activating this
release and its workers. It adds nullable owner/BPO metadata, an exact identifier
index and a service-only API budget table/RPC. It does not rewrite old catalog
rows, team configuration, or external Scalev data. An old app remains compatible
with this additive migration. Missing RPC/schema fails closed for live requests.

The parser, normal catalog sync and order-sync API adapter reserve PostgreSQL
slots per SHA-256 credential hash, shared across processes and workspaces using
the same key. Starts are spaced 250 ms apart. HTTP 429 or exhausted quota records
provider `Retry-After` (seconds/date), falling back to `X-Ratelimit-Reset` epoch.
Queued calls recheck cooldown and reserve a new spaced slot if needed. Waits over
20 seconds return a retry time rather than sleeping through an hourly reset.
No raw API key, customer payload, or upstream error body is stored in this table.
Calls from outside these adapters/other apps are not coordinated by this budget.

After release, explicitly sync the Businesses/Stores in use to populate owner
UIDs and BPO choices for legacy data. Existing SKU and membership cache can be
read immediately. Old rows without BPO metadata require sync before offering
installation; incomplete owner identity cannot authorize sharing. Apply no local
fixtures or database dumps to production. A code rollback leaves the additive
migration in place and requires no data rollback.

### Checks

- `npm run test:marketplace-parser`: domain, interaction, server access/export,
  catalog scope, warehouse labels, Scalev pagination, exact database diagnosis with zero Scalev calls,
  sharing/attachment retry, signed action scope, management access, partial
  failures, BPO selection, bulk actions and whole-batch revalidation regressions.
- `node tests/marketplace-parser-config-database.mjs`: isolated PostgreSQL checks
  for config history/CAS, v1/v2/v3 compatibility, sync-state constraints, RLS and the shared request-budget RPC.
- `npm run typecheck:app`, `npm run lint`, `npm run build`.
- Browser acceptance: synthetic XLSX orders against the real local catalog,
  automatic RTI/JHN destinations, two bundle lines in a mixed order, blocked
  unknown SKU, global save/reload, and desktop/mobile layout.

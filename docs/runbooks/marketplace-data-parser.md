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
3. Load the cached bundle catalogs of the accounts' receiving Businesses. Include
   every bundle available to that Business, owned or shared, regardless of Store
   membership or price options. A full Business sync must have completed successfully.
   Running, failed, unknown or changing generations block export for that Business.
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

Combination rules are evaluated before individual Product routes. Without a
combination, every Product must route to the same Store. Every item must be classified.
Missing or conflicting routes block export. Never infer a Store from bundle membership,
from the first candidate, or from a sole selected Store.

## Upload, validate, download

Select an account and batch date, then upload the original marketplace XLSX.
Business follows the account. The entire order receives one Store; each distinct
marketplace SKU remains its own bundle item with its original quantity.
Every SKU must match exactly one Scalev bundle identifier code in the receiving
Business. Store must be active, within that Business and selected in configuration.
Bundle installation in the Store is not required. Prices and quantities come from
the marketplace file; no Scalev price match or choice is required. Matching is case-sensitive after surrounding whitespace is removed.
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

The parser now uses full Business catalog synchronization. Store membership tables
and historical Store sync functions remain for existing consumers, but parser reads
and validation do not use them. Business sync and parser sharing share a compare-and-
swap lease in `scalev_catalog_sync_state`; lost/expired generations cannot mark success.
Before a post-sharing sync, release the sharing claim into a non-ready state, then
acquire a new sync claim. Competing syncs fail safely and never unlock partial data.
Local diagnosis can use a copied snapshot; live Scalev changes remain disabled locally.
Never copy local fixtures or database dumps back to production.

This algorithm update requires **no new migration**. Preserve saved v3 Product and
combination mappings. Configurations previously relying on common-Store inference
must explicitly map Products before downloading. Historic migrations below should
only be applied when genuinely pending, never replayed.

## Validation

### Database diagnosis and explicit Scalev repair

**Periksa masalah** and **Muat ulang data aplikasi** use indexed, exact `custom_id`
lookups, scoped to active Businesses in the current workspace. No credentials, API
calls, Store links or BPOs are needed. Completed snapshots do not expire based on age.
Missing data means not recorded in the app, not confirmed absent in Scalev.
A confirmed receiving-Business match remains valid if an unrelated Business is syncing.
Cross-Business searches require complete snapshots before authorizing sharing.

Ownership uses verified `scalev_owner_uid` matched to `scalev_business_uid`. Never
trust inferred legacy owner Business fields. A shared bundle already available in
the target is valid even if owner metadata or price options are missing.

- **Sinkronkan Business dari Scalev** explicitly refreshes the receiving Business's
  full catalog. Full sync still preserves owner/price metadata for other consumers;
  parser eligibility never uses those price options.
- If a unique bundle exists only in another connected Business, **Bagikan ke Business**
  verifies owner and receiver identities, exact bundle ID/code and existing sharing,
  then calls `POST /v3/bundles/{id}/partners` with the receiver's `partner_unique_id`
  using the owner's credential. It never calls the Store/BPO attachment endpoint.
- Sharing retries check availability/partners first. POSTs are not automatically
  replayed. Partial results preserve completed sharing and unresolved visibility.
- After sharing, a full receiving-Business sync reconciles identifiers and duplicates.
  The entire batch is reprojected, including filtered orders, and confirmation clears.
- Store is a read-only destination from Product/combination mapping. Missing mapping
  opens global settings. No per-order Store override and no catalog-price picker.

Diagnosis requires parser access and the Channels module. Sharing and full Business
sync additionally require catalog tab access plus `whs:mapping` (or platform owner).
Local development blocks live sync/mutations. Credentials remain server-side. The
v2 signed permit is actor/workspace-bound, expires after ten minutes and binds config
revision, account, target Business and exact sharing candidates. Old attachment/price
requests and old permits are rejected. Request/outcome audits use `warehouse_activity_log`.

The compact panel shows Bundle → Business → mapped Store with a visible marketplace
total. **Detail & aksi lain** holds ownership, timestamps, reload, sync and settings.
Sharing uses one primary action; exclusions persist across reloads and multi-bundle
cases retain selection controls even with one remaining candidate. Incomplete
snapshots promote explicit sync. Missing/duplicate identifiers link to the catalog.

### Shared API request budget and rollout

The previous release introduced `20261110120000_parser_cached_diagnosis.sql`.
Check that it is already applied; this algorithm update adds no migration. It adds nullable owner/BPO metadata, an exact identifier
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

Existing successful full Business snapshots can be reused. If a Business has no
completed full snapshot, explicitly sync that Business. Missing price metadata does
not block download; missing verified owner identity only prevents sharing.
No production data mutation is part of deployment. A code rollback requires no
schema rollback but restores the older Store-membership validation behavior.

### Checks

- `npm run test:marketplace-parser`: domain, interaction, server access/export,
  catalog scope, warehouse labels, Scalev pagination, exact database diagnosis with zero Scalev calls,
  Business-only sharing retry, signed action scope, management access, partial
  failures, no Store/BPO requirement, bulk actions and whole-batch revalidation regressions.
- `node tests/marketplace-parser-config-database.mjs`: isolated PostgreSQL checks
  for config history/CAS, v1/v2/v3 compatibility, sync-state constraints, RLS and the shared request-budget RPC.
- `npm run typecheck:app`, `npm run lint`, `npm run build`.
- Browser acceptance: synthetic XLSX orders against the real local catalog,
  automatic RTI/JHN destinations, two bundle lines in a mixed order, blocked
  unknown SKU, global save/reload, and desktop/mobile layout.

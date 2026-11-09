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

- `npm run test:marketplace-parser`: domain, interaction, server access/export,
  catalog scope, warehouse labels and Scalev pagination regressions.
- `node tests/marketplace-parser-config-database.mjs`: isolated PostgreSQL checks
  for config history/CAS, v1/v2/v3 compatibility, sync-state constraints and RLS.
- `npm run typecheck:app`, `npm run lint`, `npm run build`.
- Browser acceptance: synthetic XLSX orders against the real local catalog,
  automatic RTI/JHN destinations, two bundle lines in a mixed order, blocked
  unknown SKU, global save/reload, and desktop/mobile layout.

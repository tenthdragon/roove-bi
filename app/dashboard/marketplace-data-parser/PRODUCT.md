# Marketplace Data Parser

Internal workspace tool for the operations team to convert marketplace order
exports into a reviewed CSV that can be uploaded to Scalev. The interface uses
Indonesian and the existing Roove BI dashboard design system.

## Product truth

- A marketplace account has one Marketplace and one connected Business.
- Products describe what is sold; SKUs describe the particular bundle purchased.
- Each account can sell several Products. Scalev Stores are destination entities,
  not names for marketplace accounts or Products.
- Choose active destination Stores within account Businesses and map each Product.
- Marketplace SKU codes must equal a unique Scalev bundle identifier in the receiving
  Business. Owned and shared bundles both qualify. Store membership and catalog price
  options never determine eligibility. No guessed names or hardcoded destinations.
- Account + Product rules and configurable combination priorities determine one
  destination Store for the entire order. Every SKU must have Product classification;
  there is no fallback from bundle–Store relationships or a single available Store.
- Warehouse is a global Store setting, selected from connected app master data.
- Prices and quantities come from the marketplace file. No Scalev price selection.
- The whole batch must pass before download; missing/ambiguous bundles, missing
  routes, invalid Warehouses and incomplete Business snapshots block the batch.
- Team configuration is versioned and revalidated on server download. No per-order
  Business, Store, Warehouse, Product or SKU override is supported.
- **Periksa masalah** reads exact codes from the application database. Opening or
  reloading it never calls Scalev. Completed snapshots have no time-based expiry.
- Sharing a verified bundle from another connected Business remains an explicit
  global Scalev action. It stops at receiving-Business availability: no attachment
  to Store, no price option. Unknown owner metadata cannot authorize sharing.
- Explicit full Business sync and sharing require existing catalog management access.
  Both use a shared Business lease. Sync failure blocks export; successful sync
  revalidates every order and clears the previous download confirmation.

## Interface contract

Preserve the incumbent dashboard shell, typography, light/dark tokens, neutral
surfaces, blue actions, native form controls, and Lucide icons. Extend the existing
operational form; this is not a new visual identity or a marketing page.

The first viewport names Marketplace Data Parser and shows its upload → validate
→ download workflow. Configuration opens as progressive sections: accounts,
Store/Warehouse scope, Products/SKU recognition, Product routing, combination
routing, bundle catalog, and couriers. Account creation is an inline form with
human-readable fields; internal account IDs are not displayed as labels.

Use compact tables on desktop, contained horizontal scrolling for comparison
rows on small screens, and single-column forms where applicable. Preserve useful
validation detail, disabled download states, keyboard labels and visible focus.

The repair panel leads with Bundle → Business → Store status, pairing icons and
short text. Store is the read-only mapped destination; missing routing opens global
settings. Use one primary sharing action for selected foreign bundles, with checkboxes
for multi-bundle cases. Preserve exclusions on reload even if one candidate remains.
Keep the marketplace order total visible. Ownership, timestamps, database reload,
explicit Business sync and routing settings live under **Detail & aksi lain**.
Incomplete Business snapshots promote sync; missing or duplicate codes link to the
Business catalog. Keep permissions and partial sharing results visible.

The sidebar label is MP Data Parser. Existing illustrative defaults are replaced
by workspace configuration. Synthetic acceptance fixtures are labeled SYNTHETIC
and are never represented as real customer orders or sent to Scalev.

Detailed semantics and deployment requirements are in
[the runbook](../../../docs/runbooks/marketplace-data-parser.md).

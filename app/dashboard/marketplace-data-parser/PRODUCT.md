# Marketplace Data Parser

Internal workspace tool for the operations team to convert marketplace order
exports into a reviewed CSV that can be uploaded to Scalev. The interface uses
Indonesian and the existing Roove BI dashboard design system.

## Product truth

- A marketplace account has one Marketplace and one connected Business.
- Products describe what is sold; SKUs describe the particular bundle purchased.
- Each account can sell several Products. Scalev Stores are destination entities,
  not names for marketplace accounts or Products.
- Choose Stores within account Businesses before loading their bundle catalog.
- Marketplace SKU codes must equal the Scalev bundle identifier codes. No aliases,
  guessed names, or customer-specific Business/Store/Warehouse names in code.
- Account + Product rules and configurable combination priorities determine one
  destination Store for the whole order. Every item must be available there.
- Warehouse is a global Store setting, selected from connected app master data.
- The whole batch must pass before download; missing or ambiguous bundles cannot
  be skipped. Business and Store are populated automatically.
- Team configuration is versioned. Changes require revalidation, including on
  the server at download. Per-order routing overrides are not supported.
- The existing **Periksa masalah** expansion reads diagnosis from the application catalog and
  offers explicit Scalev repair, without another modal. Show bundle ownership separately from the
  account's receiving Business and Store. Installation and sharing change the
  global Scalev catalog; they never override an order's routing.
- Readable diagnostics distinguish absence from the saved catalog, incomplete syncs,
  duplicate identifiers, availability to the Business, and Store membership.
  A single available price option can be selected automatically; multiple
  options require an explicit choice. These options never change source prices.
- Opening or reloading diagnosis never calls Scalev. Synced data has no time-based
  expiry; metadata missing from older snapshots is labeled unknown. Explicit
  Store sync refreshes known bundle metadata and membership. An unknown SKU
  points to Business catalog sync; it never starts a cross-Business API scan.
- Readers can explicitly sync the catalog; sharing/installation requires the existing
  catalog management permission. Repairs sync the affected Store and revalidate
  the entire batch. Partial failures remain actionable and do not unlock export.

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

The sidebar label is MP Data Parser. Existing illustrative defaults are replaced
by workspace configuration. Synthetic acceptance fixtures are labeled SYNTHETIC
and are never represented as real customer orders or sent to Scalev.

Detailed semantics and deployment requirements are in
[the runbook](../../../docs/runbooks/marketplace-data-parser.md).

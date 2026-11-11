# Marketplace Data Parser

Internal workspace tool for the operations team to convert marketplace order
exports into a reviewed CSV that can be uploaded to Scalev. The interface uses
Indonesian and the existing Roove BI dashboard design system.

## Product truth

- A marketplace account has one Marketplace and one connected Business.
- Products describe what is sold; SKUs describe the particular bundle purchased.
- Each account can sell several Products. Scalev Stores are destination entities,
  not names for marketplace accounts or Products.
- Choose active destination Stores within account Businesses and a Warehouse per Store.
- Marketplace SKU codes must equal a unique Scalev bundle identifier in the receiving
  Business. Owned and shared bundles both qualify. Store membership and catalog price
  options never determine eligibility. No guessed names or hardcoded destinations.
- Exact approved account/Business/bundle decisions take precedence. A unique common
  Store from cached bundle relationships can determine the destination automatically.
  Existing saved Product/combination rules remain usable; they are optional. Missing
  or ambiguous routing requires explicit Store approval, never automatic name guessing.
- Bonus markers require a first approval. Decisions for mixed orders include the
  bundle set and quantities and do not overwrite single-bundle decisions. An invalid
  locked Store requires review; do not silently fall back to a different Store.
- Warehouse is a global Store setting, selected from connected app master data.
- Marketplace source fields are read-only, including SKU, quantity, price, username,
  receipt and source courier. Scalev courier mapping remains configurable. No Scalev
  price selection. SKU comparison preserves case and surrounding whitespace.
- The whole batch must pass before download; missing/ambiguous bundles, missing
  routes, invalid Warehouses and incomplete Business snapshots block the batch.
- Team configuration and global routing decisions are versioned and revalidated on
  server download. Inline Store approval creates a reusable decision with actor/time.
- Archive the original XLSX and parsed source before preview. Each successful export
  adds a separate CSV and parsing snapshot; opening a batch never replaces old output.
  Files are private and workspace-scoped. Server export uses archived source only.
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

The main order row shows buyer username, tracking receipt, original and mapped
courier, exact bundle, Store and validation. A compact **Pilih Store** control
searches only selected active Stores in the account Business and shows at most six
results. **Gunakan & simpan** records the decision for future matching cases. Keep
history collapsed and source rows read-only under **Detail**. Missing/duplicate
bundles show a short inline Scalev link; foreign bundles retain explicit sharing.
Do not force a large diagnostic panel for routine Store selection.

**Riwayat batch** exposes the original file, reopening the batch, and each export's
CSV and parsing snapshot. Unknown/incomplete catalog data must not claim that a
bundle needs creating; direct the operator to catalog sync instead.

The sidebar label is MP Data Parser. Existing illustrative defaults are replaced
by workspace configuration. Synthetic acceptance fixtures are labeled SYNTHETIC
and are never represented as real customer orders or sent to Scalev.

Detailed semantics and deployment requirements are in
[the runbook](../../../docs/runbooks/marketplace-data-parser.md).

# ScaleV financial corrections

Migration 246 adds a database mechanism; it does **not** correct any existing
order or add an editing screen. Apply the reviewed migration before deploying
the application changes. Do not apply older migrations again. This feature has
not been deployed merely by adding these files.

The original `raw_data` payload is never rewritten. Existing monetary columns
are the effective values used by BI. For each explicitly corrected field,
`scalev_financial_corrections` keeps the first original value, latest incoming
source value, manual value and active flag. Fields without corrections incur
no source-copy storage. Status, quantity, timestamps and inventory fields are
not override targets.

Supported header fields: `gross_revenue`, `net_revenue`, `shipping_cost`,
`shipping_discount`, `discount_code_discount`, `unique_code_discount`.
Supported line fields: `product_price_bt`, `discount_bt`, `cogs_bt`.
Other fee fields present only inside the raw provider payload are preserved,
but not editable through this mechanism. `_bt` values are before tax; submit
reviewed two-decimal amounts, never infer a multiplier for every money field.
Price, discount, revenue, tax treatment and HPP must be reconciled together
when required; the mechanism intentionally does not guess business formulas.

## Save and deactivate

Call `set_scalev_financial_corrections` with:

```json
{
  "p_workspace_id": "workspace UUID",
  "p_order_id": 123,
  "p_expected_version": 0,
  "p_reason": "Corrected decimal input; reconciled to marketplace export",
  "p_changes": [
    {"entity":"order", "field":"net_revenue", "amount":525000},
    {"entity":"line", "line_key":"Exact product_name", "field":"discount_bt", "amount":238738.74}
  ]
}
```

This is illustrative, not an instruction to apply those numbers to a real order.
The authenticated actor must be an active owner/admin of the same workspace.
For authorized operator jobs, service-role calls must supply `p_actor_id` for
an active owner/admin who instructed the correction. Record that operator
context in the reason; never attribute a correction without authorization.
Authenticated callers cannot impersonate another actor. Direct table writes
are revoked, including for service_role; use the RPC.

All fields in one call commit or roll back together, including audit and the
existing summary triggers. Each successful call increments the order version.
Read `getScalevFinancialCorrections` before editing and use its version; stale
edits fail. Retry transient database deadlocks as in `withScalevLineRetry`.
An uncertain network result must be reconciled against version/audit before
retrying; no blind resubmission with a fresh version.

Deactivate a field using the same target and `"active":false`, with the latest
expected version and a new reason. This restores the **latest** source amount,
including NULL for nullable source columns, not the initial snapshot. History
is never deleted. Corrections for removed product lines can be deactivated too.

## Synchronization and reporting

Per-field AFTER INSERT/UPDATE OF triggers capture raw incoming values and apply
an active override in the same database transaction. AFTER timing is necessary
for upserts: BEFORE INSERT would rewrite `EXCLUDED` and corrupt the saved source.
Internal projection updates use a scoped transaction-local recursion guard and
do not capture the manual value as the source. Normal summary triggers run on
the source write and the correcting update, leaving the final effective totals.
Read the row again after an upsert if the caller needs the effective value;
PostgreSQL RETURNING reflects the initial write before AFTER-trigger projection.

Line identity follows ingestion's `(scalev_order_id, product_name)` key, so
delete/reinsert of that product retains its correction. Renaming/moving a tracked
line is rejected for explicit reconciliation; a corrected order cannot move
workspaces or be hard-deleted. Financial corrections never create warehouse
transactions or change shipment state themselves. Test the full application
summary/warehouse trigger set in the existing local test database before release.

The server action revalidates CM3/shipping cache tags after saving. A database
revision per workspace also participates in the historical CM3 cache key, so
operator RPC calls invalidate historical CM3 on the next server request.
Already-open browser views still need reload (their in-memory cache lasts five
minutes). No full app restart is needed for future corrections with this code.

## Verification / release

`node tests/scalev-financial-corrections-database.mjs` uses a disposable database
in the existing local Supabase container; `--ci` uses the CI Postgres container.
Without Docker, install `@electric-sql/pglite` in a temporary directory and set
`PGLITE_MODULE` to its absolute `dist/index.js` path. The in-memory suite tests
PL/pgSQL, upserts, partial writes, HPP, cancellation, source preservation, summary
deltas, tenant/actor checks, atomic rollback and version conflicts. It is not a
multi-session concurrency or full production-schema test.

Before release, inspect live triggers for their ordering: the projection names
start with `zzzz_` so existing `trg_` summary callbacks run before correction.
Inspect migration history and reserve 246 if main has advanced. Apply only 246
under the normal release process, then deploy the app revision. Do not run the
November 7 correction until every amount, including the separate Pluve case,
has been reviewed. Disable active corrections via RPC before reverting this
migration; dropping tables alone would lose the originals needed for restoration.

# MCP dimension contract v2

## Evidence and relationships

Inspected on 22 October 2026: live MCP funnel catalog + daily spend drilldown,
canonical migrations 163/164, 028/117, 181/182, 237, and read-only queries against
the local BI snapshot. The live pre-v2 MCP does not expose master businesses,
stores or roles; those relationships are verified from schema/source and the
local snapshot, not claimed as a full production master-table audit.

| Dimension | Identity / relationship | Marketing meaning |
| --- | --- | --- |
| Workspace | `workspaces.id`, token-bound | Tenant, not a brand or business |
| Business | `scalev_webhook_businesses.id`, `business_code` | Only recorded spend `business_code` is attribution |
| Brand | `brands.id`, scoped to workspace | Spend `brand_id` is frozen on ingestion |
| Business–brand | `business_brand_roles` | Many-to-many owner/seller/operator; not spend allocation |
| Operational store | `scalev_store_channels.id` → `business_id` | No direct store→brand FK; names can repeat across businesses |
| Alias | provider + type + normalized name → brand | A store-type alias is not an operational store FK |
| Legacy spend `store` | Text label, e.g. Roove, Plume, Pluve | Not a store ID or reliable canonical brand filter |

Live observations: Plume and Pluve labels occur on accounts catalogued to canonical
brand Pluve (3); Roove is brand 1. All nine spend rows returned for 2026-10-21 had
null business_code. The snapshot has distinct Main Store (28) and Extra Store (59)
under RTI and duplicate Main Store - Marketplace names under RTI/RLT. These store
IDs are **not** hardcoded into tools or assumed to be verified production IDs.
Some historical migrations are absent from the reduced local schema (e.g. external
Scalev identifiers); v2 depends only on common canonical columns. No snapshot or
production schema/data was changed during development; migration tests use an
empty disposable fixture DB.

## Tool behavior

Existing five-tool allowlist is unchanged. Catalog adds `schema_version:2`,
workspace, businesses, stores, business_brand_roles, brand_aliases and semantics.
Includes inactive identities for historical queries; alias resolution must use
active, unambiguous provider/type matches. No API key, webhook secret, workspace
settings or customer fields are exposed.

Both spend tools accept canonical `brand_id` (string), exact `business_code`,
optional workspace assertion, and exact source/ad_account. Combined dimensions
are ANDed deterministically before totals/grouping. Meta means `meta_api` across
all source labels. No fuzzy label filtering. `store` is rejected; valid operational
`store_id` returns `unsupported_dimension`, `totals:null`. Invalid/out-of-workspace
identities fail closed. Funnel rejects business/store scopes and echoes its
effective brand; it uses **current account defaults**, unlike historical spend.

`status`: `ok`, `partial_attribution`, `unavailable_attribution`, `no_rows`, or
`unsupported_dimension`. Unknown attribution counts include potentially relevant
rows with missing/unrecognized canonical identities. Partial totals describe only
attributed rows. Null totals/no rows are not zero. Status `ok` only means the
selected rows were aggregated; it does not prove ingestion completeness.

Spend results remove misleading configured_store/observed_stores/account-ID joins
by account name; accounts are explicitly historical labels. `by_store` becomes
`by_legacy_store_label`. Totals and per-account ratios are server-calculated.
Date windows are validated (max 93 days). Exact count + stable-ID pagination handles
PostgREST caps; missing pages/count, detected changes, errors or >50,000 rows fail
without returning partial totals. Reads are not a transactional snapshot; count
checks cannot detect an in-place update that keeps row count/IDs unchanged.

## Verification and release

Run `npm run check:mcp`, `npm run test:mcp-dimensions`,
`npm run test:mcp-reader-db`, app typecheck, lint and build. DB fixture applies
237/238 twice and verifies tenant isolation, broken cross-tenant references,
secret exclusions, absent JWTs and read-only grants. CI runs both suites.

After review and explicit deployment authorization: inspect production migration
history; apply **only new migration 238** if 237 is already installed, deploy MCP,
then promptly deploy the companion rti-basecamp-agent prompt. Old prompts/clients
using store labels are intentionally incompatible. No data backfill is included.
Verify live catalog identities, scoped totals/status and tenant boundary before
accepting the agent's ten-case smoke suite; reconcile its historical numeric
baseline against canonical tool results, never against model output. Roll back
MCP + agent together if needed; the additive views may remain in place.

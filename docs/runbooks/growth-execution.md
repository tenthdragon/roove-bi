# Growth Execution P0

Implementation branch: `codex/growth-execution-p0`. Module ID: `growth-work`.

The domain references are the PRD Growth Execution P0 and both Growth Lead v1.2
documents in `Workstation Doc`. Illustrative business amounts in those documents
are not defaults. P0 runs entirely inside Roove BI, without Telegram or AI jobs.

## Architecture

- `/dashboard/growth-work?tab=overview|priorities|work-board|experiments|decisions|weekly-review`
  is one route. `item=<UUID>` opens a scoped detail; My Work filters the same rows.
- `growth_records` is the shared identity and transaction boundary. The thirteen
  named entity views (`growth_work_items`, `growth_experiments`, etc.) use
  `security_invoker=true`, so their reads apply the same RLS. This avoids unsafe
  polymorphic UUID links between independent tables: parent references have a
  composite workspace/portfolio FK; JSON links are validated by type and scope.
- Portfolios, memberships, normalized membership brands, immutable mandate
  versions, append-only audit events, request deduplication and server BI
  snapshots use separate tables. Each work mutation supplies object ID, expected
  row version and request ID. Quota/prerequisite/decision checks hold a portfolio
  row lock. The mutation, version and audit commit together.
- Authenticated clients have SELECT only. `growth_save_record`,
  `growth_archive_record` and `growth_configure` derive their actor from
  `auth.uid()`. A service credential cannot be substituted for the user to call
  these functions. BI service access happens only after module, permission,
  membership and scope checks; only server BI snapshot insertion uses service
  credentials. Client-supplied financial snapshots are discarded.
- Work authorization does not imply BI or financial-target authorization.
  Owners have technical permissions but still need a Growth membership and
  business mandate. `own_or_involved` gets scoped records and minimal parent
  context, not hidden team objects or weekly finance snapshots.
- Financial targets reuse the existing private resolver and weighted benchmark;
  Growth has no write path to them. Marketing and Growth share the CM3 formula
  and ad-brand resolver. Growth aggregates the same active-brand data sources
  with paginated server reads; ROAS is revenue / aggregate spend.

## Apply to a pilot environment

1. Apply migration `195_growth_execution.sql` through the project's normal
   migration process in a non-production environment first. It is additive and
   does not grant permissions or activate any workspace. Workspaces that lack
   `settings.growth_execution_enabled=true` cannot access the module, including
   newly provisioned workspaces. An existing `disabled_modules` entry wins over
   that opt-in.
2. Choose the exact workspace. Enable its module with an administrator-controlled
   workspace settings change. For example, after replacing the placeholder with
   a verified UUID:

   ```sql
   UPDATE public.workspaces
   SET settings = settings || jsonb_build_object('growth_execution_enabled', true)
   WHERE id = '<verified-pilot-workspace-uuid>'::uuid;
   ```

   If `disabled_modules` contains `growth-work`, remove only that entry while
   preserving all other module settings. No enabling operation is performed by
   the branch implementation or tests.

3. In Admin's workspace permission matrix, assign `tab:growth-work` plus only the
   needed action keys. Existing role `brand_manager` displays as **Growth Lead**;
   its stored role code and existing permissions are unchanged.
4. Use Growth Execution → Konfigurasi to create a portfolio and memberships.
   Select existing active workspace people. Set functions, effective dates,
   visibility, company/brand scope, and `managed_functions`. A Growth Lead may
   manage creative/acquisition; including Sales requires an explicit handover.
   A role permission alone does not assign membership or expand its scope.
5. Create mandate versions for each decision owner, domain, canonical brand,
   allowed action codes, budget ceiling, effective dates and rationale. No
   ceiling is inferred. A null ceiling permits only zero-value decisions.
   Financially material actions require an explicit amount within the mandate.
   Goals use `cross_function / approve_goal`. Experiment start checks
   `growth_media / <action code from its brief>` and its budget.
6. Configure operational goals and experiment evidence/guardrail rules from
   actual company decisions. Financial target values remain in Financial
   Settings. Record real work only after access and scope checks pass.

Suggested technical permissions (membership and mandate remain separate):

| Actor                       | Technical permissions                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Growth Lead                 | tab, team-read, manage, update-own, review, decide, weekly-finalize; metrics-read and financial-target-read if authorized |
| Creative / acquisition PIC  | tab, update-own; review only for appointed reviewers                                                                      |
| Sales decision owner        | tab, update-own, decide; team-read only where approved                                                                    |
| CEO                         | tab, team-read, decide, update-own for comments; metrics/financial-target reads where approved                            |
| Configuration administrator | tab, configure; other rights are explicit                                                                                 |

## Core workflow

Activate up to three priorities for the portfolio. Blocked priorities keep a
slot; pause with a reason to release one. A work item can begin as draft. Before
assignment, supply one PIC, deadline, criteria, reviewer and parent priority or
operational category. The PIC accepts the assignment, works, and adds evidence
for its output version before review. The appointed reviewer accepts the output
or sends feedback; revision increments the output version and requires fresh
evidence. An accepted output still requires a separate deployment record.

A Sales dependency begins as a request. Only its recipient can commit/decline
it. Commitment requires PIC, deadline and acceptance criteria. Fulfillment needs
evidence. Growth cannot infer acceptance from silence or a deadline.

Prepare an experiment's hypothesis, comparator, cohort, confounders, primary and
diagnostic metrics, evidence/success rules, guardrails, dates and budget. Start
only with a valid mandate and explicit prerequisite deployment/fulfilled
dependency IDs. The required list represents the exact approved design; a
partial run must document `partial_design` and its applicable prerequisites.
Record mature/immature/inconclusive results and limitations. Failure is valid.
Scale requires mature success and a positive denominator. Final experiment
closure links to a decided follow-up decision.

For decisions outside the actor's mandate, submit to an authorized recipient.
The recipient can request more information without ending the request, then
decide under their mandate. A decision is immutable after deciding; implementation
state is separate and `implemented` requires evidence. Superseding decisions
preserve the previous record. Incidents progress through open, contained,
resolved and closed with evidence, review and prevention.

Weekly reviews use an explicit Monday work week and WIB cutoff. The server
captures BI plus target versions and reconstructs work records as of the cutoff
from the audit log. BI sources are daily, so the snapshot includes complete WIB
days before the cutoff day; that policy is shown explicitly. Historical BI
recomputations are captured at `computed_at`, not presented as a source's
historical ingestion timestamp. Source freshness is marked unverified rather
than invented. Missing tables/rows/errors show N/A/partial/error, never zero.

Draft/refresh preserves the user's diagnosis, learning, forecast and commitments.
Growth alone finalizes after recording Sales alignment and data completeness.
Final snapshots cannot be rewritten. A correction creates a new review with
`supersedes_id` and a reason. CEO comments are separate event updates.

## Verification

```sh
npm run test:growth
npm run test:dashboard-components
npm run test:financial-targets
npm run typecheck:app
npm run lint
npm run build
```

For isolated PostgreSQL tests install `@electric-sql/pglite` in a temporary
directory, then:

```sh
PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node --test tests/growth-database.mjs
```

The database suite executes migration 195 on a minimal tenancy fixture, real
PostgreSQL RLS, JWT actor switching, revoked table writes and the transactional
RPCs. It verifies quota, conflicts/idempotency, scoped links, acknowledgment,
review/version/evidence/deployment, Sales commitment, mandate decisions,
experiment maturity, server snapshot provenance, final/revision/archive,
inactive actors and module disable. It does not claim production data parity or
independent PostgreSQL connection contention testing.

`node scripts/growth-ui-preview.mjs` bundles the real client component with local
fixture actions and serves `127.0.0.1:3127`. Its examples stay in browser memory;
the fixture is not imported by the application route. Use it for layout,
keyboard/mobile, navigation, search/filter/board, detail and form QA.

Growth uses the existing application's `--card`, `--text`, `--input-bg` and
`--accent` theme tokens, Warehouse-style tabs and Marketing-style KPI cards.
Both the application layout and local fixture now import the same DashboardFrame,
DashboardNavigation and WorkspaceSwitcher components extracted from the existing
layout. Marketing and Growth both render DashboardMetricCard. The fixture also
compiles the actual global stylesheet through the same Tailwind/PostCSS reset,
and imports ThemeProvider, ThemeToggle and ALL_TABS. No independent dashboard
shell remains. Production Growth stays inside the authenticated dashboard layout.

Only the fixture's workspace context is replaced by an esbuild alias to
tests/fixtures/growth-workspace.tsx. Its selector switches between two explicitly
labelled sample workspaces in browser memory; the second has Growth disabled.
It never POSTs to the real workspace API. Other modules and logout remain
unavailable in the isolated fixture. This is visual/component verification,
not a staging deployment with real login or workspace memberships.

Before pilot activation, repeat PRD AC01–AC38 against the full migrated staging
schema and real user JWTs. Use independent connections for competing priority
activations and duplicate decision responses; validate actual Supabase grants,
workspace switches, source freshness, target effective versions and metric
parity for company/brand/date scopes. Embedded fixture tests and client fixture
QA do not replace those staging checks. Run two real weekly cycles to evaluate
coordination quality and manual status-request reduction.

## Rollback

Set the exact pilot workspace's `settings.growth_execution_enabled` to false,
or add `growth-work` to its existing disabled-module list. All Growth reads and
mutations then fail the module gate and navigation hides the menu. Preserve
Growth tables, audit, mandate versions and final snapshots. Deploy the prior
application commit if needed; no legacy business data or sync jobs require
rollback. Do not drop Growth records to disable the feature.

## Current verification limits

- The branch does not apply a migration to a remote database, grant permissions,
  enable a pilot, deploy, or seed production work.
- BI source freshness is explicit but unverified until upstream sources expose
  reliable ingestion timestamps. Missing spend/fee rows remain unavailable even
  where absence might represent a genuine zero; an operator must confirm source
  completeness in the review.
- The financial target is company/month scoped. A brand or non-month scope
  shows no matching financial target. No new monthly linear-prorata rule is used.
- Fixed thresholds/sample sizes and real mandates remain business configuration.

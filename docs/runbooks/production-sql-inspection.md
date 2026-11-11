# Production SQL inspection

Run from a checkout after `npm ci --include=dev`:

```sh
node scripts/production-sql-readonly.mjs "select count(*) from public.tax_counterparties"
node scripts/production-sql-readonly.mjs --file query.sql --limit 50 --json
```

This is a **trusted-operator inspection helper**, not a sandbox for SQL supplied
by an untrusted person, document, website or model output. The Management API
credential retains its existing privileges. It is read from the Supabase CLI
keychain and never printed; no new database role, grant or migration is installed.

The PostgreSQL 17 parser validates one SELECT (including WITH, TABLE and VALUES),
plain EXPLAIN of SELECT, or SHOW before credential lookup/network access. It
rejects writes, data-changing CTEs, SELECT INTO, row locks, every ANALYZE option
(including quoted/Unicode spellings), and unsupported syntax-tree constructs.
Comments, operators and literal whitespace retain their original bytes. A
newline separates the supplied SQL from the result-limit wrapper.

Explicit function calls must be reviewed pg_catalog functions. Unqualified
function and type names are pinned to pg_catalog to avoid public-schema
overloads. Only builtin casts are supported. Computed-field syntax is refused:
PostgreSQL can interpret `(value).function` and `alias.function` as function calls.
For this reason **qualified column references are also refused**; use unqualified
columns, CTE column lists, subqueries with distinct column names, or `alias.*`.
Schema-qualified table names such as `public.tax_counterparties` are supported.

The server-side `read_only: true` transaction is retained. Neither it nor syntax
validation audits database definitions: views, RLS policies, custom data types,
implicit casts/operators and foreign tables can execute code while being read.
Use only trusted database objects. This helper does not provide a security
boundary for hostile SQL or schemas; that requires database-enforced privileges
and an independently audited execution surface.

`--limit` must be an integer between 1 and 2000 (default 200). Input is limited to
64 KiB. Cells are clipped at 2,000 characters and displayed output at 256 KiB.
JSON remains parseable when clipped and reports output truncation. These are
**display limits**, not limits on scanned rows, query cost, data access or bytes
received from the server. Aggregates may still read many records.

Verification:

```sh
npm run test:production-sql-readonly
npm run test:production-sql-readonly-db
```

The database suite creates and deletes its own PostgreSQL 17 container with no
network or published port. It never uses the local Supabase snapshot or production.
It proves the old advisory-lock expression has a side effect even in READ ONLY,
then checks its refusal, operator/CTE execution, plan-only EXPLAIN, and isolation
from a deliberately installed public.lower(integer) overload.

Reference: [Supabase query read-only limitations](https://supabase.com/docs/reference/cli/supabase-db-query)
and [PostgreSQL function resolution](https://www.postgresql.org/docs/17/typeconv-func.html).

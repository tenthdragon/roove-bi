# Isolated local development

Use `npm run dev:local`, not plain `npm run dev`, when developing against the
local copy of Roove BI. It binds the app to `127.0.0.1:3130`, uses local Supabase
at `127.0.0.1:54321`, masks dotenv integration secrets and blocks external
fetch/HTTP calls. No production sync worker or webhook forwarding is started.

## Existing verified clone

The current machine already has an activated production snapshot under ignored
`.local/clone-state.json`. Existing accounts/data and feature overlays are kept.

```sh
npm run db:local:status
npm run db:local:verify
npm run dev:local
```

If stopped, use `npm run db:local:start`. `npm run db:local:stop` stops the fixed
project without deleting data. Login uses snapshot accounts with separate local
sessions. Edits/test writes do not flow back to production; the snapshot is not
automatically refreshed when production changes.

Historical setup/migrate/seed operations refuse an activated clone. Apply only
one deliberately reviewed new migration, when needed:

```sh
npm run db:local:migration -- <reviewed-new-migration.sql>
```

The runner records filename/checksum and refuses changed applied SQL. Do not
rename historical Growth/Shopee migrations already present locally. Feature
overlays are not evidence that their old migrations should replay in production.

## Fresh fixture-only setup

On a new machine with Node 20+, Supabase CLI and Docker, `db:local:setup` creates
an isolated fixture database from adapted historical source migrations. The
generic seed creates an owner/two workspaces with integrations disabled; it
does not seed unfinished Growth or Shopee features. Credentials remain in
`.local/login.json` and must never be committed. A fresh full historical
bootstrap is not part of the routine unit-test checks. Do not run setup over an
existing unverified database to repair it.

## Multiple worktrees

Each agent uses its own branch/worktree. The fixed local Supabase project and
default app port are shared unless separately provisioned. Use the primary
checkout to manage the stack and deliberately link a feature worktree's ignored
`.local` directory to existing state if needed. Coordinate database writes;
never run setup/clone activation in a second worktree with missing metadata.

## Clone and verification tools

The retained `local-clone-*` tools support deliberate read-only production export
and verified local restoration. They are not needed for each code change.
Private access settings, Auth data, archives and snapshots remain in `.local/`.
Source access is read-only and pinned to the existing project. Restoration
writes only to the fixed local container. Activation refuses an existing active
clone; it must not overwrite the current developer database. Do not reset
production credentials to clone.

Run `npm run test:local-supabase` for guards/adapters. With the local app running,
`node scripts/local-clone-smoke.mjs` checks local Auth, workspace switching and
authenticated dashboard reads and restores the owner's preference afterward.
Feature-specific acceptance tests belong to their feature branch.

// Run against an isolated embedded PostgreSQL, never a remote Supabase database.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node --test tests/growth-database.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const modulePath = process.env.PGLITE_MODULE;
test(
  "Growth RPC, RLS, immutability, quota and retry invariants",
  { skip: !modulePath },
  async (t) => {
    const { PGlite } = await import(modulePath);
    const db = new PGlite();
    const w = randomUUID(),
      w2 = randomUUID(),
      growth = randomUUID(),
      creative = randomUUID(),
      reviewer = randomUUID(),
      sales = randomUUID(),
      ceo = randomUUID();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE public.workspaces(id uuid PRIMARY KEY,status text,settings jsonb);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text);
    CREATE TABLE public.workspace_memberships(workspace_id uuid,user_id uuid,role text,status text);
    CREATE TABLE public.workspace_role_permissions(workspace_id uuid,role text,permission_key text);
    CREATE TABLE public.brands(id integer,workspace_id uuid,name text,UNIQUE(workspace_id,id));
    CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND role='owner')$$;
    CREATE FUNCTION public.workspace_has_membership(w uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=w AND user_id=u AND status='active')$$;
    CREATE FUNCTION public.workspace_has_role(w uuid,r text[]) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=w AND user_id=auth.uid() AND status='active' AND role=ANY(r))$$;`);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/195_growth_execution.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const workspace of [w, w2])
      await db.query(
        "INSERT INTO workspaces VALUES($1,'active','{\"growth_execution_enabled\":true}')",
        [workspace],
      );
    const permissions = [
      "tab:growth-work",
      "growth:team-read",
      "growth:manage",
      "growth:update-own",
      "growth:review",
      "growth:decide",
      "growth:weekly-finalize",
      "growth:configure",
      "growth:metrics-read",
      "growth:financial-target-read",
    ];
    for (const [id, role] of [
      [growth, "growth"],
      [creative, "creative"],
      [reviewer, "reviewer"],
      [sales, "sales"],
      [ceo, "ceo"],
    ]) {
      await db.query("INSERT INTO auth.users VALUES($1);", [id]);
      await db.query("INSERT INTO profiles VALUES($1,$2)", [id, role]);
      await db.query(
        "INSERT INTO workspace_memberships VALUES($1,$2,$3,'active')",
        [w, id, role],
      );
      for (const permission of id === creative
        ? ["tab:growth-work", "growth:update-own"]
        : permissions)
        await db.query(
          "INSERT INTO workspace_role_permissions VALUES($1,$2,$3)",
          [w, role, permission],
        );
    }
    const login = async (user) => {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
        user,
      ]);
    };
    const rpc = async (name, args) => {
      const placeholders = args.map((_, i) => "$" + (i + 1)).join(",");
      return (
        await db.query(`SELECT public.${name}(${placeholders}) AS result`, args)
      ).rows[0].result;
    };
    const configure = async (
      kind,
      p,
      id,
      input,
      version = 0,
      request = randomUUID(),
    ) =>
      rpc("growth_configure", [
        w,
        p,
        id,
        version,
        request,
        kind,
        JSON.stringify(input),
      ]);
    const save = async (
      input,
      version = 0,
      id = randomUUID(),
      request = randomUUID(),
      workspace = w,
      portfolio = p,
    ) =>
      rpc("growth_save_record", [
        workspace,
        portfolio,
        id,
        version,
        request,
        JSON.stringify(input),
      ]);
    await login(growth);
    const p = randomUUID();
    await configure("portfolio", null, p, { name: "Pilot" });
    for (const [user, functions, visibility] of [
      [growth, ["growth"], "team"],
      [creative, ["creative"], "own_or_involved"],
      [reviewer, ["creative"], "team"],
      [sales, ["sales"], "team"],
      [ceo, ["ceo"], "team"],
    ])
      await configure("membership", p, randomUUID(), {
        user_id: user,
        functions,
        visibility_mode: visibility,
        managed_functions: ["growth", "creative", "acquisition", "sales"],
        company_scope: true,
      });
    const basic = {
      kind: "priority",
      title: "P",
      status: "active",
      pic_id: growth,
      payload: { diagnosis: "Bukti funnel", success_criteria: "CM3 sehat" },
    };
    await t.test(
      "portfolio quota counts blocked and rejects a fourth priority",
      async () => {
        for (let i = 0; i < 3; i++) await save(basic);
        await assert.rejects(save(basic), /Maksimal tiga/);
      },
    );
    await t.test(
      "idempotent retry returns original result; changed payload conflicts",
      async () => {
        const id = randomUUID(),
          request = randomUUID();
        const draft = { ...basic, status: "draft" };
        const first = await save(draft, 0, id, request);
        const second = await save(draft, 0, id, request);
        assert.deepEqual(second, first);
        await assert.rejects(
          save({ ...draft, title: "Different" }, 0, id, request),
          /Idempotency/,
        );
        await assert.rejects(save(draft, 0, id), /Conflict/);
        const audit = await db.query(
          "SELECT count(*)::integer AS n FROM growth_audit_events WHERE object_id=$1",
          [id],
        );
        assert.equal(audit.rows[0].n, 1);
      },
    );
    await t.test(
      "quick draft can be linked and assigned later by its Growth creator",
      async () => {
        await login(growth);
        let draft = await save({
          kind: "work",
          title: "Quick draft",
          status: "draft",
          pic_id: growth,
          payload: {},
        });
        const priority = (
          await db.query(
            "SELECT id FROM growth_records WHERE kind='priority' AND status='active' LIMIT 1",
          )
        ).rows[0].id;
        draft = await save(
          {
            ...draft,
            status: "assigned",
            pic_id: creative,
            reviewer_id: reviewer,
            parent_id: priority,
            due_at: "2026-12-20T00:00:00Z",
            payload: { acceptance_criteria: "Claim valid" },
          },
          draft.row_version,
          draft.id,
        );
        assert.equal(draft.payload.acknowledgment, "pending");
        assert.equal(draft.parent_id, priority);
      },
    );
    let task;
    await t.test(
      "PIC acknowledgment, evidence version, separate acceptance and deployment",
      async () => {
        task = await save({
          kind: "work",
          title: "Asset",
          status: "assigned",
          pic_id: creative,
          reviewer_id: reviewer,
          due_at: "2026-10-20T23:59:59+07:00",
          payload: {
            operational_category: "Creative",
            acceptance_criteria: "Claim valid",
          },
        });
        await login(creative);
        task = await save(
          { ...task, payload: { ...task.payload, acknowledgment: "accepted" } },
          task.row_version,
          task.id,
        );
        task = await save(
          { ...task, status: "in_progress" },
          task.row_version,
          task.id,
        );
        await assert.rejects(
          save({ ...task, status: "review" }, task.row_version, task.id),
          /Bukti/,
        );
        const evidence = await save({
          kind: "evidence",
          title: "Asset v1",
          status: "recorded",
          parent_id: task.id,
          payload: {
            evidence_type: "text",
            reference: "Approved asset reference",
            captured_at: new Date().toISOString(),
            output_version: 1,
          },
        });
        task = await save(
          { ...task, status: "review" },
          task.row_version,
          task.id,
        );
        await assert.rejects(
          save({ ...task, status: "accepted" }, task.row_version, task.id),
          /Forbidden|Reviewer/,
        );
        await login(reviewer);
        task = await save(
          { ...task, status: "accepted" },
          task.row_version,
          task.id,
        );
        assert.equal(task.status, "accepted");
        assert.equal(task.payload.acknowledgment, "accepted");
        await login(creative);
        await save({
          kind: "deployment",
          title: "Live ad",
          status: "deployed",
          parent_id: task.id,
          payload: {
            evidence_id: evidence.id,
            platform: "Meta",
            external_id: "AD-1",
            deployed_at: new Date().toISOString(),
          },
        });
      },
    );
    await t.test(
      "RLS never exposes unrelated tasks and own parent context is minimal",
      async () => {
        await login(growth);
        const priority = (
          await db.query(
            "SELECT id FROM growth_records WHERE kind='priority' LIMIT 1",
          )
        ).rows[0].id;
        const other = await save({
          kind: "work",
          title: "Unrelated",
          status: "draft",
          pic_id: sales,
          parent_id: priority,
          payload: {},
        });
        let own = await save({
          kind: "work",
          title: "Assigned",
          status: "assigned",
          pic_id: creative,
          reviewer_id: reviewer,
          due_at: "2026-12-20T00:00:00Z",
          parent_id: priority,
          payload: { acceptance_criteria: "Claim valid" },
        });
        await login(creative);
        await db.exec("SET ROLE authenticated");
        assert.equal(
          (
            await db.query("SELECT id FROM growth_records WHERE id=$1", [
              other.id,
            ])
          ).rows.length,
          0,
        );
        assert.equal(
          (
            await db.query("SELECT id FROM growth_records WHERE id=$1", [
              own.id,
            ])
          ).rows.length,
          1,
        );
        const context = await rpc("growth_parent_context", [own.id]);
        assert.equal(context.id, priority);
        assert.equal(context.payload, undefined);
        await assert.rejects(
          db.query("UPDATE growth_records SET title='Hack' WHERE id=$1", [
            own.id,
          ]),
          /permission denied/,
        );
        await db.exec("RESET ROLE");
        own = await save(
          { ...own, payload: { ...own.payload, acknowledgment: "accepted" } },
          own.row_version,
          own.id,
        );
        assert.equal(own.payload.acknowledgment, "accepted");
      },
    );
    await t.test(
      "request decisions require the authorized recipient and mandate; immutable response",
      async () => {
        await login(growth);
        await configure("mandate", p, randomUUID(), {
          actor_id: sales,
          domain: "sales_commercial",
          allowed_actions: ["offer"],
          max_amount: 100,
          rationale: "Delegasi Sales",
          effective_from: "2026-01-01T00:00:00Z",
        });
        let decision = await save({
          kind: "decision",
          title: "Offer",
          status: "draft",
          recipient_id: sales,
          due_at: "2026-10-20T00:00:00Z",
          payload: {
            domain: "sales_commercial",
            action: "offer",
            amount: 50,
            question: "Voucher?",
            options: "A/B",
          },
        });
        decision = await save(
          { ...decision, status: "requested" },
          decision.row_version,
          decision.id,
        );
        await assert.rejects(
          save(
            {
              ...decision,
              status: "decided",
              payload: {
                ...decision.payload,
                outcome: "approved",
                rationale: "yes",
              },
            },
            decision.row_version,
            decision.id,
          ),
          /penerima/,
        );
        await login(sales);
        decision = await save(
          {
            ...decision,
            status: "decided",
            payload: {
              ...decision.payload,
              outcome: "approved",
              rationale: "Valid",
            },
          },
          decision.row_version,
          decision.id,
        );
        assert.equal(decision.payload.execution_state, "not_started");
        await assert.rejects(
          save(
            {
              ...decision,
              payload: { ...decision.payload, outcome: "rejected" },
            },
            decision.row_version,
            decision.id,
          ),
          /immutable/,
        );
        await assert.rejects(
          save(
            {
              ...decision,
              payload: { ...decision.payload, execution_state: "implemented" },
            },
            decision.row_version,
            decision.id,
          ),
          /bukti/,
        );
      },
    );
    await t.test(
      "review feedback creates a new output version; stale evidence cannot accept it",
      async () => {
        await login(growth);
        let task = await save({
          kind: "work",
          title: "Revisable",
          status: "assigned",
          pic_id: creative,
          reviewer_id: reviewer,
          due_at: "2026-12-20T00:00:00Z",
          payload: {
            operational_category: "Creative",
            acceptance_criteria: "Claim valid",
          },
        });
        await login(creative);
        task = await save(
          {
            ...task,
            payload: { ...task.payload, acknowledgment: "accepted" },
            status: "in_progress",
          },
          task.row_version,
          task.id,
        );
        await save({
          kind: "evidence",
          title: "Version 1",
          status: "recorded",
          parent_id: task.id,
          payload: {
            evidence_type: "text",
            reference: "v1",
            captured_at: new Date().toISOString(),
            output_version: 1,
          },
        });
        task = await save(
          { ...task, status: "review" },
          task.row_version,
          task.id,
        );
        await login(reviewer);
        task = await save(
          {
            ...task,
            status: "in_progress",
            payload: { ...task.payload, review_feedback: "Perbaiki claim" },
          },
          task.row_version,
          task.id,
        );
        assert.equal(task.payload.output_version, 2);
        await login(creative);
        await assert.rejects(
          save({ ...task, status: "review" }, task.row_version, task.id),
          /Bukti versi/,
        );
      },
    );
    await t.test(
      "blockers preserve prior status and prevent silent resume to a later stage",
      async () => {
        await login(growth);
        let priority = (
          await db.query(
            "SELECT * FROM growth_records WHERE kind='priority' AND status='active' LIMIT 1",
          )
        ).rows[0];
        priority = await save(
          {
            ...priority,
            status: "blocked",
            blocker_owner_id: sales,
            payload: {
              ...priority.payload,
              blocker_reason: "Stockout",
              action_needed: "Konfirmasi stok",
              impact: "Traffic berhenti",
              follow_up_at: "2026-12-20T00:00:00Z",
            },
          },
          priority.row_version,
          priority.id,
        );
        assert.equal(priority.payload.previous_status, "active");
        await assert.rejects(save(basic), /Maksimal tiga/);
        await assert.rejects(
          save(
            { ...priority, archived_at: new Date().toISOString() },
            priority.row_version,
            priority.id,
          ),
          /tiga/,
        );
        priority = await save(
          {
            ...priority,
            status: "paused",
            payload: {
              ...priority.payload,
              pause_reason: "Hentikan komitmen sampai stok tersedia",
            },
          },
          priority.row_version,
          priority.id,
        );
        await save(basic);
      },
    );
    await t.test(
      "Sales accepts a dependency before it becomes a committed task",
      async () => {
        await login(growth);
        let dependency = await save({
          kind: "dependency",
          title: "Sales offer",
          status: "requested",
          recipient_id: sales,
          payload: { question: "Offer?" },
        });
        await assert.rejects(
          save(
            {
              ...dependency,
              status: "committed",
              pic_id: sales,
              due_at: "2026-12-20T00:00:00Z",
              payload: {
                ...dependency.payload,
                acceptance_criteria: "Offer sah",
              },
            },
            dependency.row_version,
            dependency.id,
          ),
          /penerima/,
        );
        await login(sales);
        dependency = await save(
          {
            ...dependency,
            status: "committed",
            pic_id: sales,
            due_at: "2026-12-20T00:00:00Z",
            payload: {
              ...dependency.payload,
              acceptance_criteria: "Offer sah",
            },
          },
          dependency.row_version,
          dependency.id,
        );
        assert.equal(dependency.status, "committed");
      },
    );
    await t.test(
      "experiments require deployment, mandate and mature evidence; failure is valid",
      async () => {
        await login(growth);
        await configure("mandate", p, randomUUID(), {
          actor_id: growth,
          domain: "growth_media",
          allowed_actions: ["test"],
          max_amount: 1000,
          rationale: "Delegasi eksperimen",
          effective_from: "2026-01-01T00:00:00Z",
        });
        const deployment = (
          await db.query(
            "SELECT id FROM growth_records WHERE kind='deployment' LIMIT 1",
          )
        ).rows[0].id;
        const payload = {
          hypothesis: "Message sesuai kebutuhan",
          design: "A/B",
          comparator: "B",
          baseline: "100",
          cohort: "New cohort",
          confounders: "Promo",
          primary_metric: "Purchase",
          diagnostic_metrics: "CTR",
          success_rule: "Aturan disahkan",
          evidence_rule: "Cohort matang",
          guardrails: "CM3",
          evaluate_after: "2026-01-04T00:00:00Z",
          start_at: "2026-01-01T00:00:00Z",
          end_at: "2026-01-03T00:00:00Z",
          budget: 100,
          action: "test",
          required_ids: [randomUUID()],
        };
        let experiment = await save({
          kind: "experiment",
          title: "Creative A/B",
          status: "draft",
          pic_id: growth,
          payload,
        });
        experiment = await save(
          { ...experiment, status: "ready" },
          experiment.row_version,
          experiment.id,
        );
        await assert.rejects(
          save(
            { ...experiment, status: "running" },
            experiment.row_version,
            experiment.id,
          ),
          /Prerequisite/,
        );
        experiment = await save(
          {
            ...experiment,
            status: "running",
            payload: { ...experiment.payload, required_ids: [deployment] },
          },
          experiment.row_version,
          experiment.id,
        );
        await assert.rejects(
          save(
            {
              ...experiment,
              payload: { ...experiment.payload, budget: 999999 },
            },
            experiment.row_version,
            experiment.id,
          ),
          /immutable/,
        );
        experiment = await save(
          { ...experiment, status: "awaiting_evaluation" },
          experiment.row_version,
          experiment.id,
        );
        const result = {
          kind: "result",
          title: "Evaluasi cohort",
          status: "recorded",
          parent_id: experiment.id,
          payload: {
            actual: 3,
            numerator: 3,
            denominator: 100,
            cohort: "New cohort",
            period_from: "2026-01-01",
            period_to: "2026-01-03",
            source: "BI",
            captured_at: new Date().toISOString(),
            maturity: "immature",
            limitations: "Cohort belum selesai",
            outcome: "inconclusive",
            recommendation: "scale",
          },
        };
        await assert.rejects(save(result), /belum matang/);
        await save({
          ...result,
          payload: {
            ...result.payload,
            maturity: "mature",
            outcome: "failure",
            recommendation: "stop",
          },
        });
        experiment = await save(
          { ...experiment, status: "evaluated" },
          experiment.row_version,
          experiment.id,
        );
        assert.equal(experiment.status, "evaluated");
      },
    );
    await t.test(
      "weekly snapshot is server-provenanced, immutable, versioned and Growth-finalized",
      async () => {
        await login(growth);
        const snapshotId = randomUUID(),
          cutoff = new Date(Date.now() - 5).toISOString();
        await db.query(
          "INSERT INTO growth_metric_snapshots(id,workspace_id,portfolio_id,actor_id,cutoff_at,data) VALUES($1,$2,$3,$4,$5,$6)",
          [
            snapshotId,
            w,
            p,
            growth,
            cutoff,
            JSON.stringify({
              workspace_id: w,
              portfolio_id: p,
              actual: { revenue: 10 },
              computed_at: new Date().toISOString(),
            }),
          ],
        );
        let weekly = await save({
          kind: "weekly",
          title: "Weekly Review",
          status: "draft",
          payload: {
            week_start: "2026-10-05",
            cutoff_at: cutoff,
            snapshot_id: snapshotId,
            diagnosis: "Creative quality",
            learning: "Purchase maturity",
            next_steps: "Revise",
            sales_alignment: "Confirmed",
            data_completeness: "Source freshness uncertain",
            forecast: "Scenario only",
          },
        });
        assert.equal(weekly.payload.snapshot.actual.revenue, 10);
        assert.ok(Array.isArray(weekly.payload.snapshot.work_records));
        await login(ceo);
        await assert.rejects(
          save({ ...weekly, status: "final" }, weekly.row_version, weekly.id),
          /hanya Growth/,
        );
        await login(growth);
        weekly = await save(
          {
            ...weekly,
            status: "final",
            payload: {
              ...weekly.payload,
              snapshot: {
                workspace_id: w,
                portfolio_id: p,
                actual: { revenue: 999 },
              },
            },
          },
          weekly.row_version,
          weekly.id,
        );
        assert.equal(weekly.payload.snapshot.actual.revenue, 10);
        await assert.rejects(
          save(
            { ...weekly, title: "Overwrite" },
            weekly.row_version,
            weekly.id,
          ),
          /immutable/,
        );
        const revision = await save({
          kind: "weekly",
          title: "Review revised",
          status: "draft",
          payload: {
            week_start: "2026-10-05",
            cutoff_at: cutoff,
            snapshot_id: snapshotId,
            supersedes_id: weekly.id,
            revision_reason: "Sinkronisasi biaya baru",
          },
        });
        assert.equal(revision.payload.supersedes_id, weekly.id);
        await assert.rejects(
          save({
            kind: "weekly",
            title: "Forged",
            status: "final",
            payload: {
              week_start: "2026-10-05",
              cutoff_at: cutoff,
              diagnosis: "X",
              learning: "X",
              next_steps: "X",
              sales_alignment: "X",
              data_completeness: "X",
              snapshot: {
                workspace_id: w,
                portfolio_id: p,
                actual: { revenue: 999 },
              },
            },
          }),
          /Snapshot server/,
        );
      },
    );
    await t.test(
      "brand scopes, inactive actors, read-only history and retry revocation",
      async () => {
        await login(growth);
        await db.query(
          "INSERT INTO brands VALUES(1,$1,'Brand A'),(2,$1,'Brand B')",
          [w],
        );
        const brandUser = randomUUID();
        await db.query("INSERT INTO auth.users VALUES($1)", [brandUser]);
        await db.query(
          "INSERT INTO workspace_memberships VALUES($1,$2,'creative','active')",
          [w, brandUser],
        );
        const membershipId = randomUUID();
        await configure("membership", p, membershipId, {
          user_id: brandUser,
          functions: ["creative"],
          visibility_mode: "own_or_involved",
          company_scope: false,
          brand_ids: [1],
        });
        const record = await save({
          kind: "work",
          title: "Brand A task",
          status: "draft",
          brand_id: 1,
          pic_id: brandUser,
          payload: {},
        });
        const foreign = await save({
          kind: "work",
          title: "Brand B task",
          status: "draft",
          brand_id: 2,
          pic_id: growth,
          payload: {},
        });
        await login(brandUser);
        await db.exec("SET ROLE authenticated");
        assert.equal(
          (
            await db.query("SELECT id FROM growth_records WHERE id=$1", [
              record.id,
            ])
          ).rows.length,
          1,
        );
        assert.equal(
          (
            await db.query("SELECT id FROM growth_records WHERE id=$1", [
              foreign.id,
            ])
          ).rows.length,
          0,
        );
        assert.equal(
          (await db.query("SELECT id FROM growth_memberships")).rows.length,
          1,
        );
        await db.exec("RESET ROLE");
        const request = randomUUID(),
          id = randomUUID(),
          input = {
            kind: "evidence",
            title: "Proof",
            status: "recorded",
            brand_id: 1,
            parent_id: record.id,
            payload: {
              evidence_type: "text",
              reference: "Proof",
              captured_at: new Date().toISOString(),
            },
          };
        await save(input, 0, id, request);
        await login(growth);
        await configure(
          "membership",
          p,
          membershipId,
          {
            user_id: brandUser,
            functions: ["creative"],
            visibility_mode: "own_or_involved",
            company_scope: false,
            brand_ids: [1],
            active: false,
          },
          1,
        );
        await login(brandUser);
        await assert.rejects(save(input, 0, id, request), /Forbidden/);
        await login(growth);
        await assert.rejects(
          db.query("UPDATE growth_audit_events SET action='changed'"),
          /append-only/,
        );
      },
    );
    await t.test(
      "incidents require containment, evidence and review before closure",
      async () => {
        await login(growth);
        let incident = await save({
          kind: "incident",
          title: "Stockout",
          status: "open",
          pic_id: sales,
          payload: {
            incident_type: "stockout",
            impact: "Traffic terhambat",
            urgency: "high",
          },
        });
        await assert.rejects(
          save(
            { ...incident, status: "closed" },
            incident.row_version,
            incident.id,
          ),
          /Containment|Transisi/,
        );
        incident = await save(
          {
            ...incident,
            status: "contained",
            payload: {
              ...incident.payload,
              containment: "Media dijeda operator sesuai mandat",
            },
          },
          incident.row_version,
          incident.id,
        );
        await assert.rejects(
          save(
            { ...incident, status: "resolved" },
            incident.row_version,
            incident.id,
          ),
          /bukti/,
        );
        await save({
          kind: "evidence",
          title: "Konfirmasi stok",
          status: "recorded",
          parent_id: incident.id,
          payload: {
            evidence_type: "text",
            reference: "Stok dikonfirmasi Sales",
            captured_at: new Date().toISOString(),
          },
        });
        incident = await save(
          { ...incident, status: "resolved" },
          incident.row_version,
          incident.id,
        );
        incident = await save(
          {
            ...incident,
            status: "closed",
            payload: {
              ...incident.payload,
              review: "Traffic mengikuti stok",
              prevention: "Cek stok sebelum scaling",
            },
          },
          incident.row_version,
          incident.id,
        );
        assert.equal(incident.status, "closed");
      },
    );
    await t.test(
      "archiving final records preserves payload, history and idempotency",
      async () => {
        await login(growth);
        const weekly = (
          await db.query(
            "SELECT * FROM growth_records WHERE kind='weekly' AND status='final' LIMIT 1",
          )
        ).rows[0];
        const request = randomUUID();
        const archived = await rpc("growth_archive_record", [
          w,
          p,
          weekly.id,
          weekly.row_version,
          request,
        ]);
        assert.deepEqual(archived.payload, weekly.payload);
        assert.equal(archived.status, "final");
        assert.ok(archived.archived_at);
        const retry = await rpc("growth_archive_record", [
          w,
          p,
          weekly.id,
          weekly.row_version,
          request,
        ]);
        assert.deepEqual(retry, archived);
        const priority = (
          await db.query(
            "SELECT * FROM growth_records WHERE kind='priority' AND status='active' LIMIT 1",
          )
        ).rows[0];
        await assert.rejects(
          rpc("growth_archive_record", [
            w,
            p,
            priority.id,
            priority.row_version,
            randomUUID(),
          ]),
          /sebelum arsip/,
        );
      },
    );
    await t.test(
      "module disable and cross-workspace writes fail even with permissions",
      async () => {
        await login(growth);
        await assert.rejects(
          save(
            { ...basic, status: "draft" },
            0,
            randomUUID(),
            randomUUID(),
            w2,
            p,
          ),
          /Forbidden|Portfolio/,
        );
        await db.query("UPDATE workspaces SET settings='{}' WHERE id=$1", [w]);
        await assert.rejects(save({ ...basic, status: "draft" }), /Forbidden/);
      },
    );
    await db.close();
  },
);

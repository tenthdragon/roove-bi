"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { usePermissions } from "@/lib/PermissionsContext";
import { useWorkspace } from "@/lib/WorkspaceContext";
import {
  configureGrowth,
  getGrowthBootstrap,
  getGrowthConfigurationPeople,
  getGrowthHistory,
  getGrowthOverview,
  getGrowthRecord,
  getGrowthRelated,
  listGrowthRecords,
  saveGrowthRecord,
} from "@/lib/growth-actions";
import {
  GROWTH_FIELDS,
  GROWTH_LABELS,
  GROWTH_STATUSES,
  GROWTH_TABS,
  growthTab,
  wibDate,
  workWeek,
  type GrowthKind,
  type GrowthRecord,
  type GrowthTab,
} from "@/lib/growth-domain";
import styles from "./GrowthExecution.module.css";

type Bootstrap = Awaited<ReturnType<typeof getGrowthBootstrap>>;
type Overview = Awaited<ReturnType<typeof getGrowthOverview>>;
const TAB_LABELS: Record<GrowthTab, string> = {
  overview: "Overview",
  priorities: "Priorities",
  "work-board": "Work Board",
  experiments: "Experiments",
  decisions: "Decisions",
  "weekly-review": "Weekly Review",
};
const TAB_KIND: Partial<Record<GrowthTab, GrowthKind>> = {
  priorities: "priority",
  "work-board": "work",
  experiments: "experiment",
  decisions: "decision",
  "weekly-review": "weekly",
};
const FIELD_LABELS: Record<string, string> = {
  diagnosis: "Diagnosis",
  success_criteria: "Kriteria keberhasilan",
  goal_id: "Operational goal",
  pause_reason: "Alasan pause",
  operational_category: "Kategori operasional (jika tanpa prioritas)",
  acceptance_criteria: "Kriteria penerimaan",
  acknowledgment: "Respons penugasan PIC",
  output_version: "Versi output",
  progress_note: "Update progres",
  review_feedback: "Feedback reviewer",
  blocker_reason: "Alasan blocker",
  action_needed: "Tindakan yang dibutuhkan",
  impact: "Dampak",
  follow_up_at: "Follow-up (WIB)",
  hypothesis: "Hipotesis",
  design: "Desain pengujian",
  comparator: "Pembanding",
  baseline: "Baseline",
  cohort: "Cohort",
  confounders: "Confounders / faktor lain",
  primary_metric: "Metrik utama",
  diagnostic_metrics: "Metrik diagnosis",
  success_rule: "Aturan keberhasilan",
  evidence_rule: "Aturan kecukupan bukti",
  guardrails: "Guardrail",
  budget: "Budget sesuai mandat (Rp)",
  action: "Kode tindakan sesuai mandat",
  start_at: "Mulai (WIB)",
  end_at: "Selesai pengumpulan (WIB)",
  evaluate_after: "Evaluasi setelah (WIB)",
  required_ids: "Deployment / dependency prasyarat",
  partial_design: "Desain pengujian parsial",
  evidence_type: "Jenis bukti",
  reference: "Referensi / URL / ID / teks bukti",
  captured_at: "Waktu pencatatan (WIB)",
  platform: "Platform",
  external_id: "Campaign / Ad / Asset ID",
  deployed_at: "Waktu pemasangan (WIB)",
  question: "Pertanyaan / permintaan",
  options: "Opsi keputusan",
  domain: "Domain kewenangan",
  amount: "Nilai keputusan (Rp)",
  rationale: "Alasan keputusan",
  outcome: "Hasil",
  execution_state: "Status penerapan keputusan",
  implementation_evidence_id: "Bukti penerapan",
  decision_id: "Keputusan tindak lanjut",
  evidence_id: "Evidence",
  response: "Respons / kebutuhan informasi",
  actual: "Nilai aktual",
  numerator: "Numerator",
  denominator: "Denominator",
  period_from: "Periode dari",
  period_to: "Periode sampai",
  source: "Sumber",
  maturity: "Kematangan data",
  limitations: "Keterbatasan hasil",
  recommendation: "Rekomendasi",
  incident_type: "Jenis insiden",
  urgency: "Urgensi",
  containment: "Tindakan containment",
  review: "Review insiden",
  prevention: "Pencegahan proporsional",
  week_start: "Senin awal pekan kerja",
  cutoff_at: "Cutoff review (WIB)",
  learning: "Learning",
  forecast: "Forecast (terpisah dari aktual)",
  forecast_assumptions: "Asumsi forecast",
  next_steps: "Komitmen berikutnya",
  sales_alignment: "Status alignment dengan Sales",
  data_completeness: "Kelengkapan / keterbatasan data",
  supersedes_id: "Versi/record yang digantikan",
  revision_reason: "Alasan revisi",
  metric: "Metrik",
  unit: "Satuan",
  target_value: "Target operasional",
  notes: "Catatan",
  target_id: "Record tujuan",
  relation: "Hubungan",
  note: "Catatan update / komentar",
};
const OPTIONS: Record<string, string[]> = {
  acknowledgment: ["pending", "accepted", "declined"],
  evidence_type: ["url", "campaign", "asset", "document", "text"],
  domain: [
    "growth_media",
    "creative",
    "sales_commercial",
    "sales_operations",
    "cross_function",
  ],
  execution_state: [
    "not_started",
    "in_progress",
    "implemented",
    "not_implemented",
  ],
  maturity: ["immature", "mature", "inconclusive"],
  recommendation: ["scale", "continue", "revise", "stop", "defer"],
  urgency: ["low", "medium", "high", "critical"],
};
const DATE_FIELDS = ["period_from", "period_to", "week_start"];
const TIME_FIELDS = [
  "follow_up_at",
  "captured_at",
  "deployed_at",
  "start_at",
  "end_at",
  "evaluate_after",
  "cutoff_at",
];
const NUMBER_FIELDS = ["budget", "amount", "target_value", "output_version"];
function message(error: unknown) {
  return error instanceof Error ? error.message : "Operasi gagal.";
}
function fieldValue(value: unknown) {
  return typeof value === "object"
    ? JSON.stringify(value, null, 2)
    : String(value ?? "");
}
function money(value: unknown) {
  return value == null
    ? "N/A"
    : new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }).format(Number(value));
}
function wibTime(value: string | null) {
  return value && Number.isFinite(new Date(value).getTime())
    ? new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value)) + " WIB"
    : "—";
}
function localTime(value: unknown) {
  return value
    ? new Date(new Date(String(value)).getTime() + 7 * 3600000)
        .toISOString()
        .slice(0, 16)
    : "";
}

function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.querySelector<HTMLElement>("button,input,select,textarea")?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      if (event.key === "Tab" && dialog) {
        const elements = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]",
          ),
        );
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [close]);
  return (
    <div className={styles.overlay}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={close} aria-label="Tutup dialog">
            Tutup ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export default function GrowthExecution() {
  const { can } = usePermissions();
  const { activeWorkspace } = useWorkspace();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = growthTab(searchParams.get("tab"));
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null),
    [portfolio, setPortfolio] = useState(""),
    [brand, setBrand] = useState("all");
  const [kind, setKind] = useState<GrowthKind>(TAB_KIND[tab] || "priority"),
    [records, setRecords] = useState<GrowthRecord[]>([]),
    [count, setCount] = useState(0),
    [page, setPage] = useState(0),
    [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [myWork, setMyWork] = useState(false),
    [archived, setArchived] = useState(false),
    [board, setBoard] = useState(false),
    [sort, setSort] = useState("updated");
  const [from, setFrom] = useState(`${wibDate().slice(0, 7)}-01`),
    [to, setTo] = useState(wibDate()),
    [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<GrowthRecord | null>(null),
    [editing, setEditing] = useState<GrowthRecord | GrowthKind | null>(null),
    [setup, setSetup] = useState(false);
  const scope = brand === "all" ? null : Number(brand);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    setBootstrap(null);
    setRecords([]);
    setDetail(null);
    setEditing(null);
    setOverview(null);
    setPortfolio("");
    setBrand("all");
  }, [activeWorkspace.id]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    getGrowthBootstrap()
      .then((data) => {
        if (live) {
          setBootstrap(data);
          setPortfolio((current) =>
            data.portfolios.some((p) => p.id === current)
              ? current
              : data.portfolios[0]?.id || "",
          );
          setError("");
        }
      })
      .catch((e) => {
        if (live) {
          setError(message(e));
          setBootstrap(null);
          setRecords([]);
          setDetail(null);
          setOverview(null);
          setPortfolio("");
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [activeWorkspace.id, revision]);
  useEffect(() => {
    setKind(TAB_KIND[tab] || "priority");
    setPage(0);
    setStatus("");
  }, [tab]);
  useEffect(() => {
    setPage(0);
  }, [
    portfolio,
    brand,
    kind,
    myWork,
    search,
    status,
    pageSize,
    archived,
    sort,
  ]);
  useEffect(() => {
    if (!portfolio) return;
    let live = true;
    setLoading(true);
    setError("");
    const run =
      tab === "overview"
        ? getGrowthOverview(portfolio, scope, from, to).then((data) => {
            if (live) setOverview(data);
          })
        : listGrowthRecords({
            portfolioId: portfolio,
            kind,
            brandId: scope,
            myWork,
            search,
            status,
            sort,
            page,
            pageSize,
            archived,
          }).then((data) => {
            if (live) {
              setRecords(data.records as GrowthRecord[]);
              setCount(data.count);
            }
          });
    run
      .catch((e) => {
        if (live) {
          setError(message(e));
          setRecords([]);
          setOverview(null);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [
    portfolio,
    scope,
    tab,
    kind,
    myWork,
    search,
    status,
    sort,
    page,
    pageSize,
    archived,
    from,
    to,
    revision,
  ]);
  useEffect(() => {
    const id = searchParams.get("item");
    if (!id) {
      setDetail(null);
      return;
    }
    let live = true;
    setDetail(null);
    getGrowthRecord(id)
      .then((data) => {
        if (live) setDetail(data.record as GrowthRecord);
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [searchParams, revision, activeWorkspace.id]);
  const navigateDetail = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("item", id);
      else params.delete("item");
      router.replace(`${pathname}?${params}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );
  const person = (id: string | null) =>
    bootstrap?.people.find((p) => p.id === id)?.full_name ||
    id?.slice(0, 8) ||
    "—";
  const myMembership = bootstrap?.memberships.find(
    (m) =>
      m.user_id === bootstrap.userId &&
      m.portfolio_id === portfolio &&
      m.active,
  );
  const team =
    can("growth:team-read") && myMembership?.visibility_mode === "team";
  const createKinds: GrowthKind[] =
    tab === "priorities"
      ? ["priority", "goal"]
      : tab === "work-board"
        ? ["work", "dependency"]
        : tab === "experiments"
          ? ["experiment"]
          : tab === "decisions"
            ? ["decision", "incident"]
            : tab === "weekly-review"
              ? ["weekly"]
              : [];
  function tabUrl(next: GrowthTab) {
    const params = new URLSearchParams();
    params.set("tab", next);
    return `${pathname}?${params}`;
  }
  return (
    <div className={`${styles.root} fade-in`}>
      <div className={styles.bar}>
        <div style={{ flex: 1 }}>
          <h1>Growth Execution</h1>
          <div className={styles.muted}>
            Prioritas, eksekusi, bukti dan keputusan dalam satu catatan kerja.
          </div>
        </div>
        {can("growth:configure") && (
          <button onClick={() => setSetup(true)}>Konfigurasi</button>
        )}
      </div>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
          <button style={{ marginLeft: 12 }} onClick={refresh}>
            Muat ulang
          </button>
        </div>
      )}
      {bootstrap && (
        <div className={styles.bar}>
          <label>
            Portfolio{" "}
            <select
              value={portfolio}
              onChange={(e) => setPortfolio(e.target.value)}
            >
              <option value="">Pilih portfolio</option>
              {bootstrap.portfolios.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Scope{" "}
            <select value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="all">Semua scope yang diizinkan</option>
              {bootstrap.brands.map((b) => (
                <option value={b.id} key={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <span className={styles.muted}>
            {team ? "Team view sesuai membership" : "Own / involved records"}
          </span>
        </div>
      )}
      <nav className={styles.tabs} aria-label="Growth Execution">
        {GROWTH_TABS.map((t) => (
          <Link
            key={t}
            href={tabUrl(t)}
            aria-current={t === tab ? "page" : undefined}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </nav>
      {!portfolio && !loading && (
        <div className={styles.card}>
          <h2>Siapkan portfolio dan membership</h2>
          <p>
            Administrator menetapkan aktor, scope brand, fungsi dan mandat
            sebelum pekerjaan digunakan.
          </p>
          {can("growth:configure") && (
            <button className={styles.primary} onClick={() => setSetup(true)}>
              Buka konfigurasi
            </button>
          )}
        </div>
      )}
      {portfolio && tab === "overview" && (
        <>
          <div className={styles.bar}>
            <label>
              Periode BI dari{" "}
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              sampai{" "}
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <span className={styles.muted}>
              Periode metrik; task aktif tetap lintas pekan.
            </span>
          </div>
          {overview && (
            <OverviewPanel data={overview} open={(id) => navigateDetail(id)} />
          )}
        </>
      )}
      {portfolio && tab !== "overview" && (
        <>
          <div className={styles.bar}>
            <label>
              Jenis{" "}
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as GrowthKind)}
              >
                {createKinds.map((k) => (
                  <option key={k} value={k}>
                    {GROWTH_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <input
              aria-label="Cari judul"
              placeholder="Cari pekerjaan…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Semua status</option>
              {GROWTH_STATUSES[kind].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <label>
              <input
                type="checkbox"
                checked={myWork}
                onChange={(e) => setMyWork(e.target.checked)}
              />{" "}
              My Work
            </label>
            <label>
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />{" "}
              Sertakan arsip
            </label>
            <select
              aria-label="Urutkan"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="updated">Update terbaru</option>
              <option value="due">Deadline terdekat</option>
            </select>
            {tab === "work-board" && (
              <button onClick={() => setBoard(!board)}>
                {board ? "List view" : "Board view"}
              </button>
            )}
            {can("growth:manage") && team && (
              <button
                className={styles.primary}
                onClick={() => setEditing(kind)}
              >
                + {GROWTH_LABELS[kind]}
              </button>
            )}
          </div>
          {tab === "priorities" && (
            <p className={styles.muted}>
              Maksimal tiga prioritas aktif per portfolio. Blocked tetap memakai
              slot; pause harus eksplisit.
            </p>
          )}
          {tab === "work-board" && (
            <p className={styles.muted}>
              PIC menerima penugasan; reviewer menerima hasil. Accepted,
              deployment dan hasil eksperimen dicatat terpisah.
            </p>
          )}
          {tab === "experiments" && (
            <p className={styles.muted}>
              Evaluasi mengikuti aturan bukti dan kematangan. Lewat
              evaluate_after berarti perlu evaluasi.
            </p>
          )}
          {tab === "decisions" && (
            <p className={styles.muted}>
              Keputusan mengikuti domain dan mandat; approval memiliki status
              penerapan tersendiri.
            </p>
          )}
          {board && tab === "work-board" ? (
            <div className={styles.board}>
              {GROWTH_STATUSES[kind].map((s) => (
                <section key={s} className={styles.column}>
                  <h2>{s}</h2>
                  {records
                    .filter((r) => r.status === s)
                    .map((r) => (
                      <div className={styles.card} key={r.id}>
                        <button
                          className={styles.titleButton}
                          onClick={() => navigateDetail(r.id)}
                        >
                          {r.title}
                        </button>
                        <p className={styles.muted}>
                          {person(r.pic_id)} · {wibTime(r.due_at)}
                        </p>
                      </div>
                    ))}
                </section>
              ))}
            </div>
          ) : (
            <div className={`${styles.card} ${styles.tableWrap}`}>
              <table>
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Status</th>
                    <th>PIC</th>
                    <th>Deadline WIB</th>
                    <th>Update WIB</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <button
                          className={styles.titleButton}
                          onClick={() => navigateDetail(r.id)}
                        >
                          #{r.short_id} {r.title}
                        </button>
                        <div className={styles.muted}>
                          {r.archived_at ? "Arsip · " : ""}
                          {r.brand_id == null
                            ? "Company"
                            : bootstrap?.brands.find((b) => b.id === r.brand_id)
                                ?.name}{" "}
                          · v{r.row_version}
                        </div>
                      </td>
                      <td>
                        <span className={styles.badge}>{r.status}</span>
                        {r.kind === "work" && (
                          <div className={styles.muted}>
                            Penugasan:{" "}
                            {String(r.payload.acknowledgment || "pending")}
                          </div>
                        )}
                        {r.kind === "decision" && (
                          <div className={styles.muted}>
                            {String(r.payload.execution_state || "not_started")}
                          </div>
                        )}
                      </td>
                      <td>{person(r.pic_id)}</td>
                      <td>{wibTime(r.due_at)}</td>
                      <td>{wibTime(r.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!records.length && !loading && (
                <p>Belum ada record yang cocok dengan scope dan filter ini.</p>
              )}
            </div>
          )}
          <div className={styles.bar}>
            <span className={styles.muted}>
              {count} record · Halaman {page + 1}
              {board && tab === "work-board"
                ? " · Board mengikuti halaman aktif"
                : ""}
            </span>
            <button
              disabled={page === 0 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Sebelumnya
            </button>
            <button
              disabled={(page + 1) * pageSize >= count || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Berikutnya
            </button>
            <select
              aria-label="Record per halaman"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              <option value={25}>25 / halaman</option>
              <option value={50}>50 / halaman</option>
            </select>
          </div>
        </>
      )}
      {loading && <p role="status">Memuat data…</p>}
      {detail && !editing && bootstrap && (
        <RecordDetail
          record={detail}
          bootstrap={bootstrap}
          close={() => navigateDetail(null)}
          edit={() => setEditing(detail)}
          create={(child) => setEditing(child)}
          reload={refresh}
        />
      )}
      {editing && bootstrap && (
        <RecordEditor
          initial={editing}
          bootstrap={bootstrap}
          portfolioId={
            typeof editing === "string" ? portfolio : editing.portfolio_id
          }
          brandId={scope}
          close={() => setEditing(null)}
          saved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {setup && bootstrap && (
        <SetupPanel
          bootstrap={bootstrap}
          portfolioId={portfolio}
          close={() => setSetup(false)}
          saved={refresh}
        />
      )}
    </div>
  );
}

function OverviewPanel({
  data,
  open,
}: {
  data: Overview;
  open: (id: string) => void;
}) {
  const metrics = data.metrics;
  return (
    <>
      <div className={styles.grid}>
        {Object.entries(data.counts).map(([kind, total]) => (
          <div key={kind} className={styles.card}>
            <div className={styles.muted}>
              {GROWTH_LABELS[kind as GrowthKind]}
            </div>
            <div className={styles.metric}>{total}</div>
          </div>
        ))}
      </div>
      <p className={styles.muted}>
        Jumlah record mengikuti hak akses; jumlah task selesai tidak menyatakan
        pencapaian finansial.
      </p>
      {metrics ? (
        <>
          <div className={styles.notice}>
            {metrics.scope === "company" ? "Scope perusahaan" : "Scope brand"} ·{" "}
            {metrics.source_period.from} — {metrics.source_period.to}
            <br />
            {metrics.basis}
            <br />
            {metrics.freshness}
            <br />
            Dihitung {wibTime(metrics.computed_at)} · Data as of:{" "}
            {metrics.data_as_of
              ? wibTime(metrics.data_as_of)
              : "Belum terverifikasi"}
          </div>
          {metrics.reason && <p role="status">{metrics.reason}</p>}
          <div className={styles.grid}>
            <div className={styles.card}>
              Actual Net Sales
              <div className={styles.metric}>
                {money(metrics.actual?.revenue)}
              </div>
            </div>
            <div className={styles.card}>
              Actual CM3
              <div className={styles.metric}>{money(metrics.actual?.cm3)}</div>
            </div>
            <div className={styles.card}>
              Combined ROAS
              <div className={styles.metric}>
                {metrics.actual?.roas == null
                  ? "N/A"
                  : metrics.actual.roas.toFixed(2) + "×"}
              </div>
            </div>
          </div>
          {metrics.target ? (
            <div className={styles.card}>
              <h2>Target finansial perusahaan · {metrics.target.month}</h2>
              <p>
                Required CM3: {money(metrics.target.required_cm3)} · Minimum
                revenue: {money(metrics.target.minimum_revenue)}
              </p>
              <p className={styles.muted}>
                Sumber {metrics.target.source} · Target #
                {metrics.target.version.id} · {metrics.target_reason}
              </p>
            </div>
          ) : (
            <p className={styles.muted}>{metrics.target_reason}</p>
          )}
        </>
      ) : (
        <div className={styles.card}>
          Angka BI memerlukan izin metrics-read dan akses tim sesuai scope.
        </div>
      )}
      <div className={styles.grid}>
        {(
          [
            "active_priorities",
            "blocked",
            "overdue",
            "pending_decisions",
            "evaluation_needed",
            "awaiting_deployment",
          ] as const
        ).map((key) => (
          <section className={styles.card} key={key}>
            <h2>
              {
                {
                  active_priorities: "Prioritas aktif",
                  blocked: "Blocker",
                  overdue: "Lewat deadline",
                  pending_decisions: "Menunggu keputusan",
                  evaluation_needed: "Perlu evaluasi",
                  awaiting_deployment: "Accepted, belum deployed",
                }[key]
              }
            </h2>
            {data.summary[key].length ? (
              data.summary[key].map((r) => (
                <p key={r.id}>
                  <button
                    className={styles.titleButton}
                    onClick={() => open(r.id)}
                  >
                    #{r.short_id} {r.title}
                  </button>
                  <br />
                  <span className={styles.badge}>{r.status}</span>
                </p>
              ))
            ) : (
              <p className={styles.muted}>Tidak ada record dalam scope Anda.</p>
            )}
          </section>
        ))}
      </div>
      {data.summary.last_review && (
        <div className={styles.card}>
          <h2>Weekly Review final terbaru</h2>
          <button
            className={styles.titleButton}
            onClick={() => open(data.summary.last_review!.id)}
          >
            {data.summary.last_review.title}
          </button>
          <p className={styles.muted}>
            Pekan {data.summary.last_review.week_start} · Cutoff{" "}
            {wibTime(data.summary.last_review.cutoff_at)}
          </p>
        </div>
      )}
    </>
  );
}

function WeeklySnapshot({ snapshot }: { snapshot: Record<string, unknown> }) {
  const actual = snapshot.actual as {
    revenue?: number;
    cm3?: number;
    roas?: number;
  } | null;
  const target = snapshot.target as {
    month: string;
    required_cm3: number;
    minimum_revenue: number;
  } | null;
  const period = snapshot.source_period as { from: string; to: string } | null;
  const records = Array.isArray(snapshot.work_records)
    ? (snapshot.work_records as GrowthRecord[])
    : [];
  return (
    <section className={styles.card}>
      <h2>Snapshot pada cutoff review</h2>
      <p className={styles.muted}>
        Cutoff {wibTime(String(snapshot.cutoff_at))} · BI {period?.from} —{" "}
        {period?.to}
        <br />
        Dihitung {wibTime(String(snapshot.computed_at))} ·{" "}
        {String(snapshot.daily_cutoff_policy || "")}
        <br />
        {String(snapshot.reason || snapshot.freshness || "")}
      </p>
      <div className={styles.grid}>
        <div>
          Actual Net Sales
          <div className={styles.metric}>{money(actual?.revenue)}</div>
        </div>
        <div>
          Actual CM3<div className={styles.metric}>{money(actual?.cm3)}</div>
        </div>
        <div>
          Combined ROAS
          <div className={styles.metric}>
            {actual?.roas == null ? "N/A" : actual.roas.toFixed(2) + "×"}
          </div>
        </div>
      </div>
      {target && (
        <p>
          Target perusahaan {target.month}: Required CM3{" "}
          {money(target.required_cm3)} · Minimum revenue{" "}
          {money(target.minimum_revenue)}
        </p>
      )}
      <div className={styles.grid}>
        {(
          [
            "priority",
            "work",
            "experiment",
            "decision",
            "incident",
            "dependency",
          ] as const
        ).map((kind) => (
          <div key={kind}>
            <h2>{GROWTH_LABELS[kind]}</h2>
            {records
              .filter((r) => r.kind === kind)
              .map((r) => (
                <p key={r.id}>
                  #{r.short_id} {r.title}
                  <br />
                  <span className={styles.badge}>{r.status}</span>
                </p>
              ))}
            {!records.some((r) => r.kind === kind) && (
              <p className={styles.muted}>Tidak ada record pada cutoff.</p>
            )}
          </div>
        ))}
      </div>
      <details>
        <summary>Sumber, bukti dan versi snapshot</summary>
        <pre>{JSON.stringify(snapshot, null, 2)}</pre>
      </details>
    </section>
  );
}

function RecordDetail({
  record,
  bootstrap,
  close,
  edit,
  create,
  reload,
}: {
  record: GrowthRecord;
  bootstrap: Bootstrap;
  close: () => void;
  edit: () => void;
  create: (record: GrowthRecord) => void;
  reload: () => void;
}) {
  const { can } = usePermissions();
  const [related, setRelated] = useState<GrowthRecord[]>([]),
    [relatedCount, setRelatedCount] = useState(0),
    [relatedPage, setRelatedPage] = useState(0),
    [history, setHistory] = useState<Record<string, unknown>[]>([]),
    [parent, setParent] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setHistory([]);
    setRelatedPage(0);
    Promise.all([getGrowthRelated(record.id), getGrowthRecord(record.id)])
      .then(([children, detail]) => {
        if (live) {
          setRelated(children.records as GrowthRecord[]);
          setRelatedCount(children.count);
          setParent(detail.parent);
        }
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [record.id, record.row_version]);
  const immutable =
    Boolean(record.archived_at) ||
    ["evidence", "deployment", "result", "link", "update"].includes(
      record.kind,
    ) ||
    (record.kind === "weekly" && record.status === "final") ||
    (record.kind === "goal" && record.status === "approved");
  function newChild(kind: GrowthKind) {
    create({
      ...record,
      id: "",
      short_id: 0,
      kind,
      title: "",
      status: GROWTH_STATUSES[kind][0],
      parent_id: record.id,
      payload:
        kind === "evidence"
          ? { output_version: Number(record.payload.output_version || 1) }
          : {},
      row_version: 0,
      archived_at: null,
      reviewer_id: null,
      recipient_id: null,
      blocker_owner_id: null,
      due_at: null,
    });
  }
  async function loadHistory() {
    try {
      const rows = await getGrowthHistory(
        record.id,
        history.length ? Number(history.at(-1)?.id) : undefined,
      );
      setHistory((current) => [...current, ...rows]);
    } catch (e) {
      setError(message(e));
    }
  }
  async function refreshSnapshot() {
    setBusy(true);
    setError("");
    try {
      await saveGrowthRecord({
        portfolioId: record.portfolio_id,
        objectId: record.id,
        expectedRowVersion: record.row_version,
        requestId: crypto.randomUUID(),
        input: record,
        refreshSnapshot: true,
      });
      reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function loadRelated() {
    try {
      const result = await getGrowthRelated(record.id, relatedPage + 1);
      setRelated((current) => [
        ...current,
        ...(result.records as GrowthRecord[]),
      ]);
      setRelatedCount(result.count);
      setRelatedPage((current) => current + 1);
    } catch (e) {
      setError(message(e));
    }
  }
  async function archive() {
    setBusy(true);
    setError("");
    try {
      await saveGrowthRecord({
        portfolioId: record.portfolio_id,
        objectId: record.id,
        expectedRowVersion: record.row_version,
        requestId: crypto.randomUUID(),
        input: { ...record, archived_at: new Date().toISOString() },
      });
      reload();
      close();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={`#${record.short_id} ${record.title}`} close={close}>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.bar}>
        <span className={styles.badge}>{record.status}</span>
        <span className={styles.muted}>
          v{record.row_version} · ID {record.id}
        </span>
        {!immutable && <button onClick={edit}>Perbarui record</button>}
        {immutable &&
          can("growth:manage") &&
          ["weekly", "goal", "result", "decision"].includes(record.kind) && (
            <button
              onClick={() =>
                create({
                  ...record,
                  id: "",
                  short_id: 0,
                  status: GROWTH_STATUSES[record.kind][0],
                  row_version: 0,
                  archived_at: null,
                  payload: {
                    ...record.payload,
                    supersedes_id: record.id,
                    revision_reason: "",
                    snapshot: null,
                    snapshot_id: null,
                  },
                })
              }
            >
              Buat revisi
            </button>
          )}
        {record.kind === "weekly" && record.status === "draft" && (
          <button disabled={busy} onClick={refreshSnapshot}>
            Refresh snapshot (narasi dipertahankan)
          </button>
        )}
      </div>
      {parent && (
        <p className={styles.muted}>
          Parent: #{String(parent.short_id)} {String(parent.title)} ·{" "}
          {String(parent.status)}
        </p>
      )}
      <dl className={styles.facts}>
        {Object.entries(record.payload)
          .filter(([key]) => !["snapshot", "snapshot_id"].includes(key))
          .map(([key, value]) => (
            <div key={key} style={{ display: "contents" }}>
              <dt>{FIELD_LABELS[key] || key}</dt>
              <dd>{fieldValue(value)}</dd>
            </div>
          ))}
      </dl>
      {record.kind === "weekly" && record.payload.snapshot && (
        <WeeklySnapshot
          snapshot={record.payload.snapshot as Record<string, unknown>}
        />
      )}
      <div className={styles.bar}>
        {can("growth:update-own") && (
          <>
            <button onClick={() => newChild("evidence")}>+ Evidence</button>
            <button onClick={() => newChild("update")}>
              + Update / komentar
            </button>
            {record.kind === "work" && record.status === "accepted" && (
              <button onClick={() => newChild("deployment")}>
                + Deployment
              </button>
            )}
          </>
        )}
        {can("growth:manage") &&
          record.kind === "experiment" &&
          record.status === "awaiting_evaluation" && (
            <button onClick={() => newChild("result")}>+ Hasil evaluasi</button>
          )}
        {can("growth:manage") && (
          <button onClick={() => newChild("link")}>+ Link record</button>
        )}
      </div>
      <h2>Bukti dan record terkait</h2>
      {related.length ? (
        related.map((r) => (
          <div key={r.id} className={styles.card}>
            <span className={styles.badge}>
              {GROWTH_LABELS[r.kind]} · {r.status}
            </span>
            <p>
              #{r.short_id} {r.title} · ID {r.id}
            </p>
            <dl className={styles.facts}>
              {Object.entries(r.payload).map(([key, value]) => (
                <div key={key} style={{ display: "contents" }}>
                  <dt>{FIELD_LABELS[key] || key}</dt>
                  <dd>
                    {key === "reference" &&
                    r.payload.evidence_type === "url" ? (
                      <a
                        href={String(value)}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {String(value)}
                      </a>
                    ) : (
                      fieldValue(value)
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))
      ) : (
        <p className={styles.muted}>
          Belum ada bukti/update terkait yang dapat dibaca.
        </p>
      )}
      <button onClick={loadHistory}>
        {history.length ? "Muat histori lebih lama" : "Muat histori audit"}
      </button>
      {related.length < relatedCount && (
        <button onClick={loadRelated}>Muat record terkait lain</button>
      )}
      {history.map((event) => (
        <details key={String(event.id)}>
          <summary>
            {wibTime(String(event.created_at))} · {String(event.action)} ·{" "}
            {String(event.actor_id).slice(0, 8)}
          </summary>
          <pre>{JSON.stringify(event, null, 2)}</pre>
        </details>
      ))}
      {can("growth:manage") && !record.archived_at && (
        <div className={styles.bar}>
          <button disabled={busy} onClick={archive}>
            Arsipkan record
          </button>
          <span className={styles.muted}>
            Histori dan snapshot tetap tersimpan.
          </span>
        </div>
      )}
    </Dialog>
  );
}

function RecordEditor({
  initial,
  bootstrap,
  portfolioId,
  brandId,
  close,
  saved,
}: {
  initial: GrowthRecord | GrowthKind;
  bootstrap: Bootstrap;
  portfolioId: string;
  brandId: number | null;
  close: () => void;
  saved: () => void;
}) {
  const existing = typeof initial === "string" ? null : initial;
  const kind = typeof initial === "string" ? initial : initial.kind;
  const { can } = usePermissions();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [candidates, setCandidates] = useState<GrowthRecord[]>([]);
  const request = useRef({
    objectId: existing?.id || crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    payload: "",
  });
  const [form, setForm] = useState<Record<string, string>>(() => {
    const data: Record<string, string> = {
      title: existing?.title || "",
      status: existing?.status || GROWTH_STATUSES[kind][0],
      brand_id: String((existing ? existing.brand_id : brandId) ?? ""),
      parent_id: existing?.parent_id || "",
      pic_id: existing?.pic_id || bootstrap.userId,
      reviewer_id: existing?.reviewer_id || "",
      recipient_id: existing?.recipient_id || "",
      blocker_owner_id: existing?.blocker_owner_id || "",
      due_at: localTime(existing?.due_at),
    };
    for (const field of GROWTH_FIELDS[kind])
      data[field] = TIME_FIELDS.includes(field)
        ? localTime(existing?.payload[field])
        : Array.isArray(existing?.payload[field])
          ? (existing?.payload[field] as string[]).join(", ")
          : String(existing?.payload[field] ?? "");
    if (kind === "weekly") {
      data.week_start ||= workWeek();
      data.cutoff_at ||= localTime(new Date().toISOString());
    }
    if (kind === "evidence") {
      data.evidence_type ||= "text";
      data.captured_at ||= localTime(new Date().toISOString());
      data.output_version ||= String(existing?.payload.output_version || 1);
    }
    if (kind === "deployment")
      data.deployed_at ||= localTime(new Date().toISOString());
    if (kind === "decision") {
      data.domain ||= "growth_media";
      data.execution_state ||= "not_started";
    }
    return data;
  });
  useEffect(() => {
    let live = true;
    listGrowthRecords({
      portfolioId,
      pageSize: 50,
      brandId: form.brand_id ? Number(form.brand_id) : null,
    })
      .then((data) => {
        if (live) setCandidates(data.records as GrowthRecord[]);
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [portfolioId, form.brand_id]);
  const members = bootstrap.memberships.filter(
    (m) => m.portfolio_id === portfolioId && m.active,
  );
  const person = (id: string) =>
    bootstrap.people.find((p) => p.id === id)?.full_name || id.slice(0, 8);
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {};
      for (const field of GROWTH_FIELDS[kind]) {
        const value = form[field];
        if (!value) continue;
        payload[field] =
          field === "required_ids"
            ? value.split(/[\s,]+/).filter(Boolean)
            : NUMBER_FIELDS.includes(field)
              ? Number(value)
              : value;
      }
      const input = {
        kind,
        title: form.title,
        status: form.status,
        brand_id: form.brand_id ? Number(form.brand_id) : null,
        parent_id: form.parent_id || null,
        pic_id: form.pic_id || null,
        reviewer_id: form.reviewer_id || null,
        recipient_id: form.recipient_id || null,
        blocker_owner_id: form.blocker_owner_id || null,
        due_at: form.due_at || null,
        payload,
        archived_at: existing?.archived_at || null,
      };
      const serialized = JSON.stringify(input);
      if (request.current.payload && serialized !== request.current.payload)
        request.current.requestId = crypto.randomUUID();
      request.current.payload = serialized;
      await saveGrowthRecord({
        portfolioId,
        objectId: request.current.objectId,
        requestId: request.current.requestId,
        expectedRowVersion: existing?.row_version || 0,
        input,
      });
      saved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function idField(field: string) {
    const types: Partial<Record<string, GrowthKind[]>> = {
      goal_id: ["goal"],
      evidence_id: ["evidence"],
      implementation_evidence_id: ["evidence"],
      decision_id: ["decision"],
      supersedes_id: [kind],
      parent_id: kind === "work" ? ["priority", "experiment"] : undefined,
    };
    return (
      <RecordPicker
        portfolioId={portfolioId}
        brandId={form.brand_id ? Number(form.brand_id) : null}
        value={form[field] || ""}
        onChange={(value) => set(field, value)}
        types={types[field]}
        candidates={candidates}
        disabled={
          Boolean(existing?.row_version) &&
          field === "parent_id" &&
          existing?.status !== "draft"
        }
      />
    );
  }
  return (
    <Dialog
      title={`${existing?.row_version ? "Perbarui" : "Buat"} ${GROWTH_LABELS[kind]}`}
      close={close}
    >
      <form onSubmit={submit}>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
            {/Conflict/i.test(error) && (
              <button type="button" onClick={saved}>
                Muat versi terbaru
              </button>
            )}
          </p>
        )}
        <div className={styles.form}>
          <label className={styles.wide}>
            Judul
            <input
              required
              maxLength={240}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              {GROWTH_STATUSES[kind].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Scope brand
            <select
              disabled={Boolean(existing?.row_version)}
              value={form.brand_id}
              onChange={(e) => set("brand_id", e.target.value)}
            >
              <option value="">Company</option>
              {bootstrap.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>Parent record {idField("parent_id")}</label>
          <label>
            Deadline (WIB)
            <input
              type="datetime-local"
              value={form.due_at}
              onChange={(e) => set("due_at", e.target.value)}
            />
          </label>
          {(
            [
              "pic_id",
              "reviewer_id",
              "recipient_id",
              "blocker_owner_id",
            ] as const
          ).map((field) => (
            <label key={field}>
              {
                {
                  pic_id: "PIC / owner",
                  reviewer_id: "Reviewer",
                  recipient_id: "Penerima permintaan",
                  blocker_owner_id: "Blocker owner",
                }[field]
              }
              <select
                value={form[field]}
                onChange={(e) => set(field, e.target.value)}
              >
                <option value="">Belum ditetapkan</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {person(m.user_id)} · {(m.functions as string[]).join(", ")}
                  </option>
                ))}
                {form[field] &&
                  !members.some((m) => m.user_id === form[field]) && (
                    <option value={form[field]}>{person(form[field])}</option>
                  )}
              </select>
            </label>
          ))}
          {GROWTH_FIELDS[kind].map((field) => {
            const choices =
              field === "outcome"
                ? kind === "result"
                  ? ["success", "failure", "inconclusive"]
                  : ["approved", "rejected", "alternative"]
                : OPTIONS[field];
            return (
              <label
                key={field}
                className={
                  !choices &&
                  !DATE_FIELDS.includes(field) &&
                  !TIME_FIELDS.includes(field) &&
                  !NUMBER_FIELDS.includes(field) &&
                  !field.endsWith("_id")
                    ? styles.wide
                    : undefined
                }
              >
                {FIELD_LABELS[field] || field}
                {choices ? (
                  <select
                    value={form[field]}
                    onChange={(e) => set(field, e.target.value)}
                  >
                    <option value="">Pilih…</option>
                    {choices.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                ) : DATE_FIELDS.includes(field) ? (
                  <input
                    type="date"
                    value={form[field]}
                    onChange={(e) => set(field, e.target.value)}
                  />
                ) : TIME_FIELDS.includes(field) ? (
                  <input
                    type="datetime-local"
                    value={form[field]}
                    onChange={(e) => set(field, e.target.value)}
                  />
                ) : NUMBER_FIELDS.includes(field) ? (
                  <input
                    type="number"
                    step="any"
                    value={form[field]}
                    readOnly={field === "output_version" && kind === "work"}
                    onChange={(e) => set(field, e.target.value)}
                  />
                ) : field === "required_ids" ? (
                  <RecordPicker
                    portfolioId={portfolioId}
                    brandId={form.brand_id ? Number(form.brand_id) : null}
                    value={form[field]}
                    onChange={(value) => set(field, value)}
                    types={["deployment", "dependency"]}
                    candidates={candidates}
                    multiple
                  />
                ) : field.endsWith("_id") ? (
                  idField(field)
                ) : (
                  <textarea
                    value={form[field]}
                    maxLength={10000}
                    onChange={(e) => set(field, e.target.value)}
                    placeholder={
                      field === "required_ids"
                        ? "UUID deployment/dependency dipisahkan koma"
                        : undefined
                    }
                  />
                )}
              </label>
            );
          })}
        </div>
        <p className={styles.muted}>
          Waktu ditafsirkan WIB. Status dan kewenangan akan diperiksa di server.
          Simpan draft untuk melengkapi brief bertahap.
        </p>
        <div className={styles.bar}>
          <button className={styles.primary} disabled={busy} type="submit">
            {busy ? "Menyimpan…" : "Simpan"}
          </button>
          {existing?.row_version && can("growth:manage") && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await saveGrowthRecord({
                    portfolioId,
                    objectId: existing.id,
                    expectedRowVersion: existing.row_version,
                    requestId: crypto.randomUUID(),
                    input: {
                      ...existing,
                      archived_at: new Date().toISOString(),
                    },
                  });
                  saved();
                } catch (e) {
                  setError(message(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Arsipkan record
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

function RecordPicker({
  portfolioId,
  brandId,
  value,
  onChange,
  types,
  candidates,
  multiple = false,
  disabled = false,
}: {
  portfolioId: string;
  brandId: number | null;
  value: string;
  onChange: (value: string) => void;
  types?: GrowthKind[];
  candidates: GrowthRecord[];
  multiple?: boolean;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [kind, setKind] = useState<GrowthKind | undefined>(types?.[0]),
    [open, setOpen] = useState(false),
    [rows, setRows] = useState(candidates),
    [count, setCount] = useState(candidates.length),
    [error, setError] = useState("");
  const selected = value ? value.split(/[\s,]+/).filter(Boolean) : [];
  useEffect(() => {
    if (!open) return;
    let live = true;
    listGrowthRecords({
      portfolioId,
      brandId,
      companyOnly: brandId == null,
      kind,
      search,
      page,
      pageSize: 25,
    })
      .then((data) => {
        if (live) {
          setRows(data.records as GrowthRecord[]);
          setCount(data.count);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [open, portfolioId, brandId, kind, search, page]);
  const known = [...candidates, ...rows];
  function choose(id: string) {
    onChange(multiple ? Array.from(new Set([...selected, id])).join(", ") : id);
    if (!multiple) setOpen(false);
  }
  return (
    <span>
      {selected.map((id) => (
        <span key={id} className={styles.badge}>
          {known.find((r) => r.id === id)?.title || "Record terhubung"}
          {!disabled && (
            <button
              type="button"
              aria-label="Hapus hubungan"
              onClick={() =>
                onChange(selected.filter((value) => value !== id).join(", "))
              }
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <button type="button" onClick={() => setOpen((current) => !current)}>
          {open
            ? "Tutup pilihan"
            : selected.length
              ? multiple
                ? "Tambah prasyarat"
                : "Ganti record"
              : "Pilih record"}
        </button>
      )}
      {open && (
        <span style={{ display: "block", marginTop: 8 }}>
          <input
            aria-label="Cari record terkait"
            placeholder="Cari judul record…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          {types && types.length > 1 && (
            <select
              aria-label="Jenis record terkait"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as GrowthKind);
                setPage(0);
              }}
            >
              {types.map((k) => (
                <option key={k} value={k}>
                  {GROWTH_LABELS[k]}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Pilih record terkait"
            value=""
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">Pilih hasil pencarian…</option>
            {rows
              .filter(
                (r) =>
                  r.brand_id === brandId && (!types || types.includes(r.kind)),
              )
              .map((r) => (
                <option key={r.id} value={r.id}>
                  #{r.short_id} {r.title} · {r.status}
                </option>
              ))}
          </select>
          <span className={styles.bar}>
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Sebelumnya
            </button>
            <button
              type="button"
              disabled={(page + 1) * 25 >= count}
              onClick={() => setPage(page + 1)}
            >
              Berikutnya
            </button>
          </span>
          {error && <span role="alert">{error}</span>}
        </span>
      )}
    </span>
  );
}

function SetupPanel({
  bootstrap,
  portfolioId,
  close,
  saved,
}: {
  bootstrap: Bootstrap;
  portfolioId: string;
  close: () => void;
  saved: () => void;
}) {
  const [kind, setKind] = useState<"portfolio" | "membership" | "mandate">(
      "portfolio",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [membership, setMembership] = useState("");
  const [people, setPeople] = useState(bootstrap.people);
  useEffect(() => {
    let live = true;
    getGrowthConfigurationPeople()
      .then((data) => {
        if (live) setPeople(data);
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, []);
  const [values, setValues] = useState<Record<string, string>>({
    portfolio_id: portfolioId,
    name: "",
    user_id: "",
    functions: "growth",
    managed_functions: "",
    visibility_mode: "own_or_involved",
    company_scope: "false",
    active: "true",
    brand_ids: "",
    actor_id: "",
    domain: "growth_media",
    max_amount: "",
    allowed_actions: "",
    rationale: "",
    effective_from: localTime(new Date().toISOString()),
    effective_to: "",
    supersedes_id: "",
  });
  const set = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  function loadMembership(id: string) {
    setMembership(id);
    const m = bootstrap.memberships.find((m) => m.id === id);
    if (m)
      setValues((current) => ({
        ...current,
        user_id: m.user_id,
        functions: (m.functions as string[]).join(", "),
        managed_functions: (m.managed_functions as string[]).join(", "),
        visibility_mode: m.visibility_mode,
        company_scope: String(m.company_scope),
        active: String(m.active),
        brand_ids: m.growth_membership_brands
          .map((b: { brand_id: number }) => b.brand_id)
          .join(", "),
        effective_from: localTime(m.effective_from),
        effective_to: localTime(m.effective_to),
      }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const input: Record<string, unknown> =
        kind === "portfolio"
          ? { name: values.name }
          : kind === "membership"
            ? {
                user_id: values.user_id,
                functions: values.functions.split(/[\s,]+/).filter(Boolean),
                managed_functions: values.managed_functions
                  .split(/[\s,]+/)
                  .filter(Boolean),
                visibility_mode: values.visibility_mode,
                company_scope: values.company_scope === "true",
                active: values.active === "true",
                brand_ids: values.brand_ids
                  .split(/[\s,]+/)
                  .filter(Boolean)
                  .map(Number),
                effective_from: values.effective_from
                  ? values.effective_from + "+07:00"
                  : null,
                effective_to: values.effective_to
                  ? values.effective_to + "+07:00"
                  : null,
              }
            : {
                actor_id: values.actor_id,
                domain: values.domain,
                brand_id: values.brand_ids ? Number(values.brand_ids) : null,
                max_amount: values.max_amount
                  ? Number(values.max_amount)
                  : null,
                allowed_actions: values.allowed_actions
                  .split(/[\s,]+/)
                  .filter(Boolean),
                rationale: values.rationale,
                effective_from: values.effective_from + "+07:00",
                effective_to: values.effective_to
                  ? values.effective_to + "+07:00"
                  : null,
                supersedes_id: values.supersedes_id || null,
              };
      const m = bootstrap.memberships.find((m) => m.id === membership);
      await configureGrowth({
        portfolioId: kind === "portfolio" ? null : values.portfolio_id,
        objectId: kind === "membership" && m ? m.id : crypto.randomUUID(),
        expectedRowVersion: kind === "membership" && m ? m.row_version : 0,
        requestId: crypto.randomUUID(),
        kind,
        input,
      });
      saved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const fields =
    kind === "portfolio"
      ? ["name"]
      : kind === "membership"
        ? [
            "user_id",
            "functions",
            "managed_functions",
            "visibility_mode",
            "company_scope",
            "active",
            "brand_ids",
            "effective_from",
            "effective_to",
          ]
        : [
            "actor_id",
            "domain",
            "brand_ids",
            "max_amount",
            "allowed_actions",
            "rationale",
            "effective_from",
            "effective_to",
            "supersedes_id",
          ];
  const labels: Record<string, string> = {
    name: "Nama portfolio",
    user_id: "UUID user workspace",
    actor_id: "UUID pemilik mandat",
    functions: "Fungsi: growth, creative, acquisition, sales, ceo",
    managed_functions: "Fungsi yang dikelola, pisahkan koma",
    visibility_mode: "Visibility",
    company_scope: "Scope perusahaan / semua brand",
    active: "Membership aktif",
    brand_ids:
      kind === "mandate"
        ? "Brand ID (kosong = company)"
        : "Brand IDs, pisahkan koma",
    max_amount: "Plafon Rp (kosong = tanpa mandat belanja)",
    allowed_actions: "Kode tindakan, pisahkan koma",
    rationale: "Dasar penetapan mandat",
    effective_from: "Berlaku sejak WIB",
    effective_to: "Berlaku sampai WIB",
    supersedes_id: "UUID mandat yang digantikan",
  };
  return (
    <Dialog title="Konfigurasi Growth Execution" close={close}>
      <p className={styles.muted}>
        Permission teknis diatur melalui Admin. Membership dan mandat di sini
        tidak memberikan akses ke menu BI lama.
      </p>
      <form onSubmit={submit}>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.bar}>
          <select
            aria-label="Jenis konfigurasi"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setMembership("");
            }}
          >
            <option value="portfolio">Portfolio baru</option>
            <option value="membership">Membership</option>
            <option value="mandate">Versi mandat</option>
          </select>
          {kind !== "portfolio" && (
            <select
              aria-label="Portfolio"
              value={values.portfolio_id}
              onChange={(e) => set("portfolio_id", e.target.value)}
            >
              <option value="">Pilih portfolio</option>
              {bootstrap.portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {kind === "membership" && (
            <select
              aria-label="Membership existing"
              value={membership}
              onChange={(e) => loadMembership(e.target.value)}
            >
              <option value="">Membership baru</option>
              {bootstrap.memberships
                .filter((m) => m.portfolio_id === values.portfolio_id)
                .map((m) => (
                  <option value={m.id} key={m.id}>
                    {bootstrap.people.find((p) => p.id === m.user_id)
                      ?.full_name || m.user_id}
                  </option>
                ))}
            </select>
          )}
        </div>
        <div className={styles.form}>
          {fields.map((field) => (
            <label key={field}>
              {field === "user_id"
                ? "Anggota workspace"
                : field === "actor_id"
                  ? "Pemilik mandat"
                  : labels[field] || FIELD_LABELS[field]}
              {["user_id", "actor_id"].includes(field) ? (
                <select
                  required
                  value={values[field]}
                  onChange={(e) => set(field, e.target.value)}
                >
                  <option value="">Pilih aktor</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.full_name || person.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              ) : ["company_scope", "active"].includes(field) ? (
                <select
                  value={values[field]}
                  onChange={(e) => set(field, e.target.value)}
                >
                  <option value="true">Ya</option>
                  <option value="false">Tidak</option>
                </select>
              ) : field === "visibility_mode" ? (
                <select
                  value={values[field]}
                  onChange={(e) => set(field, e.target.value)}
                >
                  <option value="own_or_involved">Own / involved</option>
                  <option value="team">Team</option>
                </select>
              ) : field === "domain" ? (
                <select
                  value={values[field]}
                  onChange={(e) => set(field, e.target.value)}
                >
                  {OPTIONS.domain.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={
                    field.startsWith("effective_")
                      ? "datetime-local"
                      : field === "max_amount"
                        ? "number"
                        : "text"
                  }
                  value={values[field]}
                  onChange={(e) => set(field, e.target.value)}
                  required={
                    ![
                      "effective_to",
                      "supersedes_id",
                      "max_amount",
                      "brand_ids",
                      "managed_functions",
                    ].includes(field)
                  }
                />
              )}
            </label>
          ))}
        </div>
        <div className={styles.bar}>
          <button disabled={busy} className={styles.primary}>
            {busy ? "Menyimpan…" : "Simpan konfigurasi"}
          </button>
        </div>
      </form>
      <details>
        <summary>Membership dan mandat saat ini</summary>
        <pre>
          {JSON.stringify(
            {
              memberships: bootstrap.memberships,
              mandates: bootstrap.mandates,
            },
            null,
            2,
          )}
        </pre>
      </details>
      <p className={styles.muted}>
        Brand IDs:{" "}
        {bootstrap.brands.map((b) => `${b.name} = ${b.id}`).join(" · ")}
        <br />
        UUID Anda: {bootstrap.userId}
      </p>
    </Dialog>
  );
}

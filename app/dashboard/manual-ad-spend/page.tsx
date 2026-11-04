'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Info,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { invalidateAll } from '@/lib/dashboard-cache';
import { getDatePartsInTimeZone } from '@/lib/utils';
import {
  deleteManualMarketplaceSpend,
  getManualMarketplaceSpendPage,
  saveManualMarketplaceSpend,
} from '@/lib/manual-marketplace-ad-spend-actions';
import {
  MANUAL_MARKETPLACE_LABELS,
  selectActiveSheetFallbackRows,
  type ManualMarketplacePlatform,
} from '@/lib/manual-marketplace-ad-spend';
import styles from './page.module.css';

type PageData = Awaited<ReturnType<typeof getManualMarketplaceSpendPage>>;
type Entry = PageData['entries'][number];
type Draft = { id: number | null; version: number | null; date: string; brandId: string; amount: string; note: string };
type Feedback = { tone: 'error' | 'success'; text: string };
type Row = { kind: 'manual'; entry: Entry } | { kind: 'sheet'; fallback: PageData['fallbackRows'][number] };
const money = (amount: number) => `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(amount)}`;
const rowDate = (row: Row) => (row.kind === 'manual' ? row.entry.spend_date : row.fallback.date);
const rowBrand = (row: Row) => (row.kind === 'manual' ? row.entry.brand_id : row.fallback.brand_id);

function freshDraft(month: string, today: string): Draft {
  return {
    id: null,
    version: null,
    date: month === today.slice(0, 7) ? today : `${month}-01`,
    brandId: '',
    amount: '',
    note: '',
  };
}
function hasChanges(draft: Draft) {
  return Boolean(draft.id || draft.brandId || draft.amount || draft.note);
}
function formatDate(date: string) {
  return new Date(`${date}T12:00:00+07:00`).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
}
function formatTimestamp(value: string) {
  return new Date(value).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}
function auditDescription(row: PageData['history'][number], brands: Map<number, string>) {
  const before = row.before_value as { brand_id?: number; spend_date?: string; amount?: number } | null;
  const after = row.after_value as typeof before;
  const describe = (value: typeof before) =>
    `${brands.get(Number(value?.brand_id)) || `Brand #${value?.brand_id}`} · ${value?.spend_date ? formatDate(value.spend_date) : '—'} · ${money(Number(value?.amount || 0))}`;
  return row.action === 'updated' ? `${describe(before)} → ${describe(after)}` : describe(after || before);
}

export default function ManualAdSpendPage() {
  const { activeWorkspace } = useWorkspace();
  return <SpendWorkspace key={activeWorkspace.id} workspaceId={activeWorkspace.id} />;
}

function SpendWorkspace({ workspaceId }: { workspaceId: string }) {
  const today = getDatePartsInTimeZone().iso;
  const [month, setMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [feedback, setFeedback] = useState<Partial<Record<ManualMarketplacePlatform, Feedback>>>({});
  const [busy, setBusy] = useState<{ platform: ManualMarketplacePlatform; action: 'save' | 'delete' } | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<ManualMarketplacePlatform, Draft>>>({});
  const [filters, setFilters] = useState<Partial<Record<ManualMarketplacePlatform, { brand: string; source: string }>>>(
    {},
  );
  const requestId = useRef(0);
  const mutationBusy = useRef(false);

  const load = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await getManualMarketplaceSpendPage(month);
      if (request !== requestId.current) return;
      if (result.workspaceId !== workspaceId) throw new Error('Workspace berubah. Muat ulang halaman.');
      setData(result);
    } catch (cause) {
      if (request === requestId.current)
        setLoadError(cause instanceof Error ? cause.message : 'Gagal memuat biaya iklan.');
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [workspaceId, month]);

  useEffect(() => {
    setData(null);
    setDrafts({});
    setFeedback({});
    setFilters({});
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);
  const dirty = Object.values(drafts).some((draft) => draft && hasChanges(draft));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const brands = useMemo(() => new Map((data?.brands || []).map((brand) => [brand.id, brand.name])), [data]);
  const activeBrands = useMemo(() => (data?.brands || []).filter((brand) => brand.is_active), [data]);
  const disabled = Boolean(busy) || loading;
  const monthLabel = new Date(`${month}-01T12:00:00+07:00`).toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
  const maxDate =
    month === today.slice(0, 7)
      ? today
      : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
  function draftFor(platform: ManualMarketplacePlatform) {
    return drafts[platform] || freshDraft(month, today);
  }
  function updateDraft(platform: ManualMarketplacePlatform, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [platform]: { ...(current[platform] || freshDraft(month, today)), ...patch },
    }));
    setFeedback((current) => ({ ...current, [platform]: undefined }));
  }
  function focusForm(platform: ManualMarketplacePlatform) {
    requestAnimationFrame(() => {
      const input = document.getElementById(`amount-${platform}`);
      input?.focus({ preventScroll: true });
      input?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      });
    });
  }
  function replaceDraft(platform: ManualMarketplacePlatform, draft: Draft) {
    const current = draftFor(platform);
    if (
      (current.id || current.amount || current.note) &&
      !window.confirm('Ganti isian yang belum disimpan? Perubahan pada formulir ini akan dibuang.')
    )
      return;
    updateDraft(platform, draft);
    focusForm(platform);
  }
  function startEdit(entry: Entry) {
    replaceDraft(entry.platform, {
      id: entry.id,
      version: entry.version,
      date: entry.spend_date,
      brandId: String(entry.brand_id),
      amount: String(entry.amount),
      note: entry.note || '',
    });
  }
  function showFeedback(platform: ManualMarketplacePlatform, tone: Feedback['tone'], text: string) {
    setFeedback((current) => ({ ...current, [platform]: { tone, text } }));
  }
  async function save(platform: ManualMarketplacePlatform) {
    if (!data?.canInput || mutationBusy.current || loading) return;
    const draft = draftFor(platform);
    const amount = Number(draft.amount);
    if (
      !draft.brandId ||
      !draft.date ||
      draft.amount.trim() === '' ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > 1_000_000_000_000
    ) {
      showFeedback(platform, 'error', 'Lengkapi tanggal, brand, dan biaya iklan dengan angka yang valid.');
      return;
    }
    if (
      data.entries.some(
        (entry) =>
          entry.platform === platform &&
          entry.brand_id === Number(draft.brandId) &&
          entry.spend_date === draft.date &&
          entry.id !== draft.id,
      )
    ) {
      showFeedback(
        platform,
        'error',
        'Input untuk tanggal dan brand ini sudah ada. Gunakan Edit pada input milik Anda.',
      );
      return;
    }
    mutationBusy.current = true;
    setBusy({ platform, action: 'save' });
    setFeedback((current) => ({ ...current, [platform]: undefined }));
    try {
      await saveManualMarketplaceSpend({
        workspaceId: data.workspaceId,
        id: draft.id,
        platform,
        brandId: Number(draft.brandId),
        date: draft.date,
        amount,
        note: draft.note,
        version: draft.version,
      });
      invalidateAll();
      setDrafts((current) => ({ ...current, [platform]: freshDraft(month, today) }));
      showFeedback(
        platform,
        'success',
        `${MANUAL_MARKETPLACE_LABELS[platform]} · ${money(amount)} tersimpan untuk ${brands.get(Number(draft.brandId)) || 'brand ini'}, ${formatDate(draft.date)}.`,
      );
      await load();
    } catch (cause) {
      showFeedback(
        platform,
        'error',
        cause instanceof Error ? cause.message : 'Gagal menyimpan. Isian Anda tetap tersimpan di formulir; coba lagi.',
      );
    } finally {
      mutationBusy.current = false;
      setBusy(null);
    }
  }
  async function remove(entry: Entry) {
    if (!data?.canInput || entry.created_by !== data.viewerId || mutationBusy.current || loading) return;
    if (
      !window.confirm(
        `Hapus input ${MANUAL_MARKETPLACE_LABELS[entry.platform]} ${brands.get(entry.brand_id) || ''} sebesar ${money(Number(entry.amount))} pada ${formatDate(entry.spend_date)}? Jika tersedia, angka spreadsheet akan kembali dipakai. Riwayat penghapusan tetap tersimpan.`,
      )
    )
      return;
    mutationBusy.current = true;
    setBusy({ platform: entry.platform, action: 'delete' });
    setFeedback((current) => ({ ...current, [entry.platform]: undefined }));
    try {
      await deleteManualMarketplaceSpend({ workspaceId: data.workspaceId, id: entry.id, version: entry.version });
      invalidateAll();
      if (draftFor(entry.platform).id === entry.id)
        setDrafts((current) => ({ ...current, [entry.platform]: freshDraft(month, today) }));
      showFeedback(
        entry.platform,
        'success',
        'Input dihapus. Jika tersedia, angka spreadsheet kembali dipakai untuk MKT Fee.',
      );
      await load();
    } catch (cause) {
      showFeedback(
        entry.platform,
        'error',
        cause instanceof Error ? cause.message : 'Gagal menghapus input. Coba lagi.',
      );
    } finally {
      mutationBusy.current = false;
      setBusy(null);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Input Biaya Iklan</h1>
          <p>Catat biaya harian Shopee Ads dan TikTok Ads untuk perhitungan MKT Fee.</p>
        </div>
        <label className={styles.monthField}>
          Periode pencatatan
          <input
            type="month"
            value={month}
            min="2026-10"
            max={today.slice(0, 7)}
            disabled={Boolean(busy)}
            onChange={(event) => {
              const next = event.target.value;
              if (
                !/^\d{4}-(0[1-9]|1[0-2])$/.test(next) ||
                next < '2026-10' ||
                next > today.slice(0, 7) ||
                next === month
              )
                return;
              if (dirty && !window.confirm('Pindah bulan dan buang isian yang belum disimpan?')) return;
              setData(null);
              setMonth(next);
            }}
          />
        </label>
      </header>

      {data && (
        <details className={styles.guide}>
          <summary>
            <Info size={16} aria-hidden="true" />
            <span>Input manual diprioritaskan untuk MKT Fee</span>
            <ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
          </summary>
          <p>
            Sejak {formatDate(data.startsOn)}, input manual menjadi sumber utama untuk setiap tanggal, brand, dan
            platform. Jika belum ada input, angka Google Sheet yang tersedia tetap dipakai. Input Rp 0 juga menggantikan
            angka spreadsheet. Angka aktual tetap dilihat di dashboard platform masing-masing.
          </p>
        </details>
      )}
      {loadError && (
        <div role="alert" className={styles.error}>
          <AlertCircle size={16} aria-hidden="true" />
          <div>
            {data && <strong>Data belum diperbarui. </strong>}
            {loadError}
          </div>
          <button type="button" className={styles.textButton} disabled={disabled} onClick={() => void load()}>
            <RotateCcw size={14} aria-hidden="true" />
            Coba lagi
          </button>
        </div>
      )}
      {loading && !data && (
        <div className={styles.loading} role="status">
          <span>Memuat catatan biaya iklan…</span>
          <div className={styles.skeleton} aria-hidden="true" />
          <div className={styles.skeleton} aria-hidden="true" />
        </div>
      )}

      {data?.platforms.map((platform) => {
        const entries = data.entries.filter((entry) => entry.platform === platform);
        const fallbackRows = selectActiveSheetFallbackRows(
          entries,
          data.fallbackRows.filter((row) => row.platform === platform),
        );
        const rows: Row[] = [
          ...entries.map((entry) => ({ kind: 'manual' as const, entry })),
          ...fallbackRows.map((fallback) => ({ kind: 'sheet' as const, fallback })),
        ].sort(
          (a, b) =>
            rowDate(b).localeCompare(rowDate(a)) ||
            (brands.get(rowBrand(a)) || '').localeCompare(brands.get(rowBrand(b)) || ''),
        );
        const filter = filters[platform] || { brand: '', source: '' };
        const visibleRows = rows.filter(
          (row) =>
            (!filter.brand || String(rowBrand(row)) === filter.brand) && (!filter.source || row.kind === filter.source),
        );
        const filtered = Boolean(filter.brand || filter.source);
        const draft = draftFor(platform);
        const duplicate = entries.find(
          (entry) =>
            entry.brand_id === Number(draft.brandId) && entry.spend_date === draft.date && entry.id !== draft.id,
        );
        const replacing = fallbackRows.find((row) => row.brand_id === Number(draft.brandId) && row.date === draft.date);
        const visibleManual = visibleRows.filter((row) => row.kind === 'manual');
        const visibleSheet = visibleRows.filter((row) => row.kind === 'sheet');
        const manualTotal = visibleManual.reduce((sum, row) => sum + Number(row.entry.amount), 0);
        const sheetTotal = visibleSheet.reduce((sum, row) => sum + Number(row.fallback.amount), 0);
        const total = manualTotal + sheetTotal;
        const brandLabel = filter.brand ? brands.get(Number(filter.brand)) || `Brand #${filter.brand}` : 'semua brand';
        const sourceLabel = filter.source === 'manual' ? 'Input manual' : filter.source === 'sheet' ? 'Spreadsheet' : '';
        const notice = feedback[platform];
        const formId = `spend-form-${platform}`;
        const editableBrand =
          activeBrands.length > 0 ||
          Boolean(draft.id && data.brands.some((brand) => String(brand.id) === draft.brandId));
        return (
          <section
            key={platform}
            className={styles.section}
            aria-labelledby={`section-${platform}`}
            aria-busy={disabled}
          >
            <div className={styles.sectionHeader}>
              <div>
                <h2 id={`section-${platform}`}>{MANUAL_MARKETPLACE_LABELS[platform]}</h2>
                <p>
                  {monthLabel} · {visibleManual.length} input manual · {visibleSheet.length} spreadsheet
                </p>
              </div>
              <div className={styles.total} aria-live="polite" aria-atomic="true">
                <span>Total MKT Fee · {brandLabel}{sourceLabel && ` · ${sourceLabel}`}</span>
                <strong>{money(total)}</strong>
                <small>
                  Manual {money(manualTotal)} · Spreadsheet {money(sheetTotal)}
                </small>
              </div>
            </div>

            {data.canInput && (
              <form
                id={formId}
                className={styles.form}
                aria-labelledby={`${formId}-title`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(platform);
                }}
              >
                <div className={styles.formHeading}>
                  <h3 id={`${formId}-title`}>
                    {draft.id ? <Pencil size={15} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                    {draft.id ? 'Edit biaya iklan' : 'Tambah biaya harian'}
                  </h3>
                  <span>Satu input per tanggal dan brand</span>
                </div>
                {activeBrands.length === 0 && (
                  <p className={styles.formHint}>
                    Belum ada brand aktif untuk input baru. Hubungi owner workspace untuk memeriksa akses brand.
                  </p>
                )}
                <fieldset className={styles.formFields} disabled={disabled}>
                  <label htmlFor={`date-${platform}`}>
                    Tanggal
                    <input
                      id={`date-${platform}`}
                      type="date"
                      required
                      value={draft.date}
                      min={month === data.startsOn.slice(0, 7) ? data.startsOn : `${month}-01`}
                      max={maxDate}
                      onChange={(event) => updateDraft(platform, { date: event.target.value })}
                    />
                  </label>
                  <label htmlFor={`brand-${platform}`}>
                    Brand
                    <select
                      id={`brand-${platform}`}
                      required
                      value={draft.brandId}
                      onChange={(event) => updateDraft(platform, { brandId: event.target.value })}
                    >
                      <option value="">Pilih brand</option>
                      {activeBrands.map((brand) => (
                        <option key={brand.id} value={brand.id}>
                          {brand.name}
                        </option>
                      ))}
                      {draft.brandId && !activeBrands.some((brand) => String(brand.id) === draft.brandId) && (
                        <option value={draft.brandId}>{brands.get(Number(draft.brandId)) || 'Brand'} (nonaktif)</option>
                      )}
                    </select>
                  </label>
                  <label htmlFor={`amount-${platform}`}>
                    Biaya iklan (Rp)
                    <input
                      id={`amount-${platform}`}
                      type="number"
                      required
                      min="0"
                      max="1000000000000"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="Mis. 150000"
                      value={draft.amount}
                      aria-describedby={`amount-hint-${platform}`}
                      onChange={(event) => updateDraft(platform, { amount: event.target.value })}
                    />
                  </label>
                  <p className={styles.amountHint} id={`amount-hint-${platform}`}>
                    {draft.amount !== '' && Number.isFinite(Number(draft.amount)) && Number(draft.amount) >= 0
                      ? money(Number(draft.amount))
                      : 'Isi 0 jika tidak ada biaya iklan.'}
                  </p>
                  <label className={styles.noteField} htmlFor={`note-${platform}`}>
                    <span>
                      Catatan <span className={styles.optional}>(opsional)</span>
                    </span>
                    <input
                      id={`note-${platform}`}
                      type="text"
                      maxLength={500}
                      placeholder="Mis. koreksi biaya tanggal sebelumnya"
                      value={draft.note}
                      onChange={(event) => updateDraft(platform, { note: event.target.value })}
                    />
                  </label>
                  <div className={styles.formActions}>
                    <button className={styles.primary} type="submit" disabled={!editableBrand || Boolean(duplicate)}>
                      <Save size={15} aria-hidden="true" />
                      {busy?.platform === platform && busy.action === 'save'
                        ? 'Menyimpan…'
                        : draft.id
                          ? 'Simpan perubahan'
                          : 'Simpan biaya'}
                    </button>
                    {hasChanges(draft) && (
                      <button
                        className={styles.secondary}
                        type="button"
                        onClick={() => {
                          if (hasChanges(draft) && !window.confirm('Buang isian yang belum disimpan?')) return;
                          updateDraft(platform, freshDraft(month, today));
                        }}
                      >
                        {draft.id ? 'Batal edit' : 'Kosongkan'}
                      </button>
                    )}
                  </div>
                </fieldset>
                {duplicate ? (
                  <div className={styles.formHint}>
                    <AlertCircle size={15} aria-hidden="true" />
                    <span>
                      Sudah ada input {money(Number(duplicate.amount))} untuk tanggal dan brand ini.
                      {duplicate.created_by !== data.viewerId && ' Hanya pengisinya yang dapat mengubah input.'}
                    </span>
                    {duplicate.created_by === data.viewerId && (
                      <button
                        className={styles.textButton}
                        type="button"
                        disabled={disabled}
                        onClick={() => startEdit(duplicate)}
                      >
                        Edit input ini
                      </button>
                    )}
                  </div>
                ) : (
                  replacing && (
                    <div className={styles.formHint}>
                      <FileSpreadsheet size={15} aria-hidden="true" />
                      <span>
                        Biaya yang disimpan akan menggantikan angka spreadsheet {money(Number(replacing.amount))} untuk
                        tanggal dan brand ini.
                      </span>
                    </div>
                  )
                )}
              </form>
            )}
            {notice && (
              <div
                role={notice.tone === 'error' ? 'alert' : 'status'}
                className={`${styles.feedback} ${notice.tone === 'error' ? styles.error : styles.success}`}
              >
                {notice.tone === 'error' ? (
                  <AlertCircle size={16} aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={16} aria-hidden="true" />
                )}
                <span>{notice.text}</span>
              </div>
            )}

            <div className={styles.tableToolbar}>
              <div>
                <h3>Rincian biaya</h3>
                <p>
                  {filtered ? `${visibleRows.length} dari ${rows.length} catatan` : `${rows.length} catatan`} · terbaru
                  di atas
                </p>
              </div>
              <div className={styles.filters}>
                <select
                  aria-label={`Filter brand ${MANUAL_MARKETPLACE_LABELS[platform]}`}
                  value={filter.brand}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, [platform]: { ...filter, brand: event.target.value } }))
                  }
                >
                  <option value="">Semua brand</option>
                  {data.brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Filter sumber ${MANUAL_MARKETPLACE_LABELS[platform]}`}
                  value={filter.source}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, [platform]: { ...filter, source: event.target.value } }))
                  }
                >
                  <option value="">Semua sumber</option>
                  <option value="manual">Input manual</option>
                  <option value="sheet">Spreadsheet</option>
                </select>
                {filtered && (
                  <button
                    className={styles.textButton}
                    type="button"
                    onClick={() => setFilters((current) => ({ ...current, [platform]: { brand: '', source: '' } }))}
                  >
                    Reset filter
                  </button>
                )}
              </div>
            </div>
            {visibleRows.length > 0 && (
              <p id={`scroll-hint-${platform}`} className={styles.scrollHint}>
                Geser tabel ke samping untuk melihat semua kolom.
              </p>
            )}
            {visibleRows.length === 0 ? (
              <div className={styles.empty}>
                <strong>
                  {filtered ? 'Tidak ada catatan yang cocok' : `Belum ada biaya ${MANUAL_MARKETPLACE_LABELS[platform]}`}
                </strong>
                <p>
                  {filtered
                    ? 'Ubah filter brand atau sumber untuk melihat catatan lainnya.'
                    : `Belum ada input manual atau data spreadsheet untuk ${monthLabel}.${data.canInput ? ' Tambahkan biaya harian melalui formulir di atas.' : ''}`}
                </p>
              </div>
            ) : (
              <div
                className={styles.tableWrap}
                tabIndex={0}
                role="region"
                aria-label={`Rincian biaya ${MANUAL_MARKETPLACE_LABELS[platform]}`}
                aria-describedby={`scroll-hint-${platform}`}
              >
                <table>
                  <caption className={styles.srOnly}>
                    Biaya {MANUAL_MARKETPLACE_LABELS[platform]}, {monthLabel}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Tanggal</th>
                      <th scope="col">Brand / catatan</th>
                      <th scope="col" className={styles.amount}>
                        Biaya iklan
                      </th>
                      <th scope="col">Sumber</th>
                      <th scope="col">Pengisi / diperbarui</th>
                      <th scope="col" className={styles.actionHeading}>
                        Aksi
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => {
                      const entry = row.kind === 'manual' ? row.entry : null;
                      const brand = brands.get(rowBrand(row)) || `Brand #${rowBrand(row)}`;
                      const amount = row.kind === 'manual' ? row.entry.amount : row.fallback.amount;
                      const editing = entry && draft.id === entry.id;
                      return (
                        <tr
                          key={entry ? `manual-${entry.id}` : `sheet-${rowDate(row)}-${rowBrand(row)}`}
                          className={editing ? styles.editingRow : undefined}
                        >
                          <td>
                            <time dateTime={rowDate(row)}>{formatDate(rowDate(row))}</time>
                            {editing && <small className={styles.editingLabel}>Sedang diedit</small>}
                          </td>
                          <td>
                            <div className={styles.brandName}>{brand}</div>
                            {entry?.note && <small className={styles.note}>{entry.note}</small>}
                          </td>
                          <td className={styles.amount}>
                            {money(Number(amount))}
                          </td>
                          <td>
                            <span className={entry ? styles.manualSource : styles.sheetSource}>
                              {entry ? (
                                <Pencil size={12} aria-hidden="true" />
                              ) : (
                                <FileSpreadsheet size={12} aria-hidden="true" />
                              )}
                              {entry ? 'Input manual' : 'Spreadsheet'}
                            </span>
                          </td>
                          <td>
                            {entry ? (
                              <>
                                {entry.created_by === data.viewerId
                                  ? 'Anda'
                                  : data.actorNames[entry.created_by] || 'Pengguna lain'}
                                <small>
                                  <time dateTime={entry.updated_at}>{formatTimestamp(entry.updated_at)} WIB</time>
                                </small>
                              </>
                            ) : (
                              <span className={styles.muted}>Dipakai sampai ada input manual</span>
                            )}
                          </td>
                          <td>
                            <div className={styles.rowActions}>
                              {data.canInput && entry?.created_by === data.viewerId ? (
                                <>
                                  <button
                                    type="button"
                                    className={styles.editButton}
                                    disabled={disabled}
                                    aria-label={`Edit ${brand}, ${formatDate(rowDate(row))}`}
                                    onClick={() => startEdit(entry)}
                                  >
                                    <Pencil size={14} aria-hidden="true" />
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.deleteButton}
                                    disabled={disabled}
                                    aria-label={`Hapus ${brand}, ${formatDate(rowDate(row))}`}
                                    onClick={() => void remove(entry)}
                                  >
                                    <Trash2 size={14} aria-hidden="true" />
                                    Hapus
                                  </button>
                                </>
                              ) : data.canInput && row.kind === 'sheet' ? (
                                <button
                                  type="button"
                                  className={styles.editButton}
                                  disabled={
                                    disabled ||
                                    !data.brands.some((item) => item.id === row.fallback.brand_id && item.is_active)
                                  }
                                  onClick={() =>
                                    replaceDraft(platform, {
                                      ...freshDraft(month, today),
                                      date: row.fallback.date,
                                      brandId: String(row.fallback.brand_id),
                                    })
                                  }
                                >
                                  Ganti dengan input
                                </button>
                              ) : (
                                <span className={styles.muted}>{data.canInput ? 'Hanya pengisi' : 'Lihat saja'}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {filtered && (
              <div className={styles.tableFoot}>
                Total sesuai filter: <strong>{money(total)}</strong> dari {visibleRows.length} catatan.
              </div>
            )}
          </section>
        );
      })}
      {data && (
        <details className={styles.history}>
          <summary>
            <span>
              Riwayat perubahan <span className={styles.historyCount}>{data.history.length} terbaru</span>
            </span>
            <ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
          </summary>
          <p>Perubahan terbaru lintas periode. Waktu ditampilkan dalam WIB.</p>
          {data.history.length === 0 ? (
            <p>Belum ada perubahan yang tercatat.</p>
          ) : (
            <ul>
              {data.history.map((row) => (
                <li key={row.id}>
                  <time dateTime={row.changed_at}>{formatTimestamp(row.changed_at)}</time>
                  <strong>
                    {row.action === 'created' ? 'Input' : row.action === 'updated' ? 'Koreksi' : 'Hapus'} ·{' '}
                    {MANUAL_MARKETPLACE_LABELS[row.platform as ManualMarketplacePlatform]} ·{' '}
                    {row.changed_by === data.viewerId ? 'Anda' : data.actorNames[row.changed_by] || 'Pengguna lain'}
                  </strong>
                  <span>{auditDescription(row, brands)}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}

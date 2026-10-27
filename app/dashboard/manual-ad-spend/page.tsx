'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { invalidateAll } from '@/lib/dashboard-cache';
import { getDatePartsInTimeZone, fmtRupiah } from '@/lib/utils';
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
type SheetFallback = PageData['fallbackRows'][number];
type Draft = {
  id: number | null;
  version: number | null;
  date: string;
  brandId: string;
  amount: string;
  note: string;
};

function firstDateInMonth(month: string, today: string) {
  return month === today.slice(0, 7) ? today : `${month}-01`;
}

function freshDraft(month: string, today: string): Draft {
  return { id: null, version: null, date: firstDateInMonth(month, today), brandId: '', amount: '', note: '' };
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00+07:00`).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta',
  });
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

function auditDescription(row: PageData['history'][number], brands: Map<number, string>) {
  const before = row.before_value as { brand_id?: number; spend_date?: string; amount?: number } | null;
  const after = row.after_value as { brand_id?: number; spend_date?: string; amount?: number } | null;
  const current = after || before;
  if (!current) return '';
  const subject = `${brands.get(Number(current.brand_id)) || `Brand #${current.brand_id}`} · ${current.spend_date ? formatDate(current.spend_date) : '—'}`;
  if (row.action === 'created') return `${subject} · ${fmtRupiah(Number(after?.amount || 0))}`;
  if (row.action === 'deleted') return `${subject} · ${fmtRupiah(Number(before?.amount || 0))}`;
  const previousSubject = `${brands.get(Number(before?.brand_id)) || `Brand #${before?.brand_id}`} · ${before?.spend_date ? formatDate(before.spend_date) : '—'}`;
  const previousAmount = fmtRupiah(Number(before?.amount || 0));
  const nextAmount = fmtRupiah(Number(after?.amount || 0));
  return previousSubject === subject
    ? `${subject} · ${previousAmount} → ${nextAmount}`
    : `${previousSubject} · ${previousAmount} → ${subject} · ${nextAmount}`;
}

export default function ManualAdSpendPage() {
  const { activeWorkspace } = useWorkspace();
  const today = getDatePartsInTimeZone().iso;
  const [month, setMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyPlatform, setBusyPlatform] = useState<ManualMarketplacePlatform | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<ManualMarketplacePlatform, Draft>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setData(null);
    setError('');
    try {
      const result = await getManualMarketplaceSpendPage(month);
      if (result.workspaceId !== activeWorkspace.id) throw new Error('Workspace berubah. Muat ulang halaman.');
      setData(result);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : 'Gagal memuat biaya iklan.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace.id, month]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setDrafts({}); setMessage(''); }, [month, activeWorkspace.id]);

  const brands = useMemo(() => new Map((data?.brands || []).map((brand) => [brand.id, brand.name])), [data]);
  const activeBrands = useMemo(() => (data?.brands || []).filter((brand) => brand.is_active), [data]);

  function draftFor(platform: ManualMarketplacePlatform) {
    return drafts[platform] || freshDraft(month, today);
  }

  function updateDraft(platform: ManualMarketplacePlatform, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [platform]: { ...(current[platform] || freshDraft(month, today)), ...patch } }));
  }

  function startEdit(entry: Entry) {
    updateDraft(entry.platform, {
      id: entry.id,
      version: entry.version,
      date: entry.spend_date,
      brandId: String(entry.brand_id),
      amount: String(entry.amount),
      note: entry.note || '',
    });
    setMessage('');
    document.getElementById(`spend-form-${entry.platform}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function startReplace(platform: ManualMarketplacePlatform, fallback: SheetFallback) {
    updateDraft(platform, {
      id: null,
      version: null,
      date: fallback.date,
      brandId: String(fallback.brand_id),
      amount: '',
      note: '',
    });
    setMessage('Isi biaya aktual untuk menggantikan angka spreadsheet pada tanggal dan brand ini.');
    document.getElementById(`spend-form-${platform}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function save(platform: ManualMarketplacePlatform) {
    if (!data || !data.canInput) return;
    const draft = draftFor(platform);
    const amount = Number(draft.amount);
    if (!draft.brandId || draft.amount.trim() === '' || !Number.isFinite(amount) || amount < 0) {
      setError('Pilih brand dan isi jumlah spend yang valid.');
      return;
    }
    setBusyPlatform(platform); setError(''); setMessage('');
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
      setMessage(`Input ${MANUAL_MARKETPLACE_LABELS[platform]} tersimpan. Nilai ini sekarang dipakai untuk MKT Fee.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal menyimpan input.');
    } finally { setBusyPlatform(null); }
  }

  async function remove(entry: Entry) {
    if (!data || !data.canInput || entry.created_by !== data.viewerId) return;
    if (!window.confirm(`Hapus input ${MANUAL_MARKETPLACE_LABELS[entry.platform]} ${brands.get(entry.brand_id) || ''} pada ${formatDate(entry.spend_date)}? Jika tersedia, angka spreadsheet akan kembali dipakai. Riwayat penghapusan tetap tersimpan.`)) return;
    setBusyPlatform(entry.platform); setError(''); setMessage('');
    try {
      await deleteManualMarketplaceSpend({ workspaceId: data.workspaceId, id: entry.id, version: entry.version });
      invalidateAll();
      setMessage('Input dihapus. Jika ada, angka spreadsheet kembali dipakai untuk MKT Fee.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal menghapus input.');
    } finally { setBusyPlatform(null); }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Input Biaya Iklan</h1>
          <p>Catat spend harian Shopee Ads dan TikTok Ads untuk MKT Fee BI. Angka aktual tetap dilihat di dashboard platform masing-masing.</p>
        </div>
        <label className={styles.monthField}>Bulan
          <input type="month" value={month} min="2026-10" max={today.slice(0, 7)} onChange={(event) => setMonth(event.target.value)} />
        </label>
      </header>

      {data && <p className={styles.cutover}>Sejak {formatDate(data.startsOn)}, input advertiser menjadi sumber utama. Jika belum ada input untuk tanggal, brand, dan platform tertentu, MKT Fee memakai angka Google Sheet yang tersedia.</p>}
      {error && <div role="alert" className={styles.error}>{error} <button type="button" onClick={() => void load()}>Muat ulang</button></div>}
      {message && <div role="status" className={styles.success}>{message}</div>}
      {loading && !data && <div className={styles.state}>Memuat catatan biaya iklan…</div>}

      {data?.platforms.map((platform) => {
        const entries = data.entries.filter((entry) => entry.platform === platform);
        const fallbackRows = selectActiveSheetFallbackRows(entries,
          data.fallbackRows.filter((row) => row.platform === platform));
        const rows: Array<{ kind: 'manual'; entry: Entry } | { kind: 'sheet'; fallback: SheetFallback }> = [
          ...entries.map((entry) => ({ kind: 'manual' as const, entry })),
          ...fallbackRows.map((fallback) => ({ kind: 'sheet' as const, fallback })),
        ].sort((left, right) => {
          const leftDate = left.kind === 'manual' ? left.entry.spend_date : left.fallback.date;
          const rightDate = right.kind === 'manual' ? right.entry.spend_date : right.fallback.date;
          return rightDate.localeCompare(leftDate);
        });
        const draft = draftFor(platform);
        const busy = busyPlatform === platform;
        const total = entries.reduce((sum, entry) => sum + Number(entry.amount), 0)
          + fallbackRows.reduce((sum, row) => sum + Number(row.amount), 0);
        return (
          <section key={platform} className={styles.section} aria-labelledby={`section-${platform}`}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 id={`section-${platform}`}>{MANUAL_MARKETPLACE_LABELS[platform]}</h2>
                <p>{entries.length} input manual · {fallbackRows.length} dari spreadsheet</p>
              </div>
              <div className={styles.total}><span>Total dipakai di MKT Fee</span><strong>{fmtRupiah(total)}</strong></div>
            </div>

            {data.canInput && <form id={`spend-form-${platform}`} className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(platform); }}>
              <div className={styles.formTitle}>{draft.id ? 'Perbaiki input Anda' : 'Tambah spend harian'}</div>
              <label>Tanggal
                <input type="date" required value={draft.date} min={month === data.startsOn.slice(0, 7) ? data.startsOn : `${month}-01`}
                  max={month === today.slice(0, 7) ? today : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10)}
                  onChange={(event) => updateDraft(platform, { date: event.target.value })} />
              </label>
              <label>Brand
                <select required value={draft.brandId} onChange={(event) => updateDraft(platform, { brandId: event.target.value })}>
                  <option value="">Pilih brand</option>
                  {activeBrands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                  {draft.brandId && !activeBrands.some((brand) => String(brand.id) === draft.brandId)
                    && <option value={draft.brandId}>{brands.get(Number(draft.brandId)) || 'Brand'} (nonaktif)</option>}
                </select>
              </label>
              <label>Spend (Rp)
                <input type="number" required min="0" max="1000000000000" step="0.01" inputMode="decimal" placeholder="0"
                  value={draft.amount} onChange={(event) => updateDraft(platform, { amount: event.target.value })} />
              </label>
              <label className={styles.noteField}>Catatan <span>(opsional)</span>
                <input type="text" maxLength={500} placeholder="Mis. koreksi biaya tanggal sebelumnya"
                  value={draft.note} onChange={(event) => updateDraft(platform, { note: event.target.value })} />
              </label>
              <div className={styles.formActions}>
                <button className={styles.primary} type="submit" disabled={busy || loading || activeBrands.length === 0}>{busy ? 'Menyimpan…' : draft.id ? 'Simpan perbaikan' : 'Simpan biaya'}</button>
                {draft.id && <button className={styles.secondary} type="button" onClick={() => updateDraft(platform, freshDraft(month, today))}>Batal edit</button>}
              </div>
            </form>}

            {rows.length === 0 ? <div className={styles.empty}>Belum ada input atau data spreadsheet {MANUAL_MARKETPLACE_LABELS[platform]} untuk bulan ini.</div> : (
              <div className={styles.tableWrap} tabIndex={0} aria-label={`Daftar input ${MANUAL_MARKETPLACE_LABELS[platform]}, dapat digeser secara horizontal`}>
                <table>
                  <thead><tr><th>Tanggal</th><th>Brand</th><th>Spend</th><th>Sumber</th><th>Catatan</th><th>Pengisi</th><th>Diperbarui</th><th>Aksi</th></tr></thead>
                  <tbody>{rows.map((row) => {
                    if (row.kind === 'manual') {
                      const entry = row.entry;
                      return <tr key={`manual-${entry.id}`}>
                      <td>{formatDate(entry.spend_date)}</td>
                      <td>{brands.get(entry.brand_id) || `Brand #${entry.brand_id}`}</td>
                      <td className={styles.amount}>{fmtRupiah(Number(entry.amount))}</td>
                      <td><span className={styles.manualSource}>Input manual</span></td>
                      <td>{entry.note || '—'}</td>
                      <td>{entry.created_by === data.viewerId ? 'Anda' : data.actorNames[entry.created_by] || 'Advertiser lain'}</td>
                      <td>{formatTimestamp(entry.updated_at)}</td>
                      <td>{data.canInput && entry.created_by === data.viewerId ? <div className={styles.rowActions}>
                        <button type="button" disabled={busy} onClick={() => startEdit(entry)}>Edit</button>
                        <button type="button" disabled={busy} onClick={() => void remove(entry)}>Hapus</button>
                      </div> : '—'}</td>
                    </tr>;
                    }
                    return <tr key={`sheet-${row.fallback.date}-${row.fallback.brand_id}`}>
                      <td>{formatDate(row.fallback.date)}</td>
                      <td>{brands.get(row.fallback.brand_id) || `Brand #${row.fallback.brand_id}`}</td>
                      <td className={styles.amount}>{fmtRupiah(Number(row.fallback.amount))}</td>
                      <td><span className={styles.sheetSource}>Spreadsheet</span></td>
                      <td>Dipakai sampai ada input manual</td>
                      <td>—</td><td>—</td>
                      <td>{data.canInput ? <div className={styles.rowActions}>
                        <button type="button" disabled={busy} onClick={() => startReplace(platform, row.fallback)}>Ganti dengan input</button>
                      </div> : '—'}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {data && <details className={styles.history}>
        <summary>Riwayat perubahan ({data.history.length} terbaru)</summary>
        {data.history.length === 0 ? <p>Belum ada perubahan yang tercatat.</p> : <ul>
          {data.history.map((row) => <li key={row.id}>
            <span>{formatTimestamp(row.changed_at)}</span>
            <strong>{row.action === 'created' ? 'Input' : row.action === 'updated' ? 'Koreksi' : 'Hapus'} · {MANUAL_MARKETPLACE_LABELS[row.platform as ManualMarketplacePlatform]} · {row.changed_by === data.viewerId ? 'Anda' : data.actorNames[row.changed_by] || 'Advertiser'}</strong>
            <span>{auditDescription(row, brands)}</span>
          </li>)}
        </ul>}
      </details>}
    </div>
  );
}

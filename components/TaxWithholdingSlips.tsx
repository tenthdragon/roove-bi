'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  commitRekapanImport,
  deleteTaxSlip,
  getTaxObjectCodes,
  listTaxSlips,
  previewRekapanImport,
  previewTaxSlip,
  saveTaxSlip,
  type DocumentType,
  type RekapanImportPreview,
  type RekapanImportResult,
  type SlipStatus,
  type TaxObjectCodeOption,
  type TaxSlip,
  type TaxSlipTotals,
} from '@/lib/tax-withholding-slip-actions';
import {
  createTaxExportBatch,
  getTaxExportBatchXml,
  previewTaxExport,
  voidExportedTaxSlip,
  type TaxExportPreview,
} from '@/lib/tax-withholding-export-actions';
import type { TaxCounterparty, TaxWithholdingEntity } from '@/lib/tax-withholding-actions';
import { DOCUMENT_TYPES, IDENTITY_LABELS, TAX_ARTICLE_LABELS, formatIdentity, type TaxArticle } from '@/lib/tax-withholding-domain';
import type { GrossInputMode } from '@/lib/tax-withholding-rules';

type PageMessage = { type: 'success' | 'error'; text: string };
type Notify = (message: PageMessage) => void;

const STATUS_LABELS: Record<SlipStatus, string> = {
  draft: 'Draft', ready: 'Siap', exported: 'Di-export', reported: 'Dilaporkan', paid: 'Dibayar',
};
const STATUS_TONE: Record<SlipStatus, 'muted' | 'accent' | 'yellow' | 'green' | 'green'> = {
  draft: 'muted', ready: 'accent', exported: 'yellow', reported: 'green', paid: 'green',
};
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const DOCUMENT_LABELS: Record<DocumentType, string> = {
  CommercialInvoice: 'Surat Tagihan / Invoice', TaxInvoice: 'Faktur Pajak', Contract: 'Kontrak', PaymentProof: 'Bukti Pembayaran',
  StatementLetter: 'Surat Pernyataan', Announchment: 'Pengumuman', DeedofEngangement: 'Akta Perjanjian',
  DeedofGeneralMeetingStakeholder: 'Akta RUPS', BankAccountNumber: 'Nomor Rekening',
};

const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const formatMoney = (value: string | number | null | undefined, decimals = 0) => {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return decimals > 0
    ? new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(number)
    : rupiah.format(number);
};
const formatDate = (date: string | null) => {
  if (!date) return '—';
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Terjadi kesalahan.');
const todayIso = () => new Date().toISOString().slice(0, 10);
const formatDateTime = (value: string) => new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
function downloadXml(fileName: string, xml: string) {
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const inputStyle = {
  width: '100%', border: '1px solid var(--border)', borderRadius: 8,
  background: 'var(--input-bg)', color: 'var(--text)', padding: '10px 12px', fontSize: 13, boxSizing: 'border-box',
} as const;
const labelStyle = { display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 } as const;
const secondaryButtonStyle = {
  border: '1px solid var(--border)', borderRadius: 8, padding: '9px 14px',
  color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer', fontWeight: 650,
} as const;
const primaryButtonStyle = {
  border: 0, borderRadius: 8, padding: '10px 16px', background: 'var(--accent-solid)', color: '#fff', fontWeight: 700, cursor: 'pointer',
} as const;
const cellStyle = { padding: '11px 12px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' } as const;
const headCellStyle = { ...cellStyle, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--dim)', textAlign: 'left' } as const;
const numberCellStyle = { ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } as const;

function StatusPill({ tone, children }: { tone: 'green' | 'yellow' | 'red' | 'muted' | 'accent'; children: ReactNode }) {
  const palette = {
    green: { background: 'var(--green-subtle)', color: 'var(--green)' },
    yellow: { background: 'color-mix(in srgb, var(--yellow) 14%, transparent)', color: 'var(--yellow)' },
    red: { background: 'color-mix(in srgb, var(--red) 14%, transparent)', color: 'var(--red)' },
    muted: { background: 'var(--input-bg)', color: 'var(--dim)' },
    accent: { background: 'var(--accent-subtle)', color: 'var(--accent)' },
  }[tone];
  return <span className="tw-pill" style={palette}>{children}</span>;
}

function SummaryCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="tw-summary-card">
      <div style={{ color: 'var(--dim)', fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 750, marginTop: 6, overflowWrap: 'anywhere' }}>{value}</div>
      {hint ? <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

function ModalShell({ title, subtitle, onClose, maxWidth = 760, children }: {
  title: string; subtitle?: string; onClose: () => void; maxWidth?: number; children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', handleKeyDown);
    const timer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled])')?.focus();
    }, 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(timer);
    };
  }, []);
  return (
    <div className="tw-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="tw-modal-panel" style={{ maxWidth }}>
        <div className="tw-modal-header">
          <div>
            <h2 id={titleId} style={{ margin: 0, fontSize: 17 }}>{title}</h2>
            {subtitle ? <div style={{ color: 'var(--dim)', fontSize: 12, marginTop: 4 }}>{subtitle}</div> : null}
          </div>
          <button type="button" onClick={onClose} className="tw-close-button" aria-label="Tutup dialog">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function useObjectCodes(notify: Notify, enabled: boolean) {
  const [codes, setCodes] = useState<TaxObjectCodeOption[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getTaxObjectCodes().then((rows) => { if (!cancelled) setCodes(rows); }).catch((error) => notify({ type: 'error', text: errorText(error) }));
    return () => { cancelled = true; };
  }, [notify, enabled]);
  return codes;
}

// ---------------------------------------------------------------------------
// Daftar bukti potong
// ---------------------------------------------------------------------------

export function SlipsSection({ entities, counterparties, canManage, notify }: {
  entities: TaxWithholdingEntity[]; counterparties: TaxCounterparty[]; canManage: boolean; notify: Notify;
}) {
  const activeEntities = useMemo(() => entities.filter((entity) => entity.is_active), [entities]);
  const now = useMemo(() => new Date(), []);
  const [entityId, setEntityId] = useState<number>(activeEntities[0]?.id ?? entities[0]?.id ?? 0);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [statusFilter, setStatusFilter] = useState<SlipStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [slips, setSlips] = useState<TaxSlip[]>([]);
  const [totals, setTotals] = useState<TaxSlipTotals | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<TaxSlip | 'new' | null>(null);
  const [deleting, setDeleting] = useState<TaxSlip | null>(null);
  const [exporting, setExporting] = useState(false);
  const [voiding, setVoiding] = useState<TaxSlip | null>(null);
  const loadSequence = useRef(0);
  const selectedEntity = entities.find((entity) => entity.id === entityId);
  const canEdit = canManage && Boolean(selectedEntity?.is_active);
  // Reference codes are only needed once there is a withholding entity to file for.
  const objectCodes = useObjectCodes(notify, activeEntities.length > 0);

  useEffect(() => {
    if (!entities.some((entity) => entity.id === entityId)) setEntityId(activeEntities[0]?.id ?? entities[0]?.id ?? 0);
  }, [entities, activeEntities, entityId]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setSlips([]);
    setTotals(null);
    if (!entityId) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await listTaxSlips({ entityId, year, month, status: statusFilter, search });
      if (sequence !== loadSequence.current) return;
      setSlips(result.slips);
      setTotals(result.totals);
    } catch (error) {
      if (sequence === loadSequence.current) notify({ type: 'error', text: errorText(error) });
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [entityId, year, month, statusFilter, search, notify]);

  useEffect(() => {
    void load();
    return () => { loadSequence.current++; };
  }, [load]);

  const remove = async () => {
    if (!deleting) return;
    try {
      await deleteTaxSlip(deleting.id);
      notify({ type: 'success', text: 'Bukti potong dihapus.' });
      setDeleting(null);
      await load();
    } catch (error) {
      notify({ type: 'error', text: errorText(error) });
    }
  };

  const years = useMemo(() => {
    const current = now.getFullYear();
    return [current + 1, current, current - 1, current - 2];
  }, [now]);

  if (entities.length === 0) {
    return <div className="tw-notice">Belum ada pemotong. Tambahkan NPWP PT di bagian Pemotong sebelum membuat bukti potong.</div>;
  }

  return (
    <>
      {totals ? (
        <div className="tw-summary-grid">
          <SummaryCard label="Bukti potong masa ini" value={totals.count} hint={`Draft ${totals.byStatus.draft} · Siap ${totals.byStatus.ready} · Dilaporkan ${totals.byStatus.reported + totals.byStatus.paid}`} />
          <SummaryCard label="Total DPP" value={formatMoney(totals.grossAmount)} />
          <SummaryCard label="Total PPh dipotong" value={formatMoney(totals.withholdingAmount)} />
          <SummaryCard label="Per pasal" value={totals.byArticle.length === 0 ? '—' : totals.byArticle.map((row) => `${TAX_ARTICLE_LABELS[row.article]} ${formatMoney(row.withholdingAmount)}`).join(' · ')} />
        </div>
      ) : null}

      <section className="tw-section">
        <div className="tw-toolbar">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select aria-label="Pemotong" className="tw-filter" value={entityId} onChange={(event) => setEntityId(Number(event.target.value))}>
              {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.legal_name}{entity.is_active ? '' : ' (nonaktif)'}</option>)}
            </select>
            <select aria-label="Masa pajak" className="tw-filter" value={month} onChange={(event) => setMonth(Number(event.target.value))}>
              {MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
            </select>
            <select aria-label="Tahun pajak" className="tw-filter" value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {years.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="tw-toolbar-actions">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari vendor, invoice, kode…" className="tw-filter tw-search" aria-label="Cari bukti potong" />
            <select aria-label="Filter status" className="tw-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as SlipStatus | 'all')}>
              <option value="all">Semua status</option>
              {(Object.keys(STATUS_LABELS) as SlipStatus[]).map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
            </select>
            {canManage ? <button type="button" style={secondaryButtonStyle} disabled={!canEdit} onClick={() => setExporting(true)}>Export XML</button> : null}
            {canManage ? <button type="button" style={primaryButtonStyle} disabled={!canEdit} onClick={() => setEditing('new')}>+ Tambah</button> : null}
          </div>
        </div>

        {selectedEntity && !selectedEntity.is_active ? <div className="tw-notice">Pemotong nonaktif. Riwayat bukti potong tetap dapat dilihat; aktifkan pemotong untuk membuat atau mengubah bukti potong.</div> : null}
        {loading && slips.length === 0 ? (
          <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 13 }}>Memuat…</div>
        ) : slips.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
            Belum ada bukti potong untuk {MONTHS[month - 1]} {year}. Tambah manual atau impor REKAPAN di bagian Impor.
          </div>
        ) : (
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1080, fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={headCellStyle}>Tanggal</th>
                  <th style={headCellStyle}>Invoice</th>
                  <th style={headCellStyle}>Lawan transaksi</th>
                  <th style={headCellStyle}>Objek</th>
                  <th style={{ ...headCellStyle, textAlign: 'right' }}>DPP</th>
                  <th style={{ ...headCellStyle, textAlign: 'right' }}>Tarif</th>
                  <th style={{ ...headCellStyle, textAlign: 'right' }}>PPh</th>
                  <th style={headCellStyle}>Status</th>
                  {canManage ? <th style={headCellStyle}></th> : null}
                </tr>
              </thead>
              <tbody>
                {slips.map((slip) => (
                  <tr key={slip.id}>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{formatDate(slip.invoice_date)}</td>
                    <td style={cellStyle}>
                      <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{slip.invoice_number}</div>
                      {slip.description ? <div style={{ color: 'var(--dim)', fontSize: 12, marginTop: 2 }}>{slip.description}</div> : null}
                    </td>
                    <td style={cellStyle}>
                      <div>{slip.counterparty_name}</div>
                      <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 2 }}>{IDENTITY_LABELS[slip.counterparty_identity_type]} {formatIdentity(slip.counterparty_identity_type, slip.counterparty_identity_number)}</div>
                    </td>
                    <td style={cellStyle}>
                      <div className="tw-mono">{slip.object_code}</div>
                      <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 2 }}>{TAX_ARTICLE_LABELS[slip.pph_article]}{slip.facility_code !== 'N/A' ? ` · ${slip.facility_code}` : ''}</div>
                    </td>
                    <td style={numberCellStyle}>{formatMoney(slip.gross_amount, 2)}</td>
                    <td style={numberCellStyle}>{slip.rate_percent}%{slip.rate_source === 'override' ? ' *' : ''}</td>
                    <td style={numberCellStyle}>
                      {formatMoney(slip.withholding_amount)}
                      {slip.workbook_withholding_amount !== null && slip.workbook_withholding_amount !== slip.withholding_amount
                        ? <div style={{ color: 'var(--yellow)', fontSize: 11 }}>workbook {formatMoney(slip.workbook_withholding_amount)}</div>
                        : null}
                    </td>
                    <td style={cellStyle}>
                      <StatusPill tone={STATUS_TONE[slip.status]}>{STATUS_LABELS[slip.status]}</StatusPill>
                      {slip.coretax_slip_number ? <div className="tw-mono" style={{ marginTop: 4 }}>{slip.coretax_slip_number}</div> : null}
                      {slip.export_batch_id ? <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 4 }}>Batch #{slip.export_batch_id}</div> : null}
                      {slip.status === 'draft' && slip.voided_from_batch_id ? <div style={{ color: 'var(--yellow)', fontSize: 11, marginTop: 4 }}>Dibatalkan dari batch #{slip.voided_from_batch_id}</div> : null}
                    </td>
                    {canManage ? (
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {canEdit && (slip.status === 'draft' || slip.status === 'ready') ? (
                          <>
                            <button type="button" className="tw-action-button" style={{ color: 'var(--accent)' }} onClick={() => setEditing(slip)}>Edit</button>
                            <button type="button" className="tw-action-button" style={{ color: 'var(--red)' }} onClick={() => setDeleting(slip)}>Hapus</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="tw-action-button" style={{ color: 'var(--accent)' }} onClick={() => setEditing(slip)}>Lihat</button>
                            {canEdit && slip.status === 'exported' ? <button type="button" className="tw-action-button" style={{ color: 'var(--yellow)' }} onClick={() => setVoiding(slip)}>Batalkan export</button> : null}
                          </>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing ? (
        <SlipForm
          slip={editing === 'new' ? null : editing}
          entityId={entityId}
          entities={editing === 'new' ? activeEntities : entities}
          counterparties={counterparties}
          objectCodes={objectCodes}
          readOnly={!canEdit || (editing !== 'new' && editing.status !== 'draft' && editing.status !== 'ready')}
          onClose={() => setEditing(null)}
          onSaved={async (text) => { notify({ type: 'success', text }); setEditing(null); await load(); }}
        />
      ) : null}

      {exporting && selectedEntity ? (
        <ExportModal
          entity={selectedEntity}
          year={year}
          month={month}
          onClose={() => setExporting(false)}
          onChanged={load}
          notify={notify}
        />
      ) : null}

      {voiding ? (
        <VoidModal
          slip={voiding}
          onClose={() => setVoiding(null)}
          onDone={async () => { notify({ type: 'success', text: 'Bukti potong dikembalikan ke draft dan keluar dari batch.' }); setVoiding(null); await load(); }}
        />
      ) : null}

      {deleting ? (
        <ModalShell title="Hapus bukti potong?" subtitle={`${deleting.invoice_number} · ${deleting.counterparty_name}`} onClose={() => setDeleting(null)} maxWidth={460}>
          <div className="tw-modal-body"><div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Bukti potong draft/siap akan dihapus permanen. Bukti potong yang sudah di-export tidak bisa dihapus dari sini.</div></div>
          <div className="tw-modal-actions">
            <button type="button" style={secondaryButtonStyle} onClick={() => setDeleting(null)}>Batal</button>
            <button type="button" style={{ ...primaryButtonStyle, background: 'var(--red-solid)' }} onClick={() => void remove()}>Hapus</button>
          </div>
        </ModalShell>
      ) : null}
    </>
  );
}

function ExportModal({ entity, year, month, onClose, onChanged, notify }: {
  entity: TaxWithholdingEntity; year: number; month: number; onClose: () => void; onChanged: () => Promise<void>; notify: Notify;
}) {
  const [preview, setPreview] = useState<TaxExportPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | number | null>(null);
  const [onlyBlocked, setOnlyBlocked] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPreview(await previewTaxExport({ entityId: entity.id, year, month }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [entity.id, year, month]);

  useEffect(() => { void refresh(); }, [refresh]);

  // One batch takes at most maxBatchSlips; the rest stay ready for the next batch.
  const batchIds = preview ? preview.eligibleIds.slice(0, preview.maxBatchSlips) : [];
  const deferredCount = preview ? preview.eligibleIds.length - batchIds.length : 0;

  const create = async () => {
    if (!preview || batchIds.length === 0) return;
    setBusy('create');
    setError(null);
    try {
      const result = await createTaxExportBatch({ entityId: entity.id, year, month, slipIds: batchIds });
      downloadXml(result.fileName, result.xml);
      notify({ type: 'success', text: `Batch ${result.fileName} dibuat: ${result.slipCount} bukti potong berstatus di-export.` });
      await Promise.all([refresh(), onChanged()]);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const redownload = async (batchId: number) => {
    setBusy(batchId);
    try {
      const result = await getTaxExportBatchXml(batchId);
      downloadXml(result.fileName, result.xml);
    } catch (err) {
      notify({ type: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const rows = preview ? preview.rows.filter((row) => !onlyBlocked || row.errors.length > 0) : [];
  const canCreate = batchIds.length > 0 && Boolean(preview && preview.entityErrors.length === 0) && busy === null;

  return (
    <ModalShell title="Export XML BPPU" subtitle={`${entity.legal_name} · ${MONTHS[month - 1]} ${year}`} onClose={onClose} maxWidth={980}>
      <div className="tw-modal-body" style={{ display: 'grid', gap: 14 }}>
        {error ? <div className="tw-notice" style={{ color: 'var(--red)' }}>{error}</div> : null}
        {loading && !preview ? <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Memuat pratinjau…</div> : null}
        {preview ? (
          <>
            {preview.entityErrors.length > 0 ? <div className="tw-notice" style={{ color: 'var(--red)' }}>Pemotong belum siap: {preview.entityErrors.join(' ')}</div> : null}
            <div className="tw-summary-grid">
              <SummaryCard label="Siap masuk XML" value={batchIds.length} hint={`${deferredCount > 0 ? `${deferredCount} lagi ke batch berikutnya · ` : ''}${preview.totals.blockedCount} terblokir · ${preview.statusCounts.exported} sudah di-export · ${preview.statusCounts.reported + preview.statusCounts.paid} dilaporkan`} />
              <SummaryCard label="Total DPP batch" value={formatMoney(preview.totals.grossAmount)} />
              <SummaryCard label="Total PPh batch" value={formatMoney(preview.totals.withholdingAmount)} />
              <SummaryCard label="Nama file berikutnya" value={preview.nextFileName} hint={`TIN ${preview.entity.npwp}`} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Semua bukti potong berstatus siap yang lolos validasi masuk ke satu file. Baris terblokir tetap di luar batch; perbaiki lalu buat batch berikutnya. Vendor non-residen (TIN asing) tidak dilaporkan lewat BPPU.
            </div>
            {deferredCount > 0 ? <div className="tw-notice">Satu file memuat maksimal {preview.maxBatchSlips} bukti potong. Batch ini mengambil {batchIds.length} bukti potong pertama; {deferredCount} sisanya tetap berstatus siap untuk batch berikutnya.</div> : null}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={onlyBlocked} onChange={(event) => setOnlyBlocked(event.target.checked)} />
              Tampilkan hanya yang terblokir
            </label>
            {rows.length === 0 ? (
              <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
                {preview.rows.length === 0 ? 'Tidak ada bukti potong draft atau siap di masa ini.' : 'Tidak ada baris terblokir.'}
              </div>
            ) : (
              <div className="table-scroll" style={{ maxHeight: 360 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 840, fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={headCellStyle}>Tanggal</th>
                      <th style={headCellStyle}>Invoice</th>
                      <th style={headCellStyle}>Lawan transaksi</th>
                      <th style={headCellStyle}>Objek</th>
                      <th style={{ ...headCellStyle, textAlign: 'right' }}>DPP</th>
                      <th style={{ ...headCellStyle, textAlign: 'right' }}>PPh</th>
                      <th style={headCellStyle}>Validasi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{formatDate(row.invoice_date)}</td>
                        <td style={cellStyle}><div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{row.invoice_number}</div></td>
                        <td style={cellStyle}>{row.counterparty_name}<div style={{ color: 'var(--dim)', fontSize: 11 }}>{IDENTITY_LABELS[row.counterparty_identity_type]}</div></td>
                        <td style={cellStyle}><span className="tw-mono">{row.object_code}</span>{row.facility_code !== 'N/A' ? <div style={{ color: 'var(--dim)', fontSize: 11 }}>{row.facility_code}</div> : null}</td>
                        <td style={numberCellStyle}>{formatMoney(row.gross_amount, 2)}</td>
                        <td style={numberCellStyle}>{formatMoney(row.withholding_amount)}</td>
                        <td style={cellStyle}>
                          {row.errors.length === 0
                            ? <StatusPill tone="green">Masuk batch</StatusPill>
                            : <><StatusPill tone="red">Terblokir</StatusPill><div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>{row.errors.join(' ')}</div></>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Riwayat batch masa ini</div>
              {preview.batches.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--dim)' }}>Belum ada batch.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={headCellStyle}>File</th>
                      <th style={headCellStyle}>Dibuat</th>
                      <th style={{ ...headCellStyle, textAlign: 'right' }}>Bupot</th>
                      <th style={{ ...headCellStyle, textAlign: 'right' }}>PPh</th>
                      <th style={headCellStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.batches.map((batch) => (
                      <tr key={batch.id}>
                        <td style={cellStyle}><div className="tw-mono" style={{ overflowWrap: 'anywhere' }}>{batch.file_name}</div><div style={{ color: 'var(--dim)', fontSize: 11 }}>sha256 {batch.xml_sha256.slice(0, 12)}…</div></td>
                        <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{formatDateTime(batch.created_at)}</td>
                        <td style={numberCellStyle}>{batch.current_slip_count}{batch.current_slip_count !== batch.slip_count ? <div style={{ color: 'var(--yellow)', fontSize: 11 }}>dari {batch.slip_count}, sisanya dibatalkan</div> : null}</td>
                        <td style={numberCellStyle}>{formatMoney(batch.total_withholding)}</td>
                        <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button type="button" className="tw-action-button" style={{ color: 'var(--accent)' }} disabled={busy !== null} onClick={() => void redownload(batch.id)}>Unduh ulang</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : null}
      </div>
      <div className="tw-modal-actions">
        <button type="button" style={secondaryButtonStyle} onClick={onClose}>Tutup</button>
        <button type="button" style={secondaryButtonStyle} disabled={loading || busy !== null} onClick={() => void refresh()}>Muat ulang</button>
        <button type="button" style={primaryButtonStyle} disabled={!canCreate} onClick={() => void create()}>
          {busy === 'create' ? 'Membuat batch…' : `Buat batch & unduh XML${preview ? ` (${batchIds.length})` : ''}`}
        </button>
      </div>
    </ModalShell>
  );
}

function VoidModal({ slip, onClose, onDone }: { slip: TaxSlip; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await voidExportedTaxSlip({ slipId: slip.id, reason });
      await onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <ModalShell title="Batalkan dari batch export?" subtitle={`${slip.invoice_number} · ${slip.counterparty_name} · batch #${slip.export_batch_id ?? '-'}`} onClose={onClose} maxWidth={520}>
      <div className="tw-modal-body" style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Bukti potong kembali ke status draft agar bisa diperbaiki dan masuk batch berikutnya. File XML batch yang sudah dibuat tidak berubah; pastikan bukti potong ini juga dibatalkan atau tidak diunggah di Coretax.
        </div>
        <label style={labelStyle}>
          Alasan pembatalan
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Contoh: DPP salah, invoice direvisi vendor" />
        </label>
        {error ? <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div> : null}
      </div>
      <div className="tw-modal-actions">
        <button type="button" style={secondaryButtonStyle} onClick={onClose} disabled={busy}>Batal</button>
        <button type="button" style={{ ...primaryButtonStyle, background: 'var(--yellow-solid)' }} disabled={busy || reason.trim().length < 5} onClick={() => void submit()}>Kembalikan ke draft</button>
      </div>
    </ModalShell>
  );
}

type SlipFormState = {
  entityId: number;
  counterpartyId: number | null;
  counterpartyQuery: string;
  invoiceDate: string;
  invoiceNumber: string;
  description: string;
  objectCode: string;
  objectQuery: string;
  grossInputMode: GrossInputMode;
  grossInputAmount: string;
  additionalCost: string;
  rateOverridePercent: string;
  rateOverrideReason: string;
  documentType: DocumentType;
  documentDate: string;
  withholdingDate: string;
  accountCode: string;
  accountName: string;
  trelloUrl: string;
  notes: string;
};

function SlipForm({ slip, entityId, entities, counterparties, objectCodes, readOnly, onClose, onSaved }: {
  slip: TaxSlip | null; entityId: number; entities: TaxWithholdingEntity[]; counterparties: TaxCounterparty[];
  objectCodes: TaxObjectCodeOption[]; readOnly: boolean; onClose: () => void; onSaved: (text: string) => Promise<void>;
}) {
  const [form, setForm] = useState<SlipFormState>(() => slip ? {
    entityId: slip.entity_id, counterpartyId: slip.counterparty_id, counterpartyQuery: slip.counterparty_name,
    invoiceDate: slip.invoice_date, invoiceNumber: slip.invoice_number, description: slip.description ?? '',
    objectCode: slip.object_code, objectQuery: slip.object_code, grossInputMode: slip.gross_input_mode, grossInputAmount: slip.gross_input_amount,
    additionalCost: slip.additional_cost === '0' ? '' : slip.additional_cost,
    rateOverridePercent: slip.rate_source === 'override' ? slip.rate_percent : '', rateOverrideReason: slip.rate_override_reason ?? '',
    documentType: slip.document_type, documentDate: slip.document_date, withholdingDate: slip.withholding_date,
    accountCode: slip.account_code ?? '', accountName: slip.account_name ?? '', trelloUrl: slip.trello_url ?? '', notes: slip.notes ?? '',
  } : {
    entityId, counterpartyId: null, counterpartyQuery: '', invoiceDate: todayIso(), invoiceNumber: '', description: '',
    objectCode: '', objectQuery: '', grossInputMode: 'total_incl_vat', grossInputAmount: '', additionalCost: '',
    rateOverridePercent: '', rateOverrideReason: '', documentType: 'CommercialInvoice', documentDate: '', withholdingDate: '',
    accountCode: '', accountName: '', trelloUrl: '', notes: '',
  });
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewTaxSlip>> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof SlipFormState>(key: K, value: SlipFormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const counterpartyMatches = useMemo(() => {
    const needle = form.counterpartyQuery.trim().toLowerCase();
    if (!needle) return [];
    const digits = needle.replace(/\D/g, '');
    return counterparties.filter((row) => row.is_active && (row.name.toLowerCase().includes(needle) || (digits.length >= 4 && row.identity_number.includes(digits)))).slice(0, 8);
  }, [counterparties, form.counterpartyQuery]);
  const selectedCounterparty = counterparties.find((row) => row.id === form.counterpartyId) ?? null;

  const objectMatches = useMemo(() => {
    const needle = form.objectQuery.trim().toLowerCase();
    if (!needle) return [];
    return objectCodes.filter((row) => row.code.includes(needle) || row.name.toLowerCase().includes(needle)).slice(0, 8);
  }, [objectCodes, form.objectQuery]);
  const selectedObject = objectCodes.find((row) => row.code === form.objectCode) ?? null;

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setPreviewError(null);
    // A read-only (exported/reported) slip shows what was stored, never a
    // recomputation against today's master data.
    if (readOnly) return;
    if (!form.counterpartyId || !form.objectCode || !form.invoiceDate || !form.grossInputAmount) return;
    const timer = window.setTimeout(() => {
      previewTaxSlip({
        entityId: form.entityId, counterpartyId: form.counterpartyId!, invoiceDate: form.invoiceDate, invoiceNumber: form.invoiceNumber || '-',
        objectCode: form.objectCode, grossInputMode: form.grossInputMode, grossInputAmount: form.grossInputAmount,
        additionalCost: form.additionalCost || null, rateOverridePercent: form.rateOverridePercent || null,
      }).then((result) => { if (!cancelled) { setPreview(result); setPreviewError(null); } })
        .catch((err) => { if (!cancelled) { setPreview(null); setPreviewError(errorText(err)); } });
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [readOnly, form.entityId, form.counterpartyId, form.objectCode, form.invoiceDate, form.grossInputMode, form.grossInputAmount, form.additionalCost, form.rateOverridePercent, form.invoiceNumber]);

  const submit = async () => {
    if (!form.counterpartyId) { setError('Pilih lawan transaksi dari daftar.'); return; }
    if (!form.objectCode) { setError('Pilih kode objek pajak dari daftar.'); return; }
    setSaving(true);
    setError(null);
    try {
      await saveTaxSlip({
        id: slip?.id ?? null, entityId: form.entityId, counterpartyId: form.counterpartyId, invoiceDate: form.invoiceDate,
        invoiceNumber: form.invoiceNumber, description: form.description, objectCode: form.objectCode,
        grossInputMode: form.grossInputMode, grossInputAmount: form.grossInputAmount, additionalCost: form.additionalCost || null,
        rateOverridePercent: form.rateOverridePercent || null, rateOverrideReason: form.rateOverrideReason || null,
        documentType: form.documentType, documentDate: form.documentDate || null, withholdingDate: form.withholdingDate || null,
        periodMonth: slip?.period_month ?? null, periodYear: slip?.period_year ?? null,
        accountCode: form.accountCode, accountName: form.accountName, trelloUrl: form.trelloUrl, notes: form.notes,
      });
      await onSaved(slip ? 'Bukti potong diperbarui.' : 'Bukti potong ditambahkan.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const disabled = readOnly || saving;
  return (
    <ModalShell title={slip ? (readOnly ? 'Detail bukti potong' : 'Edit bukti potong') : 'Tambah bukti potong'} subtitle={slip ? `Status ${STATUS_LABELS[slip.status]}${slip.coretax_slip_number ? ` · nomor Coretax ${slip.coretax_slip_number}` : ''}` : undefined} onClose={onClose} maxWidth={820}>
      <div className="tw-modal-body">
        <div className="tw-grid-2">
          <label style={labelStyle}>Pemotong
            <select style={inputStyle} value={form.entityId} onChange={(event) => update('entityId', Number(event.target.value))} disabled={disabled || Boolean(slip)}>
              {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.legal_name}</option>)}
            </select>
          </label>
          <label style={labelStyle}>Tanggal invoice
            <input type="date" style={inputStyle} value={form.invoiceDate} onChange={(event) => update('invoiceDate', event.target.value)} disabled={disabled} />
          </label>
          <label style={labelStyle}>Nomor invoice
            <input style={inputStyle} value={form.invoiceNumber} onChange={(event) => update('invoiceNumber', event.target.value)} placeholder="INV/2026/10/0001" disabled={disabled} />
          </label>
          <label style={labelStyle}>Keterangan transaksi
            <input style={inputStyle} value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="Grab Express - RTI (161026)" disabled={disabled} />
          </label>

          <div style={labelStyle} className="tw-span-2">Lawan transaksi
            <input style={inputStyle} value={form.counterpartyQuery} disabled={disabled}
              onChange={(event) => { update('counterpartyQuery', event.target.value); update('counterpartyId', null); }}
              placeholder="Ketik nama atau NPWP/NIK…" aria-label="Cari lawan transaksi" />
            {readOnly && slip ? (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Identitas saat dilaporkan: {IDENTITY_LABELS[slip.counterparty_identity_type]} {formatIdentity(slip.counterparty_identity_type, slip.counterparty_identity_number)}
              </div>
            ) : selectedCounterparty ? (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {IDENTITY_LABELS[selectedCounterparty.identity_type]} {formatIdentity(selectedCounterparty.identity_type, selectedCounterparty.identity_number)}
                {selectedCounterparty.is_pkp ? ' · PKP' : ' · bukan PKP'} · {selectedCounterparty.country_code}
                {selectedCounterparty.facilities.length > 0 ? ` · fasilitas: ${selectedCounterparty.facilities.map((f) => f.facility_code).join(', ')}` : ''}
                {selectedCounterparty.identity_type === 'unknown' ? ' · identitas belum lengkap, bupot akan tersimpan sebagai draft' : ''}
              </div>
            ) : counterpartyMatches.length > 0 ? (
              <div style={{ display: 'grid', gap: 2, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {counterpartyMatches.map((row) => (
                  <button key={row.id} type="button" onClick={() => { update('counterpartyId', row.id); update('counterpartyQuery', row.name); }}
                    style={{ textAlign: 'left', border: 0, background: 'var(--input-bg)', padding: '8px 10px', cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
                    {row.name} <span style={{ color: 'var(--dim)', fontSize: 11 }}>{IDENTITY_LABELS[row.identity_type]} {formatIdentity(row.identity_type, row.identity_number)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div style={labelStyle} className="tw-span-2">Kode objek pajak
            <input style={inputStyle} value={form.objectQuery} disabled={disabled}
              onChange={(event) => { update('objectQuery', event.target.value); update('objectCode', ''); }}
              placeholder="Ketik kode (24-104-24) atau nama jasa…" aria-label="Cari kode objek pajak" />
            {selectedObject ? (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{selectedObject.name} · {TAX_ARTICLE_LABELS[selectedObject.pph_article]} · tarif dasar {selectedObject.rate_percent}%</div>
            ) : objectMatches.length > 0 ? (
              <div style={{ display: 'grid', gap: 2, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {objectMatches.map((row) => (
                  <button key={row.code} type="button" onClick={() => { update('objectCode', row.code); update('objectQuery', row.code); }}
                    style={{ textAlign: 'left', border: 0, background: 'var(--input-bg)', padding: '8px 10px', cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
                    <span className="tw-mono">{row.code}</span> {row.name} <span style={{ color: 'var(--dim)', fontSize: 11 }}>{TAX_ARTICLE_LABELS[row.pph_article]} {row.rate_percent}%</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <label style={labelStyle}>Nominal
            <input style={inputStyle} value={form.grossInputAmount} onChange={(event) => update('grossInputAmount', event.target.value)} placeholder="7600" inputMode="decimal" disabled={disabled} />
          </label>
          <label style={labelStyle}>Nominal yang diisi adalah
            <select style={inputStyle} value={form.grossInputMode} onChange={(event) => update('grossInputMode', event.target.value as GrossInputMode)} disabled={disabled}>
              <option value="total_incl_vat">Total termasuk PPN (sistem membagi 1,11 jika PKP)</option>
              <option value="dpp">DPP langsung</option>
            </select>
          </label>
          <label style={labelStyle}>Biaya tambahan (tidak kena PPh)
            <input style={inputStyle} value={form.additionalCost} onChange={(event) => update('additionalCost', event.target.value)} placeholder="0" inputMode="decimal" disabled={disabled} />
          </label>
          <label style={labelStyle}>Jenis dokumen referensi
            <select style={inputStyle} value={form.documentType} onChange={(event) => update('documentType', event.target.value as DocumentType)} disabled={disabled}>
              {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{DOCUMENT_LABELS[type]}</option>)}
            </select>
          </label>
          <label style={labelStyle}>Tarif manual (%) — kosongkan untuk otomatis
            <input style={inputStyle} value={form.rateOverridePercent} onChange={(event) => update('rateOverridePercent', event.target.value)} placeholder="otomatis" inputMode="decimal" disabled={disabled} />
          </label>
          <label style={labelStyle}>Alasan tarif manual
            <input style={inputStyle} value={form.rateOverrideReason} onChange={(event) => update('rateOverrideReason', event.target.value)} placeholder="wajib jika tarif diubah" disabled={disabled} />
          </label>
          <label style={labelStyle}>Tanggal dokumen (default = tanggal invoice)
            <input type="date" style={inputStyle} value={form.documentDate} onChange={(event) => update('documentDate', event.target.value)} disabled={disabled} />
          </label>
          <label style={labelStyle}>Tanggal pemotongan (default = tanggal invoice)
            <input type="date" style={inputStyle} value={form.withholdingDate} onChange={(event) => update('withholdingDate', event.target.value)} disabled={disabled} />
          </label>
          <label style={labelStyle}>No. akun
            <input style={inputStyle} value={form.accountCode} onChange={(event) => update('accountCode', event.target.value)} disabled={disabled} />
          </label>
          <label style={labelStyle}>Nama akun
            <input style={inputStyle} value={form.accountName} onChange={(event) => update('accountName', event.target.value)} disabled={disabled} />
          </label>
          <label style={labelStyle}>Link Trello
            <input style={inputStyle} value={form.trelloUrl} onChange={(event) => update('trelloUrl', event.target.value)} disabled={disabled} />
          </label>
          <label style={labelStyle}>Catatan
            <input style={inputStyle} value={form.notes} onChange={(event) => update('notes', event.target.value)} disabled={disabled} />
          </label>
        </div>

        <div style={{ padding: 14, borderRadius: 10, background: 'var(--accent-subtle)', display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{readOnly && slip ? 'Angka tersimpan' : 'Perhitungan'}</div>
          {readOnly && slip ? (
            <div className="tw-grid-2" style={{ fontSize: 13 }}>
              <div>DPP <strong>{formatMoney(slip.gross_amount, 2)}</strong></div>
              <div>Tarif <strong>{slip.rate_percent}%</strong>{slip.facility_code !== 'N/A' ? ` (${slip.facility_code}${slip.facility_document_number ? ` ${slip.facility_document_number}` : ''})` : ''}{slip.rate_source === 'override' ? ' · manual' : ''}</div>
              <div>PPh dipotong <strong>{formatMoney(slip.withholding_amount)}</strong></div>
              <div>PPN {slip.vat_rate_percent}% <strong>{formatMoney(slip.vat_amount)}</strong></div>
              <div className="tw-span-2">Total bayar <strong>{formatMoney(slip.total_amount, 2)}</strong></div>
              {slip.rate_override_reason ? <div className="tw-span-2" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Alasan tarif manual: {slip.rate_override_reason}</div> : null}
              {slip.workbook_withholding_amount !== null && slip.workbook_withholding_amount !== slip.withholding_amount ? <div className="tw-span-2" style={{ color: 'var(--yellow)', fontSize: 12 }}>PPh di workbook REKAPAN: {formatMoney(slip.workbook_withholding_amount)}</div> : null}
            </div>
          ) : preview ? (
            <>
              <div className="tw-grid-2" style={{ fontSize: 13 }}>
                <div>DPP <strong>{formatMoney(preview.grossAmount, 2)}</strong></div>
                <div>Tarif <strong>{preview.ratePercent}%</strong>{preview.facilityCode !== 'N/A' ? ` (${preview.facilityCode})` : ''}</div>
                <div>PPh dipotong <strong>{formatMoney(preview.withholdingAmount)}</strong></div>
                <div>PPN {preview.vatRatePercent}% <strong>{formatMoney(preview.vatAmount)}</strong></div>
                <div className="tw-span-2">Total bayar <strong>{formatMoney(preview.totalAmount, 2)}</strong></div>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 12 }}>
                {preview.explanation.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </>
          ) : previewError ? (
            <div style={{ color: 'var(--red)', fontSize: 12 }}>{previewError}</div>
          ) : (
            <div style={{ color: 'var(--dim)', fontSize: 12 }}>Isi lawan transaksi, kode objek, tanggal, dan nominal untuk melihat perhitungan.</div>
          )}
        </div>
        {error ? <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div> : null}
      </div>
      <div className="tw-modal-actions">
        <button type="button" style={secondaryButtonStyle} onClick={onClose} disabled={saving}>{readOnly ? 'Tutup' : 'Batal'}</button>
        {!readOnly ? <button type="button" style={primaryButtonStyle} onClick={() => void submit()} disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</button> : null}
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Impor REKAPAN
// ---------------------------------------------------------------------------

export function RekapanImportSection({ entities, workspaceId, canManage, notify, onImported }: {
  entities: TaxWithholdingEntity[]; workspaceId: string; canManage: boolean; notify: Notify; onImported: () => void;
}) {
  const activeEntities = entities.filter((entity) => entity.is_active);
  const [entityId, setEntityId] = useState<number>(activeEntities[0]?.id ?? 0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RekapanImportPreview | null>(null);
  const [result, setResult] = useState<RekapanImportResult | null>(null);
  const [amountSource, setAmountSource] = useState<'engine' | 'workbook'>('engine');
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const buildFormData = (commit: boolean) => {
    if (!file) throw new Error('Pilih file workbook dahulu.');
    if (!entityId) throw new Error('Pilih pemotong dahulu.');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entityId', String(entityId));
    formData.append('amountSource', amountSource);
    if (commit) formData.append('workspaceId', workspaceId);
    return formData;
  };

  const runPreview = async () => {
    setBusy('preview'); setError(null); setResult(null);
    try { setPreview(await previewRekapanImport(buildFormData(false))); }
    catch (err) { setPreview(null); setError(errorText(err)); }
    finally { setBusy(null); }
  };

  const runCommit = async () => {
    if (!preview) return;
    if (!window.confirm(`Impor ${preview.importable} bukti potong baru ke pemotong terpilih? ${preview.existing} sudah ada dan ${preview.blocked} terblokir akan dilewati.`)) return;
    setBusy('commit'); setError(null);
    try {
      const outcome = await commitRekapanImport(buildFormData(true));
      setResult(outcome);
      setPreview(null);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      notify({ type: 'success', text: `Impor REKAPAN selesai: ${outcome.inserted} masuk, ${outcome.skippedExisting} sudah ada, ${outcome.blocked} terblokir.` });
      onImported();
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(null); }
  };

  const visibleRows = useMemo(() => {
    if (!preview) return [];
    const rows = onlyDifferences ? preview.rows.filter((row) => row.status === 'blocked' || (row.difference !== null && row.difference !== '0')) : preview.rows;
    return rows.slice(0, 200);
  }, [preview, onlyDifferences]);

  return (
    <section className="tw-section">
      <div className="tw-toolbar">
        <div>
          <div style={{ fontSize: 15, fontWeight: 750 }}>Impor sheet REKAPAN (bukti potong historis)</div>
          <div style={{ color: 'var(--dim)', fontSize: 12, marginTop: 2 }}>
            Satu baris sheet menjadi satu bukti potong. Vendor dicocokkan ke master berdasarkan nama lalu NPWP/NIK; PPh dihitung ulang oleh rule engine dan dibandingkan dengan angka workbook.
          </div>
        </div>
      </div>
      <div style={{ padding: 18, display: 'grid', gap: 14 }}>
        {!canManage ? <div className="tw-notice">Impor memerlukan role finance.</div> : null}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select aria-label="Pemotong tujuan" className="tw-filter" value={entityId} onChange={(event) => { setEntityId(Number(event.target.value)); setPreview(null); }} disabled={!canManage || busy !== null}>
            {activeEntities.length === 0 ? <option value={0}>Belum ada pemotong</option> : null}
            {activeEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.legal_name}</option>)}
          </select>
          <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls" disabled={!canManage || busy !== null} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setResult(null); setError(null); }} />
          <button type="button" style={secondaryButtonStyle} disabled={!file || !entityId || !canManage || busy !== null} onClick={() => void runPreview()}>{busy === 'preview' ? 'Membaca…' : 'Pratinjau'}</button>
          <button type="button" style={primaryButtonStyle} disabled={!preview || preview.importable === 0 || !canManage || busy !== null} onClick={() => void runCommit()}>{busy === 'commit' ? 'Mengimpor…' : 'Impor sekarang'}</button>
        </div>
        {error ? <div className="tw-notice" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>{error}</div> : null}

        {preview ? (
          <>
            <div className="tw-summary-grid">
              <SummaryCard label="Baris terbaca" value={preview.totalRows} hint={`${preview.fileName} · sheet ${preview.sheetName}`} />
              <SummaryCard label="Siap diimpor" value={preview.importable} hint={`${preview.existing} sudah ada · ${preview.skipped} baris kosong dilewati`} />
              <SummaryCard label="Terblokir" value={preview.blocked} hint={preview.unmatchedVendors.length > 0 ? `${preview.unmatchedVendors.length} vendor tidak ada di master` : undefined} />
              <SummaryCard label="PPh berbeda dari workbook" value={preview.matchedDifferences} hint="Engine vs angka sheet" />
            </div>
            {preview.unmatchedVendors.length > 0 ? (
              <div className="tw-notice">
                <strong>Vendor belum ada di master</strong> (tambahkan dulu, lalu pratinjau ulang):{' '}
                {preview.unmatchedVendors.slice(0, 20).map((row) => `${row.name} (${row.rows})`).join(', ')}{preview.unmatchedVendors.length > 20 ? ', …' : ''}
              </div>
            ) : null}
            {preview.unknownObjectCodes.length > 0 ? (
              <div className="tw-notice">Kode objek tidak dikenal: {preview.unknownObjectCodes.join(', ')}</div>
            ) : null}
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={onlyDifferences} onChange={(event) => setOnlyDifferences(event.target.checked)} /> Tampilkan hanya yang berbeda atau terblokir
              </label>
              <span style={{ color: 'var(--dim)' }}>Jika PPh berbeda, simpan:</span>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" name="amountSource" checked={amountSource === 'engine'} onChange={() => { setAmountSource('engine'); setPreview(null); }} /> angka engine</label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" name="amountSource" checked={amountSource === 'workbook'} onChange={() => { setAmountSource('workbook'); setPreview(null); }} /> angka workbook (tarif manual yang konsisten; pratinjau ulang)</label>
            </div>
            <div className="table-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980, fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={headCellStyle}>Baris</th>
                    <th style={headCellStyle}>Tanggal</th>
                    <th style={headCellStyle}>Invoice</th>
                    <th style={headCellStyle}>Vendor</th>
                    <th style={headCellStyle}>Objek</th>
                    <th style={{ ...headCellStyle, textAlign: 'right' }}>DPP</th>
                    <th style={{ ...headCellStyle, textAlign: 'right' }}>PPh sheet</th>
                    <th style={{ ...headCellStyle, textAlign: 'right' }}>PPh engine</th>
                    <th style={headCellStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td style={cellStyle}>{row.rowNumber}</td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{formatDate(row.invoiceDate)}</td>
                      <td style={{ ...cellStyle, overflowWrap: 'anywhere' }}>{row.invoiceNumber}{row.coretaxSlipNumber ? <div className="tw-mono" style={{ color: 'var(--dim)' }}>{row.coretaxSlipNumber}</div> : null}</td>
                      <td style={cellStyle}>{row.counterpartyName}</td>
                      <td style={cellStyle}><span className="tw-mono">{row.objectCode}</span> <span style={{ color: 'var(--dim)' }}>{TAX_ARTICLE_LABELS[row.pphArticle as TaxArticle]}</span>{row.facilityCode && row.facilityCode !== 'N/A' ? <div style={{ color: 'var(--dim)' }}>{row.facilityCode}</div> : null}</td>
                      <td style={numberCellStyle}>{formatMoney(row.grossAmount, 2)}</td>
                      <td style={numberCellStyle}>{row.workbookWithholding === null ? '—' : formatMoney(row.workbookWithholding)}{row.workbookRatePercent ? <div style={{ color: 'var(--dim)' }}>{row.workbookRatePercent}%</div> : null}</td>
                      <td style={{ ...numberCellStyle, color: row.difference && row.difference !== '0' ? 'var(--yellow)' : undefined }}>{row.engineWithholding === null ? '—' : formatMoney(row.engineWithholding)}{row.engineRatePercent ? <div style={{ color: 'var(--dim)' }}>{row.engineRatePercent}%</div> : null}</td>
                      <td style={cellStyle}>
                        <StatusPill tone={row.status === 'new' ? 'green' : row.status === 'existing' ? 'muted' : 'red'}>{row.status === 'new' ? 'Baru' : row.status === 'existing' ? 'Sudah ada' : 'Terblokir'}</StatusPill>
                        {row.problems.map((problem) => <div key={problem} style={{ color: 'var(--red)', marginTop: 3 }}>{problem}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > visibleRows.length ? <div style={{ color: 'var(--dim)', fontSize: 12 }}>Menampilkan {visibleRows.length} dari {onlyDifferences ? 'baris yang disaring' : preview.rows.length}.</div> : null}
            {preview.issues.length > 0 ? (
              <div className="tw-issue-list" style={{ padding: 0 }}>
                {preview.issues.slice(0, 100).map((issue, index) => (
                  <div key={`${issue.rowNumber}-${index}`} className="tw-issue">
                    <span style={{ color: issue.level === 'error' ? 'var(--red)' : 'var(--yellow)', fontWeight: 700 }}>Baris {issue.rowNumber}</span>
                    <span><span style={{ fontWeight: 600 }}>{issue.name}</span>{issue.name ? ' — ' : ''}{issue.message}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {result ? (
          <div className="tw-summary-grid">
            <SummaryCard label="Diimpor" value={result.inserted} />
            <SummaryCard label="Sudah ada" value={result.skippedExisting} />
            <SummaryCard label="Terblokir" value={result.blocked} />
            <SummaryCard label="Catatan" value={result.issues.length} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

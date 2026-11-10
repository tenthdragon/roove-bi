'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  commitCounterpartyImport,
  deleteCounterpartyFacility,
  getTaxWithholdingBootstrap,
  previewCounterpartyImport,
  saveCounterparty,
  saveCounterpartyFacility,
  saveWithholdingEntity,
  setCounterpartyActive,
  type CounterpartyImportPreview,
  type CounterpartyImportResult,
  type TaxCounterparty,
  type TaxCounterpartyFacility,
  type TaxWithholdingBootstrap,
  type TaxWithholdingEntity,
} from '@/lib/tax-withholding-actions';
import {
  FACILITY_CODES,
  FACILITY_DEFAULT_ARTICLES,
  FACILITY_LABELS,
  IDENTITY_LABELS,
  IDENTITY_TYPES,
  TAX_ARTICLES,
  TAX_ARTICLE_LABELS,
  facilityExpiryStatus,
  formatIdentity,
  formatNpwp,
  tkuFromNpwp,
  type FacilityCode,
  type IdentityType,
  type TaxArticle,
} from '@/lib/tax-withholding-domain';
import { useWorkspace } from '@/lib/WorkspaceContext';

type SubTab = 'counterparties' | 'entities' | 'import';
type PageMessage = { type: 'success' | 'error'; text: string };

type CounterpartyForm = {
  id: number | null;
  name: string;
  identityType: IdentityType;
  identityNumber: string;
  isPkp: boolean;
  countryCode: string;
  address: string;
  phone: string;
  notes: string;
  isActive: boolean;
};

type FacilityForm = {
  id: number | null;
  facilityCode: FacilityCode;
  documentNumber: string;
  appliesTo: TaxArticle[];
  rateOverride: string;
  validFrom: string;
  validTo: string;
  notes: string;
};

type EntityForm = {
  id: number | null;
  businessId: string;
  legalName: string;
  npwp: string;
  tkuId: string;
  city: string;
  signerName: string;
  signerTitle: string;
  signerNpwp: string;
  isActive: boolean;
};

const EMPTY_COUNTERPARTY: CounterpartyForm = {
  id: null, name: '', identityType: 'npwp', identityNumber: '', isPkp: false,
  countryCode: 'IDN', address: '', phone: '', notes: '', isActive: true,
};
const EMPTY_FACILITY: FacilityForm = {
  id: null, facilityCode: 'TaxExAr23', documentNumber: '', appliesTo: ['pph23'],
  rateOverride: '', validFrom: '', validTo: '', notes: '',
};
const EMPTY_ENTITY: EntityForm = {
  id: null, businessId: '', legalName: '', npwp: '', tkuId: '', city: '',
  signerName: '', signerTitle: 'Direktur Utama', signerNpwp: '', isActive: true,
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const formatDate = (date: string | null) => {
  if (!date) return '—';
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Terjadi kesalahan.');

const inputStyle = {
  width: '100%', border: '1px solid var(--border)', borderRadius: 8,
  background: 'var(--input-bg)', color: 'var(--text)', padding: '10px 12px',
  fontSize: 13, boxSizing: 'border-box',
} as const;
const labelStyle = { display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 } as const;
const secondaryButtonStyle = {
  border: '1px solid var(--border)', borderRadius: 8, padding: '9px 14px',
  color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer', fontWeight: 650,
} as const;
const primaryButtonStyle = {
  border: 0, borderRadius: 8, padding: '10px 16px', background: 'var(--accent-solid)',
  color: '#fff', fontWeight: 700, cursor: 'pointer',
} as const;
const cellStyle = { padding: '12px 14px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' } as const;
const headCellStyle = { ...cellStyle, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--dim)', textAlign: 'left' } as const;

function ModalShell({ title, subtitle, onClose, maxWidth = 620, children }: {
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

function SummaryCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="tw-summary-card">
      <div style={{ color: 'var(--dim)', fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 750, marginTop: 6 }}>{value}</div>
      {hint ? <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

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

function facilityTone(status: ReturnType<typeof facilityExpiryStatus>) {
  if (status === 'expired') return 'red' as const;
  if (status === 'expiring') return 'yellow' as const;
  if (status === 'upcoming') return 'muted' as const;
  return 'green' as const;
}

export default function TaxWithholdingPage() {
  const { activeWorkspace } = useWorkspace();
  const [subTab, setSubTab] = useState<SubTab>('counterparties');
  const [data, setData] = useState<TaxWithholdingBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<PageMessage | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await getTaxWithholdingBootstrap());
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, activeWorkspace.id]);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const today = todayIso();
  const stats = useMemo(() => {
    const rows = data?.counterparties ?? [];
    const active = rows.filter((row) => row.is_active);
    let expiring = 0;
    for (const row of rows) {
      for (const facility of row.facilities) {
        const status = facilityExpiryStatus(facility, today);
        if (status === 'expiring') expiring += 1;
      }
    }
    return {
      total: active.length,
      pkp: active.filter((row) => row.is_pkp).length,
      withFacility: active.filter((row) => row.facilities.some((f) => facilityExpiryStatus(f, today) !== 'expired')).length,
      expiring,
    };
  }, [data, today]);

  return (
    <div className="tax-withholding-page">
      <style>{`
        .tax-withholding-page{display:grid;gap:18px;max-width:1440px;margin:0 auto}
        .tax-withholding-page .tw-page-header{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap}
        .tax-withholding-page .tw-tabs{display:flex;gap:4px;padding:4px;border-radius:10px;background:var(--input-bg);border:1px solid var(--border)}
        .tax-withholding-page .tw-tab{border:0;border-radius:7px;padding:9px 14px;cursor:pointer;font-size:12px;font-weight:700;min-height:38px;background:transparent;color:var(--text-secondary)}
        .tax-withholding-page .tw-tab[aria-selected="true"]{background:var(--accent-solid);color:#fff}
        .tax-withholding-page .tw-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
        .tax-withholding-page .tw-summary-card{padding:18px;border-radius:12px;border:1px solid var(--border);background:var(--card);min-width:0}
        .tax-withholding-page .tw-section{border-radius:14px;border:1px solid var(--border);background:var(--card);overflow:hidden}
        .tax-withholding-page .tw-toolbar{padding:15px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}
        .tax-withholding-page .tw-toolbar-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
        .tax-withholding-page .tw-filter{border:1px solid var(--border);border-radius:8px;background:var(--input-bg);color:var(--text);padding:9px 11px;min-height:38px;font-size:12px}
        .tax-withholding-page .tw-search{min-width:230px}
        .tax-withholding-page .tw-action-button{border:0;background:transparent;cursor:pointer;padding:6px 8px;min-height:32px;font-weight:650;font-size:12px}
        .tax-withholding-page .tw-pill{display:inline-flex;padding:3px 8px;border-radius:999px;font-size:11px;white-space:nowrap;font-weight:600}
        .tax-withholding-page .tw-notice{padding:14px 18px;border-radius:12px;border:1px solid var(--border);background:var(--accent-subtle);color:var(--text-secondary);font-size:13px}
        .tax-withholding-page .tw-modal-backdrop{position:fixed;inset:0;z-index:1000;background:var(--overlay-bg);display:flex;align-items:center;justify-content:center;padding:18px}
        .tax-withholding-page .tw-modal-panel{width:100%;max-height:calc(100dvh - 36px);overflow:auto;background:var(--card);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);outline:none}
        .tax-withholding-page .tw-modal-header{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:17px 20px;border-bottom:1px solid var(--border);background:var(--card)}
        .tax-withholding-page .tw-close-button{width:36px;height:36px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:22px;line-height:1}
        .tax-withholding-page .tw-modal-body{padding:20px;display:grid;gap:16px}
        .tax-withholding-page .tw-grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
        .tax-withholding-page .tw-span-2{grid-column:span 2}
        .tax-withholding-page .tw-modal-actions{position:sticky;bottom:0;z-index:2;padding:14px 20px;border-top:1px solid var(--border);background:var(--card);display:flex;justify-content:flex-end;gap:8px}
        .tax-withholding-page .tw-toast{position:fixed;right:20px;bottom:20px;z-index:1200;max-width:min(420px,calc(100vw - 32px));padding:12px 14px;border-radius:10px;border:1px solid var(--border);box-shadow:var(--shadow);font-size:13px;background:var(--card)}
        .tax-withholding-page .tw-facility-list{display:grid;gap:8px}
        .tax-withholding-page .tw-facility-row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--input-bg)}
        .tax-withholding-page .tw-entity-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;padding:18px}
        .tax-withholding-page .tw-entity-card{padding:16px;border-radius:12px;border:1px solid var(--border);background:var(--input-bg);display:grid;gap:8px}
        .tax-withholding-page .tw-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
        .tax-withholding-page .tw-issue-list{display:grid;gap:6px;max-height:320px;overflow:auto;padding:0 18px 18px}
        .tax-withholding-page .tw-issue{display:grid;grid-template-columns:70px 1fr;gap:10px;padding:8px 10px;border-radius:8px;background:var(--input-bg);font-size:12px}
        @media(max-width:900px){.tax-withholding-page .tw-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:768px){
          .tax-withholding-page .tw-page-header{display:grid}.tax-withholding-page .tw-tabs{width:100%}.tax-withholding-page .tw-tab{flex:1}
          .tax-withholding-page .tw-summary-grid{grid-template-columns:1fr}.tax-withholding-page .tw-search{min-width:0;flex:1}
          .tax-withholding-page .tw-grid-2{grid-template-columns:1fr}.tax-withholding-page .tw-span-2{grid-column:span 1}
          .tax-withholding-page .tw-modal-backdrop{align-items:flex-start;padding:10px}
          .tax-withholding-page .tw-modal-actions{flex-direction:column-reverse}.tax-withholding-page .tw-modal-actions button{width:100%;min-height:44px}
        }
      `}</style>

      <header className="tw-page-header">
        <div>
          <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700, marginBottom: 5 }}>{activeWorkspace.name}</div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Bukti Potong (PPh)</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 13, maxWidth: 640 }}>
            Master data pemotong dan lawan transaksi untuk bukti potong unifikasi Coretax. Input bukti potong dan export XML menyusul di tahap berikutnya.
          </p>
        </div>
        <div role="tablist" aria-label="Bagian" className="tw-tabs">
          {([
            ['counterparties', 'Lawan Transaksi'],
            ['entities', 'Pemotong'],
            ['import', 'Impor Master'],
          ] as Array<[SubTab, string]>).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={subTab === id} className="tw-tab" onClick={() => setSubTab(id)}>{label}</button>
          ))}
        </div>
      </header>

      {loadError ? (
        <div className="tw-notice" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>{loadError}</div>
      ) : loading && !data ? (
        <div className="tw-notice">Memuat data…</div>
      ) : data ? (
        <>
          {!data.canManage ? <div className="tw-notice">Akun ini hanya dapat melihat data. Perubahan memerlukan role finance.</div> : null}
          {subTab === 'counterparties' ? (
            <>
              <div className="tw-summary-grid">
                <SummaryCard label="Lawan transaksi aktif" value={stats.total} />
                <SummaryCard label="Berstatus PKP" value={stats.pkp} hint="Dikenai PPN saat menghitung total" />
                <SummaryCard label="Punya fasilitas" value={stats.withFacility} hint="SKB / PP23 / SKD / DTP" />
                <SummaryCard label="Fasilitas habis ≤ 30 hari" value={stats.expiring} hint={stats.expiring > 0 ? 'Perbarui sebelum masa berikutnya' : undefined} />
              </div>
              <CounterpartiesSection data={data} today={today} onChanged={load} notify={setMessage} />
            </>
          ) : null}
          {subTab === 'entities' ? <EntitiesSection data={data} onChanged={load} notify={setMessage} /> : null}
          {subTab === 'import' ? <ImportSection canManage={data.canManage} onChanged={load} notify={setMessage} /> : null}
        </>
      ) : null}

      {message ? (
        <div role="status" className="tw-toast" style={{ color: message.type === 'error' ? 'var(--red)' : 'var(--green)' }}>{message.text}</div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lawan transaksi
// ---------------------------------------------------------------------------

function CounterpartiesSection({ data, today, onChanged, notify }: {
  data: TaxWithholdingBootstrap; today: string; onChanged: () => Promise<void>; notify: (message: PageMessage) => void;
}) {
  const [search, setSearch] = useState('');
  const [identityFilter, setIdentityFilter] = useState<'all' | IdentityType>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [editing, setEditing] = useState<TaxCounterparty | 'new' | null>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const needleDigits = needle.replace(/\D/g, '');
    return data.counterparties.filter((row) => {
      if (statusFilter === 'active' && !row.is_active) return false;
      if (statusFilter === 'inactive' && row.is_active) return false;
      if (identityFilter !== 'all' && row.identity_type !== identityFilter) return false;
      if (!needle) return true;
      return row.name.toLowerCase().includes(needle)
        || (needleDigits.length >= 4 && row.identity_number.includes(needleDigits))
        || row.identity_number.toLowerCase().includes(needle);
    });
  }, [data.counterparties, search, identityFilter, statusFilter]);

  const toggleActive = async (row: TaxCounterparty) => {
    try {
      await setCounterpartyActive(row.id, !row.is_active);
      notify({ type: 'success', text: `${row.name} ${row.is_active ? 'dinonaktifkan' : 'diaktifkan'}.` });
      await onChanged();
    } catch (error) {
      notify({ type: 'error', text: errorText(error) });
    }
  };

  return (
    <section className="tw-section">
      <div className="tw-toolbar">
        <div>
          <div style={{ fontSize: 15, fontWeight: 750 }}>Master lawan transaksi</div>
          <div style={{ color: 'var(--dim)', fontSize: 12, marginTop: 2 }}>{filtered.length} dari {data.counterparties.length} vendor</div>
        </div>
        <div className="tw-toolbar-actions">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama atau NPWP/NIK…" className="tw-filter tw-search" aria-label="Cari lawan transaksi" />
          <select aria-label="Filter identitas" value={identityFilter} onChange={(event) => setIdentityFilter(event.target.value as typeof identityFilter)} className="tw-filter">
            <option value="all">Semua identitas</option>
            {IDENTITY_TYPES.map((type) => <option key={type} value={type}>{IDENTITY_LABELS[type]}</option>)}
          </select>
          <select aria-label="Filter status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="tw-filter">
            <option value="active">Aktif</option>
            <option value="inactive">Nonaktif</option>
            <option value="all">Semua</option>
          </select>
          {data.canManage ? <button type="button" style={primaryButtonStyle} onClick={() => setEditing('new')}>+ Tambah</button> : null}
        </div>
      </div>

      {data.counterparties.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
          Belum ada lawan transaksi. Impor sheet MASTER LAWAN TRANSAKSI dari workbook REKAP, atau tambah manual.
        </div>
      ) : (
        <div className="table-scroll">
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880, fontSize: 13 }}>
            <thead>
              <tr>
                <th style={headCellStyle}>Nama</th>
                <th style={headCellStyle}>Identitas</th>
                <th style={headCellStyle}>PKP</th>
                <th style={headCellStyle}>Negara</th>
                <th style={headCellStyle}>Fasilitas</th>
                <th style={headCellStyle}>Status</th>
                {data.canManage ? <th style={headCellStyle}></th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} style={{ opacity: row.is_active ? 1 : 0.6 }}>
                  <td style={cellStyle}>
                    <div style={{ fontWeight: 650 }}>{row.name}</div>
                    {row.address ? <div style={{ color: 'var(--dim)', fontSize: 12, marginTop: 2 }}>{row.address}</div> : null}
                  </td>
                  <td style={cellStyle}>
                    {row.identity_type === 'unknown'
                      ? <StatusPill tone="yellow">Belum ada identitas</StatusPill>
                      : <div className="tw-mono">{formatIdentity(row.identity_type, row.identity_number)}</div>}
                    <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 2 }}>{IDENTITY_LABELS[row.identity_type]}</div>
                  </td>
                  <td style={cellStyle}>{row.is_pkp ? <StatusPill tone="accent">PKP</StatusPill> : <span style={{ color: 'var(--dim)' }}>—</span>}</td>
                  <td style={cellStyle}>{row.country_code}</td>
                  <td style={cellStyle}>
                    {row.facilities.length === 0 ? <span style={{ color: 'var(--dim)' }}>—</span> : (
                      <div style={{ display: 'grid', gap: 4 }}>
                        {row.facilities.map((facility) => {
                          const status = facilityExpiryStatus(facility, today);
                          return (
                            <div key={facility.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <StatusPill tone={facilityTone(status)}>{facility.facility_code}</StatusPill>
                              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                {facility.document_number || 'tanpa nomor'}
                                {facility.valid_from || facility.valid_to ? ` · ${formatDate(facility.valid_from)} – ${facility.valid_to ? formatDate(facility.valid_to) : 'tanpa batas'}` : ''}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td style={cellStyle}>
                    <StatusPill tone={row.is_active ? 'green' : 'muted'}>{row.is_active ? 'Aktif' : 'Nonaktif'}</StatusPill>
                  </td>
                  {data.canManage ? (
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button type="button" className="tw-action-button" style={{ color: 'var(--accent)' }} onClick={() => setEditing(row)}>Edit</button>
                      <button type="button" className="tw-action-button" style={{ color: row.is_active ? 'var(--red)' : 'var(--green)' }} onClick={() => void toggleActive(row)}>
                        {row.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <CounterpartyModal
          counterparty={editing === 'new' ? null : editing}
          today={today}
          onClose={() => setEditing(null)}
          onSaved={async (text) => { notify({ type: 'success', text }); await onChanged(); }}
          notify={notify}
        />
      ) : null}
    </section>
  );
}

function CounterpartyModal({ counterparty, today, onClose, onSaved, notify }: {
  counterparty: TaxCounterparty | null; today: string; onClose: () => void;
  onSaved: (text: string) => Promise<void>; notify: (message: PageMessage) => void;
}) {
  const [form, setForm] = useState<CounterpartyForm>(counterparty ? {
    id: counterparty.id, name: counterparty.name, identityType: counterparty.identity_type,
    identityNumber: counterparty.identity_number, isPkp: counterparty.is_pkp, countryCode: counterparty.country_code,
    address: counterparty.address ?? '', phone: counterparty.phone ?? '', notes: counterparty.notes ?? '', isActive: counterparty.is_active,
  } : EMPTY_COUNTERPARTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(counterparty?.id ?? null);
  const [facilities, setFacilities] = useState<TaxCounterpartyFacility[]>(counterparty?.facilities ?? []);
  const [facilityForm, setFacilityForm] = useState<FacilityForm | null>(null);

  const update = <K extends keyof CounterpartyForm>(key: K, value: CounterpartyForm[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveCounterparty({
        id: form.id, name: form.name, identityType: form.identityType, identityNumber: form.identityNumber,
        isPkp: form.isPkp, countryCode: form.countryCode, address: form.address, phone: form.phone, notes: form.notes, isActive: form.isActive,
      });
      setSavedId(saved.id);
      setForm((prev) => ({ ...prev, id: saved.id, identityNumber: saved.identity_number }));
      setFacilities(saved.facilities);
      await onSaved(form.id ? 'Lawan transaksi diperbarui.' : 'Lawan transaksi ditambahkan. Anda bisa menambah fasilitas sekarang.');
      if (form.id) onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const submitFacility = async () => {
    if (!facilityForm || !savedId) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveCounterpartyFacility({
        id: facilityForm.id, counterpartyId: savedId, facilityCode: facilityForm.facilityCode,
        documentNumber: facilityForm.documentNumber, appliesTo: facilityForm.appliesTo, rateOverride: facilityForm.rateOverride,
        validFrom: facilityForm.validFrom || null, validTo: facilityForm.validTo || null, notes: facilityForm.notes,
      });
      setFacilities((prev) => {
        const rest = prev.filter((item) => item.id !== saved.id);
        return [saved, ...rest];
      });
      setFacilityForm(null);
      await onSaved(facilityForm.id ? 'Fasilitas diperbarui.' : 'Fasilitas ditambahkan.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const removeFacility = async (facility: TaxCounterpartyFacility) => {
    if (!window.confirm(`Hapus fasilitas ${facility.facility_code} ${facility.document_number ?? ''}?`)) return;
    try {
      await deleteCounterpartyFacility(facility.id);
      setFacilities((prev) => prev.filter((item) => item.id !== facility.id));
      await onSaved('Fasilitas dihapus.');
    } catch (err) {
      notify({ type: 'error', text: errorText(err) });
    }
  };

  const identityPlaceholder = form.identityType === 'npwp' ? '16 digit (NPWP 15 digit lama otomatis ditambah 0)'
    : form.identityType === 'nik' ? '16 digit NIK'
      : form.identityType === 'unknown' ? 'Kosongkan; lengkapi NPWP/NIK sebelum dipakai di bukti potong'
        : 'Nomor identitas pajak negara asal';

  return (
    <ModalShell title={counterparty ? 'Edit lawan transaksi' : 'Tambah lawan transaksi'} subtitle={counterparty ? `Terakhir diubah ${formatDate(counterparty.updated_at.slice(0, 10))}` : undefined} onClose={onClose} maxWidth={720}>
      <div className="tw-modal-body">
        <div className="tw-grid-2">
          <label style={labelStyle} className="tw-span-2">Nama
            <input style={inputStyle} value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="PT Contoh Jaya" />
          </label>
          <label style={labelStyle}>Jenis identitas
            <select style={inputStyle} value={form.identityType} onChange={(event) => {
              const type = event.target.value as IdentityType;
              update('identityType', type);
              if (type === 'foreign_tin' && form.countryCode === 'IDN') update('countryCode', '');
              if (type !== 'foreign_tin' && !form.countryCode) update('countryCode', 'IDN');
            }}>
              {IDENTITY_TYPES.map((type) => <option key={type} value={type}>{IDENTITY_LABELS[type]}</option>)}
            </select>
          </label>
          <label style={labelStyle}>{IDENTITY_LABELS[form.identityType]}
            <input style={inputStyle} value={form.identityNumber} onChange={(event) => update('identityNumber', event.target.value)} placeholder={identityPlaceholder} />
          </label>
          <label style={labelStyle}>Kode negara (ISO-3)
            <input style={inputStyle} value={form.countryCode} onChange={(event) => update('countryCode', event.target.value.toUpperCase())} placeholder="IDN" maxLength={3} />
          </label>
          <label style={{ ...labelStyle, alignContent: 'end' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 40 }}>
              <input type="checkbox" checked={form.isPkp} onChange={(event) => update('isPkp', event.target.checked)} /> Pengusaha Kena Pajak (PKP)
            </span>
          </label>
          <label style={labelStyle} className="tw-span-2">Alamat
            <input style={inputStyle} value={form.address} onChange={(event) => update('address', event.target.value)} />
          </label>
          <label style={labelStyle}>Telepon
            <input style={inputStyle} value={form.phone} onChange={(event) => update('phone', event.target.value)} />
          </label>
          <label style={labelStyle}>Catatan
            <input style={inputStyle} value={form.notes} onChange={(event) => update('notes', event.target.value)} />
          </label>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Fasilitas perpajakan</div>
            {savedId && !facilityForm ? (
              <button type="button" style={secondaryButtonStyle} onClick={() => setFacilityForm(EMPTY_FACILITY)}>+ Fasilitas</button>
            ) : null}
          </div>
          {!savedId ? (
            <div style={{ color: 'var(--dim)', fontSize: 12 }}>Simpan lawan transaksi dahulu, lalu tambahkan SKB / PP23 / SKD.</div>
          ) : facilities.length === 0 && !facilityForm ? (
            <div style={{ color: 'var(--dim)', fontSize: 12 }}>Belum ada fasilitas. Tanpa fasilitas, tarif normal dari kode objek yang dipakai.</div>
          ) : (
            <div className="tw-facility-list">
              {facilities.map((facility) => {
                const status = facilityExpiryStatus(facility, today);
                return (
                  <div key={facility.id} className="tw-facility-row">
                    <div style={{ display: 'grid', gap: 4 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <StatusPill tone={facilityTone(status)}>{FACILITY_LABELS[facility.facility_code]}</StatusPill>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{facility.applies_to.map((a) => TAX_ARTICLE_LABELS[a]).join(', ')}</span>
                      </div>
                      <div style={{ fontSize: 12 }}>{facility.document_number || <span style={{ color: 'var(--dim)' }}>tanpa nomor dokumen</span>}</div>
                      <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                        Berlaku {facility.valid_from ? formatDate(facility.valid_from) : 'sejak awal'} – {facility.valid_to ? formatDate(facility.valid_to) : 'tanpa batas'}
                        {facility.rate_override !== null ? ` · tarif ${facility.rate_override}%` : ' · tarif 0%'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button type="button" className="tw-action-button" style={{ color: 'var(--accent)' }} onClick={() => setFacilityForm({
                        id: facility.id, facilityCode: facility.facility_code, documentNumber: facility.document_number ?? '',
                        appliesTo: facility.applies_to, rateOverride: facility.rate_override === null ? '' : String(facility.rate_override),
                        validFrom: facility.valid_from ?? '', validTo: facility.valid_to ?? '', notes: facility.notes ?? '',
                      })}>Edit</button>
                      <button type="button" className="tw-action-button" style={{ color: 'var(--red)' }} onClick={() => void removeFacility(facility)}>Hapus</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {facilityForm ? (
            <div style={{ marginTop: 12, padding: 14, border: '1px dashed var(--border)', borderRadius: 10, display: 'grid', gap: 12 }}>
              <div className="tw-grid-2">
                <label style={labelStyle}>Jenis fasilitas
                  <select style={inputStyle} value={facilityForm.facilityCode} onChange={(event) => {
                    const code = event.target.value as FacilityCode;
                    setFacilityForm({ ...facilityForm, facilityCode: code, appliesTo: FACILITY_DEFAULT_ARTICLES[code] });
                  }}>
                    {FACILITY_CODES.map((code) => <option key={code} value={code}>{code} — {FACILITY_LABELS[code]}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>Nomor dokumen
                  <input style={inputStyle} value={facilityForm.documentNumber} onChange={(event) => setFacilityForm({ ...facilityForm, documentNumber: event.target.value })} placeholder="KET-00020/PPUT-CT/KPP.0413/2026" />
                </label>
                <label style={labelStyle}>Berlaku mulai
                  <input type="date" style={inputStyle} value={facilityForm.validFrom} onChange={(event) => setFacilityForm({ ...facilityForm, validFrom: event.target.value })} />
                </label>
                <label style={labelStyle}>Berlaku sampai
                  <input type="date" style={inputStyle} value={facilityForm.validTo} onChange={(event) => setFacilityForm({ ...facilityForm, validTo: event.target.value })} />
                </label>
                <label style={labelStyle}>Tarif khusus (%)
                  <input style={inputStyle} value={facilityForm.rateOverride} onChange={(event) => setFacilityForm({ ...facilityForm, rateOverride: event.target.value })} placeholder="Kosong = 0% (dibebaskan)" inputMode="decimal" />
                </label>
                <div style={labelStyle}>Berlaku untuk pasal
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', minHeight: 40, alignItems: 'center' }}>
                    {TAX_ARTICLES.map((article) => (
                      <label key={article} style={{ display: 'flex', gap: 5, alignItems: 'center', fontWeight: 500, color: 'var(--text)' }}>
                        <input type="checkbox" checked={facilityForm.appliesTo.includes(article)} onChange={(event) => setFacilityForm({
                          ...facilityForm,
                          appliesTo: event.target.checked
                            ? [...facilityForm.appliesTo, article]
                            : facilityForm.appliesTo.filter((item) => item !== article),
                        })} />
                        {TAX_ARTICLE_LABELS[article]}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" style={secondaryButtonStyle} onClick={() => setFacilityForm(null)} disabled={saving}>Batal</button>
                <button type="button" style={primaryButtonStyle} onClick={() => void submitFacility()} disabled={saving}>{facilityForm.id ? 'Simpan fasilitas' : 'Tambah fasilitas'}</button>
              </div>
            </div>
          ) : null}
        </div>

        {error ? <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div> : null}
      </div>
      <div className="tw-modal-actions">
        <button type="button" style={secondaryButtonStyle} onClick={onClose} disabled={saving}>{savedId ? 'Tutup' : 'Batal'}</button>
        <button type="button" style={primaryButtonStyle} onClick={() => void submit()} disabled={saving}>
          {saving ? 'Menyimpan…' : savedId ? 'Simpan perubahan' : 'Simpan'}
        </button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Pemotong
// ---------------------------------------------------------------------------

function EntitiesSection({ data, onChanged, notify }: {
  data: TaxWithholdingBootstrap; onChanged: () => Promise<void>; notify: (message: PageMessage) => void;
}) {
  const [editing, setEditing] = useState<EntityForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const businessLabel = (businessId: number) => {
    const business = data.businesses.find((item) => item.id === businessId);
    return business ? `${business.business_code} · ${business.business_name}` : `Business #${businessId}`;
  };
  const availableBusinesses = data.businesses.filter((business) =>
    business.is_active && (!data.entities.some((entity) => entity.business_id === business.id) || editing?.businessId === String(business.id)));

  const openNew = () => setEditing({ ...EMPTY_ENTITY, businessId: availableBusinesses[0] ? String(availableBusinesses[0].id) : '' });
  const openEdit = (entity: TaxWithholdingEntity) => setEditing({
    id: entity.id, businessId: String(entity.business_id), legalName: entity.legal_name, npwp: entity.npwp, tkuId: entity.tku_id,
    city: entity.city ?? '', signerName: entity.signer_name ?? '', signerTitle: entity.signer_title ?? '', signerNpwp: entity.signer_npwp ?? '', isActive: entity.is_active,
  });

  const submit = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await saveWithholdingEntity({
        id: editing.id, businessId: Number(editing.businessId), legalName: editing.legalName, npwp: editing.npwp,
        tkuId: editing.tkuId || null, city: editing.city, signerName: editing.signerName, signerTitle: editing.signerTitle,
        signerNpwp: editing.signerNpwp, isActive: editing.isActive,
      });
      notify({ type: 'success', text: editing.id ? 'Data pemotong diperbarui.' : 'Pemotong ditambahkan.' });
      setEditing(null);
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const npwpDigits = editing?.npwp.replace(/\D/g, '') ?? '';
  const derivedTku = npwpDigits.length === 16 ? tkuFromNpwp(npwpDigits) : npwpDigits.length === 15 ? tkuFromNpwp(`0${npwpDigits}`) : '';

  return (
    <section className="tw-section">
      <div className="tw-toolbar">
        <div>
          <div style={{ fontSize: 15, fontWeight: 750 }}>Identitas pemotong per PT</div>
          <div style={{ color: 'var(--dim)', fontSize: 12, marginTop: 2 }}>NPWP dan ID TKU yang menjadi &lt;TIN&gt; dan &lt;IDPlaceOfBusinessActivity&gt; di XML Coretax</div>
        </div>
        {data.canManage && availableBusinesses.length > 0 ? (
          <div className="tw-toolbar-actions"><button type="button" style={primaryButtonStyle} onClick={openNew}>+ Tambah pemotong</button></div>
        ) : null}
      </div>
      {data.entities.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
          {data.businesses.length === 0
            ? 'Workspace ini belum memiliki business (RTI, RLB, dll). Daftarkan business dahulu di Business & Fulfillment.'
            : 'Belum ada pemotong. Tambahkan NPWP PT yang memotong PPh.'}
        </div>
      ) : (
        <div className="tw-entity-grid">
          {data.entities.map((entity) => (
            <article key={entity.id} className="tw-entity-card" style={{ opacity: entity.is_active ? 1 : 0.6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>{businessLabel(entity.business_id)}</div>
                  <div style={{ fontWeight: 750, marginTop: 2 }}>{entity.legal_name}</div>
                </div>
                <StatusPill tone={entity.is_active ? 'green' : 'muted'}>{entity.is_active ? 'Aktif' : 'Nonaktif'}</StatusPill>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>NPWP <span className="tw-mono" style={{ color: 'var(--text)' }}>{formatNpwp(entity.npwp)}</span></div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>TKU <span className="tw-mono" style={{ color: 'var(--text)' }}>{entity.tku_id}</span></div>
              {entity.city ? <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{entity.city}</div> : null}
              {entity.signer_name ? (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Penandatangan: <span style={{ color: 'var(--text)' }}>{entity.signer_name}</span>{entity.signer_title ? ` (${entity.signer_title})` : ''}
                </div>
              ) : null}
              {data.canManage ? (
                <div><button type="button" style={{ ...secondaryButtonStyle, color: 'var(--accent)' }} onClick={() => openEdit(entity)}>Edit</button></div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {editing ? (
        <ModalShell title={editing.id ? 'Edit pemotong' : 'Tambah pemotong'} onClose={() => setEditing(null)}>
          <div className="tw-modal-body">
            <div className="tw-grid-2">
              <label style={labelStyle} className="tw-span-2">Business
                <select style={inputStyle} value={editing.businessId} onChange={(event) => setEditing({ ...editing, businessId: event.target.value })} disabled={Boolean(editing.id)}>
                  <option value="">Pilih business…</option>
                  {availableBusinesses.map((business) => <option key={business.id} value={business.id}>{business.business_code} · {business.business_name}</option>)}
                </select>
              </label>
              <label style={labelStyle} className="tw-span-2">Nama badan (sesuai Coretax)
                <input style={inputStyle} value={editing.legalName} onChange={(event) => setEditing({ ...editing, legalName: event.target.value })} placeholder="PT. ROOVE TIJARA INTERNASIONAL" />
              </label>
              <label style={labelStyle}>NPWP pemotong
                <input style={inputStyle} value={editing.npwp} onChange={(event) => setEditing({ ...editing, npwp: event.target.value })} placeholder="94.042.441.9-429.000" />
              </label>
              <label style={labelStyle}>ID TKU (22 digit)
                <input style={inputStyle} value={editing.tkuId} onChange={(event) => setEditing({ ...editing, tkuId: event.target.value })} placeholder={derivedTku || 'Otomatis: NPWP + 000000'} />
              </label>
              <label style={labelStyle}>Kota
                <input style={inputStyle} value={editing.city} onChange={(event) => setEditing({ ...editing, city: event.target.value })} />
              </label>
              <label style={labelStyle}>Nama penandatangan
                <input style={inputStyle} value={editing.signerName} onChange={(event) => setEditing({ ...editing, signerName: event.target.value })} />
              </label>
              <label style={labelStyle}>Jabatan penandatangan
                <input style={inputStyle} value={editing.signerTitle} onChange={(event) => setEditing({ ...editing, signerTitle: event.target.value })} />
              </label>
              <label style={labelStyle}>NPWP penandatangan
                <input style={inputStyle} value={editing.signerNpwp} onChange={(event) => setEditing({ ...editing, signerNpwp: event.target.value })} />
              </label>
              {editing.id ? (
                <label style={{ ...labelStyle, alignContent: 'end' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 40 }}>
                    <input type="checkbox" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} /> Aktif
                  </span>
                </label>
              ) : null}
            </div>
            {error ? <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div> : null}
          </div>
          <div className="tw-modal-actions">
            <button type="button" style={secondaryButtonStyle} onClick={() => setEditing(null)} disabled={saving}>Batal</button>
            <button type="button" style={primaryButtonStyle} onClick={() => void submit()} disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
          </div>
        </ModalShell>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Impor master
// ---------------------------------------------------------------------------

function ImportSection({ canManage, onChanged, notify }: {
  canManage: boolean; onChanged: () => Promise<void>; notify: (message: PageMessage) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CounterpartyImportPreview | null>(null);
  const [result, setResult] = useState<CounterpartyImportResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const buildFormData = () => {
    if (!file) throw new Error('Pilih file workbook dahulu.');
    const formData = new FormData();
    formData.append('file', file);
    return formData;
  };

  const runPreview = async () => {
    setBusy('preview');
    setError(null);
    setResult(null);
    try {
      setPreview(await previewCounterpartyImport(buildFormData()));
    } catch (err) {
      setPreview(null);
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const runCommit = async () => {
    if (!preview) return;
    if (!window.confirm(`Impor ${preview.newCount} lawan transaksi baru dan perbarui ${preview.existingCount} yang sudah ada?`)) return;
    setBusy('commit');
    setError(null);
    try {
      const outcome = await commitCounterpartyImport(buildFormData());
      setResult(outcome);
      setPreview(null);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      notify({ type: 'success', text: `Impor selesai: ${outcome.inserted} baru, ${outcome.updated} diperbarui, ${outcome.facilitiesInserted} fasilitas.` });
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const issues = result?.issues ?? preview?.issues ?? [];
  const errorCount = issues.filter((issue) => issue.level === 'error').length;

  return (
    <section className="tw-section">
      <div className="tw-toolbar">
        <div>
          <div style={{ fontSize: 15, fontWeight: 750 }}>Impor sheet MASTER LAWAN TRANSAKSI</div>
          <div style={{ color: 'var(--dim)', fontSize: 12, marginTop: 2 }}>
            Unggah workbook REKAP POTPUT (.xlsm/.xlsx). Nama, NPWP/NIK, PKP, negara, dan fasilitas SKB/PP23/SKD dibaca dari sheet master.
          </div>
        </div>
      </div>
      <div style={{ padding: 18, display: 'grid', gap: 14 }}>
        {!canManage ? <div className="tw-notice">Impor memerlukan role finance.</div> : null}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls" disabled={!canManage || busy !== null} onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setPreview(null);
            setResult(null);
            setError(null);
          }} />
          <button type="button" style={secondaryButtonStyle} disabled={!file || !canManage || busy !== null} onClick={() => void runPreview()}>
            {busy === 'preview' ? 'Membaca…' : 'Pratinjau'}
          </button>
          <button type="button" style={primaryButtonStyle} disabled={!preview || !canManage || busy !== null} onClick={() => void runCommit()}>
            {busy === 'commit' ? 'Mengimpor…' : 'Impor sekarang'}
          </button>
        </div>
        <div style={{ color: 'var(--dim)', fontSize: 12 }}>
          Aturan: NPWP 15 digit ditambah awalan 0 menjadi 16 digit. Vendor dengan identitas yang sudah ada tidak digandakan; hanya PKP, negara, alamat kosong dan fasilitas baru yang ditambahkan. Baris yang gagal validasi dilaporkan, tidak ditebak.
        </div>

        {error ? <div className="tw-notice" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>{error}</div> : null}

        {preview ? (
          <>
            <div className="tw-summary-grid">
              <SummaryCard label="Baris terbaca" value={preview.totalRows} hint={`${preview.fileName} · sheet ${preview.sheetName}`} />
              <SummaryCard label="Vendor baru" value={preview.newCount} />
              <SummaryCard label="Sudah ada" value={preview.existingCount} hint="Hanya dilengkapi, tidak digandakan" />
              <SummaryCard label="Fasilitas" value={preview.facilityCount} hint={preview.skipped > 0 ? `${preview.skipped} baris dilewati` : undefined} />
            </div>
            <div className="table-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={headCellStyle}>Baris</th>
                    <th style={headCellStyle}>Nama</th>
                    <th style={headCellStyle}>Identitas</th>
                    <th style={headCellStyle}>PKP</th>
                    <th style={headCellStyle}>Negara</th>
                    <th style={headCellStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row) => (
                    <tr key={row.rowNumber}>
                      <td style={cellStyle}>{row.rowNumber}</td>
                      <td style={cellStyle}>{row.name}</td>
                      <td style={cellStyle}><span className="tw-mono">{formatIdentity(row.identity_type, row.identity_number)}</span> <span style={{ color: 'var(--dim)', fontSize: 11 }}>{IDENTITY_LABELS[row.identity_type]}</span></td>
                      <td style={cellStyle}>{row.is_pkp ? 'PKP' : '—'}</td>
                      <td style={cellStyle}>{row.country_code}</td>
                      <td style={cellStyle}><StatusPill tone={row.status === 'new' ? 'green' : 'muted'}>{row.status === 'new' ? 'Baru' : 'Sudah ada'}</StatusPill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.totalRows > preview.sample.length ? (
              <div style={{ color: 'var(--dim)', fontSize: 12 }}>Menampilkan {preview.sample.length} dari {preview.totalRows} baris.</div>
            ) : null}
          </>
        ) : null}

        {result ? (
          <div className="tw-summary-grid">
            <SummaryCard label="Ditambahkan" value={result.inserted} />
            <SummaryCard label="Diperbarui" value={result.updated} />
            <SummaryCard label="Fasilitas baru" value={result.facilitiesInserted} />
            <SummaryCard label="Dilewati" value={result.skipped} />
          </div>
        ) : null}
      </div>

      {issues.length > 0 ? (
        <>
          <div style={{ padding: '0 18px 10px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Catatan impor</div>
            {errorCount > 0 ? <StatusPill tone="red">{errorCount} error</StatusPill> : null}
            <StatusPill tone="yellow">{issues.length - errorCount} peringatan</StatusPill>
          </div>
          <div className="tw-issue-list">
            {issues.map((issue, index) => (
              <div key={`${issue.rowNumber}-${index}`} className="tw-issue">
                <span style={{ color: issue.level === 'error' ? 'var(--red)' : 'var(--yellow)', fontWeight: 700 }}>
                  {issue.rowNumber > 0 ? `Baris ${issue.rowNumber}` : issue.level === 'error' ? 'Error' : 'Info'}
                </span>
                <span><span style={{ fontWeight: 600 }}>{issue.name}</span>{issue.name ? ' — ' : ''}{issue.message}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

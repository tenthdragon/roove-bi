'use client';

import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import {
  getScalevCatalogBusinesses,
  getScalevCatalogEntries,
  getScalevVisibleCatalogCutoverProgress,
  syncScalevCatalogBusiness,
  syncScalevVisibleCatalogCutoverAllBusinesses,
  type ScalevCatalogBusinessSummary,
  type ScalevCatalogEntryRow,
  type ScalevCatalogView,
  type ScalevVisibleCatalogCutoverBusinessProgress,
  type ScalevVisibleCatalogCutoverProgress,
} from '@/lib/scalev-catalog-actions';

const inputStyle: CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 10px',
  color: 'var(--text)',
  fontSize: 12,
  outline: 'none',
  width: '100%',
};

const VIEW_OPTIONS: { id: ScalevCatalogView; label: string; placeholder: string }[] = [
  { id: 'products', label: 'Produk', placeholder: 'Cari nama produk, public name, atau slug...' },
  { id: 'variants', label: 'Varian', placeholder: 'Cari variant name, product name, SKU, atau unique ID...' },
  { id: 'bundles', label: 'Bundle', placeholder: 'Cari bundle name, public name, display, atau custom ID...' },
  { id: 'identifiers', label: 'Identifier', placeholder: 'Cari raw identifier, label entity, atau source...' },
];

function renderVisibilitySummary(row: {
  visibility_kind?: string | null;
  owner_business_code?: string | null;
  processor_business_code?: string | null;
}) {
  const visibilityKind = row.visibility_kind === 'shared' ? 'shared' : 'owned';
  const ownerCode = row.owner_business_code || '-';
  const processorCode = row.processor_business_code || ownerCode;

  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <span
        style={{
          color: visibilityKind === 'shared' ? '#93c5fd' : 'var(--dim)',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
        }}
      >
        {visibilityKind}
      </span>
      <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>owner: {ownerCode}</span>
      <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>processor: {processorCode}</span>
    </div>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Belum pernah sync';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatCount(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('id-ID');
}

function renderStatusBadge(status: ScalevCatalogBusinessSummary['sync_status']) {
  const colors: Record<ScalevCatalogBusinessSummary['sync_status'], { bg: string; text: string; border: string; dot: string; label: string }> = {
    idle: { bg: 'rgba(148,163,184,0.08)', text: 'var(--dim)', border: 'rgba(148,163,184,0.16)', dot: '#64748b', label: 'Idle' },
    running: { bg: 'rgba(59,130,246,0.12)', text: '#93c5fd', border: 'rgba(96,165,250,0.28)', dot: '#60a5fa', label: 'Syncing' },
    success: { bg: 'rgba(16,185,129,0.14)', text: '#6ee7b7', border: 'rgba(52,211,153,0.24)', dot: '#34d399', label: 'Ready' },
    failed: { bg: 'rgba(239,68,68,0.12)', text: '#fca5a5', border: 'rgba(248,113,113,0.22)', dot: '#f87171', label: 'Failed' },
  };
  const style = colors[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        padding: '5px 10px',
        borderRadius: 999,
        border: `1px solid ${style.border}`,
        fontSize: 11,
        fontWeight: 700,
        background: style.bg,
        color: style.text,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: style.dot,
          boxShadow: `0 0 0 3px ${style.bg}`,
        }}
      />
      {style.label}
    </span>
  );
}

function renderCutoverBadge(status: ScalevVisibleCatalogCutoverBusinessProgress['catalog_status']) {
  const colors: Record<ScalevVisibleCatalogCutoverBusinessProgress['catalog_status'], { bg: string; text: string; border: string; label: string }> = {
    pending: { bg: 'rgba(148,163,184,0.08)', text: 'var(--dim)', border: 'rgba(148,163,184,0.16)', label: 'Pending' },
    running: { bg: 'rgba(59,130,246,0.12)', text: '#93c5fd', border: 'rgba(96,165,250,0.28)', label: 'Running' },
    success: { bg: 'rgba(16,185,129,0.14)', text: '#6ee7b7', border: 'rgba(52,211,153,0.24)', label: 'Done' },
    warning: { bg: 'rgba(251,191,36,0.12)', text: '#fde68a', border: 'rgba(251,191,36,0.28)', label: 'Warning' },
    failed: { bg: 'rgba(239,68,68,0.12)', text: '#fca5a5', border: 'rgba(248,113,113,0.22)', label: 'Failed' },
    skipped: { bg: 'rgba(107,114,128,0.14)', text: '#d1d5db', border: 'rgba(107,114,128,0.24)', label: 'Skipped' },
  };
  const style = colors[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 8px',
        borderRadius: 999,
        border: `1px solid ${style.border}`,
        background: style.bg,
        color: style.text,
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {style.label}
    </span>
  );
}

function ProgressBar({
  value,
  total,
  color,
}: {
  value: number;
  total: number;
  color: string;
}) {
  const safeTotal = Math.max(Number(total || 0), 0);
  const safeValue = Math.min(Math.max(Number(value || 0), 0), safeTotal || Number(value || 0));
  const percent = safeTotal > 0 ? Math.max(0, Math.min(100, (safeValue / safeTotal) * 100)) : 0;

  return (
    <div
      style={{
        height: 8,
        borderRadius: 999,
        background: 'rgba(148,163,184,0.12)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${percent}%`,
          height: '100%',
          borderRadius: 999,
          background: color,
          transition: 'width 200ms ease',
        }}
      />
    </div>
  );
}

function DataTable({ view, rows, loading }: { view: ScalevCatalogView; rows: ScalevCatalogEntryRow[]; loading: boolean }) {
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--dim)' }}>Memuat katalog Scalev...</div>;
  }

  if (rows.length === 0) {
    return (
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 20,
          color: 'var(--dim)',
          fontSize: 13,
        }}
      >
        Tidak ada data untuk tampilan ini.
      </div>
    );
  }

  if (view === 'products') {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Nama', 'Public', 'Slug', 'Tipe', 'Varian', 'Visible', 'Marketplace', 'Updated'].map((header) => (
                <th key={header} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any) => (
              <tr key={`product-${row.id}`} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                <td style={{ padding: '6px 8px', color: 'var(--text)', fontWeight: 600 }}>{row.name}</td>
                <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{row.public_name || '-'}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{row.slug || '-'}</td>
                <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{row.item_type || '-'}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{row.variants_count}</td>
                <td style={{ padding: '6px 8px' }}>{renderVisibilitySummary(row)}</td>
                <td style={{ padding: '6px 8px', color: row.is_listed_at_marketplace ? '#6ee7b7' : 'var(--dim)' }}>
                  {row.is_listed_at_marketplace ? 'Ya' : 'Tidak'}
                </td>
                <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{formatDateTime(row.scalev_last_updated_at || row.last_synced_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (view === 'variants') {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Nama Varian', 'Produk', 'SKU', 'Unique ID', 'Opsi', 'Visible', 'Tipe'].map((header) => (
                <th key={header} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any) => {
              const optionParts = [row.option1_value, row.option2_value, row.option3_value].filter(Boolean);
              return (
                <tr key={`variant-${row.id}`} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                  <td style={{ padding: '6px 8px', color: 'var(--text)', fontWeight: 600 }}>{row.name}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{row.product_name || '-'}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{row.sku || '-'}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{row.scalev_variant_unique_id || '-'}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{optionParts.length > 0 ? optionParts.join(' / ') : '-'}</td>
                  <td style={{ padding: '6px 8px' }}>{renderVisibilitySummary(row)}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{row.item_type || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (view === 'bundles') {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Nama Bundle', 'Display', 'Custom ID', 'Price Opt', 'Visible', 'Weight'].map((header) => (
                <th key={header} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any) => (
              <tr key={`bundle-${row.id}`} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                <td style={{ padding: '6px 8px', color: 'var(--text)', fontWeight: 600 }}>{row.name}</td>
                <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{row.display || row.public_name || '-'}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{row.custom_id || '-'}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{row.price_options_count}</td>
                <td style={{ padding: '6px 8px' }}>{renderVisibilitySummary(row)}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                  {row.weight_bump != null ? Number(row.weight_bump).toLocaleString('id-ID') : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Identifier', 'Source', 'Entity', 'Label'].map((header) => (
              <th key={header} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any) => (
            <tr key={`identifier-${row.id}`} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
              <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--text)' }}>{row.identifier}</td>
              <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{row.source}</td>
              <td style={{ padding: '6px 8px', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{row.entity_type}</td>
              <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{row.entity_label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ScalevCatalogSettingsTab() {
  const [businesses, setBusinesses] = useState<ScalevCatalogBusinessSummary[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(null);
  const [view, setView] = useState<ScalevCatalogView>('products');
  const [rows, setRows] = useState<ScalevCatalogEntryRow[]>([]);
  const [search, setSearch] = useState('');
  const [loadingBusinesses, setLoadingBusinesses] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [syncingBusinessId, setSyncingBusinessId] = useState<number | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [cutoverProgress, setCutoverProgress] = useState<ScalevVisibleCatalogCutoverProgress | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === selectedBusinessId) || null,
    [businesses, selectedBusinessId],
  );
  const schemaReady = businesses.every((business) => business.catalog_schema_ready);
  const schemaNotice = businesses.find((business) => !business.catalog_schema_ready)?.catalog_schema_message || null;
  const bulkSyncActive = syncingAll || Boolean(cutoverProgress?.active);

  const currentPlaceholder = VIEW_OPTIONS.find((option) => option.id === view)?.placeholder || 'Cari...';

  async function refreshBusinesses(preferredBusinessId?: number | null) {
    setLoadingBusinesses(true);
    try {
      const nextBusinesses = await getScalevCatalogBusinesses();
      setBusinesses(nextBusinesses);

      const candidate =
        preferredBusinessId && nextBusinesses.some((business) => business.id === preferredBusinessId)
          ? preferredBusinessId
          : nextBusinesses.find((business) => business.has_api_key)?.id
          || nextBusinesses[0]?.id
          || null;

      setSelectedBusinessId(candidate);
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal memuat daftar business Scalev.' });
    }
    setLoadingBusinesses(false);
  }

  async function refreshRows() {
    if (!selectedBusinessId) {
      setRows([]);
      return;
    }

    setLoadingRows(true);
    try {
      const nextRows = await getScalevCatalogEntries({
        businessId: selectedBusinessId,
        view,
        search,
        limit: 250,
      });
      setRows(nextRows);
    } catch (error: any) {
      setRows([]);
      setMessage({ type: 'error', text: error?.message || 'Gagal memuat data katalog Scalev.' });
    }
    setLoadingRows(false);
  }

  async function refreshCutoverProgress() {
    try {
      const nextProgress = await getScalevVisibleCatalogCutoverProgress();
      setCutoverProgress(nextProgress);
    } catch (error: any) {
      setCutoverProgress(null);
      setMessage({ type: 'error', text: error?.message || 'Gagal memuat progress bulk sync katalog Scalev.' });
    }
  }

  useEffect(() => {
    refreshBusinesses();
    refreshCutoverProgress();
  }, []);

  useEffect(() => {
    refreshRows();
  }, [selectedBusinessId, view, search]);

  useEffect(() => {
    if (!bulkSyncActive) return undefined;

    const intervalId = window.setInterval(() => {
      refreshCutoverProgress();
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [bulkSyncActive]);

  async function handleSyncBusiness(businessId: number) {
    const business = businesses.find((row) => row.id === businessId);
    if (business && !business.catalog_schema_ready) {
      setMessage({
        type: 'error',
        text: business.catalog_schema_message || 'Schema katalog Scalev belum siap dipakai.',
      });
      return;
    }

    setSyncingBusinessId(businessId);
    setMessage(null);
    try {
      const result = await syncScalevCatalogBusiness(businessId);
      setMessage({
        type: 'success',
        text: `${result.business_code}: ${result.products_count} produk, ${result.variants_count} varian, ${result.bundles_count} bundle, ${result.identifiers_count} identifier tersimpan.`,
      });
      await refreshBusinesses(businessId);
      await refreshRows();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal sync katalog Scalev.' });
    }
    setSyncingBusinessId(null);
  }

  async function handleSyncAll() {
    if (!schemaReady) {
      setMessage({
        type: 'error',
        text: schemaNotice || 'Schema katalog Scalev belum siap dipakai.',
      });
      return;
    }

    setSyncingAll(true);
    setMessage(null);
    try {
      const results = await syncScalevVisibleCatalogCutoverAllBusinesses();
      const okCount = Number(results.catalog_success_count || 0);
      const failCount = Number(results.catalog_failed_count || 0) + Number(results.bundle_failed_count || 0);
      setMessage({
        type: failCount === 0 ? 'success' : 'error',
        text: failCount === 0
          ? `Cutover visible catalog selesai (${okCount} business berhasil, bundle lines ikut disync).`
          : `Cutover visible catalog selesai dengan catatan: ${okCount} katalog berhasil, ${failCount} proses gagal.`,
      });
      await refreshCutoverProgress();
      await refreshBusinesses(selectedBusinessId);
      await refreshRows();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menjalankan sync semua business.' });
    }
    setSyncingAll(false);
    await refreshCutoverProgress();
  }

  return (
    <>
      {message && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 12,
            background: message.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            color: message.type === 'success' ? '#6ee7b7' : '#fca5a5',
          }}
        >
          {message.text}
        </div>
      )}

      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Katalog Scalev</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
              Tab ini menyimpan visible catalog upstream dari Scalev ke sistem kita: entity milik business sendiri plus entity yang dishare masuk ke business itu.
              Owner dan processor ikut tersimpan supaya deduction live bisa mengikuti business pemroses yang benar.
            </div>
          </div>
          <button
            onClick={handleSyncAll}
            disabled={
              bulkSyncActive
              || loadingBusinesses
              || !schemaReady
              || businesses.filter((business) => business.has_api_key).length === 0
            }
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: bulkSyncActive || !schemaReady ? 'var(--dim)' : 'var(--text)',
              cursor: bulkSyncActive ? 'wait' : (!schemaReady ? 'not-allowed' : 'pointer'),
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {bulkSyncActive ? 'Sync Semua...' : 'Sync Semua Business + Bundle'}
          </button>
        </div>

        {!schemaReady && schemaNotice ? (
          <div
            style={{
              marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(251,191,36,0.35)',
              background: 'rgba(251,191,36,0.08)',
              color: '#fde68a',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {schemaNotice}
          </div>
        ) : null}

        {cutoverProgress && cutoverProgress.phase !== 'idle' ? (
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 12,
              border: `1px solid ${cutoverProgress.active ? 'rgba(96,165,250,0.28)' : 'rgba(148,163,184,0.2)'}`,
              background: cutoverProgress.active ? 'rgba(59,130,246,0.08)' : 'rgba(148,163,184,0.06)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                  {cutoverProgress.active ? 'Bulk Sync Sedang Berjalan' : 'Bulk Sync Terakhir'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
                  {cutoverProgress.summary}
                </div>
              </div>
              <div style={{ minWidth: 220, fontSize: 11, color: 'var(--text-secondary)' }}>
                Mulai: <b style={{ color: 'var(--text)' }}>{formatDateTime(cutoverProgress.started_at)}</b><br />
                {cutoverProgress.finished_at ? (
                  <>Selesai: <b style={{ color: 'var(--text)' }}>{formatDateTime(cutoverProgress.finished_at)}</b><br /></>
                ) : null}
                Update terakhir: <b style={{ color: 'var(--text)' }}>{formatDateTime(cutoverProgress.last_event_at)}</b>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  <span>Katalog</span>
                  <b style={{ color: 'var(--text)' }}>
                    {formatCount(cutoverProgress.catalog_finished_count)} / {formatCount(cutoverProgress.total_businesses)} business
                  </b>
                </div>
                <ProgressBar value={cutoverProgress.catalog_finished_count} total={cutoverProgress.total_businesses} color="#60a5fa" />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  <span>Bundle</span>
                  <b style={{ color: 'var(--text)' }}>
                    {formatCount(cutoverProgress.bundle_finished_count)} / {formatCount(cutoverProgress.total_businesses)} business
                  </b>
                </div>
                <ProgressBar value={cutoverProgress.bundle_finished_count} total={cutoverProgress.total_businesses} color="#34d399" />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  <span>Bundle Diproses</span>
                  <b style={{ color: 'var(--text)' }}>
                    {formatCount(cutoverProgress.processed_bundles)} / {formatCount(cutoverProgress.total_bundles)}
                  </b>
                </div>
                <ProgressBar value={cutoverProgress.processed_bundles} total={cutoverProgress.total_bundles} color="#f59e0b" />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>
              <span>Katalog gagal: <b style={{ color: '#fca5a5' }}>{formatCount(cutoverProgress.catalog_failed_count)}</b></span>
              <span>Bundle warning: <b style={{ color: '#fde68a' }}>{formatCount(cutoverProgress.bundle_warning_count)}</b></span>
              <span>Bundle gagal: <b style={{ color: '#fca5a5' }}>{formatCount(cutoverProgress.bundle_failed_count)}</b></span>
              <span>
                Current:
                {' '}
                <b style={{ color: 'var(--text)' }}>
                  {cutoverProgress.current_business_code || '-'}
                  {cutoverProgress.current_business_name ? ` • ${cutoverProgress.current_business_name}` : ''}
                </b>
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {cutoverProgress.businesses.map((business) => (
                <div
                  key={`cutover-${business.business_id}`}
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                  }}
                >
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent)', fontSize: 11 }}>
                      {business.business_code}
                    </div>
                    <div style={{ color: 'var(--text)', fontSize: 12, fontWeight: 700 }}>
                      {business.business_name}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {renderCutoverBadge(business.catalog_status)}
                    {renderCutoverBadge(business.bundle_status)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Bundle: <b style={{ color: 'var(--text)' }}>{formatCount(business.bundles_processed)}</b> / {formatCount(business.bundles_total)}
                    {business.bundle_failed_count > 0 ? (
                      <span style={{ color: '#fca5a5' }}> • gagal {formatCount(business.bundle_failed_count)}</span>
                    ) : null}
                  </div>
                  <ProgressBar
                    value={business.bundles_processed}
                    total={business.bundles_total}
                    color={business.bundle_status === 'warning' ? '#f59e0b' : business.bundle_status === 'failed' ? '#f87171' : '#34d399'}
                  />
                  {business.latest_error ? (
                    <div style={{ marginTop: 8, fontSize: 10, color: '#fca5a5', lineHeight: 1.5 }}>
                      {business.latest_error}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {loadingBusinesses ? (
          <div style={{ color: 'var(--dim)', fontSize: 13 }}>Memuat business Scalev...</div>
        ) : businesses.length === 0 ? (
          <div style={{ color: 'var(--dim)', fontSize: 13 }}>Belum ada business Scalev yang terdaftar.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {businesses.map((business) => {
              const isSelected = business.id === selectedBusinessId;
              const isSyncing = syncingBusinessId === business.id;

              return (
                <div
                  key={business.id}
                  onClick={() => setSelectedBusinessId(business.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedBusinessId(business.id);
                    }
                  }}
                  style={{
                    textAlign: 'left',
                    background: isSelected ? 'rgba(96,165,250,0.08)' : 'var(--bg)',
                    border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 12,
                    padding: 14,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent)', fontSize: 12 }}>
                        {business.business_code}
                      </div>
                      <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 13 }}>
                        {business.business_name}
                      </div>
                    </div>
                    {renderStatusBadge(business.sync_status)}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginBottom: 10, fontSize: 11 }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Produk: <b style={{ color: 'var(--text)' }}>{business.products_count}</b></div>
                    <div style={{ color: 'var(--text-secondary)' }}>Varian: <b style={{ color: 'var(--text)' }}>{business.variants_count}</b></div>
                    <div style={{ color: 'var(--text-secondary)' }}>Bundle: <b style={{ color: 'var(--text)' }}>{business.bundles_count}</b></div>
                    <div style={{ color: 'var(--text-secondary)' }}>Identifier: <b style={{ color: 'var(--text)' }}>{business.identifiers_count}</b></div>
                  </div>

                  <div style={{ color: 'var(--dim)', fontSize: 10, marginBottom: 12 }}>
                    API: {business.has_api_key ? 'Connected' : 'Belum ada key'}<br />
                    Sync terakhir: {formatDateTime(business.last_synced_at)}
                    {business.last_error ? (
                      <>
                        <br />
                        <span style={{ color: '#fca5a5' }}>{business.last_error}</span>
                      </>
                    ) : null}
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSyncBusiness(business.id);
                      }}
                      disabled={!business.has_api_key || isSyncing || bulkSyncActive || !business.catalog_schema_ready}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: business.has_api_key && business.catalog_schema_ready ? 'var(--accent)' : 'var(--dim)',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: business.has_api_key && business.catalog_schema_ready ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {isSyncing ? 'Syncing...' : 'Sync Dari API'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {VIEW_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => setView(option.id)}
            style={{
              padding: '5px 12px',
              borderRadius: 8,
              border: `1px solid ${view === option.id ? 'var(--accent)' : 'var(--border)'}`,
              background: view === option.id ? 'rgba(96,165,250,0.12)' : 'transparent',
              color: view === option.id ? 'var(--accent)' : 'var(--dim)',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {option.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <input
          type="text"
          value={search}
          placeholder={currentPlaceholder}
          onChange={(event) => setSearch(event.target.value)}
          style={{ ...inputStyle, minWidth: 280, width: 'auto' }}
        />
      </div>

      {selectedBusiness ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
            Menampilkan <b style={{ color: 'var(--text)' }}>{VIEW_OPTIONS.find((option) => option.id === view)?.label.toLowerCase()}</b> yang visible di{' '}
            <b style={{ color: 'var(--text)' }}>{selectedBusiness.business_name}</b>.
          </div>
          {!selectedBusiness.catalog_schema_ready ? (
            <div
              style={{
                background: 'var(--card)',
                border: '1px solid rgba(251,191,36,0.25)',
                borderRadius: 12,
                padding: 20,
                color: '#fde68a',
                fontSize: 13,
                lineHeight: 1.7,
              }}
            >
              {selectedBusiness.catalog_schema_message || 'Schema katalog Scalev belum siap dipakai.'}
            </div>
          ) : (
            <DataTable view={view} rows={rows} loading={loadingRows} />
          )}
        </>
      ) : (
        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 20,
            color: 'var(--dim)',
            fontSize: 13,
          }}
        >
          Pilih business untuk melihat katalog Scalev.
        </div>
      )}
    </>
  );
}

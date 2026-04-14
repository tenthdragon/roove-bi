'use client';

import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import {
  getScalevCatalogBusinesses,
  getScalevCatalogEntries,
  syncScalevCatalogAllBusinesses,
  syncScalevCatalogBusiness,
  type ScalevCatalogBusinessSummary,
  type ScalevCatalogEntryRow,
  type ScalevCatalogView,
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

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Belum pernah sync';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function renderStatusBadge(status: ScalevCatalogBusinessSummary['sync_status']) {
  const colors: Record<ScalevCatalogBusinessSummary['sync_status'], { bg: string; text: string; label: string }> = {
    idle: { bg: 'var(--bg-deep)', text: 'var(--dim)', label: 'Idle' },
    running: { bg: 'rgba(59,130,246,0.12)', text: '#93c5fd', label: 'Syncing' },
    success: { bg: 'var(--badge-green-bg)', text: '#6ee7b7', label: 'Ready' },
    failed: { bg: 'var(--badge-red-bg)', text: '#fca5a5', label: 'Failed' },
  };
  const style = colors[status];
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        background: style.bg,
        color: style.text,
      }}
    >
      {style.label}
    </span>
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
              {['Nama', 'Public', 'Slug', 'Tipe', 'Varian', 'Marketplace', 'Updated'].map((header) => (
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
              {['Nama Varian', 'Produk', 'SKU', 'Unique ID', 'Opsi', 'Tipe'].map((header) => (
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
              {['Nama Bundle', 'Display', 'Custom ID', 'Price Opt', 'Sharing', 'Weight'].map((header) => (
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
                <td style={{ padding: '6px 8px', color: row.is_bundle_sharing ? '#6ee7b7' : 'var(--dim)' }}>
                  {row.is_bundle_sharing ? 'Ya' : 'Tidak'}
                </td>
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
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === selectedBusinessId) || null,
    [businesses, selectedBusinessId],
  );

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

  useEffect(() => {
    refreshBusinesses();
  }, []);

  useEffect(() => {
    refreshRows();
  }, [selectedBusinessId, view, search]);

  async function handleSyncBusiness(businessId: number) {
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
    setSyncingAll(true);
    setMessage(null);
    try {
      const results = await syncScalevCatalogAllBusinesses();
      const okCount = results.filter((row) => row.success).length;
      const failCount = results.length - okCount;
      setMessage({
        type: failCount === 0 ? 'success' : 'error',
        text: failCount === 0
          ? `Sync semua business selesai (${okCount} berhasil).`
          : `Sync selesai dengan catatan: ${okCount} berhasil, ${failCount} gagal.`,
      });
      await refreshBusinesses(selectedBusinessId);
      await refreshRows();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menjalankan sync semua business.' });
    }
    setSyncingAll(false);
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
              Stage 1 menyimpan source catalog upstream dari Scalev ke sistem kita: produk, varian, bundle, dan semua identifier-nya.
              Mapping lama di tab <b>Mapping Scalev</b> tetap dipakai dan tidak diubah oleh fitur ini.
            </div>
          </div>
          <button
            onClick={handleSyncAll}
            disabled={syncingAll || loadingBusinesses || businesses.filter((business) => business.has_api_key).length === 0}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text)',
              cursor: syncingAll ? 'wait' : 'pointer',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {syncingAll ? 'Sync Semua...' : 'Sync Semua Business'}
          </button>
        </div>

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
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
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
                      disabled={!business.has_api_key || isSyncing || syncingAll}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: business.has_api_key ? 'var(--accent)' : 'var(--dim)',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: business.has_api_key ? 'pointer' : 'not-allowed',
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
            Menampilkan <b style={{ color: 'var(--text)' }}>{VIEW_OPTIONS.find((option) => option.id === view)?.label.toLowerCase()}</b> untuk{' '}
            <b style={{ color: 'var(--text)' }}>{selectedBusiness.business_name}</b>.
          </div>
          <DataTable view={view} rows={rows} loading={loadingRows} />
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

'use client';

import { Fragment, type CSSProperties, useEffect, useMemo, useState } from 'react';
import {
  getScalevCatalogBusinesses,
  type ScalevCatalogBusinessSummary,
} from '@/lib/scalev-catalog-actions';
import {
  getScalevCatalogBundleMappings,
  syncScalevCatalogBundleLines,
  type ScalevBundleMappingPayload,
  type ScalevBundleMappingRow,
} from '@/lib/scalev-catalog-bundle-actions';

const BUNDLE_SYNC_BATCH_SIZE = 80;

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

function renderStatusBadge(status: ScalevBundleMappingRow['status']) {
  const palette = {
    resolved: {
      bg: 'rgba(16,185,129,0.12)',
      border: 'rgba(52,211,153,0.22)',
      color: '#6ee7b7',
      label: 'Resolved',
    },
    partial: {
      bg: 'rgba(245,158,11,0.12)',
      border: 'rgba(251,191,36,0.2)',
      color: '#fcd34d',
      label: 'Partial',
    },
    unresolved: {
      bg: 'rgba(239,68,68,0.12)',
      border: 'rgba(248,113,113,0.2)',
      color: '#fca5a5',
      label: 'Unresolved',
    },
    'missing-lines': {
      bg: 'rgba(59,130,246,0.12)',
      border: 'rgba(96,165,250,0.22)',
      color: '#93c5fd',
      label: 'Belum Sync Isi',
    },
  } as const;

  const style = palette[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 9px',
        borderRadius: 999,
        border: `1px solid ${style.border}`,
        background: style.bg,
        color: style.color,
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {style.label}
    </span>
  );
}

function formatBusinessTarget(target: ScalevBundleMappingPayload['business_target']) {
  if (!target?.is_active || !target.deduct_entity) return 'Belum ada target deduct';
  return `${target.deduct_entity}${target.deduct_warehouse ? ` • ${target.deduct_warehouse}` : ''}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function ScalevBundleMappingSettingsTab() {
  const [businesses, setBusinesses] = useState<ScalevCatalogBusinessSummary[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(null);
  const [payload, setPayload] = useState<ScalevBundleMappingPayload | null>(null);
  const [loadingBusinesses, setLoadingBusinesses] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'resolved' | 'partial' | 'unresolved' | 'missing-lines'>('partial');
  const [search, setSearch] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function refreshBusinesses(preferredBusinessId?: number | null) {
    setLoadingBusinesses(true);
    try {
      const nextBusinesses = await getScalevCatalogBusinesses();
      setBusinesses(nextBusinesses);

      const nextSelectedId =
        preferredBusinessId && nextBusinesses.some((business) => business.id === preferredBusinessId)
          ? preferredBusinessId
          : nextBusinesses.find((business) => business.has_api_key)?.id
            || nextBusinesses[0]?.id
            || null;

      setSelectedBusinessId(nextSelectedId);
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal memuat business Scalev.' });
    }
    setLoadingBusinesses(false);
  }

  async function refreshRows(businessId: number | null) {
    if (!businessId) {
      setPayload(null);
      return;
    }

    const business = businesses.find((row) => row.id === businessId);
    if (business && !business.catalog_schema_ready) {
      setPayload(null);
      setMessage({
        type: 'error',
        text: business.catalog_schema_message || 'Katalog Scalev belum siap dipakai.',
      });
      return;
    }

    setLoadingRows(true);
    try {
      const nextPayload = await getScalevCatalogBundleMappings(businessId);
      setPayload(nextPayload);
      setExpandedKeys([]);
      setMessage(nextPayload.schema_message ? { type: 'error', text: nextPayload.schema_message } : null);
    } catch (error: any) {
      setPayload(null);
      setMessage({ type: 'error', text: error?.message || 'Gagal memuat bundle mapping Scalev.' });
    }
    setLoadingRows(false);
  }

  useEffect(() => {
    refreshBusinesses();
  }, []);

  useEffect(() => {
    refreshRows(selectedBusinessId);
  }, [selectedBusinessId]);

  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === selectedBusinessId) || null,
    [businesses, selectedBusinessId],
  );

  const counts = useMemo(() => {
    const rows = payload?.rows || [];
    return {
      all: rows.length,
      resolved: rows.filter((row) => row.status === 'resolved').length,
      partial: rows.filter((row) => row.status === 'partial').length,
      unresolved: rows.filter((row) => row.status === 'unresolved').length,
      'missing-lines': rows.filter((row) => row.status === 'missing-lines').length,
    };
  }, [payload?.rows]);

  const filteredRows = useMemo(() => {
    const rows = payload?.rows || [];
    const query = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false;
      if (!query) return true;

      const haystack = [
        row.label,
        row.secondary_label,
        row.custom_id,
        ...(row.identifiers_preview || []),
        ...row.components.flatMap((component) => [
          component.label,
          component.secondary_label,
          component.scalev_variant_sku,
          component.resolved_warehouse_product?.name,
        ]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [filter, payload?.rows, search]);

  function toggleExpanded(entityKey: string) {
    setExpandedKeys((current) => (
      current.includes(entityKey)
        ? current.filter((key) => key !== entityKey)
        : [...current, entityKey]
    ));
  }

  async function handleSyncBundleLines() {
    if (!selectedBusinessId) return;
    setSyncing(true);
    setMessage(null);
    try {
      let offset = 0;
      let totalBundles = 0;
      let scanned = 0;
      let storedComponents = 0;
      let failed = 0;

      while (true) {
        const result = await syncScalevCatalogBundleLines(selectedBusinessId, {
          offset,
          limit: BUNDLE_SYNC_BATCH_SIZE,
        });

        totalBundles = result.total_bundles || totalBundles;
        scanned += result.bundles_scanned || 0;
        storedComponents += result.bundle_lines_count || 0;
        failed += result.failed_count || 0;

        const processedLabel = totalBundles > 0
          ? `${Math.min(result.next_offset || 0, totalBundles)}/${totalBundles}`
          : `${scanned}`;

        setMessage({
          type: failed > 0 ? 'error' : 'success',
          text: `Sync isi bundle berjalan... ${processedLabel} bundle diproses.`,
        });

        if (result.completed || !result.bundles_scanned) break;
        offset = result.next_offset || 0;
      }

      setMessage({
        type: failed > 0 ? 'error' : 'success',
        text: failed > 0
          ? `Sync isi bundle selesai. ${scanned}/${totalBundles || scanned} bundle diproses, ${storedComponents} komponen tersimpan, ${failed} bundle gagal diambil.`
          : `Sync isi bundle selesai. ${scanned}/${totalBundles || scanned} bundle diproses dan ${storedComponents} komponen tersimpan.`,
      });
      await refreshRows(selectedBusinessId);
      await refreshBusinesses(selectedBusinessId);
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal sync isi bundle dari API.' });
    }
    setSyncing(false);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 18,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Bundle Mapping Scalev</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4, maxWidth: 780, lineHeight: 1.6 }}>
              Tab ini membaca isi bundle dari Scalev lalu mencoba me-resolve setiap komponen ke produk warehouse lewat mapping produk Scalev. Untuk komponen shared, sistem akan mencoba memakai mapping dari business pemilik produk lebih dulu.
            </div>
          </div>

          <button
            onClick={handleSyncBundleLines}
            disabled={!selectedBusinessId || syncing || !selectedBusiness?.has_api_key || Boolean(payload?.schema_message)}
            style={{
              padding: '9px 14px',
              borderRadius: 10,
              border: '1px solid rgba(59,130,246,0.25)',
              background: 'rgba(37,99,235,0.12)',
              color: '#60a5fa',
              cursor: !selectedBusinessId || syncing || !selectedBusiness?.has_api_key || Boolean(payload?.schema_message) ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: 700,
              opacity: !selectedBusinessId || syncing || !selectedBusiness?.has_api_key || Boolean(payload?.schema_message) ? 0.6 : 1,
            }}
          >
            {syncing ? 'Syncing...' : 'Sync Isi Bundle'}
          </button>
        </div>

        {message ? (
          <div
            style={{
              marginTop: 14,
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${message.type === 'success' ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)'}`,
              background: message.type === 'success' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
              color: message.type === 'success' ? '#86efac' : '#fca5a5',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {message.text}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {loadingBusinesses ? (
          <div style={{ color: 'var(--dim)', fontSize: 12 }}>Memuat business Scalev...</div>
        ) : businesses.length === 0 ? (
          <div style={{ color: 'var(--dim)', fontSize: 12 }}>Belum ada business Scalev yang terhubung.</div>
        ) : businesses.map((business) => {
          const active = business.id === selectedBusinessId;
          return (
            <button
              key={business.id}
              onClick={() => {
                setSelectedBusinessId(business.id);
                setMessage(null);
              }}
              style={{
                textAlign: 'left',
                background: active ? 'rgba(37,99,235,0.1)' : 'var(--card)',
                border: `1px solid ${active ? 'rgba(96,165,250,0.8)' : 'var(--border)'}`,
                borderRadius: 16,
                padding: 16,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 800, color: '#3b82f6' }}>{business.business_code}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>{business.business_name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12, fontSize: 11, color: 'var(--dim)' }}>
                <div>Bundle: <span style={{ color: 'var(--text)', fontWeight: 700 }}>{business.bundles_count}</span></div>
                <div>Produk: <span style={{ color: 'var(--text)', fontWeight: 700 }}>{business.products_count}</span></div>
              </div>
            </button>
          );
        })}
      </div>

      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 18,
          display: 'grid',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              {selectedBusiness?.business_name || 'Pilih business'}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
              Target deduct: <span style={{ color: 'var(--text)', fontWeight: 600 }}>{formatBusinessTarget(payload?.business_target || null)}</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
              Bundle lines tersimpan: <span style={{ color: 'var(--text)', fontWeight: 600 }}>{payload?.bundle_lines_count || 0}</span>
              {' '}• Sync terakhir: <span style={{ color: 'var(--text)', fontWeight: 600 }}>{formatDateTime(payload?.bundle_lines_last_synced_at)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {([
              ['all', 'Semua'],
              ['partial', 'Partial'],
              ['unresolved', 'Unresolved'],
              ['missing-lines', 'Belum Sync'],
              ['resolved', 'Resolved'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: `1px solid ${filter === value ? 'rgba(96,165,250,0.5)' : 'var(--border)'}`,
                  background: filter === value ? 'rgba(37,99,235,0.12)' : 'transparent',
                  color: filter === value ? '#93c5fd' : 'var(--dim)',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {label} ({counts[value as keyof typeof counts]})
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 280, flex: 1 }}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari bundle, identifier, SKU, atau nama produk warehouse..."
              style={inputStyle}
            />
          </div>
          <div style={{ fontSize: 11, color: 'var(--dim)' }}>
            Partial/unresolved di sini biasanya selesai setelah variannya dimap di tab Product Mapping Scalev.
          </div>
        </div>

        {loadingRows ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--dim)', fontSize: 12 }}>
            Memuat bundle mapping...
          </div>
        ) : filteredRows.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--dim)', fontSize: 12 }}>
            Tidak ada bundle yang cocok dengan filter saat ini.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Bundle', 'Identifier', 'Komponen', 'Resolved', 'Status', 'Aksi'].map((header) => (
                    <th
                      key={header}
                      style={{
                        textAlign: 'left',
                        padding: '10px 8px',
                        fontSize: 11,
                        color: 'var(--dim)',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const expanded = expandedKeys.includes(row.entity_key);
                  return (
                    <Fragment key={row.entity_key}>
                      <tr key={row.entity_key} style={{ borderBottom: expanded ? 'none' : '1px solid var(--bg-deep)', verticalAlign: 'top' }}>
                        <td style={{ padding: '12px 8px', minWidth: 260 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{row.label}</div>
                          {row.secondary_label ? (
                            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--dim)' }}>{row.secondary_label}</div>
                          ) : null}
                          {row.custom_id ? (
                            <div style={{ marginTop: 6, fontSize: 10, color: '#93c5fd', fontFamily: 'monospace' }}>{row.custom_id}</div>
                          ) : null}
                        </td>

                        <td style={{ padding: '12px 8px', minWidth: 220 }}>
                          <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.7 }}>
                            {(row.identifiers_preview || []).map((identifier) => (
                              <div key={identifier}>{identifier}</div>
                            ))}
                          </div>
                          {row.identifiers_count > row.identifiers_preview.length ? (
                            <div style={{ marginTop: 4, fontSize: 10, color: 'var(--dim)' }}>
                              +{row.identifiers_count - row.identifiers_preview.length} identifier lagi
                            </div>
                          ) : null}
                        </td>

                        <td style={{ padding: '12px 8px', minWidth: 260 }}>
                          <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.7 }}>
                            {row.components.slice(0, 3).map((component) => (
                              <div key={component.bundle_line_key}>
                                {component.quantity}x {component.label}
                              </div>
                            ))}
                          </div>
                          {row.components_count > 3 ? (
                            <div style={{ marginTop: 4, fontSize: 10, color: 'var(--dim)' }}>
                              +{row.components_count - 3} komponen lagi
                            </div>
                          ) : null}
                          {row.components_count === 0 ? (
                            <div style={{ fontSize: 11, color: 'var(--dim)' }}>Isi bundle belum di-sync</div>
                          ) : null}
                        </td>

                        <td style={{ padding: '12px 8px', minWidth: 110 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                            {row.resolved_components_count}/{row.components_count}
                          </div>
                          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--dim)' }}>
                            {row.unresolved_components_count > 0
                              ? `${row.unresolved_components_count} belum map`
                              : 'Semua komponen siap'}
                          </div>
                        </td>

                        <td style={{ padding: '12px 8px' }}>
                          {renderStatusBadge(row.status)}
                        </td>

                        <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>
                          <button
                            onClick={() => toggleExpanded(row.entity_key)}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--border)',
                              background: 'transparent',
                              color: '#60a5fa',
                              cursor: 'pointer',
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {expanded ? 'Sembunyikan' : 'Lihat Isi'}
                          </button>
                        </td>
                      </tr>

                      {expanded ? (
                        <tr key={`${row.entity_key}-expanded`} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                          <td colSpan={6} style={{ padding: '0 8px 14px' }}>
                            <div style={{ background: 'rgba(15,23,42,0.32)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 12, padding: 12 }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid rgba(148,163,184,0.12)' }}>
                                    {['Qty', 'Komponen Scalev', 'SKU / UID', 'Produk Warehouse', 'Source'].map((header) => (
                                      <th
                                        key={header}
                                        style={{
                                          textAlign: 'left',
                                          padding: '8px 6px',
                                          fontSize: 10,
                                          color: 'var(--dim)',
                                          fontWeight: 700,
                                        }}
                                      >
                                        {header}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.components.map((component) => (
                                    <tr key={component.bundle_line_key} style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                                      <td style={{ padding: '8px 6px', color: 'var(--text)', fontWeight: 700, fontSize: 11 }}>
                                        {component.quantity}
                                      </td>
                                      <td style={{ padding: '8px 6px' }}>
                                        <div style={{ color: 'var(--text)', fontSize: 11, fontWeight: 600 }}>{component.label}</div>
                                        {component.secondary_label ? (
                                          <div style={{ color: 'var(--dim)', fontSize: 10, marginTop: 3 }}>{component.secondary_label}</div>
                                        ) : null}
                                      </td>
                                      <td style={{ padding: '8px 6px', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 10 }}>
                                        {component.scalev_variant_sku || component.scalev_variant_unique_id || '-'}
                                      </td>
                                      <td style={{ padding: '8px 6px' }}>
                                        {component.resolved_warehouse_product ? (
                                          <>
                                            <div style={{ color: 'var(--text)', fontSize: 11, fontWeight: 600 }}>
                                              {component.resolved_warehouse_product.name}
                                            </div>
                                            <div style={{ color: 'var(--dim)', fontSize: 10, marginTop: 3 }}>
                                              {component.resolved_warehouse_product.category || '-'} • {component.resolved_warehouse_product.warehouse}-{component.resolved_warehouse_product.entity}
                                            </div>
                                          </>
                                        ) : (
                                          <div style={{ color: '#fca5a5', fontSize: 10, fontWeight: 700 }}>
                                            {component.source_business_code && component.source_business_code !== payload?.business_code
                                              ? `Belum ada Product Mapping Scalev di business sumber ${component.source_business_code}`
                                              : 'Belum terhubung ke Product Mapping Scalev'}
                                          </div>
                                        )}
                                      </td>
                                      <td style={{ padding: '8px 6px', fontSize: 10 }}>
                                        <div style={{ color: component.resolution_source ? '#93c5fd' : 'var(--dim)', fontWeight: 700 }}>
                                          {component.resolution_source === 'variant'
                                            ? 'variant'
                                            : component.resolution_source === 'product'
                                              ? 'product'
                                              : '-'}
                                        </div>
                                        {component.source_business_code ? (
                                          <div style={{ color: 'var(--dim)', marginTop: 3 }}>
                                            source: {component.source_business_code}
                                            {component.is_shared_component ? ' shared' : ''}
                                          </div>
                                        ) : null}
                                        {component.mapping_business_code ? (
                                          <div style={{ color: 'var(--dim)', marginTop: 3 }}>
                                            map: {component.mapping_business_code}
                                          </div>
                                        ) : null}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

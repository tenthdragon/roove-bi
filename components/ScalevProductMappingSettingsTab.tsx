'use client';

import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { getProducts } from '@/lib/warehouse-ledger-actions';
import {
  getScalevCatalogBusinesses,
  type ScalevCatalogBusinessSummary,
} from '@/lib/scalev-catalog-actions';
import {
  getScalevCatalogProductMappings,
  saveScalevCatalogProductMapping,
  type ScalevCatalogMappingPayload,
  type ScalevCatalogMappingRow,
} from '@/lib/scalev-catalog-mapping-actions';

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

function renderStatusBadge(status: ScalevCatalogMappingRow['status']) {
  const palette = {
    mapped: {
      bg: 'rgba(16,185,129,0.12)',
      border: 'rgba(52,211,153,0.22)',
      color: '#6ee7b7',
      label: 'Mapped',
    },
    recommended: {
      bg: 'rgba(59,130,246,0.12)',
      border: 'rgba(96,165,250,0.22)',
      color: '#93c5fd',
      label: 'Recommended',
    },
    unmapped: {
      bg: 'rgba(239,68,68,0.12)',
      border: 'rgba(248,113,113,0.2)',
      color: '#fca5a5',
      label: 'Unmapped',
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

function renderEntityTypeBadge(type: ScalevCatalogMappingRow['entity_type']) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 7px',
        borderRadius: 999,
        background: 'rgba(148,163,184,0.08)',
        border: '1px solid rgba(148,163,184,0.16)',
        color: 'var(--dim)',
        fontSize: 9,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
      }}
    >
      {type}
    </span>
  );
}

function renderCatalogReadyBadge(isReady: boolean) {
  const palette = isReady
    ? {
        bg: 'rgba(16,185,129,0.12)',
        border: 'rgba(52,211,153,0.22)',
        color: '#6ee7b7',
        dot: '#34d399',
        label: 'Catalog Ready',
      }
    : {
        bg: 'rgba(251,191,36,0.12)',
        border: 'rgba(251,191,36,0.22)',
        color: '#fde68a',
        dot: '#fbbf24',
        label: 'Catalog Missing',
      };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
        alignSelf: 'flex-start',
        padding: '5px 10px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        color: palette.color,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: palette.dot,
          boxShadow: `0 0 0 3px ${palette.bg}`,
        }}
      />
      {palette.label}
    </span>
  );
}

function formatBusinessTarget(target: ScalevCatalogMappingPayload['business_target']) {
  if (!target?.is_active || !target.deduct_entity) return 'Belum ada target deduct';
  return `${target.deduct_entity}${target.deduct_warehouse ? ` • ${target.deduct_warehouse}` : ''}`;
}

export default function ScalevProductMappingSettingsTab() {
  const [businesses, setBusinesses] = useState<ScalevCatalogBusinessSummary[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [mappingData, setMappingData] = useState<ScalevCatalogMappingPayload | null>(null);
  const [loadingBusinesses, setLoadingBusinesses] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [filter, setFilter] = useState<'all' | 'mapped' | 'recommended' | 'unmapped'>('recommended');
  const [search, setSearch] = useState('');
  const [editingEntityKey, setEditingEntityKey] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [savingEntityKey, setSavingEntityKey] = useState<string | null>(null);
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
      setMappingData(null);
      return;
    }

    const business = businesses.find((row) => row.id === businessId);
    if (business && !business.catalog_schema_ready) {
      setMappingData(null);
      setMessage({
        type: 'error',
        text: business.catalog_schema_message || 'Katalog Scalev belum siap dipakai.',
      });
      return;
    }

    setLoadingRows(true);
    try {
      const payload = await getScalevCatalogProductMappings(businessId);
      setMappingData(payload);
    } catch (error: any) {
      setMappingData(null);
      setMessage({ type: 'error', text: error?.message || 'Gagal memuat product mapping Scalev.' });
    }
    setLoadingRows(false);
  }

  async function loadProducts() {
    setLoadingProducts(true);
    try {
      setProducts(await getProducts());
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal memuat master produk warehouse.' });
    }
    setLoadingProducts(false);
  }

  useEffect(() => {
    refreshBusinesses();
    loadProducts();
  }, []);

  useEffect(() => {
    refreshRows(selectedBusinessId);
  }, [selectedBusinessId]);

  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === selectedBusinessId) || null,
    [businesses, selectedBusinessId],
  );

  const filteredRows = useMemo(() => {
    const rows = mappingData?.rows || [];
    const query = search.trim().toLowerCase();

    return rows
      .filter((row) => {
        if (filter !== 'all' && row.status !== filter) return false;
        if (!query) return true;

        const haystack = [
          row.label,
          row.secondary_label,
          row.sku,
          row.warehouse_product?.name,
          row.recommendation?.warehouse_product_name,
          ...(row.identifiers_preview || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystack.includes(query);
      })
      .sort((left, right) => {
        const rank = { recommended: 0, unmapped: 1, mapped: 2 } as const;
        if (rank[left.status] !== rank[right.status]) return rank[left.status] - rank[right.status];
        return left.label.localeCompare(right.label);
      });
  }, [filter, mappingData?.rows, search]);

  const counts = useMemo(() => {
    const rows = mappingData?.rows || [];
    return {
      all: rows.length,
      mapped: rows.filter((row) => row.status === 'mapped').length,
      recommended: rows.filter((row) => row.status === 'recommended').length,
      unmapped: rows.filter((row) => row.status === 'unmapped').length,
    };
  }, [mappingData?.rows]);

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return [];

    const targetEntity = mappingData?.business_target?.deduct_entity || null;
    const targetWarehouse = mappingData?.business_target?.deduct_warehouse || null;

    return [...products]
      .filter((product) => {
        const haystack = [
          product.name,
          product.category,
          product.entity,
          product.warehouse,
          ...(Array.isArray(product.scalev_product_names) ? product.scalev_product_names : []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((left, right) => {
        const leftBoost = (left.entity === targetEntity ? 2 : 0) + (left.warehouse === targetWarehouse ? 1 : 0);
        const rightBoost = (right.entity === targetEntity ? 2 : 0) + (right.warehouse === targetWarehouse ? 1 : 0);
        if (rightBoost !== leftBoost) return rightBoost - leftBoost;
        return left.name.localeCompare(right.name);
      })
      .slice(0, 12);
  }, [mappingData?.business_target?.deduct_entity, mappingData?.business_target?.deduct_warehouse, productSearch, products]);

  async function persistMapping(row: ScalevCatalogMappingRow, warehouseProductId: number | null) {
    if (!selectedBusinessId) return;
    setSavingEntityKey(row.entity_key);
    setMessage(null);
    try {
      await saveScalevCatalogProductMapping({
        businessId: selectedBusinessId,
        entityKey: row.entity_key,
        warehouseProductId,
      });
      setEditingEntityKey(null);
      setProductSearch('');
      await refreshRows(selectedBusinessId);
      setMessage({
        type: 'success',
        text: warehouseProductId == null ? `Mapping ${row.label} dibersihkan.` : `Mapping ${row.label} disimpan.`,
      });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menyimpan mapping.' });
    }
    setSavingEntityKey(null);
  }

  function openEditor(row: ScalevCatalogMappingRow) {
    setEditingEntityKey(row.entity_key);
    setProductSearch(row.recommendation?.warehouse_product_name || row.warehouse_product?.name || '');
  }

  const schemaReady = businesses.every((business) => business.catalog_schema_ready);
  const schemaNotice = businesses.find((business) => !business.catalog_schema_ready)?.catalog_schema_message || null;

  return (
    <>
      {message ? (
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
      ) : null}

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
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Product Mapping Scalev</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
              Halaman ini memetakan entity catalog Scalev ke master produk warehouse. Rekomendasi diambil dari mapping lama yang sudah terjadi,
              alias `scalev_product_names`, dan kemiripan nama sebagai fallback.
            </div>
          </div>
          <div
            style={{
              minWidth: 220,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 4 }}>Target deduct default</div>
            <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 13 }}>
              {formatBusinessTarget(mappingData?.business_target || null)}
            </div>
            {mappingData?.business_target?.notes ? (
              <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 4 }}>{mappingData.business_target.notes}</div>
            ) : null}
          </div>
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

        {loadingBusinesses ? (
          <div style={{ color: 'var(--dim)', fontSize: 13 }}>Memuat business Scalev...</div>
        ) : businesses.length === 0 ? (
          <div style={{ color: 'var(--dim)', fontSize: 13 }}>Belum ada business Scalev yang terdaftar.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {businesses.map((business) => {
              const isSelected = business.id === selectedBusinessId;
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
                    background: isSelected ? 'rgba(96,165,250,0.08)' : 'var(--bg)',
                    border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 12,
                    padding: 14,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent)', fontSize: 12 }}>
                        {business.business_code}
                      </div>
                      <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 13 }}>
                        {business.business_name}
                      </div>
                    </div>
                    {renderCatalogReadyBadge(business.catalog_schema_ready)}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                    <div>Produk: <b style={{ color: 'var(--text)' }}>{business.products_count}</b></div>
                    <div>Varian: <b style={{ color: 'var(--text)' }}>{business.variants_count}</b></div>
                    <div>Identifier: <b style={{ color: 'var(--text)' }}>{business.identifiers_count}</b></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['all', 'recommended', 'unmapped', 'mapped'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            style={{
              padding: '5px 12px',
              borderRadius: 8,
              border: `1px solid ${filter === tab ? 'var(--accent)' : 'var(--border)'}`,
              background: filter === tab ? 'rgba(96,165,250,0.12)' : 'transparent',
              color: filter === tab ? 'var(--accent)' : 'var(--dim)',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {tab === 'all' ? `Semua (${counts.all})` : tab === 'recommended' ? `Rekomendasi (${counts.recommended})` : tab === 'unmapped' ? `Belum Map (${counts.unmapped})` : `Sudah Map (${counts.mapped})`}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <input
          type="text"
          placeholder="Cari nama Scalev, SKU, atau produk warehouse..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ ...inputStyle, minWidth: 280, width: 'auto' }}
        />
      </div>

      {loadingRows || loadingProducts ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--dim)' }}>
          {loadingRows ? 'Memuat mapping Scalev...' : 'Memuat master produk warehouse...'}
        </div>
      ) : !selectedBusiness ? (
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
          Pilih business untuk mulai memetakan produk Scalev.
        </div>
      ) : !selectedBusiness.catalog_schema_ready ? (
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
          {selectedBusiness.catalog_schema_message || 'Katalog Scalev belum siap dipakai.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Entity Scalev', 'Mapping Warehouse', 'Status', 'Aksi'].map((header) => (
                  <th key={header} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const isEditing = editingEntityKey === row.entity_key;
                const isSaving = savingEntityKey === row.entity_key;

                return (
                  <tr key={row.entity_key} style={{ borderBottom: '1px solid var(--bg-deep)', verticalAlign: 'top' }}>
                    <td style={{ padding: '8px 8px', minWidth: 260 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        {renderEntityTypeBadge(row.entity_type)}
                        <span style={{ color: 'var(--text)', fontWeight: 700 }}>{row.label}</span>
                      </div>
                      {row.secondary_label ? (
                        <div style={{ color: 'var(--dim)', marginBottom: 4 }}>{row.secondary_label}</div>
                      ) : null}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10 }}>
                        {row.sku ? (
                          <span style={{ padding: '2px 6px', borderRadius: 999, background: 'var(--bg-deep)', color: 'var(--text-secondary)' }}>
                            SKU: {row.sku}
                          </span>
                        ) : null}
                        <span style={{ padding: '2px 6px', borderRadius: 999, background: 'var(--bg-deep)', color: 'var(--text-secondary)' }}>
                          Identifier: {row.identifiers_count}
                        </span>
                      </div>
                      {row.identifiers_preview.length > 0 ? (
                        <div style={{ marginTop: 6, color: 'var(--dim)', fontSize: 10, lineHeight: 1.6 }}>
                          {row.identifiers_preview.slice(0, 3).join(' • ')}
                        </div>
                      ) : null}
                    </td>

                    <td style={{ padding: '8px 8px', minWidth: 320 }}>
                      {isEditing ? (
                        <div>
                          <input
                            type="text"
                            placeholder="Cari produk warehouse..."
                            value={productSearch}
                            onChange={(event) => setProductSearch(event.target.value)}
                            style={inputStyle}
                            autoFocus
                          />
                          {productSearch ? (
                            <div
                              style={{
                                marginTop: 6,
                                maxHeight: 220,
                                overflowY: 'auto',
                                border: '1px solid var(--border)',
                                borderRadius: 8,
                                background: 'var(--bg)',
                              }}
                            >
                              {filteredProducts.map((product) => (
                                <div
                                  key={product.id}
                                  onClick={() => persistMapping(row, product.id)}
                                  style={{
                                    padding: '7px 10px',
                                    cursor: 'pointer',
                                    borderTop: '1px solid var(--bg-deep)',
                                  }}
                                >
                                  <div style={{ color: 'var(--text)', fontWeight: 600 }}>{product.name}</div>
                                  <div style={{ color: 'var(--dim)', fontSize: 10 }}>
                                    {product.category || '-'} • {product.warehouse}-{product.entity}
                                  </div>
                                </div>
                              ))}
                              {filteredProducts.length === 0 ? (
                                <div style={{ padding: '8px 10px', color: 'var(--dim)', fontSize: 10 }}>Tidak ada produk yang cocok.</div>
                              ) : null}
                            </div>
                          ) : null}
                          <button
                            onClick={() => {
                              setEditingEntityKey(null);
                              setProductSearch('');
                            }}
                            style={{
                              marginTop: 8,
                              padding: '5px 10px',
                              borderRadius: 6,
                              border: '1px solid var(--border)',
                              background: 'transparent',
                              color: 'var(--dim)',
                              fontSize: 10,
                              cursor: 'pointer',
                            }}
                          >
                            Batal
                          </button>
                        </div>
                      ) : row.warehouse_product ? (
                        <div>
                          <div style={{ color: 'var(--text)', fontWeight: 700 }}>{row.warehouse_product.name}</div>
                          <div style={{ color: 'var(--dim)', fontSize: 10, marginTop: 3 }}>
                            {row.warehouse_product.category || '-'} • {row.warehouse_product.warehouse}-{row.warehouse_product.entity}
                          </div>
                          {row.mapping_source ? (
                            <div style={{ color: 'var(--dim)', fontSize: 10, marginTop: 4 }}>Source: {row.mapping_source}</div>
                          ) : null}
                        </div>
                      ) : row.recommendation ? (
                        <div
                          style={{
                            padding: '8px 10px',
                            borderRadius: 10,
                            border: '1px dashed rgba(96,165,250,0.4)',
                            background: 'rgba(59,130,246,0.08)',
                          }}
                        >
                          <div style={{ color: '#93c5fd', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>
                            Rekomendasi {row.recommendation.confidence}%
                          </div>
                          <div style={{ color: 'var(--text)', fontWeight: 700 }}>{row.recommendation.warehouse_product_name}</div>
                          <div style={{ color: 'var(--dim)', fontSize: 10, marginTop: 3 }}>
                            {row.recommendation.category || '-'} • {row.recommendation.warehouse}-{row.recommendation.entity}
                          </div>
                          <div style={{ color: 'var(--dim)', fontSize: 10, marginTop: 4, lineHeight: 1.6 }}>
                            {row.recommendation.reason}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--dim)' }}>Belum ada mapping.</span>
                      )}
                    </td>

                    <td style={{ padding: '8px 8px', minWidth: 120 }}>
                      {renderStatusBadge(row.status)}
                    </td>

                    <td style={{ padding: '8px 8px', minWidth: 180 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {!isEditing && row.recommendation ? (
                          <button
                            onClick={() => persistMapping(row, row.recommendation!.warehouse_product_id)}
                            disabled={isSaving}
                            style={{
                              padding: '5px 10px',
                              borderRadius: 6,
                              border: '1px solid rgba(96,165,250,0.35)',
                              background: 'rgba(59,130,246,0.12)',
                              color: '#93c5fd',
                              fontSize: 10,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Gunakan
                          </button>
                        ) : null}

                        {!isEditing ? (
                          <button
                            onClick={() => openEditor(row)}
                            disabled={isSaving}
                            style={{
                              padding: '5px 10px',
                              borderRadius: 6,
                              border: '1px solid var(--border)',
                              background: 'transparent',
                              color: 'var(--accent)',
                              fontSize: 10,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {row.warehouse_product_id ? 'Ubah' : 'Map Manual'}
                          </button>
                        ) : null}

                        {!isEditing && row.warehouse_product_id ? (
                          <button
                            onClick={() => persistMapping(row, null)}
                            disabled={isSaving}
                            style={{
                              padding: '5px 10px',
                              borderRadius: 6,
                              border: '1px solid var(--border)',
                              background: 'transparent',
                              color: '#fca5a5',
                              fontSize: 10,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredRows.length === 0 ? (
            <div
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 20,
                color: 'var(--dim)',
                fontSize: 13,
                marginTop: 12,
              }}
            >
              Tidak ada row untuk filter ini.
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

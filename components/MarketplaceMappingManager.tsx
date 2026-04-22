// @ts-nocheck
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteMarketplaceStoreMappingRule,
  getMarketplaceMappingSnapshot,
  saveMarketplaceStoreMappingRule,
  searchMarketplaceCatalogEntities,
  toggleMarketplaceStoreMappingRule,
} from '@/lib/marketplace-mapping-actions';

const panelStyle = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 16,
  boxShadow: 'var(--shadow)',
};

const inputStyle = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
  outline: 'none',
};

const labelStyle = {
  fontSize: 11,
  color: 'var(--dim)',
  fontWeight: 700,
  marginBottom: 6,
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const PLATFORM_META = {
  shopee: { label: 'Shopee', color: '#ee4d2d', bg: 'rgba(238,77,45,0.12)' },
  tiktok: { label: 'TikTok Shop', color: '#00d2c6', bg: 'rgba(0,210,198,0.12)' },
  lazada: { label: 'Lazada', color: '#1d4ed8', bg: 'rgba(29,78,216,0.12)' },
  blibli: { label: 'BliBli', color: '#2563eb', bg: 'rgba(37,99,235,0.12)' },
};

const MATCH_FIELD_OPTIONS = [
  { value: 'sku', label: 'SKU Marketplace' },
  { value: 'product_name', label: 'Nama Produk' },
];

const MATCH_TYPE_OPTIONS = [
  { value: 'exact', label: 'Exact' },
  { value: 'prefix', label: 'Prefix' },
  { value: 'contains', label: 'Contains' },
];

function getEntityTypeColor(entityType) {
  if (entityType === 'variant') return { color: '#22c55e', bg: 'rgba(34,197,94,0.12)' };
  if (entityType === 'bundle') return { color: '#a855f7', bg: 'rgba(168,85,247,0.12)' };
  return { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' };
}

function MappingMessage({ message }) {
  if (!message) return null;
  return (
    <div
      style={{
        marginBottom: 14,
        padding: '10px 12px',
        borderRadius: 10,
        fontSize: 13,
        background: message.type === 'success' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
        color: message.type === 'success' ? '#6ee7b7' : '#fca5a5',
        border: `1px solid ${message.type === 'success' ? 'rgba(16,185,129,0.24)' : 'rgba(239,68,68,0.24)'}`,
      }}
    >
      {message.text}
    </div>
  );
}

export default function MarketplaceMappingManager() {
  const [isCompact, setIsCompact] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(null);
  const [sources, setSources] = useState([]);
  const [rules, setRules] = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState(null);
  const selectedSourceIdRef = useRef(null);
  const [ruleFilter, setRuleFilter] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    id: null,
    sourceStoreId: '',
    matchField: 'sku',
    matchType: 'exact',
    matchValue: '',
    targetEntityKey: '',
    targetEntityLabel: '',
    targetEntityType: '',
    notes: '',
    isActive: true,
  });

  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogResults, setCatalogResults] = useState([]);

  useEffect(() => {
    const syncCompact = () => {
      if (typeof window === 'undefined') return;
      setIsCompact(window.innerWidth < 1180);
    };
    syncCompact();
    window.addEventListener('resize', syncCompact);
    return () => window.removeEventListener('resize', syncCompact);
  }, []);

  useEffect(() => {
    selectedSourceIdRef.current = selectedSourceId;
  }, [selectedSourceId]);

  const loadSnapshot = useCallback(async (preferredSourceId, initialLoad = false) => {
    if (initialLoad) setLoading(true);
    else setRefreshing(true);
    setError('');

    try {
      const snapshot = await getMarketplaceMappingSnapshot();
      const nextSources = snapshot.sources || [];
      setSources(nextSources);
      setRules(snapshot.rules || []);

      const fallbackId = preferredSourceId
        ?? selectedSourceIdRef.current
        ?? nextSources.find((source) => source.is_active)?.id
        ?? nextSources[0]?.id
        ?? null;
      const nextSelectedId = nextSources.some((source) => source.id === fallbackId)
        ? fallbackId
        : nextSources.find((source) => source.is_active)?.id || nextSources[0]?.id || null;
      setSelectedSourceId(nextSelectedId);
    } catch (err) {
      console.error('Failed to load marketplace mapping snapshot:', err);
      setError(err?.message || 'Gagal memuat marketplace mapping.');
      setSources([]);
      setRules([]);
      setSelectedSourceId(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSnapshot(undefined, true);
  }, [loadSnapshot]);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) || null,
    [sources, selectedSourceId]
  );

  const visibleRules = useMemo(() => {
    const sourceRules = rules.filter((rule) => rule.source_id === selectedSourceId);
    const normalizedFilter = String(ruleFilter || '').trim().toLowerCase();
    const filtered = normalizedFilter
      ? sourceRules.filter((rule) => {
          const haystack = [
            rule.match_value,
            rule.source_store_name,
            rule.target_entity_label,
            rule.notes,
          ].join(' ').toLowerCase();
          return haystack.includes(normalizedFilter);
        })
      : sourceRules;

    return filtered.sort((left, right) => {
      if (Boolean(left.is_active) !== Boolean(right.is_active)) return left.is_active ? -1 : 1;
      const leftText = `${left.match_field}|${left.match_type}|${left.match_value}`;
      const rightText = `${right.match_field}|${right.match_type}|${right.match_value}`;
      return leftText.localeCompare(rightText);
    });
  }, [ruleFilter, rules, selectedSourceId]);

  function resetForm(source = selectedSource) {
    const defaultStoreId = source?.stores?.[0]?.id ? String(source.stores[0].id) : '';
    setForm({
      id: null,
      sourceStoreId: defaultStoreId,
      matchField: 'sku',
      matchType: 'exact',
      matchValue: '',
      targetEntityKey: '',
      targetEntityLabel: '',
      targetEntityType: '',
      notes: '',
      isActive: true,
    });
    setCatalogQuery('');
    setCatalogResults([]);
    setCatalogError('');
    setShowForm(false);
  }

  function handleSelectSource(sourceId) {
    setSelectedSourceId(sourceId);
    setRuleFilter('');
    setMessage(null);
    resetForm(sources.find((source) => source.id === sourceId) || null);
  }

  function handleOpenCreate() {
    resetForm(selectedSource);
    setShowForm(true);
  }

  function handleOpenEdit(rule) {
    if (rule.source_id !== selectedSourceId) {
      setSelectedSourceId(rule.source_id);
    }
    setForm({
      id: rule.id,
      sourceStoreId: String(rule.source_store_id || ''),
      matchField: rule.match_field || 'sku',
      matchType: rule.match_type || 'exact',
      matchValue: rule.match_value || '',
      targetEntityKey: rule.target_entity_key || '',
      targetEntityLabel: rule.target_entity_label || '',
      targetEntityType: rule.target_entity_type || '',
      notes: rule.notes || '',
      isActive: rule.is_active !== false,
    });
    setCatalogQuery('');
    setCatalogResults([]);
    setCatalogError('');
    setShowForm(true);
  }

  async function handleSearchCatalog() {
    if (!selectedSource) return;
    if (String(catalogQuery || '').trim().length < 2) {
      setCatalogError('Masukkan minimal 2 karakter untuk mencari entity katalog.');
      setCatalogResults([]);
      return;
    }

    setCatalogLoading(true);
    setCatalogError('');
    try {
      const results = await searchMarketplaceCatalogEntities({
        sourceId: selectedSource.id,
        query: catalogQuery,
      });
      setCatalogResults(results || []);
      if (!results || results.length === 0) {
        setCatalogError('Tidak ada entity katalog yang cocok dengan pencarian ini.');
      }
    } catch (err) {
      console.error('Failed to search catalog entities:', err);
      setCatalogError(err?.message || 'Gagal mencari entity katalog.');
      setCatalogResults([]);
    } finally {
      setCatalogLoading(false);
    }
  }

  function handleSelectCatalogEntity(entity) {
    setForm((current) => ({
      ...current,
      targetEntityKey: entity.entity_key || '',
      targetEntityLabel: entity.entity_label || '',
      targetEntityType: entity.entity_type || '',
    }));
  }

  function handleClearCatalogEntity() {
    setForm((current) => ({
      ...current,
      targetEntityKey: '',
      targetEntityLabel: '',
      targetEntityType: '',
    }));
  }

  async function handleSaveRule() {
    if (!selectedSource) return;
    setSaving(true);
    setMessage(null);
    setError('');

    try {
      await saveMarketplaceStoreMappingRule({
        id: form.id || undefined,
        sourceId: selectedSource.id,
        sourceStoreId: Number(form.sourceStoreId || 0),
        matchField: form.matchField,
        matchType: form.matchType,
        matchValue: form.matchValue,
        targetEntityKey: form.targetEntityKey || null,
        notes: form.notes || null,
        isActive: form.isActive !== false,
      });

      setMessage({
        type: 'success',
        text: form.id ? 'Rule mapping berhasil diperbarui.' : 'Rule mapping berhasil ditambahkan.',
      });
      await loadSnapshot(selectedSource.id);
      resetForm(selectedSource);
    } catch (err) {
      console.error('Failed to save marketplace mapping rule:', err);
      setMessage({ type: 'error', text: err?.message || 'Gagal menyimpan rule mapping.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleRule(rule) {
    try {
      await toggleMarketplaceStoreMappingRule(rule.id, !rule.is_active);
      setMessage({
        type: 'success',
        text: `Rule "${rule.match_value}" ${rule.is_active ? 'dinonaktifkan' : 'diaktifkan'}.`,
      });
      await loadSnapshot(selectedSourceId);
    } catch (err) {
      console.error('Failed to toggle mapping rule:', err);
      setMessage({ type: 'error', text: err?.message || 'Gagal mengubah status rule.' });
    }
  }

  async function handleDeleteRule(rule) {
    if (!window.confirm(`Hapus rule mapping "${rule.match_value}"?`)) return;
    try {
      await deleteMarketplaceStoreMappingRule(rule.id);
      setMessage({ type: 'success', text: 'Rule mapping dihapus.' });
      await loadSnapshot(selectedSourceId);
      if (form.id === rule.id) resetForm(selectedSource);
    } catch (err) {
      console.error('Failed to delete mapping rule:', err);
      setMessage({ type: 'error', text: err?.message || 'Gagal menghapus rule mapping.' });
    }
  }

  if (loading) {
    return (
      <div style={{ ...panelStyle, padding: 32, textAlign: 'center', color: 'var(--dim)', fontSize: 14 }}>
        Memuat konfigurasi marketplace mapping...
      </div>
    );
  }

  return (
    <>
      <MappingMessage message={message} />
      {error && (
        <div style={{ ...panelStyle, marginBottom: 14, borderColor: 'rgba(239,68,68,0.24)', color: '#fca5a5' }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isCompact ? '1fr' : '320px minmax(0, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Source Account</div>
                <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>
                  Deterministic box untuk uploader marketplace.
                </div>
              </div>
              <button
                onClick={() => loadSnapshot(selectedSourceId)}
                disabled={refreshing}
                style={{
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--dim)',
                  borderRadius: 8,
                  padding: '7px 10px',
                  fontSize: 12,
                  cursor: refreshing ? 'wait' : 'pointer',
                }}
              >
                {refreshing ? 'Refresh...' : 'Refresh'}
              </button>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              {sources.map((source) => {
                const platformMeta = PLATFORM_META[source.platform] || PLATFORM_META.shopee;
                const active = selectedSourceId === source.id;
                return (
                  <button
                    key={source.id}
                    onClick={() => handleSelectSource(source.id)}
                    style={{
                      textAlign: 'left',
                      borderRadius: 12,
                      border: active ? '1px solid rgba(59,130,246,0.4)' : '1px solid var(--border)',
                      background: active ? 'rgba(59,130,246,0.08)' : 'var(--bg)',
                      padding: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: platformMeta.bg,
                          color: platformMeta.color,
                        }}
                      >
                        {platformMeta.label}
                      </span>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: 'rgba(148,163,184,0.12)',
                          color: '#cbd5f5',
                        }}
                      >
                        {source.business_code}
                      </span>
                    </div>

                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{source.source_label}</div>
                    <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
                      {source.description || 'Source account marketplace'}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10, fontSize: 12, color: 'var(--dim)' }}>
                      <span>{source.stores?.length || 0} store</span>
                      <span>{source.rule_count || 0} rule</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {!selectedSource ? (
            <div style={{ ...panelStyle, color: 'var(--dim)', fontSize: 13 }}>
              Belum ada source account marketplace yang aktif.
            </div>
          ) : (
            <>
              <div style={panelStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{selectedSource.source_label}</div>
                      <span
                        style={{
                          padding: '4px 9px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: (PLATFORM_META[selectedSource.platform] || PLATFORM_META.shopee).bg,
                          color: (PLATFORM_META[selectedSource.platform] || PLATFORM_META.shopee).color,
                        }}
                      >
                        {(PLATFORM_META[selectedSource.platform] || PLATFORM_META.shopee).label}
                      </span>
                      <span
                        style={{
                          padding: '4px 9px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: 'rgba(148,163,184,0.12)',
                          color: '#cbd5f5',
                        }}
                      >
                        Business {selectedSource.business_code}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 6, maxWidth: 760 }}>
                      Rule di bawah source ini akan menentukan item marketplace dialokasikan ke store mana, dan bila perlu didecode ke entity Scalev tertentu di business yang sudah terkunci.
                    </div>
                  </div>

                  <button
                    onClick={handleOpenCreate}
                    style={{
                      border: 'none',
                      background: 'var(--green)',
                      color: '#fff',
                      borderRadius: 10,
                      padding: '10px 14px',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    + Tambah Rule
                  </button>
                </div>

                <div style={{ marginTop: 14 }}>
                  <div style={{ ...labelStyle, marginBottom: 8 }}>Allowed Store</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(selectedSource.stores || []).map((store) => (
                      <span
                        key={store.id}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 999,
                          background: 'rgba(148,163,184,0.10)',
                          border: '1px solid var(--border)',
                          fontSize: 12,
                          color: 'var(--text)',
                        }}
                      >
                        {store.store_name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {showForm && (
                <div style={panelStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>
                        {form.id ? 'Edit Rule Mapping' : 'Tambah Rule Mapping'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 3 }}>
                        Rule bisa memetakan SKU/nama produk marketplace ke store tertentu dan optional decode ke bundle/variant/product Scalev.
                      </div>
                    </div>

                    <button
                      onClick={() => resetForm(selectedSource)}
                      style={{
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: 'var(--dim)',
                        borderRadius: 8,
                        padding: '7px 10px',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Tutup
                    </button>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isCompact ? '1fr' : 'repeat(3, minmax(0, 1fr))',
                      gap: 12,
                    }}
                  >
                    <div>
                      <label style={labelStyle}>Field</label>
                      <select
                        value={form.matchField}
                        onChange={(event) => setForm((current) => ({ ...current, matchField: event.target.value }))}
                        style={inputStyle}
                      >
                        {MATCH_FIELD_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={labelStyle}>Tipe Match</label>
                      <select
                        value={form.matchType}
                        onChange={(event) => setForm((current) => ({ ...current, matchType: event.target.value }))}
                        style={inputStyle}
                      >
                        {MATCH_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={labelStyle}>Store Tujuan</label>
                      <select
                        value={form.sourceStoreId}
                        onChange={(event) => setForm((current) => ({ ...current, sourceStoreId: event.target.value }))}
                        style={inputStyle}
                      >
                        <option value="">Pilih store</option>
                        {(selectedSource.stores || []).map((store) => (
                          <option key={store.id} value={String(store.id)}>{store.store_name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <label style={labelStyle}>Nilai Match</label>
                    <input
                      value={form.matchValue}
                      onChange={(event) => setForm((current) => ({ ...current, matchValue: event.target.value }))}
                      placeholder={form.matchField === 'sku' ? 'Contoh: ROV20-295 atau SRTARM-250' : 'Contoh: The Secret Series: Arum by Purvu'}
                      style={inputStyle}
                    />
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <div style={{ ...labelStyle, marginBottom: 8 }}>Decode Entity Scalev (Opsional)</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <input
                        value={catalogQuery}
                        onChange={(event) => setCatalogQuery(event.target.value)}
                        placeholder="Cari bundle / variant / product di katalog Scalev..."
                        style={{ ...inputStyle, flex: 1, minWidth: 260 }}
                      />
                      <button
                        onClick={handleSearchCatalog}
                        disabled={catalogLoading}
                        style={{
                          border: '1px solid var(--border)',
                          background: 'var(--bg)',
                          color: 'var(--text)',
                          borderRadius: 10,
                          padding: '9px 14px',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: catalogLoading ? 'wait' : 'pointer',
                        }}
                      >
                        {catalogLoading ? 'Mencari...' : 'Cari Katalog'}
                      </button>
                      <button
                        onClick={handleClearCatalogEntity}
                        style={{
                          border: '1px solid var(--border)',
                          background: 'transparent',
                          color: 'var(--dim)',
                          borderRadius: 10,
                          padding: '9px 14px',
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        Clear
                      </button>
                    </div>

                    {form.targetEntityKey && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: 12,
                          borderRadius: 12,
                          background: 'rgba(59,130,246,0.08)',
                          border: '1px solid rgba(59,130,246,0.2)',
                        }}
                      >
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                          <span
                            style={{
                              padding: '4px 8px',
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 700,
                              background: getEntityTypeColor(form.targetEntityType).bg,
                              color: getEntityTypeColor(form.targetEntityType).color,
                            }}
                          >
                            {String(form.targetEntityType || 'entity').toUpperCase()}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--dim)' }}>{form.targetEntityKey}</span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{form.targetEntityLabel || 'Entity katalog terpilih'}</div>
                      </div>
                    )}

                    {catalogError && (
                      <div style={{ marginTop: 8, color: '#fca5a5', fontSize: 12 }}>{catalogError}</div>
                    )}

                    {catalogResults.length > 0 && (
                      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                        {catalogResults.map((entity) => {
                          const selected = form.targetEntityKey === entity.entity_key;
                          const entityMeta = getEntityTypeColor(entity.entity_type);
                          return (
                            <button
                              key={entity.entity_key}
                              onClick={() => handleSelectCatalogEntity(entity)}
                              style={{
                                textAlign: 'left',
                                borderRadius: 12,
                                border: selected ? '1px solid rgba(59,130,246,0.4)' : '1px solid var(--border)',
                                background: selected ? 'rgba(59,130,246,0.08)' : 'var(--bg)',
                                padding: 12,
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span
                                  style={{
                                    padding: '4px 8px',
                                    borderRadius: 999,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    background: entityMeta.bg,
                                    color: entityMeta.color,
                                  }}
                                >
                                  {String(entity.entity_type || '').toUpperCase()}
                                </span>
                                <span style={{ fontSize: 12, color: 'var(--dim)' }}>{entity.entity_key}</span>
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 7 }}>{entity.entity_label}</div>
                              {entity.secondary_label && (
                                <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>{entity.secondary_label}</div>
                              )}
                              {entity.identifiers_preview?.length > 0 && (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                                  {entity.identifiers_preview.map((value) => (
                                    <span
                                      key={`${entity.entity_key}:${value}`}
                                      style={{
                                        padding: '4px 7px',
                                        borderRadius: 999,
                                        fontSize: 11,
                                        border: '1px solid var(--border)',
                                        background: 'rgba(148,163,184,0.08)',
                                        color: 'var(--dim)',
                                      }}
                                    >
                                      {value}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <label style={labelStyle}>Catatan</label>
                    <textarea
                      value={form.notes}
                      onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                      rows={3}
                      placeholder="Contoh: decode ke bundle Scalev karena file MP memakai seller SKU bundle."
                      style={{ ...inputStyle, resize: 'vertical', minHeight: 84 }}
                    />
                  </div>

                  <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginTop: 14, fontSize: 13, color: 'var(--text)' }}>
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                    />
                    Rule aktif
                  </label>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                    <button
                      onClick={() => resetForm(selectedSource)}
                      style={{
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: 'var(--dim)',
                        borderRadius: 10,
                        padding: '10px 14px',
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      Batal
                    </button>
                    <button
                      onClick={handleSaveRule}
                      disabled={saving}
                      style={{
                        border: 'none',
                        background: 'var(--green)',
                        color: '#fff',
                        borderRadius: 10,
                        padding: '10px 14px',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: saving ? 'wait' : 'pointer',
                      }}
                    >
                      {saving ? 'Menyimpan...' : form.id ? 'Update Rule' : 'Simpan Rule'}
                    </button>
                  </div>
                </div>
              )}

              <div style={panelStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>Rule Mapping</div>
                    <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 3 }}>
                      Total {visibleRules.length} rule untuk source ini.
                    </div>
                  </div>

                  <input
                    value={ruleFilter}
                    onChange={(event) => setRuleFilter(event.target.value)}
                    placeholder="Filter rule..."
                    style={{ ...inputStyle, width: isCompact ? '100%' : 240 }}
                  />
                </div>

                {visibleRules.length === 0 ? (
                  <div
                    style={{
                      borderRadius: 12,
                      border: '1px dashed var(--border)',
                      padding: 20,
                      textAlign: 'center',
                      color: 'var(--dim)',
                      fontSize: 13,
                    }}
                  >
                    Belum ada rule mapping untuk source ini.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
                      <thead>
                        <tr>
                          {['Lookup', 'Store', 'Decode', 'Catatan', 'Status', 'Aksi'].map((header) => (
                            <th
                              key={header}
                              style={{
                                textAlign: 'left',
                                padding: '10px 12px',
                                fontSize: 11,
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                color: 'var(--dim)',
                                borderBottom: '1px solid var(--border)',
                              }}
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRules.map((rule) => {
                          const entityMeta = getEntityTypeColor(rule.target_entity_type);
                          return (
                            <tr key={rule.id}>
                              <td style={{ padding: '12px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }}>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                                  <span
                                    style={{
                                      padding: '4px 8px',
                                      borderRadius: 999,
                                      fontSize: 11,
                                      fontWeight: 700,
                                      background: 'rgba(59,130,246,0.12)',
                                      color: '#60a5fa',
                                    }}
                                  >
                                    {rule.match_field === 'sku' ? 'SKU' : 'PRODUCT'}
                                  </span>
                                  <span
                                    style={{
                                      padding: '4px 8px',
                                      borderRadius: 999,
                                      fontSize: 11,
                                      fontWeight: 700,
                                      background: 'rgba(148,163,184,0.12)',
                                      color: 'var(--dim)',
                                    }}
                                  >
                                    {String(rule.match_type || '').toUpperCase()}
                                  </span>
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 700 }}>{rule.match_value}</div>
                              </td>

                              <td style={{ padding: '12px', borderBottom: '1px solid var(--border)', verticalAlign: 'top', fontSize: 13 }}>
                                {rule.source_store_name || '-'}
                              </td>

                              <td style={{ padding: '12px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }}>
                                {rule.target_entity_key ? (
                                  <>
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                                      <span
                                        style={{
                                          padding: '4px 8px',
                                          borderRadius: 999,
                                          fontSize: 11,
                                          fontWeight: 700,
                                          background: entityMeta.bg,
                                          color: entityMeta.color,
                                        }}
                                      >
                                        {String(rule.target_entity_type || '').toUpperCase()}
                                      </span>
                                      <span style={{ fontSize: 11, color: 'var(--dim)' }}>{rule.target_entity_key}</span>
                                    </div>
                                    <div style={{ fontSize: 13, fontWeight: 700 }}>{rule.target_entity_label || '-'}</div>
                                  </>
                                ) : (
                                  <span style={{ fontSize: 12, color: 'var(--dim)' }}>Store-only rule</span>
                                )}
                              </td>

                              <td style={{ padding: '12px', borderBottom: '1px solid var(--border)', verticalAlign: 'top', fontSize: 12, color: 'var(--dim)', lineHeight: 1.5 }}>
                                {rule.notes || '—'}
                              </td>

                              <td style={{ padding: '12px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }}>
                                <span
                                  style={{
                                    padding: '4px 8px',
                                    borderRadius: 999,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    background: rule.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.12)',
                                    color: rule.is_active ? '#22c55e' : 'var(--dim)',
                                  }}
                                >
                                  {rule.is_active ? 'Aktif' : 'Nonaktif'}
                                </span>
                              </td>

                              <td style={{ padding: '12px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }}>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  <button
                                    onClick={() => handleOpenEdit(rule)}
                                    style={{
                                      border: '1px solid var(--border)',
                                      background: 'transparent',
                                      color: 'var(--text)',
                                      borderRadius: 8,
                                      padding: '6px 10px',
                                      fontSize: 12,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleToggleRule(rule)}
                                    style={{
                                      border: '1px solid var(--border)',
                                      background: 'transparent',
                                      color: rule.is_active ? '#f59e0b' : '#22c55e',
                                      borderRadius: 8,
                                      padding: '6px 10px',
                                      fontSize: 12,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {rule.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                                  </button>
                                  <button
                                    onClick={() => handleDeleteRule(rule)}
                                    style={{
                                      border: '1px solid rgba(239,68,68,0.24)',
                                      background: 'transparent',
                                      color: '#f87171',
                                      borderRadius: 8,
                                      padding: '6px 10px',
                                      fontSize: 12,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    Hapus
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

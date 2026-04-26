// @ts-nocheck
'use client';

import { useEffect, useMemo, useState } from 'react';

import { listMarketplaceIntakeSourceConfigs } from '@/lib/marketplace-intake-sources';

const panelStyle = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 16,
  boxShadow: 'var(--shadow)',
};

const SOURCE_OPTIONS = listMarketplaceIntakeSourceConfigs();

function fmtNumber(value) {
  return new Intl.NumberFormat('id-ID').format(Number(value || 0));
}

function fmtDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function SummaryCard({ label, value, helper, tone = 'default' }) {
  const color = tone === 'success'
    ? '#22c55e'
    : tone === 'warn'
      ? '#f59e0b'
      : 'var(--text)';
  const bg = tone === 'success'
    ? 'rgba(34,197,94,0.08)'
    : tone === 'warn'
      ? 'rgba(245,158,11,0.08)'
      : 'var(--bg)';

  return (
    <div style={{ background: bg, border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800, color }}>
        {fmtNumber(value)}
      </div>
      {helper ? <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dim)' }}>{helper}</div> : null}
    </div>
  );
}

function ActionButton({ children, onClick, tone = 'default', disabled = false, type = 'button' }) {
  const palette = tone === 'primary'
    ? { bg: '#2563eb', color: '#fff', border: '#2563eb' }
    : tone === 'warn'
      ? { bg: 'rgba(245,158,11,0.12)', color: '#fcd34d', border: 'rgba(245,158,11,0.24)' }
      : tone === 'danger'
        ? { bg: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: 'rgba(239,68,68,0.24)' }
        : { bg: 'var(--bg)', color: 'var(--text-secondary)', border: 'var(--border)' };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '7px 10px',
        borderRadius: 8,
        border: `1px solid ${palette.border}`,
        background: disabled ? 'var(--bg)' : palette.bg,
        color: disabled ? 'var(--dim)' : palette.color,
        fontSize: 12,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function StatusPill({ active }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 9px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: active ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.12)',
        color: active ? '#22c55e' : 'var(--dim)',
        border: `1px solid ${active ? 'rgba(34,197,94,0.24)' : 'var(--border)'}`,
      }}
    >
      {active ? 'Aktif' : 'Nonaktif'}
    </span>
  );
}

function buildEmptyForm(sourceKey = 'tiktok_rti') {
  return {
    id: null,
    sourceKey,
    rawPlatformSkuId: '',
    rawSellerSku: '',
    rawProductName: '',
    rawVariation: '',
    normalizedSku: '',
    reason: '',
    isActive: true,
  };
}

function buildEmptyManualRuleForm(sourceKey = 'tiktok_rti') {
  return {
    id: null,
    sourceKey,
    mpSku: '',
    mpProductName: '',
    mpVariation: '',
    targetEntityKey: '',
    targetEntityLabel: '',
    targetCustomId: '',
    scalevBundleId: '',
    mappedStoreName: '',
    isActive: true,
  };
}

export default function MarketplaceSkuAliasPanel() {
  const [resolverView, setResolverView] = useState('sku');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [data, setData] = useState({ items: [], summary: { total: 0, active: 0, inactive: 0 } });
  const [manualRulesData, setManualRulesData] = useState({ items: [], summary: { total: 0, active: 0, inactive: 0 } });
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [entityStoreFilter, setEntityStoreFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(buildEmptyForm());
  const [manualRuleFormOpen, setManualRuleFormOpen] = useState(false);
  const [manualRuleForm, setManualRuleForm] = useState(buildEmptyManualRuleForm());
  const [storeScopeLoading, setStoreScopeLoading] = useState(false);
  const [storeScopeSaving, setStoreScopeSaving] = useState(false);
  const [storeScope, setStoreScope] = useState(null);
  const [storeScopeDraft, setStoreScopeDraft] = useState([]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const query = sourceFilter !== 'all'
        ? `?limit=500&sourceKey=${encodeURIComponent(sourceFilter)}`
        : '?limit=500';
      const [aliasRes, manualRuleRes] = await Promise.all([
        fetch(`/api/marketplace-intake/sku-aliases${query}`),
        fetch(`/api/marketplace-intake/manual-rules${query}`),
      ]);
      const [aliasNext, manualRuleNext] = await Promise.all([
        aliasRes.json(),
        manualRuleRes.json(),
      ]);
      if (!aliasRes.ok) throw new Error(aliasNext.error || 'Gagal memuat SKU alias marketplace.');
      if (!manualRuleRes.ok) throw new Error(manualRuleNext.error || 'Gagal memuat resolver rule marketplace.');
      setData(aliasNext);
      setManualRulesData(manualRuleNext);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal memuat resolver rules marketplace.');
      setData({ items: [], summary: { total: 0, active: 0, inactive: 0 } });
      setManualRulesData({ items: [], summary: { total: 0, active: 0, inactive: 0 } });
    } finally {
      setLoading(false);
    }
  }

  async function loadStoreScope(nextSourceKey = sourceFilter) {
    if (!nextSourceKey || nextSourceKey === 'all') {
      setStoreScope(null);
      setStoreScopeDraft([]);
      return;
    }

    setStoreScopeLoading(true);
    try {
      const res = await fetch(`/api/marketplace-intake/source-store-scopes?sourceKey=${encodeURIComponent(nextSourceKey)}`);
      const next = await res.json();
      if (!res.ok) throw new Error(next.error || 'Gagal memuat store scope marketplace.');
      setStoreScope(next);
      setStoreScopeDraft(next.selectedStoreNames || []);
    } catch (err) {
      console.error(err);
      setStoreScope(null);
      setStoreScopeDraft([]);
      setError(err?.message || 'Gagal memuat store scope marketplace.');
    } finally {
      setStoreScopeLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [sourceFilter]);

  useEffect(() => {
    loadStoreScope(sourceFilter);
  }, [sourceFilter]);

  useEffect(() => {
    setEntityStoreFilter('all');
  }, [sourceFilter]);

  useEffect(() => {
    setFormOpen(false);
    setManualRuleFormOpen(false);
  }, [resolverView]);

  const activeSourceConfig = useMemo(() => {
    if (sourceFilter === 'all') return null;
    return SOURCE_OPTIONS.find((source) => source.sourceKey === sourceFilter) || null;
  }, [sourceFilter]);

  const filteredItems = useMemo(() => {
    const query = cleanText(search).toLowerCase();
    return (data.items || []).filter((item) => {
      if (statusFilter === 'active' && !item.isActive) return false;
      if (statusFilter === 'inactive' && item.isActive) return false;
      if (!query) return true;
      const haystack = [
        item.sourceLabel,
        item.businessCode,
        item.platform,
        item.rawPlatformSkuId,
        item.rawSellerSku,
        item.rawProductName,
        item.rawVariation,
        item.normalizedSku,
        item.reason,
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [data.items, search, statusFilter]);

  const filteredManualRules = useMemo(() => {
    const query = cleanText(search).toLowerCase();
    return (manualRulesData.items || []).filter((item) => {
      if (statusFilter === 'active' && !item.isActive) return false;
      if (statusFilter === 'inactive' && item.isActive) return false;
      if (activeSourceConfig) {
        if (entityStoreFilter === '__unassigned__' && item.mappedStoreName) return false;
        if (entityStoreFilter !== 'all' && entityStoreFilter !== '__unassigned__' && item.mappedStoreName !== entityStoreFilter) return false;
      }
      if (!query) return true;
      const haystack = [
        item.sourceLabel,
        item.businessCode,
        item.platform,
        item.mpSku,
        item.mpProductName,
        item.mpVariation,
        item.targetEntityLabel,
        item.targetCustomId,
        item.mappedStoreName,
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [activeSourceConfig, entityStoreFilter, manualRulesData.items, search, statusFilter]);

  const storeScopedManualRules = useMemo(() => {
    if (!activeSourceConfig) return [];
    return (manualRulesData.items || []).filter((item) => {
      if (item.sourceKey !== activeSourceConfig.sourceKey) return false;
      if (statusFilter === 'active' && !item.isActive) return false;
      if (statusFilter === 'inactive' && item.isActive) return false;
      return true;
    });
  }, [activeSourceConfig, manualRulesData.items, statusFilter]);

  const entityStoreOptions = useMemo(() => {
    if (!activeSourceConfig) return [];
    const scopedStoreNames = (storeScope?.availableStores || [])
      .filter((store) => store.isSelected)
      .map((store) => store.storeName);
    const effectiveStoreNames = scopedStoreNames.length > 0
      ? scopedStoreNames
      : activeSourceConfig.allowedStores;
    const baseItems = [
      {
        key: 'all',
        label: 'Semua Store',
        helper: 'Lihat semua atribusi source ini',
        count: storeScopedManualRules.length,
      },
      ...effectiveStoreNames.map((storeName) => ({
        key: storeName,
        label: storeName,
        helper: 'Atribusi sales ke store ini',
        count: storeScopedManualRules.filter((item) => item.mappedStoreName === storeName).length,
      })),
      {
        key: '__unassigned__',
        label: 'Tanpa atribusi store',
        helper: 'Rule entity belum di-lock ke store tertentu',
        count: storeScopedManualRules.filter((item) => !item.mappedStoreName).length,
      },
    ];
    return baseItems;
  }, [activeSourceConfig, storeScope?.availableStores, storeScopedManualRules]);

  async function saveStoreScope() {
    if (!activeSourceConfig) return;
    setStoreScopeSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/marketplace-intake/source-store-scopes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceKey: activeSourceConfig.sourceKey,
          selectedStoreNames: storeScopeDraft,
        }),
      });
      const next = await res.json();
      if (!res.ok) throw new Error(next.error || 'Gagal menyimpan store scope marketplace.');
      setStoreScope(next);
      setStoreScopeDraft(next.selectedStoreNames || []);
      setMessage(`Whitelist store untuk ${next.sourceLabel} berhasil disimpan.`);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal menyimpan store scope marketplace.');
    } finally {
      setStoreScopeSaving(false);
    }
  }

  function resetForm(sourceKey = form.sourceKey || 'tiktok_rti') {
    setForm(buildEmptyForm(sourceKey));
  }

  function resetManualRuleForm(sourceKey = manualRuleForm.sourceKey || 'tiktok_rti') {
    setManualRuleForm(buildEmptyManualRuleForm(sourceKey));
  }

  function startCreate() {
    setMessage('');
    setError('');
    setForm(buildEmptyForm(sourceFilter !== 'all' ? sourceFilter : 'tiktok_rti'));
    setFormOpen(true);
  }

  function startCreateManualRule() {
    setMessage('');
    setError('');
    const sourceKey = sourceFilter !== 'all' ? sourceFilter : 'tiktok_rti';
    const preferredStoreName = activeSourceConfig && entityStoreFilter !== 'all' && entityStoreFilter !== '__unassigned__'
      ? entityStoreFilter
      : '';
    setManualRuleForm({
      ...buildEmptyManualRuleForm(sourceKey),
      mappedStoreName: preferredStoreName,
    });
    setManualRuleFormOpen(true);
  }

  function startEdit(item) {
    setMessage('');
    setError('');
    setForm({
      id: item.id,
      sourceKey: item.sourceKey,
      rawPlatformSkuId: item.rawPlatformSkuId || '',
      rawSellerSku: item.rawSellerSku || '',
      rawProductName: item.rawProductName || '',
      rawVariation: item.rawVariation || '',
      normalizedSku: item.normalizedSku || '',
      reason: item.reason || '',
      isActive: item.isActive !== false,
    });
    setFormOpen(true);
  }

  function startEditManualRule(item) {
    setMessage('');
    setError('');
    setManualRuleForm({
      id: item.id,
      sourceKey: item.sourceKey,
      mpSku: item.mpSku || '',
      mpProductName: item.mpProductName || '',
      mpVariation: item.mpVariation || '',
      targetEntityKey: item.targetEntityKey || '',
      targetEntityLabel: item.targetEntityLabel || '',
      targetCustomId: item.targetCustomId || '',
      scalevBundleId: String(item.scalevBundleId || ''),
      mappedStoreName: item.mappedStoreName || '',
      isActive: item.isActive !== false,
    });
    setManualRuleFormOpen(true);
  }

  async function submitForm(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const method = form.id ? 'PATCH' : 'POST';
      const res = await fetch('/api/marketplace-intake/sku-aliases', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const next = await res.json();
      if (!res.ok) throw new Error(next.error || 'Gagal menyimpan SKU alias marketplace.');
      setMessage(form.id ? 'SKU alias berhasil diubah.' : 'SKU alias berhasil ditambahkan.');
      setFormOpen(false);
      resetForm(form.sourceKey);
      await loadData();
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal menyimpan SKU alias marketplace.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/marketplace-intake/sku-aliases', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          sourceKey: item.sourceKey,
          rawPlatformSkuId: item.rawPlatformSkuId,
          rawSellerSku: item.rawSellerSku,
          rawProductName: item.rawProductName,
          rawVariation: item.rawVariation,
          normalizedSku: item.normalizedSku,
          reason: item.reason,
          isActive: !item.isActive,
        }),
      });
      const next = await res.json();
      if (!res.ok) throw new Error(next.error || 'Gagal mengubah status SKU alias.');
      setMessage(item.isActive ? 'SKU alias dinonaktifkan.' : 'SKU alias diaktifkan kembali.');
      await loadData();
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal mengubah status SKU alias.');
    } finally {
      setSaving(false);
    }
  }

  async function submitManualRuleForm(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const method = manualRuleForm.id ? 'PATCH' : 'POST';
      const res = await fetch('/api/marketplace-intake/manual-rules', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...manualRuleForm,
          scalevBundleId: Number(manualRuleForm.scalevBundleId || 0),
        }),
      });
      const next = await res.json();
      if (!res.ok) throw new Error(next.error || 'Gagal menyimpan rule entity/store.');
      setMessage(manualRuleForm.id ? 'Rule entity/store berhasil diubah.' : 'Rule entity/store berhasil ditambahkan.');
      setManualRuleFormOpen(false);
      resetManualRuleForm(manualRuleForm.sourceKey);
      await loadData();
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal menyimpan rule entity/store.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleManualRuleActive(item) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/marketplace-intake/manual-rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          sourceKey: item.sourceKey,
          mpSku: item.mpSku,
          mpProductName: item.mpProductName,
          mpVariation: item.mpVariation,
          targetEntityKey: item.targetEntityKey,
          targetEntityLabel: item.targetEntityLabel,
          targetCustomId: item.targetCustomId,
          scalevBundleId: item.scalevBundleId,
          mappedStoreName: item.mappedStoreName,
          isActive: !item.isActive,
        }),
      });
      const next = await res.json();
      if (!res.ok) throw new Error(next.error || 'Gagal mengubah status rule entity/store.');
      setMessage(item.isActive ? 'Rule entity/store dinonaktifkan.' : 'Rule entity/store diaktifkan kembali.');
      await loadData();
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal mengubah status rule entity/store.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Resolver Rules Marketplace</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4, maxWidth: 900, lineHeight: 1.6 }}>
              Semua aturan resolver dipusatkan di sini: <strong>SKU normalization</strong> untuk merapikan raw SKU marketplace, lalu <strong>entity/store rules</strong> untuk mengunci target Scalev tanpa bergantung pada memory tersembunyi.
              Preview intake tetap dipakai untuk melihat exception, tetapi rule permanennya disimpan dan dikelola di panel ini.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setResolverView('sku')}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: `1px solid ${resolverView === 'sku' ? 'rgba(37,99,235,0.32)' : 'var(--border)'}`,
                  background: resolverView === 'sku' ? 'rgba(37,99,235,0.12)' : 'var(--bg)',
                  color: resolverView === 'sku' ? '#bfdbfe' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                SKU Normalization
              </button>
              <button
                type="button"
                onClick={() => setResolverView('entity_store')}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: `1px solid ${resolverView === 'entity_store' ? 'rgba(34,197,94,0.32)' : 'var(--border)'}`,
                  background: resolverView === 'entity_store' ? 'rgba(34,197,94,0.12)' : 'var(--bg)',
                  color: resolverView === 'entity_store' ? '#86efac' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Entity & Store Attribution
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={resolverView === 'sku' ? 'Cari raw SKU, normalized SKU, nama produk…' : 'Cari matcher intake, bundle, atau store…'}
              style={{
                minWidth: 260,
                padding: '9px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              style={{
                minWidth: 150,
                padding: '9px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 13,
                outline: 'none',
              }}
            >
              <option value="all">Semua Source</option>
              {SOURCE_OPTIONS.map((source) => (
                <option key={source.sourceKey} value={source.sourceKey}>
                  {source.sourceLabel}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              style={{
                minWidth: 130,
                padding: '9px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 13,
                outline: 'none',
              }}
            >
              <option value="active">Rule Aktif</option>
              <option value="inactive">Rule Nonaktif</option>
              <option value="all">Semua Status</option>
            </select>
            <ActionButton onClick={loadData} disabled={loading || saving}>
              {loading ? 'Memuat…' : 'Refresh'}
            </ActionButton>
            {resolverView === 'sku' ? (
              <ActionButton onClick={startCreate} tone="primary" disabled={saving}>
                Tambah Alias SKU
              </ActionButton>
            ) : (
              <ActionButton onClick={startCreateManualRule} tone="primary" disabled={saving}>
                Tambah Rule Entity
              </ActionButton>
            )}
          </div>
        </div>

        {error ? (
          <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#fca5a5', fontSize: 13 }}>
            {error}
          </div>
        ) : null}
        {message ? (
          <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.08)', color: '#86efac', fontSize: 13 }}>
            {message}
          </div>
        ) : null}

        {resolverView === 'entity_store' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <SummaryCard label="Rule Entity" value={manualRulesData.summary.total} helper="Rule target entity/store permanen." />
            <SummaryCard label="Rule Aktif" value={manualRulesData.summary.active} tone="success" helper="Dipakai untuk preselect exact match." />
            <SummaryCard label="Rule Nonaktif" value={manualRulesData.summary.inactive} tone="warn" helper="Tidak dipakai sampai diaktifkan kembali." />
          </div>
        ) : null}
      </div>

      {resolverView === 'sku' && formOpen ? (
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{form.id ? 'Edit Rule SKU Normalization' : 'Tambah Rule SKU Normalization'}</div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
                Isi minimal satu matcher mentah, lalu tentukan `normalized SKU` yang harus dipakai intake.
              </div>
            </div>
            <ActionButton onClick={() => { setFormOpen(false); resetForm(); }} disabled={saving}>
              Tutup
            </ActionButton>
          </div>

          <form onSubmit={submitForm} style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>Source</span>
                <select
                  value={form.sourceKey}
                  onChange={(event) => setForm((current) => ({ ...current, sourceKey: event.target.value }))}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  {SOURCE_OPTIONS.map((source) => (
                    <option key={source.sourceKey} value={source.sourceKey}>
                      {source.sourceLabel}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>Normalized SKU</span>
                <input
                  value={form.normalizedSku}
                  onChange={(event) => setForm((current) => ({ ...current, normalizedSku: event.target.value }))}
                  placeholder="Contoh: SRTARM-185"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>Raw Seller SKU</span>
                <input
                  value={form.rawSellerSku}
                  onChange={(event) => setForm((current) => ({ ...current, rawSellerSku: event.target.value }))}
                  placeholder="Contoh: SRTARM-250"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>Raw Platform SKU ID</span>
                <input
                  value={form.rawPlatformSkuId}
                  onChange={(event) => setForm((current) => ({ ...current, rawPlatformSkuId: event.target.value }))}
                  placeholder="Contoh: 1729778418551522592"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>Raw Product Name</span>
                <input
                  value={form.rawProductName}
                  onChange={(event) => setForm((current) => ({ ...current, rawProductName: event.target.value }))}
                  placeholder="Dipakai kalau SKU tidak stabil"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>Raw Variation</span>
                <input
                  value={form.rawVariation}
                  onChange={(event) => setForm((current) => ({ ...current, rawVariation: event.target.value }))}
                  placeholder="Opsional"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </label>
            </div>

            <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--dim)' }}>Reason</span>
              <textarea
                value={form.reason}
                onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
                placeholder="Contoh: SKU lama di dashboard TikTok, ops sudah upload versi baru ke Scalev."
                rows={3}
                style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' }}
              />
            </label>

            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={Boolean(form.isActive)}
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
              />
              Alias aktif dan langsung dipakai classifier
            </label>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ActionButton type="submit" tone="primary" disabled={saving}>
                {saving ? 'Menyimpan…' : form.id ? 'Simpan Perubahan' : 'Tambah Alias'}
              </ActionButton>
              <ActionButton onClick={() => resetForm(form.sourceKey)} disabled={saving}>
                Reset
              </ActionButton>
            </div>
          </form>
        </div>
      ) : null}

      {resolverView === 'entity_store' && manualRuleFormOpen ? (
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{manualRuleForm.id ? 'Edit Rule Entity & Store' : 'Tambah Rule Entity & Store'}</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
              Rule ini bekerja setelah SKU selesai dinormalisasi. Isi matcher intake, lalu kunci target entity Scalev dan store jika perlu.
              Rule yang disimpan dari preview juga akan muncul di daftar ini.
            </div>
            </div>
            <ActionButton onClick={() => { setManualRuleFormOpen(false); resetManualRuleForm(); }} disabled={saving}>
              Tutup
            </ActionButton>
          </div>

          <form onSubmit={submitManualRuleForm} style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>Source</span>
                <select
                  value={manualRuleForm.sourceKey}
                  onChange={(event) => setManualRuleForm((current) => ({ ...current, sourceKey: event.target.value }))}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  {SOURCE_OPTIONS.map((source) => (
                    <option key={source.sourceKey} value={source.sourceKey}>
                      {source.sourceLabel}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>SKU Intake Matcher</span>
                <input
                  value={manualRuleForm.mpSku}
                  onChange={(event) => setManualRuleForm((current) => ({ ...current, mpSku: event.target.value }))}
                  placeholder="Contoh: PLV20-245"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>Produk Marketplace</span>
                <input
                  value={manualRuleForm.mpProductName}
                  onChange={(event) => setManualRuleForm((current) => ({ ...current, mpProductName: event.target.value }))}
                  placeholder="Contoh: Pluve Fiber Collagen Drink"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>Variation</span>
                <input
                  value={manualRuleForm.mpVariation}
                  onChange={(event) => setManualRuleForm((current) => ({ ...current, mpVariation: event.target.value }))}
                  placeholder="Opsional"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>Target Entity Key</span>
                <input
                  value={manualRuleForm.targetEntityKey}
                  onChange={(event) => setManualRuleForm((current) => ({ ...current, targetEntityKey: event.target.value }))}
                  placeholder="Contoh: bundle:123"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>Target Entity Label</span>
                <input
                  value={manualRuleForm.targetEntityLabel}
                  onChange={(event) => setManualRuleForm((current) => ({ ...current, targetEntityLabel: event.target.value }))}
                  placeholder="Nama bundle/entity Scalev"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>Target Custom ID</span>
                <input
                  value={manualRuleForm.targetCustomId}
                  onChange={(event) => setManualRuleForm((current) => ({ ...current, targetCustomId: event.target.value }))}
                  placeholder="Contoh: PLV20-245"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>Scalev Bundle ID</span>
                <input
                  value={manualRuleForm.scalevBundleId}
                  onChange={(event) => setManualRuleForm((current) => ({ ...current, scalevBundleId: event.target.value }))}
                  placeholder="Contoh: 376"
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--dim)' }}>Store Override</span>
                <select
                  value={manualRuleForm.mappedStoreName}
                  onChange={(event) => setManualRuleForm((current) => ({ ...current, mappedStoreName: event.target.value }))}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  <option value="">Tanpa override store</option>
                  {((storeScope?.availableStores || []).filter((store) => store.isSelected)).map((store) => (
                    <option key={store.storeName} value={store.storeName}>
                      {store.storeName}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={Boolean(manualRuleForm.isActive)}
                onChange={(event) => setManualRuleForm((current) => ({ ...current, isActive: event.target.checked }))}
              />
              Rule aktif dan langsung dipakai preview intake
            </label>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ActionButton type="submit" tone="primary" disabled={saving}>
                {saving ? 'Menyimpan…' : manualRuleForm.id ? 'Simpan Perubahan' : 'Tambah Rule'}
              </ActionButton>
              <ActionButton onClick={() => resetManualRuleForm(manualRuleForm.sourceKey)} disabled={saving}>
                Reset
              </ActionButton>
            </div>
          </form>
        </div>
      ) : null}

      {resolverView === 'sku' ? (
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Daftar Rule SKU Normalization</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4, maxWidth: 760, lineHeight: 1.6 }}>
              Memperbaiki atribusi nama SKU yang tidak match antara marketplace dan internal.
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--dim)' }}>
            {fmtNumber(filteredItems.length)} alias tampil
          </div>
        </div>

        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Source</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Matcher Mentah</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Normalized SKU</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Reason</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Status</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Updated</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {!loading && filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '18px 12px', fontSize: 13, color: 'var(--dim)' }}>
                    Belum ada SKU alias yang cocok dengan filter sekarang.
                  </td>
                </tr>
              ) : null}
              {filteredItems.map((item) => (
                <tr key={item.id}>
                  <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700 }}>{item.sourceLabel}</div>
                    <div style={{ color: 'var(--dim)', marginTop: 4 }}>{item.businessCode} • {item.platform}</div>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                    {item.rawSellerSku ? <div><strong>Seller SKU:</strong> {item.rawSellerSku}</div> : null}
                    {item.rawPlatformSkuId ? <div style={{ marginTop: 4 }}><strong>Platform SKU ID:</strong> {item.rawPlatformSkuId}</div> : null}
                    {item.rawProductName ? <div style={{ marginTop: 4 }}><strong>Produk:</strong> {item.rawProductName}</div> : null}
                    {item.rawVariation ? <div style={{ marginTop: 4, color: 'var(--dim)' }}>Variation: {item.rawVariation}</div> : null}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700 }}>{item.normalizedSku}</div>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)', color: item.reason ? 'var(--text-secondary)' : 'var(--dim)' }}>
                    {item.reason || '-'}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                    <StatusPill active={item.isActive} />
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)', color: 'var(--dim)' }}>
                    {fmtDateTime(item.updatedAt)}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                      <ActionButton onClick={() => startEdit(item)} disabled={saving}>
                        Edit
                      </ActionButton>
                      <ActionButton onClick={() => toggleActive(item)} tone={item.isActive ? 'warn' : 'primary'} disabled={saving}>
                        {item.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      ) : null}

      {resolverView === 'entity_store' ? (
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Daftar Rule Entity & Store</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4, maxWidth: 760, lineHeight: 1.6 }}>
              Menghubungkan antara nama SKU di marketplace dengan nama bundle, dan meletakkan atribusi salesnya di store yang sesuai.
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--dim)' }}>
            {fmtNumber(filteredManualRules.length)} rule tampil
          </div>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {!activeSourceConfig ? (
            <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--dim)', fontSize: 12, lineHeight: 1.6 }}>
              Pilih <strong>source</strong> di filter atas untuk melihat daftar store attribution business itu. Tanpa source spesifik, tabel di bawah menampilkan semua rule entity/store lintas source.
            </div>
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                }}
              >
                <div style={{ display: 'grid', gap: 4 }}>
                  <div style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Store Scope • {activeSourceConfig.sourceLabel}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
                    Setiap matcher intake bertemu ke <strong>satu bundle/entity</strong>, lalu sales order-nya diatribusikan ke store yang dipilih di sini. Atribusi store bisa diubah tanpa mengubah target bundle.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--dim)', fontWeight: 700 }}>
                    Store Atribusi
                  </div>
                  <select
                    value={entityStoreFilter}
                    onChange={(event) => setEntityStoreFilter(event.target.value)}
                    style={{
                      minWidth: 260,
                      maxWidth: 360,
                      padding: '9px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--card)',
                      color: 'var(--text)',
                      fontSize: 13,
                      outline: 'none',
                    }}
                  >
                    {entityStoreOptions.map((storeOption) => (
                      <option key={storeOption.key} value={storeOption.key}>
                        {storeOption.label} ({fmtNumber(storeOption.count)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {entityStoreOptions.find((storeOption) => storeOption.key === entityStoreFilter)?.helper ? (
                <div style={{ fontSize: 12, color: 'var(--dim)', paddingInline: 2 }}>
                  {entityStoreOptions.find((storeOption) => storeOption.key === entityStoreFilter)?.helper}
                </div>
              ) : null}
            </>
          )}

          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Source</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Matcher Intake</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Bundle / Entity</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Store Atribusi</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Usage</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Status</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Updated</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && filteredManualRules.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '18px 12px', fontSize: 13, color: 'var(--dim)' }}>
                        Belum ada rule entity/store yang cocok dengan filter sekarang.
                      </td>
                    </tr>
                  ) : null}
                  {filteredManualRules.map((item) => (
                    <tr key={item.id}>
                      <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 700 }}>{item.sourceLabel}</div>
                        <div style={{ color: 'var(--dim)', marginTop: 4 }}>{item.businessCode} • {item.platform}</div>
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                        <div><strong>SKU:</strong> {item.mpSku || '-'}</div>
                        <div style={{ marginTop: 4 }}><strong>Produk:</strong> {item.mpProductName}</div>
                        {item.mpVariation ? <div style={{ marginTop: 4, color: 'var(--dim)' }}>Variation: {item.mpVariation}</div> : null}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 700 }}>{item.targetEntityLabel}</div>
                        <div style={{ marginTop: 4, color: 'var(--dim)' }}>{item.targetCustomId || item.targetEntityKey}</div>
                        <div style={{ marginTop: 4, color: 'var(--dim)' }}>Bundle ID: {fmtNumber(item.scalevBundleId)}</div>
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                        {item.mappedStoreName || <span style={{ color: 'var(--dim)' }}>Belum diatribusikan</span>}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                        <div>{fmtNumber(item.usageCount)}x</div>
                        {item.lastConfirmedAt ? <div style={{ marginTop: 4, color: 'var(--dim)' }}>Last: {fmtDateTime(item.lastConfirmedAt)}</div> : null}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                        <StatusPill active={item.isActive} />
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)', color: 'var(--dim)' }}>
                        {fmtDateTime(item.updatedAt)}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                          <ActionButton onClick={() => startEditManualRule(item)} disabled={saving}>
                            Edit
                          </ActionButton>
                          <ActionButton onClick={() => toggleManualRuleActive(item)} tone={item.isActive ? 'warn' : 'primary'} disabled={saving}>
                            {item.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                          </ActionButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          </div>
        </div>
      </div>
      ) : null}
    </div>
  );
}

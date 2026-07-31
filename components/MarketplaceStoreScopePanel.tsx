// @ts-nocheck
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMarketplaceIntakeSources } from '@/lib/use-marketplace-intake-sources';

const panelStyle = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 16,
  boxShadow: 'var(--shadow)',
};

function fmtNumber(value) {
  return new Intl.NumberFormat('id-ID').format(Number(value || 0));
}

function ActionButton({ children, onClick, tone = 'default', disabled = false, type = 'button' }) {
  const palette = tone === 'primary'
    ? { bg: '#2563eb', color: '#fff', border: '#2563eb' }
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

export default function MarketplaceStoreScopePanel() {
  const {
    sources,
    businesses,
    loading: sourcesLoading,
    error: sourcesError,
    refresh: refreshSources,
  } = useMarketplaceIntakeSources();
  const [sourceKey, setSourceKey] = useState('');
  const [newPlatform, setNewPlatform] = useState('shopee');
  const [newBusinessId, setNewBusinessId] = useState('');
  const [creatingSource, setCreatingSource] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [scope, setScope] = useState(null);
  const [draft, setDraft] = useState([]);
  const [warehouseDraft, setWarehouseDraft] = useState({});

  const activeSource = useMemo(
    () => sources.find((source) => source.sourceKey === sourceKey) || sources[0] || null,
    [sourceKey, sources],
  );

  useEffect(() => {
    if (sources.length === 0) {
      setSourceKey('');
      setScope(null);
      setDraft([]);
      setWarehouseDraft({});
      setLoading(false);
      return;
    }
    if (!sources.some((source) => source.sourceKey === sourceKey)) {
      setSourceKey(sources[0].sourceKey);
    }
  }, [sourceKey, sources]);

  async function loadScope(nextSourceKey = sourceKey) {
    if (!nextSourceKey) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/marketplace-intake/source-store-scopes?sourceKey=${encodeURIComponent(nextSourceKey)}`);
      const next = await res.json();
      if (!res.ok) throw new Error(next.error || 'Gagal memuat store scope marketplace.');
      setScope(next);
      setDraft(next.selectedStoreNames || []);
      setWarehouseDraft(Object.fromEntries(
        (next.availableStores || []).map((store) => [store.storeName, store.scalevWarehouseName || '']),
      ));
    } catch (err) {
      console.error(err);
      setScope(null);
      setDraft([]);
      setWarehouseDraft({});
      setError(err?.message || 'Gagal memuat store scope marketplace.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadScope(sourceKey);
  }, [sourceKey]);

  async function saveScope() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/marketplace-intake/source-store-scopes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceKey,
          selectedStoreNames: draft,
          scalevWarehouseNames: warehouseDraft,
        }),
      });
      const next = await res.json();
      if (!res.ok) throw new Error(next.error || 'Gagal menyimpan store scope marketplace.');
      setScope(next);
      setDraft(next.selectedStoreNames || []);
      setWarehouseDraft(Object.fromEntries(
        (next.availableStores || []).map((store) => [store.storeName, store.scalevWarehouseName || '']),
      ));
      setMessage(`Whitelist store untuk ${next.sourceLabel} berhasil disimpan.`);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal menyimpan store scope marketplace.');
    } finally {
      setSaving(false);
    }
  }

  async function createSource() {
    if (!newBusinessId) return;
    setCreatingSource(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/marketplace-intake/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: newPlatform, businessId: Number(newBusinessId) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Gagal menambahkan source marketplace.');
      await refreshSources();
      setMessage('Source marketplace workspace berhasil ditambahkan.');
    } catch (nextError) {
      setError(nextError?.message || 'Gagal menambahkan source marketplace.');
    } finally {
      setCreatingSource(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Store Scope Marketplace</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4, maxWidth: 900, lineHeight: 1.6 }}>
              Untuk tiap source marketplace, app mengambil semua store di business yang terhubung pada Business Settings. Pilih store mana saja yang di-whitelist sebagai destinasi atribusi sales order marketplace dari source itu.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={sourceKey}
              onChange={(event) => setSourceKey(event.target.value)}
              style={{
                minWidth: 180,
                padding: '9px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 13,
                outline: 'none',
              }}
            >
              <option value="">- Pilih source -</option>
              {sources.map((source) => (
                <option key={source.sourceKey} value={source.sourceKey}>
                  {source.sourceLabel}
                </option>
              ))}
            </select>
            <ActionButton onClick={() => loadScope(sourceKey)} disabled={loading || saving}>
              {loading ? 'Memuat…' : 'Refresh'}
            </ActionButton>
            <ActionButton onClick={() => {
              setDraft(scope?.selectedStoreNames || []);
              setWarehouseDraft(Object.fromEntries(
                (scope?.availableStores || []).map((store) => [store.storeName, store.scalevWarehouseName || '']),
              ));
            }} disabled={loading || saving}>
              Reset
            </ActionButton>
            <ActionButton onClick={saveScope} tone="primary" disabled={loading || saving || draft.length === 0}>
              {saving ? 'Menyimpan…' : 'Simpan Store Scope'}
            </ActionButton>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginBottom: 14, padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)' }}>
          <label style={{ display: 'grid', gap: 5, fontSize: 11, color: 'var(--dim)' }}>
            Platform baru
            <select value={newPlatform} onChange={(event) => setNewPlatform(event.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}>
              <option value="shopee">Shopee</option>
              <option value="tiktok">TikTok</option>
              <option value="blibli">Blibli</option>
              <option value="lazada">Lazada</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 5, fontSize: 11, color: 'var(--dim)' }}>
            Business ScaleV workspace
            <select value={newBusinessId} onChange={(event) => setNewBusinessId(event.target.value)} style={{ minWidth: 220, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}>
              <option value="">- Pilih business -</option>
              {businesses.filter((business) => business.is_active !== false).map((business) => (
                <option key={business.id} value={business.id}>
                  {business.business_code} • {business.business_name || 'Tanpa nama'}
                </option>
              ))}
            </select>
          </label>
          <ActionButton onClick={createSource} tone="primary" disabled={!newBusinessId || creatingSource || sourcesLoading}>
            {creatingSource ? 'Menambahkan…' : 'Tambah Source Workspace'}
          </ActionButton>
          <div style={{ fontSize: 11, color: 'var(--dim)', maxWidth: 500, lineHeight: 1.5 }}>
            Source adalah konfigurasi tenant. Workspace baru tidak menerima source milik company lain secara otomatis.
          </div>
        </div>

        {sourcesError || error ? (
          <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#fca5a5', fontSize: 13 }}>
            {sourcesError || error}
          </div>
        ) : null}
        {message ? (
          <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.08)', color: '#86efac', fontSize: 13 }}>
            {message}
          </div>
        ) : null}

        {!sourcesLoading && sources.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--dim)' }}>
            Workspace ini masih kosong. Tambahkan business ScaleV di Business Settings untuk membentuk source marketplace milik workspace ini.
          </div>
        ) : loading || sourcesLoading ? (
          <div style={{ fontSize: 12, color: 'var(--dim)' }}>Memuat daftar store business…</div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 10 }}>
              Source <strong style={{ color: 'var(--text-secondary)' }}>{activeSource?.sourceLabel}</strong>
              {' • '}
              Business <strong style={{ color: 'var(--text-secondary)' }}>{scope?.businessCode || activeSource?.businessCode}</strong>
              {' • '}
              {fmtNumber(scope?.availableStores?.length || 0)} store tersedia
              {' • '}
              {fmtNumber(draft.length)} store dipilih
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Store</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Tipe Store</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Status</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Nama Gudang di ScaleV</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Whitelist</th>
                  </tr>
                </thead>
                <tbody>
                  {(scope?.availableStores || []).map((store) => {
                    const checked = draft.includes(store.storeName);
                    return (
                      <tr
                        key={store.storeName}
                        style={{
                          background: checked ? 'rgba(34,197,94,0.06)' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
                          <div style={{ fontWeight: 700 }}>{store.storeName}</div>
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>
                          {store.storeType || 'Belum diisi'}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: store.isActive ? '#86efac' : '#fca5a5', borderBottom: '1px solid var(--border)' }}>
                          {store.isActive ? 'Aktif di Business Settings' : 'Tidak aktif di Business Settings'}
                        </td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                          <input
                            value={warehouseDraft[store.storeName] || ''}
                            onChange={(event) => setWarehouseDraft((current) => ({
                              ...current,
                              [store.storeName]: event.target.value,
                            }))}
                            placeholder="Nama persis gudang ScaleV"
                            style={{ minWidth: 230, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12 }}
                          />
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              setDraft((current) => (
                                event.target.checked
                                  ? Array.from(new Set([...current, store.storeName])).sort((left, right) => left.localeCompare(right))
                                  : current.filter((name) => name !== store.storeName)
                              ));
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

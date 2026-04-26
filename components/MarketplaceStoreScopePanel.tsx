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
  const [sourceKey, setSourceKey] = useState(SOURCE_OPTIONS[0]?.sourceKey || 'shopee_rlt');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [scope, setScope] = useState(null);
  const [draft, setDraft] = useState([]);

  const activeSource = useMemo(
    () => SOURCE_OPTIONS.find((source) => source.sourceKey === sourceKey) || SOURCE_OPTIONS[0] || null,
    [sourceKey],
  );

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
    } catch (err) {
      console.error(err);
      setScope(null);
      setDraft([]);
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
        }),
      });
      const next = await res.json();
      if (!res.ok) throw new Error(next.error || 'Gagal menyimpan store scope marketplace.');
      setScope(next);
      setDraft(next.selectedStoreNames || []);
      setMessage(`Whitelist store untuk ${next.sourceLabel} berhasil disimpan.`);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal menyimpan store scope marketplace.');
    } finally {
      setSaving(false);
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
              {SOURCE_OPTIONS.map((source) => (
                <option key={source.sourceKey} value={source.sourceKey}>
                  {source.sourceLabel}
                </option>
              ))}
            </select>
            <ActionButton onClick={() => loadScope(sourceKey)} disabled={loading || saving}>
              {loading ? 'Memuat…' : 'Refresh'}
            </ActionButton>
            <ActionButton onClick={() => setDraft(scope?.selectedStoreNames || [])} disabled={loading || saving}>
              Reset
            </ActionButton>
            <ActionButton onClick={saveScope} tone="primary" disabled={loading || saving || draft.length === 0}>
              {saving ? 'Menyimpan…' : 'Simpan Store Scope'}
            </ActionButton>
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

        {loading ? (
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

// components/ConnectionManager.tsx
'use client';

import { useState, useEffect } from 'react';
import { getScalevStatus } from '@/lib/scalev-actions';
import {
  getWebhookBusinesses,
  saveWebhookBusiness,
  deleteWebhookBusiness,
  toggleWebhookBusiness,
  getStoreChannels,
  saveStoreChannel,
  deleteStoreChannel,
  fetchStoresFromScalev,
  toggleStoreChannel,
} from '@/lib/webhook-actions';

type Business = {
  id: number;
  business_code: string;
  business_name: string;
  is_active: boolean;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
  last_webhook_at: string | null;
  last_sync_type: string | null;
};

type StoreChannel = {
  id: number;
  store_name: string;
  store_type: 'marketplace' | 'scalev' | 'reseller';
  is_active: boolean;
  created_at: string;
};

type FormData = {
  id?: number;
  business_code: string;
  business_name: string;
  webhook_secret: string;
  api_key: string;
};

const EMPTY_FORM: FormData = { business_code: '', business_name: '', webhook_secret: '', api_key: '' };

const STORE_TYPES = [
  { value: 'marketplace' as const, label: 'Marketplace', color: '#0ea5e9', bg: '#0c4a6e' },
  { value: 'scalev' as const, label: 'Scalev', color: '#a78bfa', bg: '#312e81' },
  { value: 'reseller' as const, label: 'Reseller', color: '#f59e0b', bg: '#78350f' },
];

export default function ConnectionManager() {
  // ── Connection status ──
  const [configured, setConfigured] = useState(false);
  const [bizCount, setBizCount] = useState<number>(0);

  // ── Business state ──
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // ── Store channels state ──
  const [expandedBiz, setExpandedBiz] = useState<number | null>(null);
  const [storeChannels, setStoreChannels] = useState<StoreChannel[]>([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [fetchingStores, setFetchingStores] = useState(false);
  const [confirmDeleteStore, setConfirmDeleteStore] = useState<number | null>(null);
  const [hideInactive, setHideInactive] = useState(true);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    try {
      const [status, bizData] = await Promise.all([
        getScalevStatus(),
        getWebhookBusinesses(),
      ]);
      setConfigured(status.configured);
      setBizCount(status.businessesWithApiKeys);
      setBusinesses(bizData);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  // ── Business CRUD ──
  function openAddForm() {
    setForm(EMPTY_FORM);
    setShowForm(true);
    setMessage(null);
  }

  function openEditForm(biz: Business) {
    setForm({
      id: biz.id,
      business_code: biz.business_code,
      business_name: biz.business_name,
      webhook_secret: '',
      api_key: '',
    });
    setShowForm(true);
    setMessage(null);
  }

  async function handleSave() {
    if (!form.business_code.trim() || !form.business_name.trim()) return;
    if (!form.id && !form.webhook_secret.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await saveWebhookBusiness({
        id: form.id,
        business_code: form.business_code,
        business_name: form.business_name,
        webhook_secret: form.webhook_secret || 'unchanged',
        api_key: form.api_key || 'unchanged',
      });
      setMessage({ type: 'success', text: form.id ? 'Business berhasil diupdate!' : 'Business berhasil ditambahkan!' });
      setShowForm(false);
      setForm(EMPTY_FORM);
      await loadAll();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setMessage(null);
    try {
      await deleteWebhookBusiness(id);
      setMessage({ type: 'success', text: 'Business berhasil dihapus' });
      setConfirmDelete(null);
      if (expandedBiz === id) setExpandedBiz(null);
      await loadAll();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  async function handleToggle(id: number, currentActive: boolean) {
    setMessage(null);
    try {
      await toggleWebhookBusiness(id, !currentActive);
      await loadAll();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  // ── Store channels ──
  async function toggleExpand(bizId: number) {
    if (expandedBiz === bizId) { setExpandedBiz(null); return; }
    setExpandedBiz(bizId);
    setLoadingStores(true);
    try {
      const stores = await getStoreChannels(bizId);
      setStoreChannels(stores);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoadingStores(false);
    }
  }

  async function handleFetchStores(bizId: number) {
    setFetchingStores(true);
    setMessage(null);
    try {
      const result = await fetchStoresFromScalev(bizId);
      setMessage({ type: 'success', text: `${result.total} stores ditemukan. ${result.inserted} baru ditambahkan.` });
      const stores = await getStoreChannels(bizId);
      setStoreChannels(stores);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setFetchingStores(false);
    }
  }

  async function handleStoreTypeChange(storeId: number, storeName: string, newType: StoreChannel['store_type']) {
    setMessage(null);
    try {
      await saveStoreChannel({
        id: storeId,
        business_id: expandedBiz!,
        store_name: storeName,
        store_type: newType,
      });
      setStoreChannels(prev => prev.map(sc =>
        sc.id === storeId ? { ...sc, store_type: newType } : sc
      ));
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  async function handleToggleStore(storeId: number, currentActive: boolean) {
    setMessage(null);
    try {
      await toggleStoreChannel(storeId, !currentActive);
      setStoreChannels(prev => prev.map(sc =>
        sc.id === storeId ? { ...sc, is_active: !currentActive } : sc
      ));
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  async function handleDeleteStore(id: number) {
    setMessage(null);
    try {
      await deleteStoreChannel(id);
      setConfirmDeleteStore(null);
      setStoreChannels(prev => prev.filter(sc => sc.id !== id));
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  function formatTime(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Baru saja';
    if (diffMin < 60) return `${diffMin} menit lalu`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} jam lalu`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay} hari lalu`;
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  if (loading) {
    return (
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <div style={{ color: '#64748b', fontSize: 13 }}>Memuat koneksi Scalev...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Status Bar ── */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span style={{
          padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
          background: configured ? '#064e3b' : '#78350f',
          color: configured ? '#10b981' : '#f59e0b',
        }}>
          {configured ? `${bizCount} business terhubung` : 'Belum ada API key'}
        </span>
        <span style={{ fontSize: 11, color: '#475569' }}>Sinkronisasi order tersedia di tab Sync</span>
      </div>

      {/* Messages */}
      {message && (
        <div style={{
          padding: 12, borderRadius: 8, fontSize: 13,
          background: message.type === 'success' ? '#064e3b' : '#7f1d1d',
          color: message.type === 'success' ? '#10b981' : '#ef4444',
        }}>
          {message.text}
        </div>
      )}

      {/* ── Businesses ── */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Businesses</div>
          <button
            onClick={openAddForm}
            style={{
              padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: '#3b82f6', color: '#fff', fontSize: 12, fontWeight: 600,
            }}
          >
            + Tambah Business
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#475569', padding: '8px 10px', background: '#0c1b3a', borderRadius: 6, marginTop: 10, marginBottom: 14 }}>
          <strong>Webhook URL:</strong>{' '}
          <span style={{ color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace' }}>
            https://roove-bi.vercel.app/api/scalev-webhook
          </span>
        </div>

        {/* ── Add/Edit Form ── */}
        {showForm && (
          <div style={{
            padding: 14, background: '#0c1b3a', border: '1px solid #1e3a5f',
            borderRadius: 8, marginBottom: 14,
          }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
              {form.id ? 'Edit Business' : 'Tambah Business Baru'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: '0 0 120px' }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Kode (unik)</div>
                  <input
                    type="text"
                    value={form.business_code}
                    onChange={(e) => setForm({ ...form, business_code: e.target.value.toUpperCase() })}
                    placeholder="RTI"
                    maxLength={10}
                    disabled={!!form.id}
                    style={{
                      width: '100%', padding: '8px 12px', background: form.id ? '#1a2744' : '#0b1121',
                      border: '1px solid #1a2744', borderRadius: 6, color: '#e2e8f0', fontSize: 13,
                      outline: 'none', opacity: form.id ? 0.6 : 1,
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Nama Business</div>
                  <input
                    type="text"
                    value={form.business_name}
                    onChange={(e) => setForm({ ...form, business_name: e.target.value })}
                    placeholder="Roove Tijara Internasional"
                    style={{
                      width: '100%', padding: '8px 12px', background: '#0b1121',
                      border: '1px solid #1a2744', borderRadius: 6, color: '#e2e8f0', fontSize: 13,
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                    Webhook Secret {form.id && <span style={{ color: '#475569' }}>(kosongkan jika tidak diubah)</span>}
                  </div>
                  <input
                    type="password"
                    value={form.webhook_secret}
                    onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })}
                    placeholder={form.id ? '••••••••••' : 'Secret dari Scalev dashboard'}
                    style={{
                      width: '100%', padding: '8px 12px', background: '#0b1121',
                      border: '1px solid #1a2744', borderRadius: 6, color: '#e2e8f0', fontSize: 13,
                      outline: 'none',
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                    API Key {form.id && <span style={{ color: '#475569' }}>(kosongkan jika tidak diubah)</span>}
                  </div>
                  <input
                    type="password"
                    value={form.api_key}
                    onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                    placeholder={form.id ? '••••••••••' : 'API key dari Scalev'}
                    style={{
                      width: '100%', padding: '8px 12px', background: '#0b1121',
                      border: '1px solid #1a2744', borderRadius: 6, color: '#e2e8f0', fontSize: 13,
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.business_code.trim() || !form.business_name.trim() || (!form.id && !form.webhook_secret.trim())}
                  style={{
                    padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: '#1e40af', color: '#93c5fd', fontSize: 12, fontWeight: 600,
                    opacity: saving ? 0.5 : 1,
                  }}
                >
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
                <button
                  onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
                  style={{
                    padding: '8px 16px', borderRadius: 6, border: '1px solid #1a2744', cursor: 'pointer',
                    background: 'transparent', color: '#64748b', fontSize: 12, fontWeight: 600,
                  }}
                >
                  Batal
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Business Table ── */}
        {businesses.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: 20 }}>
            Belum ada business terdaftar.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1a2744' }}>
                  <th style={{ textAlign: 'left', padding: '8px 10px', color: '#64748b', fontWeight: 600, fontSize: 11 }}>KODE</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', color: '#64748b', fontWeight: 600, fontSize: 11 }}>NAMA BUSINESS</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', color: '#64748b', fontWeight: 600, fontSize: 11 }}>KONEKSI</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', color: '#64748b', fontWeight: 600, fontSize: 11 }}>AKTIVITAS</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', color: '#64748b', fontWeight: 600, fontSize: 11 }}>AKSI</th>
                </tr>
              </thead>
              <tbody>
                {businesses.map((biz) => (
                  <>{/* Fragment for business row + expanded stores */}
                    <tr key={biz.id} style={{ borderBottom: expandedBiz === biz.id ? 'none' : '1px solid #0f1d32' }}>
                      <td style={{ padding: '10px 10px', fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f0', fontWeight: 600 }}>
                        <span onClick={() => toggleExpand(biz.id)} style={{ cursor: 'pointer' }}>
                          {expandedBiz === biz.id ? '▼' : '▶'} {biz.business_code}
                        </span>
                      </td>
                      <td style={{ padding: '10px 10px', color: '#e2e8f0' }}>
                        {biz.business_name}
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <span style={{
                            padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            background: biz.has_api_key ? '#064e3b' : '#1a2744',
                            color: biz.has_api_key ? '#10b981' : '#475569',
                          }}>API</span>
                          <span style={{
                            padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            background: biz.is_active ? '#064e3b' : '#1a2744',
                            color: biz.is_active ? '#10b981' : '#475569',
                          }}>Webhook</span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 10px', color: '#64748b', fontSize: 12 }}>
                        {formatTime(biz.last_webhook_at)}
                        {biz.last_sync_type && (
                          <span style={{ color: '#475569', marginLeft: 6 }}>
                            ({biz.last_sync_type.replace('webhook_', '')})
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button onClick={() => openEditForm(biz)} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #1a2744', background: 'transparent', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>Edit</button>
                          {confirmDelete === biz.id ? (
                            <>
                              <button onClick={() => handleDelete(biz.id)} style={{ padding: '4px 10px', borderRadius: 4, border: 'none', background: '#7f1d1d', color: '#ef4444', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Yakin?</button>
                              <button onClick={() => setConfirmDelete(null)} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #1a2744', background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer' }}>Batal</button>
                            </>
                          ) : (
                            <button onClick={() => setConfirmDelete(biz.id)} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #2d1515', background: 'transparent', color: '#ef4444', fontSize: 11, cursor: 'pointer' }}>Hapus</button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* ── Expanded Stores Panel ── */}
                    {expandedBiz === biz.id && (
                      <tr key={`stores-${biz.id}`}>
                        <td colSpan={5} style={{ padding: '0 10px 12px 10px' }}>
                          <div style={{ background: '#0c1b3a', border: '1px solid #1e3a5f', borderRadius: 8, padding: 14 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>
                                  Stores
                                  <span style={{ fontWeight: 400, color: '#475569', marginLeft: 6 }}>
                                    {storeChannels.filter(sc => sc.is_active).length} aktif
                                    {storeChannels.some(sc => !sc.is_active) && ` / ${storeChannels.length} total`}
                                  </span>
                                </div>
                                {storeChannels.some(sc => !sc.is_active) && (
                                  <button
                                    onClick={() => setHideInactive(!hideInactive)}
                                    style={{
                                      padding: '2px 8px', borderRadius: 4, border: '1px solid #1a2744', cursor: 'pointer',
                                      background: hideInactive ? 'transparent' : '#1a2744',
                                      color: '#64748b', fontSize: 10, fontWeight: 500,
                                    }}
                                  >
                                    {hideInactive ? 'Tampilkan inactive' : 'Sembunyikan inactive'}
                                  </button>
                                )}
                              </div>
                              {biz.has_api_key && (
                                <button
                                  onClick={() => handleFetchStores(biz.id)}
                                  disabled={fetchingStores}
                                  style={{
                                    padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                                    background: '#1e40af', color: '#93c5fd', fontSize: 11, fontWeight: 600,
                                    opacity: fetchingStores ? 0.5 : 1,
                                  }}
                                >
                                  {fetchingStores ? 'Mengambil...' : 'Refresh dari API'}
                                </button>
                              )}
                            </div>

                            {loadingStores ? (
                              <div style={{ color: '#64748b', fontSize: 12 }}>Memuat stores...</div>
                            ) : storeChannels.length === 0 ? (
                              <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 12 }}>
                                {biz.has_api_key
                                  ? 'Belum ada stores. Klik "Refresh dari API" untuk mengambil dari Scalev.'
                                  : 'Masukkan API key terlebih dahulu.'}
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {[...storeChannels]
                                  .sort((a, b) => (a.is_active === b.is_active ? 0 : a.is_active ? -1 : 1))
                                  .filter(sc => !hideInactive || sc.is_active)
                                  .map((sc) => (
                                  <div key={sc.id} style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '8px 10px', background: '#0b1121', borderRadius: 6, gap: 10,
                                    opacity: sc.is_active ? 1 : 0.45,
                                  }}>
                                    <button
                                      onClick={() => handleToggleStore(sc.id, sc.is_active)}
                                      title={sc.is_active ? 'Nonaktifkan store' : 'Aktifkan store'}
                                      style={{
                                        width: 14, height: 14, borderRadius: 3, border: 'none', cursor: 'pointer',
                                        background: sc.is_active ? '#10b981' : '#334155', flexShrink: 0,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        padding: 0, fontSize: 9, color: '#fff', lineHeight: 1,
                                      }}
                                    >
                                      {sc.is_active ? '✓' : ''}
                                    </button>
                                    <div style={{ flex: 1, fontSize: 12, color: sc.is_active ? '#e2e8f0' : '#475569', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {sc.store_name}
                                    </div>
                                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                      {STORE_TYPES.map((st) => (
                                        <button
                                          key={st.value}
                                          onClick={() => {
                                            if (sc.store_type !== st.value) {
                                              handleStoreTypeChange(sc.id, sc.store_name, st.value);
                                            }
                                          }}
                                          style={{
                                            padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
                                            fontSize: 10, fontWeight: 600,
                                            background: sc.store_type === st.value ? st.bg : 'transparent',
                                            color: sc.store_type === st.value ? st.color : '#475569',
                                            opacity: sc.store_type === st.value ? 1 : 0.6,
                                          }}
                                        >
                                          {st.label}
                                        </button>
                                      ))}
                                    </div>
                                    <div style={{ flexShrink: 0 }}>
                                      {confirmDeleteStore === sc.id ? (
                                        <div style={{ display: 'flex', gap: 4 }}>
                                          <button onClick={() => handleDeleteStore(sc.id)} style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#7f1d1d', color: '#ef4444', fontSize: 10, cursor: 'pointer', fontWeight: 600 }}>Yakin?</button>
                                          <button onClick={() => setConfirmDeleteStore(null)} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #1a2744', background: 'transparent', color: '#64748b', fontSize: 10, cursor: 'pointer' }}>Batal</button>
                                        </div>
                                      ) : (
                                        <button onClick={() => setConfirmDeleteStore(sc.id)} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #2d1515', background: 'transparent', color: '#ef4444', fontSize: 10, cursor: 'pointer' }}>Hapus</button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

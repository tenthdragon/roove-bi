// app/dashboard/business-settings/page.tsx
// @ts-nocheck
'use client';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/lib/supabase-browser';
import {
  getWebhookBusinesses,
  saveWebhookBusiness,
  deleteWebhookBusiness,
  toggleWebhookBusiness,
  updateWebhookBusinessTaxRate,
  getStoreChannels,
  saveStoreChannel,
  deleteStoreChannel,
  fetchStoresFromScalev,
  toggleStoreChannel,
} from '@/lib/webhook-actions';
import {
  getWarehouseBusinessMappings,
  updateWarehouseBusinessMapping,
  createWarehouseBusinessMapping,
  removeWarehouseBusinessMapping,
} from '@/lib/warehouse-ledger-actions';

// ── Types ──
type Business = {
  id: number;
  business_code: string;
  business_name: string;
  is_active: boolean;
  has_api_key: boolean;
  tax_rate_name?: string;
  created_at: string;
  updated_at: string;
  last_webhook_at: string | null;
  last_sync_type: string | null;
};

type StoreChannel = {
  id: number;
  store_name: string;
  store_type: 'marketplace' | 'scalev' | 'reseller';
  channel_override: string | null;
  is_active: boolean;
  created_at: string;
};

type WarehouseMapping = {
  id: number;
  business_code: string;
  deduct_entity: string;
  deduct_warehouse: string;
  is_active: boolean;
  is_primary: boolean;
  notes: string | null;
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
  { value: 'marketplace', label: 'Marketplace', color: '#0ea5e9' },
  { value: 'scalev', label: 'Scalev', color: '#a78bfa' },
  { value: 'reseller', label: 'Reseller', color: 'var(--yellow)' },
];

const CHANNEL_OVERRIDE_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: 'WABA', label: 'WABA' },
  { value: 'Scalev Ads', label: 'Scalev Ads' },
  { value: 'CS Manual', label: 'CS Manual' },
  { value: 'Reseller', label: 'Reseller' },
  { value: 'Shopee', label: 'Shopee' },
  { value: 'TikTok Shop', label: 'TikTok Shop' },
  { value: 'Tokopedia', label: 'Tokopedia' },
  { value: 'BliBli', label: 'BliBli' },
  { value: 'Lazada', label: 'Lazada' },
];

// ── Helpers ──
function formatTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'Baru saja';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} menit lalu`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} jam lalu`;
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)} hari lalu`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function sortWarehouseMappings(rows: WarehouseMapping[]) {
  return [...rows].sort((left, right) => {
    if (Boolean(left.is_primary) !== Boolean(right.is_primary)) return left.is_primary ? -1 : 1;
    if (Boolean(left.is_active) !== Boolean(right.is_active)) return left.is_active ? -1 : 1;
    const leftLabel = `${left.deduct_entity}|${left.deduct_warehouse}`;
    const rightLabel = `${right.deduct_entity}|${right.deduct_warehouse}`;
    return leftLabel.localeCompare(rightLabel);
  });
}

function formatWarehouseSummary(rows: WarehouseMapping[]) {
  const activeRows = sortWarehouseMappings(rows.filter(row => row.is_active));
  if (activeRows.length === 0) {
    return rows.length > 0 ? 'Gudang nonaktif' : 'Gudang: Belum';
  }

  const primary = activeRows.find(row => row.is_primary) || activeRows[0];
  const primaryLabel = `${primary.deduct_warehouse}-${primary.deduct_entity}`;
  return activeRows.length > 1
    ? `${primaryLabel} +${activeRows.length - 1}`
    : primaryLabel;
}

const inputStyle = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg)',
  color: 'var(--text)', fontSize: 13, outline: 'none',
};

const labelStyle = { fontSize: 11, color: 'var(--dim)', fontWeight: 600, marginBottom: 4, display: 'block' };

// ============================================================
// MAIN PAGE
// ============================================================
export default function BusinessSettingsPage() {
  const supabase = useSupabase();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [warehouseMappings, setWarehouseMappings] = useState<WarehouseMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // Expanded business detail
  const [expandedBiz, setExpandedBiz] = useState<number | null>(null);
  const [storeChannels, setStoreChannels] = useState<StoreChannel[]>([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [fetchingStores, setFetchingStores] = useState(false);
  const [storeError, setStoreError] = useState('');
  const [hideInactive, setHideInactive] = useState(true);

  // Warehouse entities (for dropdown)
  const [warehouseEntities, setWarehouseEntities] = useState<string[]>([]);
  const [warehouseCodes, setWarehouseCodes] = useState<string[]>([]);

  // ── Load all data ──
  async function loadAll() {
    setLoading(true);
    setLoadError('');
    try {
      const [bizData, whData] = await Promise.all([
        getWebhookBusinesses(),
        getWarehouseBusinessMappings(),
      ]);
      setBusinesses(bizData);
      setWarehouseMappings(whData);

      // Get distinct entities from warehouse_products
      const { data: entityData, error: entityError } = await supabase
        .from('warehouse_products')
        .select('entity, warehouse')
        .order('entity');
      if (entityError) throw entityError;
      const entities = [...new Set((entityData || []).map(e => e.entity))].filter(Boolean);
      const warehouses = [...new Set((entityData || []).map(e => e.warehouse))].filter(Boolean);
      setWarehouseEntities(entities);
      setWarehouseCodes(warehouses.length > 0 ? warehouses : ['BTN']);
    } catch (err: any) {
      console.error('Failed to load:', err);
      setLoadError(err?.message || 'Gagal memuat Business Settings.');
      setBusinesses([]);
      setWarehouseMappings([]);
      setWarehouseEntities([]);
      setWarehouseCodes(['BTN']);
    }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

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
      webhook_secret: 'unchanged',
      api_key: 'unchanged',
    });
    setShowForm(true);
    setMessage(null);
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      await saveWebhookBusiness(form);
      setMessage({ type: 'success', text: form.id ? 'Business updated' : 'Business ditambahkan' });
      setShowForm(false);
      setForm(EMPTY_FORM);
      await loadAll();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
    setSaving(false);
  }

  async function handleDelete(id: number) {
    setSaving(true);
    try {
      await deleteWebhookBusiness(id);
      setMessage({ type: 'success', text: 'Business dihapus' });
      setConfirmDelete(null);
      if (expandedBiz === id) setExpandedBiz(null);
      await loadAll();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
    setSaving(false);
  }

  async function handleToggle(id: number, currentActive: boolean) {
    try {
      await toggleWebhookBusiness(id, !currentActive);
      await loadAll();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  // ── Tax update ──
  async function handleTaxChange(bizId: number, newTaxRateName: string) {
    try {
      await updateWebhookBusinessTaxRate(bizId, newTaxRateName);
      setBusinesses(prev => prev.map(b => b.id === bizId ? { ...b, tax_rate_name: newTaxRateName } : b));
      setMessage({ type: 'success', text: 'Status PKP updated' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  // ── Warehouse mapping ──
  function getMappings(code: string) {
    return sortWarehouseMappings(warehouseMappings.filter(m => m.business_code === code));
  }

  async function handleMappingChange(id: number, field: string, value: any) {
    try {
      await updateWarehouseBusinessMapping(id, field, value);
      setWarehouseMappings(await getWarehouseBusinessMappings());
      setMessage({ type: 'success', text: 'Warehouse mapping updated' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  async function handleCreateMapping(businessCode: string) {
    try {
      const existingMappings = getMappings(businessCode);
      const existingKeys = new Set(existingMappings.map((mapping) => `${mapping.deduct_entity}|${mapping.deduct_warehouse}`));
      const nextCandidate = warehouseEntities
        .flatMap((entity) => warehouseCodes.map((warehouse) => ({ entity, warehouse })))
        .find((candidate) => !existingKeys.has(`${candidate.entity}|${candidate.warehouse}`));

      if (!nextCandidate) {
        setMessage({ type: 'error', text: 'Semua kombinasi gudang yang tersedia sudah dipakai untuk business ini.' });
        return;
      }

      const defaultEntity = nextCandidate.entity || businessCode.slice(0, 3);
      const defaultWarehouse = nextCandidate.warehouse || 'BTN';
      await createWarehouseBusinessMapping(businessCode, defaultEntity, defaultWarehouse);
      setWarehouseMappings(await getWarehouseBusinessMappings());
      setMessage({ type: 'success', text: 'Gudang business ditambahkan' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  async function handleRemoveMapping(id: number) {
    try {
      await removeWarehouseBusinessMapping(id);
      setWarehouseMappings(await getWarehouseBusinessMappings());
      setMessage({ type: 'success', text: 'Gudang business dihapus' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  // ── Store management ──
  async function toggleExpand(bizId: number) {
    if (expandedBiz === bizId) { setExpandedBiz(null); return; }
    setExpandedBiz(bizId);
    setLoadingStores(true);
    setStoreError('');
    try {
      const data = await getStoreChannels(bizId);
      setStoreChannels(data);
    } catch (err: any) {
      setStoreChannels([]);
      setStoreError(err?.message || 'Gagal memuat daftar store.');
    }
    setLoadingStores(false);
  }

  async function handleFetchStores(bizId: number) {
    setFetchingStores(true);
    setStoreError('');
    try {
      const result = await fetchStoresFromScalev(bizId);
      setStoreChannels(await getStoreChannels(bizId));
      setMessage({ type: 'success', text: `Stores di-refresh: ${result.inserted} baru, ${result.skipped} dilewati` });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
    setFetchingStores(false);
  }

  async function handleStoreTypeChange(store: StoreChannel, newType: string) {
    try {
      setStoreError('');
      await saveStoreChannel({
        id: store.id,
        business_id: expandedBiz!,
        store_name: store.store_name,
        store_type: newType,
        channel_override: store.channel_override,
      });
      setStoreChannels(await getStoreChannels(expandedBiz!));
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  async function handleChannelOverrideChange(store: StoreChannel, newOverride: string) {
    try {
      setStoreError('');
      await saveStoreChannel({
        id: store.id,
        business_id: expandedBiz!,
        store_name: store.store_name,
        store_type: store.store_type,
        channel_override: newOverride || null,
      });
      setStoreChannels(await getStoreChannels(expandedBiz!));
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  async function handleToggleStore(storeId: number, currentActive: boolean) {
    try {
      setStoreError('');
      await toggleStoreChannel(storeId, !currentActive);
      setStoreChannels(await getStoreChannels(expandedBiz!));
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  async function handleDeleteStore(id: number) {
    try {
      setStoreError('');
      await deleteStoreChannel(id);
      setStoreChannels(await getStoreChannels(expandedBiz!));
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  // ── Render ──
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--dim)' }}>Memuat...</div>;

  if (loadError) {
    return (
      <div className="fade-in">
        <div style={{ background: 'rgba(127,29,29,0.15)', border: '1px solid #991b1b', borderRadius: 12, padding: 18, color: '#fca5a5' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Business Settings Gagal Dimuat</div>
          <div style={{ fontSize: 13, marginBottom: 12 }}>{loadError}</div>
          <button onClick={loadAll} style={{ background: 'transparent', color: '#fecaca', border: '1px solid #991b1b', borderRadius: 8, padding: '8px 14px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  const visibleStores = hideInactive ? storeChannels.filter(s => s.is_active) : storeChannels;

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Business Settings</h2>
        <button onClick={openAddForm} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          + Tambah Business
        </button>
      </div>

      {/* Webhook URL info */}
      <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 16, padding: '8px 12px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
        Webhook URL: <code style={{ color: 'var(--accent)' }}>https://app.roove.info/api/scalev-webhook</code>
      </div>

      {/* Message */}
      {message && (
        <div style={{ padding: '8px 14px', borderRadius: 8, marginBottom: 14, fontSize: 12, background: message.type === 'success' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)', color: message.type === 'success' ? 'var(--green)' : 'var(--red)', cursor: 'pointer' }}
          onClick={() => setMessage(null)}>
          {message.text}
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{form.id ? 'Edit Business' : 'Tambah Business Baru'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Kode Business</label>
              <input value={form.business_code} onChange={e => setForm({ ...form, business_code: e.target.value.toUpperCase() })}
                disabled={!!form.id} placeholder="RTI" style={{ ...inputStyle, opacity: form.id ? 0.5 : 1 }} />
            </div>
            <div>
              <label style={labelStyle}>Nama Business</label>
              <input value={form.business_name} onChange={e => setForm({ ...form, business_name: e.target.value })}
                placeholder="PT Roove Telaga Indah" style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Webhook Secret</label>
              <input type="password" value={form.webhook_secret === 'unchanged' ? '' : form.webhook_secret}
                onChange={e => setForm({ ...form, webhook_secret: e.target.value })}
                placeholder={form.id ? 'Kosongkan jika tidak berubah' : 'Secret dari Scalev dashboard'} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>API Key</label>
              <input type="password" value={form.api_key === 'unchanged' ? '' : form.api_key}
                onChange={e => setForm({ ...form, api_key: e.target.value })}
                placeholder={form.id ? 'Kosongkan jika tidak berubah' : 'API key dari Scalev'} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSave} disabled={saving}
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontWeight: 600, fontSize: 13, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Menyimpan...' : form.id ? 'Update' : 'Simpan'}
            </button>
            <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
              style={{ background: 'transparent', color: 'var(--dim)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 20px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Business Cards */}
      {businesses.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--dim)', background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)' }}>
          Belum ada business. Klik "Tambah Business" untuk memulai.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {businesses.map(biz => {
            const mappings = getMappings(biz.business_code);
            const primaryMapping = mappings.find((mapping) => mapping.is_primary) || mappings[0] || null;
            const activeMappings = mappings.filter((mapping) => mapping.is_active);
            const isExpanded = expandedBiz === biz.id;

            return (
              <div key={biz.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                {/* Collapsed header */}
                <div onClick={() => toggleExpand(biz.id)}
                  style={{ padding: '14px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {/* Code badge */}
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: 'var(--accent)', minWidth: 60 }}>{biz.business_code}</span>
                  {/* Name */}
                  <span style={{ fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 150 }}>{biz.business_name}</span>
                  {/* Status badges */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {/* Active */}
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: biz.is_active ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)', color: biz.is_active ? 'var(--green)' : 'var(--red)' }}>
                      {biz.is_active ? 'Active' : 'Inactive'}
                    </span>
                    {/* PKP */}
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: 'var(--accent-subtle)', color: '#818cf8' }}>
                      {biz.tax_rate_name === 'NONE' ? 'Non-PKP' : 'PKP'}
                    </span>
                    {/* API */}
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: biz.has_api_key ? 'var(--badge-green-bg)' : 'var(--badge-yellow-bg)', color: biz.has_api_key ? 'var(--green)' : 'var(--yellow)' }}>
                      API {biz.has_api_key ? 'Connected' : 'Belum'}
                    </span>
                    {/* Warehouse */}
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: activeMappings.length > 0 ? 'var(--badge-green-bg)' : mappings.length > 0 ? 'var(--badge-yellow-bg)' : 'var(--badge-red-bg)', color: activeMappings.length > 0 ? 'var(--green)' : mappings.length > 0 ? 'var(--yellow)' : 'var(--red)' }}>
                      {formatWarehouseSummary(mappings)}
                    </span>
                  </div>
                  {/* Expand arrow */}
                  <span style={{ fontSize: 12, color: 'var(--dim)', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>&#9660;</span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '16px 18px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16, marginBottom: 16 }}>
                      {/* Umum */}
                      <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', marginBottom: 10, textTransform: 'uppercase' }}>Umum</div>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>
                          <span style={{ color: 'var(--dim)' }}>Kode:</span> <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{biz.business_code}</span>
                        </div>
                        <div style={{ fontSize: 12, marginBottom: 8 }}>
                          <span style={{ color: 'var(--dim)' }}>Aktivitas:</span> <span style={{ color: 'var(--text-secondary)' }}>{formatTime(biz.last_webhook_at)}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={(e) => { e.stopPropagation(); openEditForm(biz); }}
                            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                            Edit
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleToggle(biz.id, biz.is_active); }}
                            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: biz.is_active ? 'var(--yellow)' : 'var(--green)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                            {biz.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                          {confirmDelete === biz.id ? (
                            <>
                              <button onClick={() => handleDelete(biz.id)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--red)', color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Yakin Hapus</button>
                              <button onClick={() => setConfirmDelete(null)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 11, cursor: 'pointer' }}>Batal</button>
                            </>
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(biz.id); }}
                              style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                              Hapus
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Pajak */}
                      <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', marginBottom: 10, textTransform: 'uppercase' }}>Pajak</div>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>
                          <span style={{ color: 'var(--dim)' }}>Status PKP:</span>
                        </div>
                        <select value={biz.tax_rate_name || 'PPN'} onChange={e => handleTaxChange(biz.id, e.target.value)}
                          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          <option value="PPN">PKP (PPN)</option>
                          <option value="NONE">Non-PKP</option>
                        </select>
                      </div>

                      {/* Gudang */}
                      <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', marginBottom: 10, textTransform: 'uppercase' }}>Gudang</div>
                        <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6, marginBottom: 10 }}>
                          Gudang yang diizinkan untuk business ini. Resolver akan tetap strict dan hanya menerima produk yang jatuh ke salah satu target di bawah.
                        </div>

                        {mappings.length > 0 ? (
                          <div style={{ display: 'grid', gap: 8 }}>
                            {mappings.map((mapping) => (
                              <div
                                key={mapping.id}
                                style={{
                                  display: 'grid',
                                  gap: 8,
                                  padding: 10,
                                  borderRadius: 8,
                                  border: `1px solid ${mapping.is_primary ? 'rgba(59,130,246,0.35)' : 'var(--border)'}`,
                                  background: mapping.is_primary ? 'rgba(37,99,235,0.08)' : 'var(--card)',
                                }}
                              >
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <select value={mapping.deduct_entity} onChange={e => handleMappingChange(mapping.id, 'deduct_entity', e.target.value)}
                                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                    {warehouseEntities.map(entity => <option key={entity} value={entity}>{entity}</option>)}
                                    {!warehouseEntities.includes(mapping.deduct_entity) && <option value={mapping.deduct_entity}>{mapping.deduct_entity}</option>}
                                  </select>
                                  <select value={mapping.deduct_warehouse} onChange={e => handleMappingChange(mapping.id, 'deduct_warehouse', e.target.value)}
                                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                    {warehouseCodes.map(warehouse => <option key={warehouse} value={warehouse}>{warehouse}</option>)}
                                    {!warehouseCodes.includes(mapping.deduct_warehouse) && <option value={mapping.deduct_warehouse}>{mapping.deduct_warehouse}</option>}
                                  </select>
                                  <span onClick={() => handleMappingChange(mapping.id, 'is_active', !mapping.is_active)}
                                    style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', background: mapping.is_active ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)', color: mapping.is_active ? 'var(--green)' : 'var(--red)' }}>
                                    {mapping.is_active ? 'Active' : 'Inactive'}
                                  </span>
                                  <span
                                    onClick={() => !mapping.is_primary && handleMappingChange(mapping.id, 'is_primary', true)}
                                    style={{
                                      padding: '2px 8px',
                                      borderRadius: 4,
                                      fontSize: 10,
                                      fontWeight: 700,
                                      cursor: mapping.is_primary ? 'default' : 'pointer',
                                      background: mapping.is_primary ? 'rgba(37,99,235,0.18)' : 'var(--bg)',
                                      color: mapping.is_primary ? '#93c5fd' : 'var(--dim)',
                                      border: `1px solid ${mapping.is_primary ? 'rgba(96,165,250,0.45)' : 'var(--border)'}`,
                                    }}
                                  >
                                    {mapping.is_primary ? 'Utama' : 'Jadikan Utama'}
                                  </span>
                                  <button
                                    onClick={() => handleRemoveMapping(mapping.id)}
                                    style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                                  >
                                    Hapus
                                  </button>
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--dim)', lineHeight: 1.6 }}>
                                  {mapping.is_primary
                                    ? 'Gudang utama untuk fallback dan anchor operasional.'
                                    : `Diizinkan sebagai warehouse tambahan untuk ${biz.business_code}.`}
                                  {mapping.notes ? ` ${mapping.notes}` : ''}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: 'var(--yellow)', marginBottom: 8 }}>Belum ada gudang yang diizinkan.</div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 11, color: 'var(--dim)' }}>
                            Utama sekarang: <span style={{ color: 'var(--text)', fontWeight: 600 }}>{primaryMapping ? `${primaryMapping.deduct_entity} • ${primaryMapping.deduct_warehouse}` : 'Belum ada'}</span>
                          </div>
                          <button onClick={() => handleCreateMapping(biz.business_code)}
                            style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--accent)', color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                            + Tambah Gudang
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Stores */}
                    <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase' }}>
                          Stores ({storeChannels.filter(s => s.is_active).length} aktif / {storeChannels.length} total)
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <label style={{ fontSize: 10, color: 'var(--dim)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                            <input type="checkbox" checked={hideInactive} onChange={e => setHideInactive(e.target.checked)} /> Sembunyikan inactive
                          </label>
                          <button onClick={() => handleFetchStores(biz.id)} disabled={fetchingStores || !biz.has_api_key}
                            style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: biz.has_api_key ? 'var(--accent)' : 'var(--dim)', fontSize: 10, cursor: biz.has_api_key ? 'pointer' : 'not-allowed', fontWeight: 600, opacity: fetchingStores ? 0.5 : 1 }}>
                            {fetchingStores ? 'Loading...' : 'Refresh dari API'}
                          </button>
                        </div>
                      </div>

                      {storeError && (
                        <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--badge-red-bg)', color: 'var(--red)', fontSize: 11 }}>
                          {storeError}
                        </div>
                      )}

                      {loadingStores ? (
                        <div style={{ textAlign: 'center', padding: 16, color: 'var(--dim)', fontSize: 12 }}>Memuat stores...</div>
                      ) : visibleStores.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 16, color: 'var(--dim)', fontSize: 12 }}>
                          {storeChannels.length === 0 ? (biz.has_api_key ? 'Belum ada stores. Klik "Refresh dari API".' : 'Tambahkan API key terlebih dahulu.') : 'Semua store inactive (uncheck filter).'}
                        </div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                {['Store Name', 'Type', 'Channel', 'Status', 'Aksi'].map(h => (
                                  <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600 }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {visibleStores.map(s => (
                                <tr key={s.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                                  <td style={{ padding: '6px 8px', fontWeight: 500 }}>{s.store_name}</td>
                                  <td style={{ padding: '6px 8px' }}>
                                    <select value={s.store_type} onChange={e => handleStoreTypeChange(s, e.target.value)}
                                      style={{ padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 11 }}>
                                      {STORE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                  </td>
                                  <td style={{ padding: '6px 8px' }}>
                                    <select value={s.channel_override || ''} onChange={e => handleChannelOverrideChange(s, e.target.value)}
                                      style={{ padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 11 }}>
                                      {CHANNEL_OVERRIDE_OPTIONS.map(option => <option key={option.label} value={option.value}>{option.label}</option>)}
                                    </select>
                                  </td>
                                  <td style={{ padding: '6px 8px' }}>
                                    <span onClick={() => handleToggleStore(s.id, s.is_active)}
                                      style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', background: s.is_active ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)', color: s.is_active ? 'var(--green)' : 'var(--red)' }}>
                                      {s.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                  </td>
                                  <td style={{ padding: '6px 8px' }}>
                                    <button onClick={() => handleDeleteStore(s.id)}
                                      style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red)', fontSize: 10, cursor: 'pointer' }}>
                                      Hapus
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

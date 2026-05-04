'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import { listMarketplaceIntakeSourceConfigs } from '@/lib/marketplace-intake-sources';
import {
  getShopeeSpendStreamDefinition,
  listShopeeSpendStreamDefinitions,
  type ShopeeSpendStreamKey,
  type ShopeeSpendSyncMode,
} from '@/lib/shopee-streams';
import {
  getShopeeAdminSnapshot,
  setShopeeShopActive,
  updateShopeeShop,
} from '@/lib/admin-actions';
import { invalidateAll } from '@/lib/dashboard-cache';

type ShopeeSetupInfo = {
  configured: boolean;
  missingEnv: string[];
};

type ShopeeSpendStream = {
  id: number | null;
  shop_config_id: number;
  stream_key: ShopeeSpendStreamKey;
  label: string;
  default_source: string;
  default_advertiser: string;
  sync_mode: ShopeeSpendSyncMode;
  is_enabled: boolean;
  api_supported: boolean;
  description: string;
};

type ShopeeShop = {
  id: number;
  shop_id: number;
  shop_name: string;
  region: string | null;
  merchant_id: number | null;
  shop_status: string | null;
  is_cb: boolean;
  auth_time: string | null;
  auth_expire_at: string | null;
  marketplace_source_key: string | null;
  is_active: boolean;
  has_tokens: boolean;
  token_expires_at: string | null;
  spend_streams: ShopeeSpendStream[];
};

type SyncLog = {
  id: number;
  sync_date: string;
  date_range_start: string;
  date_range_end: string;
  shops_synced: number;
  rows_inserted: number;
  spend_total: number;
  direct_gmv_total: number;
  broad_gmv_total: number;
  status: string;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
};

type EditableShopeeSpendStream = {
  stream_key: ShopeeSpendStreamKey;
  default_source: string;
  default_advertiser: string;
  sync_mode: ShopeeSpendSyncMode;
  is_enabled: boolean;
};

type EditFormState = {
  marketplace_source_key: string;
  spend_streams: EditableShopeeSpendStream[];
};

const SHOPEE_SOURCE_OPTIONS = listMarketplaceIntakeSourceConfigs()
  .filter((config) => config.platform === 'shopee')
  .map((config) => ({
    value: config.sourceKey,
    label: config.sourceLabel,
    businessCode: config.businessCode,
  }));

const SHOPEE_STREAM_DEFINITIONS = listShopeeSpendStreamDefinitions();

function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function fmtRupiah(value: number) {
  return `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(Number(value) || 0))}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildDefaultEditStreams(shopName: string) {
  return SHOPEE_STREAM_DEFINITIONS.map((definition) => ({
    stream_key: definition.key,
    default_source: definition.defaultSource,
    default_advertiser: shopName || 'Shopee Shop',
    sync_mode: definition.defaultSyncMode,
    is_enabled: definition.defaultEnabled,
  }));
}

function normalizeEditStreams(streams: EditableShopeeSpendStream[], shopName: string) {
  const streamMap = new Map(
    (streams || []).map((stream) => [
      stream.stream_key,
      {
        ...stream,
        default_advertiser: String(stream.default_advertiser || '').trim() || shopName || 'Shopee Shop',
      },
    ]),
  );

  return SHOPEE_STREAM_DEFINITIONS.map((definition) => {
    const stream = streamMap.get(definition.key);
    return {
      stream_key: definition.key,
      default_source: definition.defaultSource,
      default_advertiser: stream?.default_advertiser || shopName || 'Shopee Shop',
      sync_mode: stream?.sync_mode || definition.defaultSyncMode,
      is_enabled: Boolean(stream?.is_enabled ?? definition.defaultEnabled),
    };
  });
}

function buildEditForm(shop: ShopeeShop): EditFormState {
  return {
    marketplace_source_key: shop.marketplace_source_key || '',
    spend_streams: normalizeEditStreams(
      (shop.spend_streams || []).map((stream) => ({
        stream_key: stream.stream_key,
        default_source: stream.default_source || getShopeeSpendStreamDefinition(stream.stream_key).defaultSource,
        default_advertiser: stream.default_advertiser || shop.shop_name || 'Shopee Shop',
        sync_mode: stream.sync_mode,
        is_enabled: stream.is_enabled,
      })),
      shop.shop_name || 'Shopee Shop',
    ),
  };
}

export default function ShopeeManager() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [setup, setSetup] = useState<ShopeeSetupInfo | null>(null);
  const [shops, setShops] = useState<ShopeeShop[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [syncDateStart, setSyncDateStart] = useState(getYesterday);
  const [syncDateEnd, setSyncDateEnd] = useState(getYesterday);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({
    marketplace_source_key: '',
    spend_streams: buildDefaultEditStreams('Shopee Shop'),
  });

  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: 13,
    outline: 'none',
  };

  const labelStyle: CSSProperties = {
    fontSize: 11,
    color: 'var(--dim)',
    display: 'block',
    marginBottom: 4,
  };

  const sourceOptionMetaMap = useMemo(
    () => new Map<string, { label: string; businessCode: string }>(
      SHOPEE_SOURCE_OPTIONS.map((option) => [option.value, { label: option.label, businessCode: option.businessCode }]),
    ),
    [],
  );

  const getSourceDisplay = useCallback((sourceKey: string | null) => {
    if (!sourceKey) return '-';
    return sourceOptionMetaMap.get(sourceKey)?.label || sourceKey;
  }, [sourceOptionMetaMap]);

  const getSourceBusinessCode = useCallback((sourceKey: string | null) => {
    if (!sourceKey) return null;
    return sourceOptionMetaMap.get(sourceKey)?.businessCode || null;
  }, [sourceOptionMetaMap]);

  const hasCommerceMapping = useCallback((shop: ShopeeShop) => (
    Boolean(String(shop.marketplace_source_key || '').trim())
  ), []);

  const hasApiSpendStreamEnabled = useCallback((shop: ShopeeShop) => (
    (shop.spend_streams || []).some((stream) => stream.sync_mode === 'api' && stream.is_enabled)
  ), []);

  const isShopSyncReady = useCallback((shop: ShopeeShop) => (
    shop.is_active
      && shop.has_tokens
      && hasCommerceMapping(shop)
      && hasApiSpendStreamEnabled(shop)
  ), [hasApiSpendStreamEnabled, hasCommerceMapping]);

  const loadData = useCallback(async () => {
    try {
      const snapshot = await getShopeeAdminSnapshot();
      setSetup(snapshot.setup || null);
      setShops(snapshot.shops || []);
      setLogs(snapshot.recentLogs || []);
    } catch (error: any) {
      console.error('Failed to load Shopee admin snapshot:', error);
      setMessage({ type: 'error', text: error.message || 'Gagal memuat konfigurasi Shopee.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const status = searchParams.get('shopee_status');
    const text = searchParams.get('shopee_message');
    if (!status || !text) return;
    setMessage({ type: status === 'error' ? 'error' : 'success', text });
  }, [searchParams]);

  const updateEditStream = useCallback((
    streamKey: ShopeeSpendStreamKey,
    updater: (stream: EditableShopeeSpendStream) => EditableShopeeSpendStream,
  ) => {
    setEditForm((form) => ({
      ...form,
      spend_streams: form.spend_streams.map((stream) => (
        stream.stream_key === streamKey ? updater(stream) : stream
      )),
    }));
  }, []);

  const handleSyncNow = async () => {
    setSyncing(true);
    setMessage(null);

    try {
      const params = new URLSearchParams({ date_start: syncDateStart, date_end: syncDateEnd });
      const res = await fetch(`/api/shopee-sync?${params.toString()}`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || data.message || 'Sync Shopee gagal.' });
      } else {
        const summary = `Sync ${data.status}: ${data.shops_synced}/${data.shops_total} shop, ${data.rows_inserted} row, spend ${fmtRupiah(data.spend_total)}`;
        setMessage({ type: data.status === 'failed' ? 'error' : 'success', text: summary });
        invalidateAll();
        await loadData();
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Sync Shopee gagal.' });
    } finally {
      setSyncing(false);
    }
  };

  const handleEdit = (shop: ShopeeShop) => {
    setEditingId(shop.id);
    setEditForm(buildEditForm(shop));
  };

  const handleEditSave = async () => {
    if (!editingId) return;

    const editingShop = shops.find((shop) => shop.id === editingId);
    const shopName = editingShop?.shop_name || 'Shopee Shop';
    const normalizedStreams = normalizeEditStreams(editForm.spend_streams, shopName);
    const hasCommerceSource = Boolean(editForm.marketplace_source_key.trim());
    const hasEnabledApiStream = normalizedStreams.some(
      (stream) => stream.sync_mode === 'api' && stream.is_enabled,
    );

    try {
      await updateShopeeShop(editingId, {
        marketplace_source_key: editForm.marketplace_source_key.trim() || null,
        spend_streams: normalizedStreams,
      });
      setMessage({
        type: 'success',
        text: !hasCommerceSource || !hasEnabledApiStream
          ? 'Konfigurasi Shopee diperbarui. Lengkapi commerce source dan aktifkan minimal satu spend stream API sebelum sync.'
          : 'Konfigurasi Shopee diperbarui.',
      });
      setEditingId(null);
      await loadData();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Gagal menyimpan konfigurasi Shopee.' });
    }
  };

  const handleToggleActive = async (shop: ShopeeShop) => {
    try {
      await setShopeeShopActive(shop.id, !shop.is_active);
      await loadData();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Gagal mengubah status shop Shopee.' });
    }
  };

  const handleConnect = () => {
    window.location.href = '/api/shopee/connect';
  };

  const statusStyle = (status: string) => {
    switch (status) {
      case 'success':
        return { bg: 'var(--badge-green-bg)', color: 'var(--green)', label: 'Sukses' };
      case 'partial':
        return { bg: 'var(--badge-yellow-bg)', color: 'var(--yellow)', label: 'Partial' };
      case 'failed':
        return { bg: 'var(--badge-red-bg)', color: 'var(--red)', label: 'Gagal' };
      case 'running':
        return { bg: '#1e3a5f', color: '#60a5fa', label: 'Running' };
      default:
        return { bg: 'var(--border)', color: 'var(--dim)', label: status };
    }
  };

  const getShopWarnings = useCallback((shop: ShopeeShop) => {
    const warnings: string[] = [];
    if (!shop.marketplace_source_key) warnings.push('Commerce source belum diisi');
    if (!hasApiSpendStreamEnabled(shop)) warnings.push('Belum ada spend stream API aktif');
    if (!shop.has_tokens) warnings.push('Token belum tersedia');
    return warnings;
  }, [hasApiSpendStreamEnabled]);

  if (loading) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ color: 'var(--dim)', fontSize: 13 }}>Memuat konfigurasi Shopee...</div>
      </div>
    );
  }

  const readyShops = shops.filter(isShopSyncReady);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Shopee Shops</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
              Hubungkan business dengan Shopee untuk mendapatkan data Shopee Ads harian
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a
              href="https://open.shopee.com/"
              target="_blank"
              rel="noreferrer"
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                textDecoration: 'none',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Portal Shopee
            </a>
            <button
              onClick={handleConnect}
              disabled={!setup?.configured}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                cursor: setup?.configured ? 'pointer' : 'not-allowed',
                background: setup?.configured ? '#ee4d2d' : 'var(--border)',
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                opacity: setup?.configured ? 1 : 0.6,
              }}
            >
              + Hubungkan Shop
            </button>
          </div>
        </div>

        {!setup?.configured && (
          <div style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 8,
            fontSize: 13,
            background: 'var(--badge-red-bg)',
            color: 'var(--red)',
          }}>
            Konfigurasi Shopee belum lengkap. Missing env: {setup?.missingEnv?.join(', ') || '-'}
          </div>
        )}

        {message && (
          <div style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 8,
            fontSize: 13,
            background: message.type === 'success' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)',
            color: message.type === 'success' ? 'var(--green)' : 'var(--red)',
          }}>
            {message.text}
          </div>
        )}

        {shops.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
            padding: 12,
            background: 'var(--bg)',
            borderRadius: 8,
            border: '1px solid var(--border)',
            flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Sync tanggal:</span>
            <input
              type="date"
              value={syncDateStart}
              onChange={(e) => setSyncDateStart(e.target.value)}
              style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 12 }}
            />
            <span style={{ fontSize: 12, color: 'var(--dim)' }}>s/d</span>
            <input
              type="date"
              value={syncDateEnd}
              onChange={(e) => setSyncDateEnd(e.target.value)}
              style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 12 }}
            />
            <button
              onClick={handleSyncNow}
              disabled={syncing || readyShops.length === 0}
              style={{
                padding: '6px 16px',
                borderRadius: 6,
                border: 'none',
                cursor: syncing || readyShops.length === 0 ? 'not-allowed' : 'pointer',
                background: syncing || readyShops.length === 0 ? 'var(--border)' : '#ee4d2d',
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                opacity: syncing || readyShops.length === 0 ? 0.6 : 1,
                marginLeft: 'auto',
              }}
            >
              {syncing ? 'Syncing...' : 'Sync Shopee'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--dim)' }}>
              {readyShops.length > 0
                ? `${readyShops.length} shop siap di-sync. Sink Shopee Ads API akan dijalankan untuk shop yang aktif.`
                : 'Aktifkan shop, pastikan token ada, pilih commerce source, lalu aktifkan sink Shopee Ads sebelum sync.'}
            </span>
          </div>
        )}

        {shops.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--dim)', fontSize: 13 }}>
            Belum ada shop Shopee terhubung. Setelah APP Shopee dibuat dan env diisi, klik "Hubungkan Shop".
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 920 }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['Status', 'Shop', 'Commerce Source', 'Shopee Ads', 'Token', 'Auth Expire', 'Aksi'].map((header) => (
                    <th
                      key={header}
                      style={{
                        padding: '10px 12px',
                        textAlign: 'left',
                        color: 'var(--dim)',
                        fontWeight: 600,
                        fontSize: 10,
                        textTransform: 'uppercase',
                        borderBottom: '2px solid var(--border)',
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shops.map((shop) => {
                  const warnings = getShopWarnings(shop);
                  const businessCode = getSourceBusinessCode(shop.marketplace_source_key);

                  return (
                    <tr key={shop.id} style={{ borderBottom: '1px solid var(--bg-deep)', verticalAlign: 'top' }}>
                      {editingId === shop.id ? (
                        <td style={{ padding: '12px' }} colSpan={7}>
                          <div style={{ display: 'grid', gap: 14 }}>
                            <div>
                              <div style={{ fontWeight: 700, color: 'var(--text)' }}>{shop.shop_name}</div>
                              <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
                                Shop ID <span style={{ fontFamily: 'monospace' }}>{shop.shop_id}</span>
                                {shop.region ? ` • ${shop.region}` : ''}
                                {shop.shop_status ? ` • ${shop.shop_status}` : ''}
                              </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 12 }}>
                              <label>
                                <span style={labelStyle}>Commerce Source</span>
                                <select
                                  value={editForm.marketplace_source_key}
                                  onChange={(e) => setEditForm((form) => ({ ...form, marketplace_source_key: e.target.value }))}
                                  style={inputStyle}
                                >
                                  <option value="">- Pilih Source Shopee -</option>
                                  {SHOPEE_SOURCE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </label>

                              <div
                                style={{
                                  border: '1px solid var(--border)',
                                  borderRadius: 6,
                                  padding: '10px 12px',
                                  background: 'var(--bg)',
                                  alignSelf: 'end',
                                }}
                              >
                                <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4 }}>Business Owner Spend</div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                                  {getSourceBusinessCode(editForm.marketplace_source_key) || '-'}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}>
                                  Brand/store tidak diisi di sini. Order akan tetap diparsing downstream dari SKU dan bundle seperti jalur marketplace intake.
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'grid', gap: 12 }}>
                              {editForm.spend_streams.map((stream) => {
                                const definition = getShopeeSpendStreamDefinition(stream.stream_key);
                                return (
                                  <div
                                    key={stream.stream_key}
                                    style={{
                                      border: '1px solid var(--border)',
                                      borderRadius: 8,
                                      background: 'var(--bg)',
                                      padding: 12,
                                      display: 'grid',
                                      gap: 10,
                                    }}
                                  >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                                      <div>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{definition.label}</div>
                                        <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4, maxWidth: 720 }}>
                                          {definition.description}
                                        </div>
                                      </div>
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <span style={{
                                          padding: '2px 8px',
                                          borderRadius: 999,
                                          fontSize: 10,
                                          fontWeight: 700,
                                          background: stream.sync_mode === 'api' ? 'var(--badge-green-bg)' : 'rgba(255,255,255,0.06)',
                                          color: stream.sync_mode === 'api' ? 'var(--green)' : 'var(--dim)',
                                        }}>
                                          {stream.sync_mode === 'api' ? 'Mode API' : 'Mode Manual'}
                                        </span>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
                                          <input
                                            type="checkbox"
                                            checked={stream.is_enabled}
                                            onChange={(e) => updateEditStream(stream.stream_key, (current) => ({
                                              ...current,
                                              is_enabled: e.target.checked,
                                            }))}
                                          />
                                          Aktifkan stream ini
                                        </label>
                                      </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 12 }}>
                                      <label>
                                        <span style={labelStyle}>Label Source</span>
                                        <input
                                          value={definition.defaultSource}
                                          readOnly
                                          disabled
                                          style={{ ...inputStyle, opacity: 0.72, cursor: 'not-allowed' }}
                                        />
                                      </label>

                                      <label>
                                        <span style={labelStyle}>Advertiser</span>
                                        <input
                                          value={stream.default_advertiser}
                                          onChange={(e) => updateEditStream(stream.stream_key, (current) => ({
                                            ...current,
                                            default_advertiser: e.target.value,
                                          }))}
                                          style={inputStyle}
                                        />
                                      </label>
                                    </div>

                                    {!definition.apiSupported && (
                                      <div style={{ fontSize: 11, color: 'var(--yellow)' }}>
                                        Stream ini tetap bisa dicatat di dashboard, tetapi nilainya masih di-feed manual dari spreadsheet/admin daily data sampai jalur API yang tepat siap dipakai.
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button
                                onClick={handleEditSave}
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: 6,
                                  border: 'none',
                                  background: 'var(--accent)',
                                  color: '#fff',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                }}
                              >
                                Simpan
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: 6,
                                  border: '1px solid var(--border)',
                                  background: 'transparent',
                                  color: 'var(--dim)',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                }}
                              >
                                Batal
                              </button>
                            </div>
                          </div>
                        </td>
                      ) : (
                        <>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span style={{
                                padding: '2px 8px',
                                borderRadius: 5,
                                fontSize: 10,
                                fontWeight: 600,
                                background: shop.is_active ? 'var(--badge-green-bg)' : 'var(--border)',
                                color: shop.is_active ? 'var(--green)' : 'var(--dim)',
                                width: 'fit-content',
                              }}>
                                {shop.is_active ? 'Aktif' : 'Nonaktif'}
                              </span>
                              {warnings.map((warning) => (
                                <span key={warning} style={{ fontSize: 10, color: 'var(--yellow)' }}>{warning}</span>
                              ))}
                            </div>
                          </td>

                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ color: 'var(--text)', fontWeight: 600 }}>{shop.shop_name}</div>
                            <div style={{ color: 'var(--dim)', fontSize: 10, fontFamily: 'monospace', marginTop: 4 }}>
                              {shop.shop_id}
                            </div>
                            <div style={{ color: 'var(--dim)', fontSize: 10, marginTop: 4 }}>
                              {shop.region || '-'}
                              {shop.is_cb ? ' • CB' : ''}
                              {shop.shop_status ? ` • ${shop.shop_status}` : ''}
                            </div>
                          </td>

                          <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>
                            <div>{getSourceDisplay(shop.marketplace_source_key)}</div>
                            <div style={{ color: 'var(--dim)', fontSize: 10, marginTop: 4 }}>
                              business: {businessCode || '-'}
                            </div>
                          </td>

                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'grid', gap: 8 }}>
                              {(shop.spend_streams || []).map((stream) => (
                                <div
                                  key={stream.stream_key}
                                  style={{
                                    padding: '8px 10px',
                                    borderRadius: 8,
                                    border: '1px solid var(--bg-deep)',
                                    background: 'rgba(255,255,255,0.02)',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <span style={{ color: 'var(--text)', fontWeight: 600 }}>{stream.label}</span>
                                    <span style={{
                                      padding: '2px 6px',
                                      borderRadius: 999,
                                      fontSize: 10,
                                      fontWeight: 700,
                                      background: stream.sync_mode === 'api' ? 'var(--badge-green-bg)' : 'rgba(255,255,255,0.06)',
                                      color: stream.sync_mode === 'api' ? 'var(--green)' : 'var(--dim)',
                                    }}>
                                      {stream.sync_mode === 'api' ? 'API' : 'Manual'}
                                    </span>
                                    <span style={{
                                      padding: '2px 6px',
                                      borderRadius: 999,
                                      fontSize: 10,
                                      fontWeight: 700,
                                      background: stream.is_enabled ? 'var(--badge-green-bg)' : 'var(--border)',
                                      color: stream.is_enabled ? 'var(--green)' : 'var(--dim)',
                                    }}>
                                      {stream.is_enabled ? 'Aktif' : 'Off'}
                                    </span>
                                  </div>
                                  <div style={{ color: 'var(--dim)', fontSize: 10, marginTop: 6 }}>
                                    source: {getShopeeSpendStreamDefinition(stream.stream_key).defaultSource} • advertiser: {stream.default_advertiser}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>

                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span style={{
                                padding: '2px 8px',
                                borderRadius: 5,
                                fontSize: 10,
                                fontWeight: 600,
                                background: shop.has_tokens ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)',
                                color: shop.has_tokens ? 'var(--green)' : 'var(--red)',
                                width: 'fit-content',
                              }}>
                                {shop.has_tokens ? 'Connected' : 'Missing'}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--dim)' }}>{formatDateTime(shop.token_expires_at)}</span>
                            </div>
                          </td>

                          <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: 11 }}>
                            {formatDateTime(shop.auth_expire_at)}
                          </td>

                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={() => handleEdit(shop)}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 4,
                                  border: '1px solid var(--border)',
                                  background: 'transparent',
                                  color: '#60a5fa',
                                  fontSize: 11,
                                  cursor: 'pointer',
                                }}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleToggleActive(shop)}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 4,
                                  border: '1px solid var(--border)',
                                  background: 'transparent',
                                  color: shop.is_active ? 'var(--yellow)' : 'var(--green)',
                                  fontSize: 11,
                                  cursor: 'pointer',
                                }}
                              >
                                {shop.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {logs.length > 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Riwayat Sync Shopee</div>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>5 sync terakhir</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 760 }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['Waktu', 'Range', 'Shop', 'Rows', 'Spend', 'Direct GMV', 'Broad GMV', 'Status', 'Durasi'].map((header) => (
                    <th
                      key={header}
                      style={{
                        padding: '10px 12px',
                        textAlign: 'left',
                        color: 'var(--dim)',
                        fontWeight: 600,
                        fontSize: 10,
                        textTransform: 'uppercase',
                        borderBottom: '2px solid var(--border)',
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const status = statusStyle(log.status);
                  return (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{formatDateTime(log.created_at)}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>
                        {log.date_range_start === log.date_range_end
                          ? log.date_range_start
                          : `${log.date_range_start} - ${log.date_range_end}`}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{log.shops_synced}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{log.rows_inserted}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{fmtRupiah(log.spend_total)}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{fmtRupiah(log.direct_gmv_total)}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{fmtRupiah(log.broad_gmv_total)}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 5,
                          fontSize: 10,
                          fontWeight: 600,
                          background: status.bg,
                          color: status.color,
                        }}>
                          {status.label}
                        </span>
                        {log.error_message ? (
                          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--red)' }}>{log.error_message}</div>
                        ) : null}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>
                        {log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

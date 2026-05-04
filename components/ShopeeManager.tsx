'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { listMarketplaceIntakeSourceConfigs } from '@/lib/marketplace-intake-sources';
import {
  getShopeeAdminSnapshot,
  setShopeeShopActive,
  updateShopeeShop,
} from '@/lib/admin-actions';
import { invalidateAll } from '@/lib/dashboard-cache';

type ShopeeSetupInfo = {
  configured: boolean;
  redirectUrl: string;
  authBaseUrl: string;
  apiBaseUrl: string;
  requestBaseUrl: string;
  missingEnv: string[];
  environment: 'sandbox' | 'production' | 'custom';
  authLooksSandbox: boolean;
  apiLooksSandbox: boolean;
  baseUrlModeMismatch: boolean;
  partnerIdSuffix: string | null;
  partnerIdWrapped: boolean;
  partnerKeyLength: number;
  partnerKeyWrapped: boolean;
};

type ShopeeBusinessOption = {
  business_code: string;
  business_name: string;
  is_active: boolean;
};

type ShopeeSourceOption = {
  value: string;
  label: string;
  businessCode: string;
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
  account_business_code: string | null;
  viewer_business_code: string | null;
  revenue_business_code: string | null;
  default_owner_business_code: string | null;
  default_processor_business_code: string | null;
  store: string | null;
  default_source: string;
  default_advertiser: string;
  is_active: boolean;
  has_tokens: boolean;
  token_expires_at: string | null;
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

type AdsStoreBrandMapping = {
  store_pattern: string;
  brand: string;
};

const SOURCE_OPTIONS = [
  'Shopee Ads',
  'Shopee Live',
  'Facebook CPAS',
  'Facebook Ads',
  'Google Ads',
  'TikTok Ads',
  'Organik',
];

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

export default function ShopeeManager() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [setup, setSetup] = useState<ShopeeSetupInfo | null>(null);
  const [shops, setShops] = useState<ShopeeShop[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [brandMappings, setBrandMappings] = useState<AdsStoreBrandMapping[]>([]);
  const [businesses, setBusinesses] = useState<ShopeeBusinessOption[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [syncDateStart, setSyncDateStart] = useState(getYesterday);
  const [syncDateEnd, setSyncDateEnd] = useState(getYesterday);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    marketplace_source_key: '',
    account_business_code: '',
    viewer_business_code: '',
    revenue_business_code: '',
    default_owner_business_code: '',
    default_processor_business_code: '',
    store: '',
    default_source: 'Shopee Ads',
    default_advertiser: 'Shopee Shop',
  });

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: 13,
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--dim)',
    display: 'block',
    marginBottom: 4,
  };

  const brandOptions = useMemo<{ value: string; label: string }[]>(() => {
    const brandCounts: Record<string, number> = {};
    brandMappings.forEach((mapping) => {
      const brand = mapping.brand?.trim() || mapping.store_pattern?.trim() || '';
      if (!brand) return;
      brandCounts[brand] = (brandCounts[brand] || 0) + 1;
    });

    return brandMappings
      .map((mapping) => {
        const value = mapping.store_pattern?.trim() || '';
        const brand = mapping.brand?.trim() || value;
        if (!value) return null;
        const needsDisambiguation = (brandCounts[brand] || 0) > 1 && value.toLowerCase() !== brand.toLowerCase();
        return {
          value,
          label: needsDisambiguation ? `${brand} (${value})` : brand,
        };
      })
      .filter((option): option is { value: string; label: string } => Boolean(option))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [brandMappings]);

  const getBrandDisplay = useCallback((storeValue: string | null) => {
    if (!storeValue) return '-';
    return brandOptions.find((option) => option.value === storeValue)?.label || storeValue;
  }, [brandOptions]);

  const shopeeSourceOptions = useMemo<ShopeeSourceOption[]>(
    () =>
      listMarketplaceIntakeSourceConfigs()
        .filter((config) => config.platform === 'shopee')
        .map((config) => ({
          value: config.sourceKey,
          label: `${config.sourceLabel} (${config.businessCode})`,
          businessCode: config.businessCode,
        })),
    [],
  );

  const shopeeSourceConfigMap = useMemo(
    () => new Map(shopeeSourceOptions.map((option) => [option.value, option])),
    [shopeeSourceOptions],
  );

  const businessLabelMap = useMemo(
    () =>
      new Map(
        businesses.map((business) => [
          business.business_code,
          business.business_name ? `${business.business_code} • ${business.business_name}` : business.business_code,
        ]),
      ),
    [businesses],
  );

  const getBusinessDisplay = useCallback((businessCode: string | null) => {
    if (!businessCode) return '-';
    return businessLabelMap.get(businessCode) || businessCode;
  }, [businessLabelMap]);

  const hasCoreBusinessMapping = useCallback((shop: ShopeeShop) => (
    Boolean(
      String(shop.marketplace_source_key || '').trim()
      && String(shop.account_business_code || '').trim()
      && String(shop.viewer_business_code || '').trim()
      && String(shop.revenue_business_code || '').trim(),
    )
  ), []);

  const isShopSyncReady = useCallback((shop: ShopeeShop) => (
    shop.is_active
      && shop.has_tokens
      && Boolean(String(shop.store || '').trim())
      && hasCoreBusinessMapping(shop)
  ), [hasCoreBusinessMapping]);

  const loadData = useCallback(async () => {
    try {
      const snapshot = await getShopeeAdminSnapshot();
      setSetup(snapshot.setup || null);
      setShops(snapshot.shops || []);
      setLogs(snapshot.recentLogs || []);
      setBrandMappings(snapshot.brandMappings || []);
      setBusinesses(snapshot.businesses || []);
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
    setEditForm({
      marketplace_source_key: shop.marketplace_source_key || '',
      account_business_code: shop.account_business_code || '',
      viewer_business_code: shop.viewer_business_code || '',
      revenue_business_code: shop.revenue_business_code || '',
      default_owner_business_code: shop.default_owner_business_code || '',
      default_processor_business_code: shop.default_processor_business_code || '',
      store: shop.store || '',
      default_source: shop.default_source || 'Shopee Ads',
      default_advertiser: shop.default_advertiser || shop.shop_name || 'Shopee Shop',
    });
  };

  const handleMarketplaceSourceChange = (nextSourceKey: string) => {
    const sourceConfig = shopeeSourceConfigMap.get(nextSourceKey);
    setEditForm((form) => ({
      ...form,
      marketplace_source_key: nextSourceKey,
      account_business_code: sourceConfig?.businessCode || '',
      viewer_business_code: sourceConfig?.businessCode || '',
      revenue_business_code: sourceConfig?.businessCode || '',
    }));
  };

  const handleEditSave = async () => {
    const hasStore = Boolean(editForm.store.trim());
    const hasCoreBusinessFields = Boolean(
      editForm.marketplace_source_key.trim()
      && editForm.account_business_code.trim()
      && editForm.viewer_business_code.trim()
      && editForm.revenue_business_code.trim(),
    );

    try {
      await updateShopeeShop(editingId!, {
        marketplace_source_key: editForm.marketplace_source_key.trim() || null,
        account_business_code: editForm.account_business_code.trim() || null,
        viewer_business_code: editForm.viewer_business_code.trim() || null,
        revenue_business_code: editForm.revenue_business_code.trim() || null,
        default_owner_business_code: editForm.default_owner_business_code.trim() || null,
        default_processor_business_code: editForm.default_processor_business_code.trim() || null,
        store: editForm.store.trim() || null,
        default_source: editForm.default_source.trim() || 'Shopee Ads',
        default_advertiser: editForm.default_advertiser.trim() || 'Shopee Shop',
      });
      setMessage({
        type: 'success',
        text: !hasStore || !hasCoreBusinessFields
          ? 'Konfigurasi Shopee diperbarui. Lengkapi source marketplace, business mapping inti, dan brand/store sebelum sync.'
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
              <div style={{ fontSize: 14, fontWeight: 700 }}>Shopee Ads</div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
              Hubungkan shop Shopee, simpan mapping business + brand/store, lalu sync ad spend ke dashboard.
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

        <div style={{
          marginBottom: 14,
          padding: 14,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          display: 'grid',
          gap: 8,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Checklist setup Shopee Open Platform</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            1. Create APP di portal Shopee Open Platform.<br />
            2. Daftarkan redirect URL ini secara exact: <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{setup?.redirectUrl || '-'}</span><br />
            3. Isi env server: <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>SHOPEE_PARTNER_ID</span> dan <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>SHOPEE_PARTNER_KEY</span>.<br />
            4. Setelah itu klik <strong>Hubungkan Shop</strong> untuk authorize seller shop ke aplikasi ini.
          </div>
          {setup && (
            <div style={{
              padding: 10,
              borderRadius: 6,
              background: 'rgba(255,255,255,0.03)',
              color: 'var(--text-secondary)',
              fontSize: 11,
              lineHeight: 1.7,
              fontFamily: 'monospace',
            }}>
              runtime.environment={setup.environment}<br />
              runtime.auth_base_url={setup.authBaseUrl}<br />
              runtime.api_base_url={setup.apiBaseUrl}<br />
              runtime.request_base_url={setup.requestBaseUrl}<br />
              runtime.partner_id_suffix={setup.partnerIdSuffix || '-'}<br />
              runtime.partner_key_length={setup.partnerKeyLength}
            </div>
          )}
          {!setup?.configured && (
            <div style={{
              padding: 10,
              borderRadius: 6,
              background: 'var(--badge-red-bg)',
              color: 'var(--red)',
              fontSize: 12,
            }}>
              Konfigurasi Shopee belum lengkap. Missing env: {setup?.missingEnv?.join(', ') || '-'}
            </div>
          )}
          {setup?.baseUrlModeMismatch && (
            <div style={{
              padding: 10,
              borderRadius: 6,
              background: 'var(--badge-red-bg)',
              color: 'var(--red)',
              fontSize: 12,
            }}>
              Runtime Shopee tidak konsisten: auth base terlihat {setup.authLooksSandbox ? 'sandbox' : 'production/custom'}, tapi API base terlihat {setup.apiLooksSandbox ? 'sandbox' : 'production/custom'}.
            </div>
          )}
          {(setup?.partnerIdWrapped || setup?.partnerKeyWrapped) && (
            <div style={{
              padding: 10,
              borderRadius: 6,
              background: 'var(--badge-yellow-bg)',
              color: 'var(--yellow)',
              fontSize: 12,
            }}>
              Terdeteksi env Shopee sempat memakai wrapping quote. Runtime sekarang otomatis membersihkannya.
            </div>
          )}
        </div>

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
            {readyShops.length === 0 && (
              <span style={{ fontSize: 11, color: 'var(--dim)' }}>
                Aktifkan shop, pastikan token ada, lalu isi source marketplace, business mapping inti, dan brand/store sebelum sync.
              </span>
            )}
          </div>
        )}

        {shops.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--dim)', fontSize: 13 }}>
            Belum ada shop Shopee terhubung. Setelah APP Shopee dibuat dan env diisi, klik "Hubungkan Shop".
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 960 }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['Status', 'Shop ID', 'Nama Shop', 'Region', 'Brand', 'Source', 'Advertiser', 'Token', 'Auth Expire', 'Aksi'].map((header) => (
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
                {shops.map((shop) => (
                  <tr key={shop.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                    {editingId === shop.id ? (
                      <>
                        <td style={{ padding: '10px 12px' }} colSpan={4}>
                          <div style={{ fontWeight: 600, color: 'var(--text)' }}>{shop.shop_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'monospace' }}>{shop.shop_id}</div>
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, minmax(180px, 1fr))',
                            gap: 8,
                            marginTop: 10,
                          }}>
                            <label>
                              <span style={labelStyle}>Source Marketplace</span>
                              <select
                                value={editForm.marketplace_source_key}
                                onChange={(e) => handleMarketplaceSourceChange(e.target.value)}
                                style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}
                              >
                                <option value="">- Pilih Source -</option>
                                {shopeeSourceOptions.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span style={labelStyle}>Account Business</span>
                              <select
                                value={editForm.account_business_code}
                                onChange={(e) => setEditForm((form) => ({ ...form, account_business_code: e.target.value }))}
                                style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}
                              >
                                <option value="">- Pilih Business -</option>
                                {businesses.map((business) => (
                                  <option key={business.business_code} value={business.business_code}>
                                    {getBusinessDisplay(business.business_code)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span style={labelStyle}>Viewer Business</span>
                              <select
                                value={editForm.viewer_business_code}
                                onChange={(e) => setEditForm((form) => ({ ...form, viewer_business_code: e.target.value }))}
                                style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}
                              >
                                <option value="">- Pilih Business -</option>
                                {businesses.map((business) => (
                                  <option key={business.business_code} value={business.business_code}>
                                    {getBusinessDisplay(business.business_code)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span style={labelStyle}>Revenue Business</span>
                              <select
                                value={editForm.revenue_business_code}
                                onChange={(e) => setEditForm((form) => ({ ...form, revenue_business_code: e.target.value }))}
                                style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}
                              >
                                <option value="">- Pilih Business -</option>
                                {businesses.map((business) => (
                                  <option key={business.business_code} value={business.business_code}>
                                    {getBusinessDisplay(business.business_code)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span style={labelStyle}>Fallback Owner</span>
                              <select
                                value={editForm.default_owner_business_code}
                                onChange={(e) => setEditForm((form) => ({ ...form, default_owner_business_code: e.target.value }))}
                                style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}
                              >
                                <option value="">- Optional -</option>
                                {businesses.map((business) => (
                                  <option key={business.business_code} value={business.business_code}>
                                    {getBusinessDisplay(business.business_code)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span style={labelStyle}>Fallback Processor</span>
                              <select
                                value={editForm.default_processor_business_code}
                                onChange={(e) => setEditForm((form) => ({ ...form, default_processor_business_code: e.target.value }))}
                                style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}
                              >
                                <option value="">- Optional -</option>
                                {businesses.map((business) => (
                                  <option key={business.business_code} value={business.business_code}>
                                    {getBusinessDisplay(business.business_code)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <div style={{ marginTop: 10, fontSize: 10, color: 'var(--dim)', lineHeight: 1.6 }}>
                            account = business pemilik akun seller, viewer = business yang katalog visible-nya dijual,
                            revenue = business penerima revenue marketplace, owner/processor = fallback owner stok dan fulfillment.
                          </div>
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <select
                            value={editForm.store}
                            onChange={(e) => setEditForm((form) => ({ ...form, store: e.target.value }))}
                            style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}
                          >
                            <option value="">- Pilih Brand/Store -</option>
                            {brandOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <select
                            value={editForm.default_source}
                            onChange={(e) => setEditForm((form) => ({ ...form, default_source: e.target.value }))}
                            style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}
                          >
                            {SOURCE_OPTIONS.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <input
                            value={editForm.default_advertiser}
                            onChange={(e) => setEditForm((form) => ({ ...form, default_advertiser: e.target.value }))}
                            style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}
                          />
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: 11 }}>
                          {shop.has_tokens ? formatDateTime(shop.token_expires_at) : '-'}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: 11 }}>
                          {formatDateTime(shop.auth_expire_at)}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              onClick={handleEditSave}
                              style={{
                                padding: '4px 8px',
                                borderRadius: 4,
                                border: 'none',
                                background: 'var(--accent)',
                                color: '#fff',
                                fontSize: 10,
                                cursor: 'pointer',
                              }}
                            >
                              Simpan
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              style={{
                                padding: '4px 8px',
                                borderRadius: 4,
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
                        </td>
                      </>
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
                            {!shop.store && (
                              <span style={{ fontSize: 10, color: 'var(--yellow)' }}>Brand/store belum diisi</span>
                            )}
                            {!shop.marketplace_source_key && (
                              <span style={{ fontSize: 10, color: 'var(--yellow)' }}>Source marketplace belum diisi</span>
                            )}
                            {!hasCoreBusinessMapping(shop) && (
                              <span style={{ fontSize: 10, color: 'var(--yellow)' }}>Business core belum lengkap</span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 11 }}>
                          {shop.shop_id}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ color: 'var(--text)', fontWeight: 600 }}>{shop.shop_name}</div>
                          <div style={{ color: 'var(--dim)', fontSize: 10 }}>{shop.shop_status || '-'}</div>
                          <div style={{ color: 'var(--dim)', fontSize: 10, marginTop: 4 }}>
                            source: {shop.marketplace_source_key || '-'} • revenue: {getBusinessDisplay(shop.revenue_business_code)}
                          </div>
                          <div style={{ color: 'var(--dim)', fontSize: 10 }}>
                            account: {getBusinessDisplay(shop.account_business_code)} • viewer: {getBusinessDisplay(shop.viewer_business_code)}
                          </div>
                          <div style={{ color: 'var(--dim)', fontSize: 10 }}>
                            owner: {getBusinessDisplay(shop.default_owner_business_code)} • processor: {getBusinessDisplay(shop.default_processor_business_code)}
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>
                          {shop.region || '-'}
                          {shop.is_cb ? <span style={{ marginLeft: 6, color: '#60a5fa', fontSize: 10 }}>CB</span> : null}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{getBrandDisplay(shop.store)}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{shop.default_source}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{shop.default_advertiser}</td>
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
                ))}
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
                  const badge = statusStyle(log.status);
                  return (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontSize: 11 }}>
                        {formatDateTime(log.created_at)}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: 11 }}>
                        {log.date_range_start === log.date_range_end
                          ? log.date_range_start
                          : `${log.date_range_start} ~ ${log.date_range_end}`}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{log.shops_synced}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{log.rows_inserted}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{fmtRupiah(log.spend_total)}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{fmtRupiah(log.direct_gmv_total)}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{fmtRupiah(log.broad_gmv_total)}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 5,
                          fontSize: 10,
                          fontWeight: 700,
                          background: badge.bg,
                          color: badge.color,
                        }}>
                          {badge.label}
                        </span>
                        {log.error_message && (
                          <div style={{
                            fontSize: 10,
                            color: 'var(--red)',
                            marginTop: 2,
                            maxWidth: 220,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {log.error_message}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: 11 }}>
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

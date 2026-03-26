// components/MetaManager.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSupabase } from '@/lib/supabase-browser';

interface MetaAccount {
  id: number;
  account_id: string;
  account_name: string;
  store: string;
  default_source: string;
  default_advertiser: string;
  is_active: boolean;
}

interface SyncLog {
  id: number;
  sync_date: string;
  date_range_start: string;
  date_range_end: string;
  accounts_synced: number;
  rows_inserted: number;
  status: string;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface RemoteAccount {
  account_id: string;
  name: string;
  account_status: number;
  currency: string;
  is_registered: boolean;
  registration: any;
}

interface WabaAccount {
  id: number;
  waba_id: string;
  waba_name: string;
  store: string;
  default_source: string;
  default_advertiser: string;
  is_active: boolean;
}

// Store mapping per selected account for bulk add
interface SelectedAccountMapping {
  account_id: string;
  name: string;
  store: string;
  default_source: string;
  default_advertiser: string;
}

const ACCOUNT_STATUS_LABELS: Record<number, string> = {
  1: 'Active',
  2: 'Disabled',
  3: 'Unsettled',
  7: 'Pending Review',
  8: 'Pending Closure',
  9: 'In Grace Period',
  100: 'Pending Settlement',
  101: 'Closed',
  201: 'Any Closed',
};

export default function MetaManager() {
  const supabase = useSupabase();

  const [accounts, setAccounts] = useState<MetaAccount[]>([]);
  const [recentLogs, setRecentLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Date picker state for sync
  const getYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  };
  const [syncDateStart, setSyncDateStart] = useState(getYesterday);
  const [syncDateEnd, setSyncDateEnd] = useState(getYesterday);

  // WABA state
  const [wabaAccounts, setWabaAccounts] = useState<WabaAccount[]>([]);
  const [wabaLogs, setWabaLogs] = useState<SyncLog[]>([]);
  const [wabaSyncing, setWabaSyncing] = useState(false);
  const [wabaMessage, setWabaMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [wabaSyncDateStart, setWabaSyncDateStart] = useState(getYesterday);
  const [wabaSyncDateEnd, setWabaSyncDateEnd] = useState(getYesterday);
  const [showWabaForm, setShowWabaForm] = useState(false);
  const [wabaForm, setWabaForm] = useState({ waba_id: '', waba_name: '', store: '', default_source: 'WhatsApp Marketing', default_advertiser: 'WhatsApp Team' });
  const [savingWaba, setSavingWaba] = useState(false);
  const [wabaEditingId, setWabaEditingId] = useState<number | null>(null);
  const [wabaEditForm, setWabaEditForm] = useState({ waba_id: '', waba_name: '', store: '', default_source: 'WhatsApp Marketing', default_advertiser: 'WhatsApp Team' });

  // Dropdown options loaded from DB
  const [storeOptions, setStoreOptions] = useState<string[]>([]);
  const [sourceOptions] = useState<string[]>([
    'Facebook Ads', 'Facebook CPAS', 'Google Ads', 'TikTok Ads', 'Shopee', 'Lazada',
    'BliBli', 'Tokopedia', 'SnackVideo Ads', 'Organik', 'Reseller',
  ]);

  // Account picker state
  const [showPicker, setShowPicker] = useState(false);
  const [remoteAccounts, setRemoteAccounts] = useState<RemoteAccount[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [selectedMappings, setSelectedMappings] = useState<Map<string, SelectedAccountMapping>>(new Map());
  const [savingBulk, setSavingBulk] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  // Edit form state (for existing accounts)
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    account_id: '', account_name: '', store: '',
    default_source: 'Facebook Ads', default_advertiser: 'Meta Team',
  });

  const loadData = useCallback(async () => {
    try {
      const [{ data: accs }, { data: logs }, { data: stores }, { data: wAbas }, { data: wLogs }] = await Promise.all([
        supabase.from('meta_ad_accounts').select('*').order('account_name'),
        supabase.from('meta_sync_log').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('ads_store_brand_mapping').select('store_pattern').order('store_pattern'),
        supabase.from('waba_accounts').select('*').order('waba_name'),
        supabase.from('waba_sync_log').select('*').order('created_at', { ascending: false }).limit(5),
      ]);
      setAccounts(accs || []);
      setRecentLogs(logs || []);
      setStoreOptions((stores || []).map((s: any) => s.store_pattern));
      setWabaAccounts(wAbas || []);
      setWabaLogs(wLogs || []);
    } catch (err: any) {
      console.error('Failed to load Meta data:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Fetch remote accounts from Meta API ──
  const handleLoadRemoteAccounts = async () => {
    setLoadingRemote(true);
    setMessage(null);
    try {
      const res = await fetch('/api/meta-accounts');
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Gagal mengambil data dari Meta' });
        return;
      }
      setRemoteAccounts(data.accounts || []);
      setShowPicker(true);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Gagal fetch akun' });
    } finally {
      setLoadingRemote(false);
    }
  };

  // ── Toggle selection of a remote account ──
  const toggleSelection = (acc: RemoteAccount) => {
    setSelectedMappings(prev => {
      const next = new Map(prev);
      if (next.has(acc.account_id)) {
        next.delete(acc.account_id);
      } else {
        next.set(acc.account_id, {
          account_id: acc.account_id,
          name: acc.name,
          store: '',
          default_source: 'Facebook Ads',
          default_advertiser: 'Meta Team',
        });
      }
      return next;
    });
  };

  // ── Update store mapping for a selected account ──
  const updateMapping = (accountId: string, field: string, value: string) => {
    setSelectedMappings(prev => {
      const next = new Map(prev);
      const existing = next.get(accountId);
      if (existing) {
        next.set(accountId, { ...existing, [field]: value });
      }
      return next;
    });
  };

  // ── Bulk save selected accounts ──
  const handleBulkSave = async () => {
    const toSave = Array.from(selectedMappings.values()).filter(m => m.store.trim());
    if (toSave.length === 0) {
      setMessage({ type: 'error', text: 'Pilih minimal 1 akun dan isi Store mapping-nya' });
      return;
    }

    const missing = Array.from(selectedMappings.values()).filter(m => !m.store.trim());
    if (missing.length > 0) {
      setMessage({ type: 'error', text: `${missing.length} akun belum diisi Store mapping-nya` });
      return;
    }

    setSavingBulk(true);
    setMessage(null);
    try {
      const rows = toSave.map(m => ({
        account_id: m.account_id,
        account_name: m.name,
        store: m.store.trim(),
        default_source: m.default_source.trim() || 'Facebook',
        default_advertiser: m.default_advertiser.trim() || 'Meta Team',
      }));

      const { error } = await supabase.from('meta_ad_accounts').upsert(rows, {
        onConflict: 'account_id',
      });
      if (error) throw error;

      setMessage({ type: 'success', text: `${rows.length} akun berhasil disimpan` });
      setSelectedMappings(new Map());
      setShowPicker(false);
      setRemoteAccounts([]);
      await loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Gagal menyimpan' });
    } finally {
      setSavingBulk(false);
    }
  };

  // ── Edit existing account ──
  const handleEdit = (acc: MetaAccount) => {
    setEditForm({
      account_id: acc.account_id, account_name: acc.account_name,
      store: acc.store, default_source: acc.default_source,
      default_advertiser: acc.default_advertiser,
    });
    setEditingId(acc.id);
  };

  const handleEditSave = async () => {
    if (!editForm.store.trim()) {
      setMessage({ type: 'error', text: 'Store wajib diisi' });
      return;
    }
    try {
      const { error } = await supabase.from('meta_ad_accounts').update({
        account_name: editForm.account_name.trim(),
        store: editForm.store.trim(),
        default_source: editForm.default_source.trim(),
        default_advertiser: editForm.default_advertiser.trim(),
        updated_at: new Date().toISOString(),
      }).eq('id', editingId);
      if (error) throw error;
      setMessage({ type: 'success', text: 'Akun diperbarui' });
      setEditingId(null);
      await loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleToggleActive = async (acc: MetaAccount) => {
    try {
      const { error } = await supabase.from('meta_ad_accounts').update({
        is_active: !acc.is_active, updated_at: new Date().toISOString(),
      }).eq('id', acc.id);
      if (error) throw error;
      await loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({ date_start: syncDateStart, date_end: syncDateEnd });
      const res = await fetch(`/api/meta-sync?${params}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Sync gagal' });
      } else {
        const msg = `Sync ${data.status}: ${data.accounts_synced}/${data.accounts_total} akun, ${data.rows_inserted} baris data`;
        setMessage({
          type: data.status === 'failed' ? 'error' : 'success',
          text: data.token_warning ? `${msg}. ⚠️ ${data.token_warning}` : msg,
        });
        await loadData();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Sync gagal' });
    } finally {
      setSyncing(false);
    }
  };

  // ── WABA handlers ──
  const handleWabaSave = async () => {
    if (!wabaForm.waba_id.trim() || !wabaForm.waba_name.trim() || !wabaForm.store.trim()) {
      setWabaMessage({ type: 'error', text: 'WABA ID, Nama, dan Store wajib diisi' });
      return;
    }
    setSavingWaba(true);
    setWabaMessage(null);
    try {
      const { error } = await supabase.from('waba_accounts').upsert({
        waba_id: wabaForm.waba_id.trim(),
        waba_name: wabaForm.waba_name.trim(),
        store: wabaForm.store.trim(),
        default_source: wabaForm.default_source.trim() || 'WhatsApp Marketing',
        default_advertiser: wabaForm.default_advertiser.trim() || 'WhatsApp Team',
      }, { onConflict: 'waba_id' });
      if (error) throw error;
      setWabaMessage({ type: 'success', text: 'WABA account berhasil disimpan' });
      setShowWabaForm(false);
      setWabaForm({ waba_id: '', waba_name: '', store: '', default_source: 'WhatsApp Marketing', default_advertiser: 'WhatsApp Team' });
      await loadData();
    } catch (err: any) {
      setWabaMessage({ type: 'error', text: err.message || 'Gagal menyimpan' });
    } finally {
      setSavingWaba(false);
    }
  };

  const handleWabaEdit = (acc: WabaAccount) => {
    setWabaEditForm({
      waba_id: acc.waba_id, waba_name: acc.waba_name,
      store: acc.store, default_source: acc.default_source,
      default_advertiser: acc.default_advertiser,
    });
    setWabaEditingId(acc.id);
  };

  const handleWabaEditSave = async () => {
    if (!wabaEditForm.store.trim()) {
      setWabaMessage({ type: 'error', text: 'Store wajib diisi' });
      return;
    }
    try {
      const { error } = await supabase.from('waba_accounts').update({
        waba_name: wabaEditForm.waba_name.trim(),
        store: wabaEditForm.store.trim(),
        default_source: wabaEditForm.default_source.trim(),
        default_advertiser: wabaEditForm.default_advertiser.trim(),
        updated_at: new Date().toISOString(),
      }).eq('id', wabaEditingId);
      if (error) throw error;
      setWabaMessage({ type: 'success', text: 'WABA account diperbarui' });
      setWabaEditingId(null);
      await loadData();
    } catch (err: any) {
      setWabaMessage({ type: 'error', text: err.message });
    }
  };

  const handleWabaToggleActive = async (acc: WabaAccount) => {
    try {
      const { error } = await supabase.from('waba_accounts').update({
        is_active: !acc.is_active, updated_at: new Date().toISOString(),
      }).eq('id', acc.id);
      if (error) throw error;
      await loadData();
    } catch (err: any) {
      setWabaMessage({ type: 'error', text: err.message });
    }
  };

  const handleWabaSyncNow = async () => {
    setWabaSyncing(true);
    setWabaMessage(null);
    try {
      const params = new URLSearchParams({ date_start: wabaSyncDateStart, date_end: wabaSyncDateEnd });
      const res = await fetch(`/api/whatsapp-sync?${params}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setWabaMessage({ type: 'error', text: data.error || 'Sync gagal' });
      } else {
        const msg = `Sync ${data.status}: ${data.accounts_synced}/${data.accounts_total} akun, ${data.rows_inserted} baris data`;
        setWabaMessage({ type: data.status === 'failed' ? 'error' : 'success', text: msg });
        await loadData();
      }
    } catch (err: any) {
      setWabaMessage({ type: 'error', text: err.message || 'Sync gagal' });
    } finally {
      setWabaSyncing(false);
    }
  };

  const statusStyle = (s: string) => {
    switch (s) {
      case 'success': return { bg: 'var(--badge-green-bg)', color: 'var(--green)', label: 'Sukses' };
      case 'partial': return { bg: 'var(--badge-yellow-bg)', color: 'var(--yellow)', label: 'Partial' };
      case 'failed': return { bg: 'var(--badge-red-bg)', color: 'var(--red)', label: 'Gagal' };
      case 'running': return { bg: '#1e3a5f', color: '#60a5fa', label: 'Running' };
      default: return { bg: 'var(--border)', color: 'var(--dim)', label: s };
    }
  };

  if (loading) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ color: 'var(--dim)', fontSize: 13 }}>Memuat data Meta Ads...</div>
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--bg)',
    color: 'var(--text)', fontSize: 13, outline: 'none',
  };
  const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--dim)', display: 'block', marginBottom: 4 };

  // Filtered remote accounts for the picker
  const filteredRemote = remoteAccounts.filter(a =>
    !searchFilter || a.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
    a.account_id.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ─── Meta Ad Accounts ─── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Meta Ad Accounts</div>
          <button
            onClick={handleLoadRemoteAccounts}
            disabled={loadingRemote}
            style={{
              padding: '6px 14px', borderRadius: 6, border: 'none', cursor: loadingRemote ? 'not-allowed' : 'pointer',
              background: loadingRemote ? 'var(--border)' : 'var(--accent)', color: '#fff',
              fontSize: 12, fontWeight: 600, opacity: loadingRemote ? 0.6 : 1,
            }}
          >
            {loadingRemote ? 'Memuat...' : '+ Tambah Akun'}
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>
          Daftar akun Meta Ads yang datanya ditarik otomatis via Marketing API.
        </div>

        {/* ─── Sync Controls with Date Picker ─── */}
        {accounts.filter(a => a.is_active).length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
            padding: 12, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)',
            flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Sync tanggal:</span>
            <input
              type="date"
              value={syncDateStart}
              onChange={e => setSyncDateStart(e.target.value)}
              style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 12 }}
            />
            <span style={{ fontSize: 12, color: 'var(--dim)' }}>s/d</span>
            <input
              type="date"
              value={syncDateEnd}
              onChange={e => setSyncDateEnd(e.target.value)}
              style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 12 }}
            />
            <button
              onClick={handleSyncNow}
              disabled={syncing}
              style={{
                padding: '6px 16px', borderRadius: 6, border: 'none',
                cursor: syncing ? 'not-allowed' : 'pointer',
                background: syncing ? 'var(--border)' : 'var(--green)', color: syncing ? 'var(--dim)' : '#fff',
                fontSize: 12, fontWeight: 600, opacity: syncing ? 0.4 : 1,
                marginLeft: 'auto',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={syncing ? { animation: 'spin 1s linear infinite' } : undefined}><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        )}

        {/* Messages */}
        {message && (
          <div style={{
            marginBottom: 12, padding: 12, borderRadius: 8, fontSize: 13,
            background: message.type === 'success' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)',
            color: message.type === 'success' ? 'var(--green)' : 'var(--red)',
          }}>
            {message.type === 'success' ? '✅' : '❌'} {message.text}
          </div>
        )}

        {/* ─── Account Picker (multi-select from Meta API) ─── */}
        {showPicker && (
          <div style={{
            marginBottom: 16, padding: 16, background: 'var(--bg)',
            borderRadius: 8, border: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                Pilih Akun dari Meta ({remoteAccounts.length} ditemukan)
              </div>
              <button
                onClick={() => { setShowPicker(false); setSelectedMappings(new Map()); setSearchFilter(''); }}
                style={{
                  padding: '4px 12px', borderRadius: 4, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--dim)', fontSize: 11, cursor: 'pointer',
                }}
              >
                Tutup
              </button>
            </div>

            {/* Search */}
            <input
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              placeholder="Cari nama akun atau ID..."
              style={{ ...inputStyle, marginBottom: 12 }}
            />

            {/* Account checklist */}
            <div style={{
              maxHeight: 350, overflowY: 'auto', border: '1px solid var(--border)',
              borderRadius: 6, background: 'var(--card)',
            }}>
              {filteredRemote.map(acc => {
                const isSelected = selectedMappings.has(acc.account_id);
                const mapping = selectedMappings.get(acc.account_id);
                const statusLabel = ACCOUNT_STATUS_LABELS[acc.account_status] || `Status ${acc.account_status}`;

                return (
                  <div key={acc.account_id} style={{
                    borderBottom: '1px solid var(--bg-deep)',
                    background: isSelected ? 'var(--accent-subtle)' : 'transparent',
                  }}>
                    {/* Row: checkbox + info */}
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 12px', cursor: acc.is_registered ? 'default' : 'pointer',
                      }}
                      onClick={() => !acc.is_registered && toggleSelection(acc)}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected || acc.is_registered}
                        disabled={acc.is_registered}
                        onChange={() => !acc.is_registered && toggleSelection(acc)}
                        onClick={e => e.stopPropagation()}
                        style={{ accentColor: 'var(--accent)', cursor: acc.is_registered ? 'default' : 'pointer' }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                          {acc.name}
                          {acc.is_registered && (
                            <span style={{
                              marginLeft: 8, padding: '1px 6px', borderRadius: 4,
                              fontSize: 9, fontWeight: 600, background: 'var(--badge-green-bg)', color: 'var(--green)',
                            }}>Sudah terdaftar</span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--dim)' }}>
                          {acc.account_id} · {statusLabel} · {acc.currency}
                        </div>
                      </div>
                    </div>

                    {/* Mapping fields (shown when selected) */}
                    {isSelected && mapping && (
                      <div style={{
                        padding: '0 12px 12px 36px',
                        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
                      }}>
                        <div>
                          <label style={labelStyle}>Store (wajib)</label>
                          <select
                            value={mapping.store}
                            onChange={e => updateMapping(acc.account_id, 'store', e.target.value)}
                            style={{ ...inputStyle, padding: '6px 10px', fontSize: 12 }}
                            onClick={e => e.stopPropagation()}
                          >
                            <option value="">— Pilih Store —</option>
                            {storeOptions.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={labelStyle}>Source</label>
                          <select
                            value={mapping.default_source}
                            onChange={e => updateMapping(acc.account_id, 'default_source', e.target.value)}
                            style={{ ...inputStyle, padding: '6px 10px', fontSize: 12 }}
                            onClick={e => e.stopPropagation()}
                          >
                            {sourceOptions.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={labelStyle}>Advertiser</label>
                          <input
                            value={mapping.default_advertiser}
                            onChange={e => updateMapping(acc.account_id, 'default_advertiser', e.target.value)}
                            placeholder="Meta Team"
                            style={{ ...inputStyle, padding: '6px 10px', fontSize: 12 }}
                            onClick={e => e.stopPropagation()}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredRemote.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--dim)', fontSize: 12 }}>
                  {searchFilter ? 'Tidak ada akun yang cocok' : 'Tidak ada akun ditemukan'}
                </div>
              )}
            </div>

            {/* Save button */}
            {selectedMappings.size > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {selectedMappings.size} akun dipilih
                </div>
                <button
                  onClick={handleBulkSave}
                  disabled={savingBulk}
                  style={{
                    padding: '8px 24px', borderRadius: 6, border: 'none', cursor: savingBulk ? 'not-allowed' : 'pointer',
                    background: savingBulk ? 'var(--border)' : 'var(--accent)', color: '#fff',
                    fontSize: 13, fontWeight: 600, opacity: savingBulk ? 0.6 : 1,
                  }}
                >
                  {savingBulk ? 'Menyimpan...' : `Simpan ${selectedMappings.size} Akun`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─── Registered Account List ─── */}
        {accounts.length === 0 && !showPicker ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--dim)', fontSize: 13 }}>
            Belum ada akun Meta Ads. Klik "+ Tambah Akun" untuk memuat daftar dari Meta API.
          </div>
        ) : accounts.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['Status', 'Account ID', 'Nama Akun', 'Store', 'Source', 'Advertiser', 'Aksi'].map(h => (
                    <th key={h} style={{
                      padding: '10px 12px', textAlign: 'left', color: 'var(--dim)',
                      fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                      borderBottom: '2px solid var(--border)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts.map(acc => (
                  <tr key={acc.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                    {editingId === acc.id ? (
                      /* ── Inline edit mode ── */
                      <>
                        <td style={{ padding: '8px 12px' }} colSpan={2}>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--dim)' }}>{acc.account_id}</span>
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <input value={editForm.account_name} onChange={e => setEditForm(f => ({ ...f, account_name: e.target.value }))}
                            style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }} />
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <select value={editForm.store} onChange={e => setEditForm(f => ({ ...f, store: e.target.value }))}
                            style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}>
                            <option value="">— Pilih —</option>
                            {storeOptions.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <select value={editForm.default_source} onChange={e => setEditForm(f => ({ ...f, default_source: e.target.value }))}
                            style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}>
                            {sourceOptions.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <input value={editForm.default_advertiser} onChange={e => setEditForm(f => ({ ...f, default_advertiser: e.target.value }))}
                            style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }} />
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={handleEditSave} style={{
                              padding: '4px 8px', borderRadius: 4, border: 'none',
                              background: 'var(--accent)', color: '#fff', fontSize: 10, cursor: 'pointer',
                            }}>Simpan</button>
                            <button onClick={() => setEditingId(null)} style={{
                              padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)',
                              background: 'transparent', color: 'var(--dim)', fontSize: 10, cursor: 'pointer',
                            }}>Batal</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      /* ── Normal display mode ── */
                      <>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                            background: acc.is_active ? 'var(--badge-green-bg)' : 'var(--border)',
                            color: acc.is_active ? 'var(--green)' : 'var(--dim)',
                          }}>
                            {acc.is_active ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 11 }}>
                          {acc.account_id}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text)', fontWeight: 600 }}>{acc.account_name}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{acc.store}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{acc.default_source}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{acc.default_advertiser}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => handleEdit(acc)} style={{
                              padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)',
                              background: 'transparent', color: '#60a5fa', fontSize: 11, cursor: 'pointer',
                            }}>Edit</button>
                            <button onClick={() => handleToggleActive(acc)} style={{
                              padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)',
                              background: 'transparent', fontSize: 11, cursor: 'pointer',
                              color: acc.is_active ? 'var(--yellow)' : 'var(--green)',
                            }}>
                              {acc.is_active ? 'Nonaktifkan' : 'Aktifkan'}
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

      {/* ─── Recent Sync Logs ─── */}
      {recentLogs.length > 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Riwayat Sync Meta</div>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>5 sync terakhir</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 500 }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['Waktu', 'Range', 'Akun', 'Baris', 'Status', 'Durasi'].map(h => (
                    <th key={h} style={{
                      padding: '10px 12px', textAlign: 'left', color: 'var(--dim)',
                      fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                      borderBottom: '2px solid var(--border)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentLogs.map(log => {
                  const ss = statusStyle(log.status);
                  return (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontSize: 11 }}>
                        {new Date(log.created_at).toLocaleString('id-ID', {
                          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: 11 }}>
                        {log.date_range_start === log.date_range_end
                          ? log.date_range_start
                          : `${log.date_range_start} ~ ${log.date_range_end}`}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{log.accounts_synced}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{log.rows_inserted}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                          background: ss.bg, color: ss.color,
                        }}>{ss.label}</span>
                        {log.error_message && (
                          <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {log.error_message}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: 11 }}>
                        {log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* ═══════════════════════════════════════════════════════ */}
      {/* ─── WhatsApp Business Accounts (WABA) ─── */}
      {/* ═══════════════════════════════════════════════════════ */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>WhatsApp Business Accounts</div>
          <button
            onClick={() => setShowWabaForm(true)}
            style={{
              padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: '#25D366', color: '#fff',
              fontSize: 12, fontWeight: 600,
            }}
          >
            + Tambah WABA
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>
          Daftar WABA yang datanya ditarik otomatis via WhatsApp Business Management API.
        </div>

        {/* ─── WABA Sync Controls ─── */}
        {wabaAccounts.filter(a => a.is_active).length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
            padding: 12, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)',
            flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Sync tanggal:</span>
            <input
              type="date"
              value={wabaSyncDateStart}
              onChange={e => setWabaSyncDateStart(e.target.value)}
              style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 12 }}
            />
            <span style={{ fontSize: 12, color: 'var(--dim)' }}>s/d</span>
            <input
              type="date"
              value={wabaSyncDateEnd}
              onChange={e => setWabaSyncDateEnd(e.target.value)}
              style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 12 }}
            />
            <button
              onClick={handleWabaSyncNow}
              disabled={wabaSyncing}
              style={{
                padding: '6px 16px', borderRadius: 6, border: 'none',
                cursor: wabaSyncing ? 'not-allowed' : 'pointer',
                background: wabaSyncing ? 'var(--border)' : '#25D366', color: '#fff',
                fontSize: 12, fontWeight: 600, opacity: wabaSyncing ? 0.4 : 1,
                marginLeft: 'auto',
              }}
            >
              {wabaSyncing ? 'Syncing...' : 'Sync WABA'}
            </button>
          </div>
        )}

        {/* WABA Messages */}
        {wabaMessage && (
          <div style={{
            marginBottom: 12, padding: 12, borderRadius: 8, fontSize: 13,
            background: wabaMessage.type === 'success' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)',
            color: wabaMessage.type === 'success' ? 'var(--green)' : 'var(--red)',
          }}>
            {wabaMessage.type === 'success' ? '✅' : '❌'} {wabaMessage.text}
          </div>
        )}

        {/* ─── Add WABA Form ─── */}
        {showWabaForm && (
          <div style={{
            marginBottom: 16, padding: 16, background: 'var(--bg)',
            borderRadius: 8, border: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Tambah WABA Account</div>
              <button
                onClick={() => { setShowWabaForm(false); setWabaForm({ waba_id: '', waba_name: '', store: '', default_source: 'WhatsApp Marketing', default_advertiser: 'WhatsApp Team' }); }}
                style={{
                  padding: '4px 12px', borderRadius: 4, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--dim)', fontSize: 11, cursor: 'pointer',
                }}
              >
                Tutup
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>WABA ID (wajib)</label>
                <input
                  value={wabaForm.waba_id}
                  onChange={e => setWabaForm(f => ({ ...f, waba_id: e.target.value }))}
                  placeholder="Contoh: 123456789012345"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Nama WABA (wajib)</label>
                <input
                  value={wabaForm.waba_name}
                  onChange={e => setWabaForm(f => ({ ...f, waba_name: e.target.value }))}
                  placeholder="Contoh: RTI WhatsApp"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Store (wajib)</label>
                <select
                  value={wabaForm.store}
                  onChange={e => setWabaForm(f => ({ ...f, store: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="">— Pilih Store —</option>
                  {storeOptions.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Source</label>
                <input
                  value={wabaForm.default_source}
                  onChange={e => setWabaForm(f => ({ ...f, default_source: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Advertiser</label>
                <input
                  value={wabaForm.default_advertiser}
                  onChange={e => setWabaForm(f => ({ ...f, default_advertiser: e.target.value }))}
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={handleWabaSave}
                disabled={savingWaba}
                style={{
                  padding: '8px 24px', borderRadius: 6, border: 'none', cursor: savingWaba ? 'not-allowed' : 'pointer',
                  background: savingWaba ? 'var(--border)' : '#25D366', color: '#fff',
                  fontSize: 13, fontWeight: 600, opacity: savingWaba ? 0.6 : 1,
                }}
              >
                {savingWaba ? 'Menyimpan...' : 'Simpan WABA'}
              </button>
            </div>
          </div>
        )}

        {/* ─── WABA Account List ─── */}
        {wabaAccounts.length === 0 && !showWabaForm ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--dim)', fontSize: 13 }}>
            Belum ada WABA account. Klik "+ Tambah WABA" untuk menambahkan.
          </div>
        ) : wabaAccounts.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['Status', 'WABA ID', 'Nama', 'Store', 'Source', 'Advertiser', 'Aksi'].map(h => (
                    <th key={h} style={{
                      padding: '10px 12px', textAlign: 'left', color: 'var(--dim)',
                      fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                      borderBottom: '2px solid var(--border)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wabaAccounts.map(acc => (
                  <tr key={acc.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                    {wabaEditingId === acc.id ? (
                      <>
                        <td style={{ padding: '8px 12px' }} colSpan={2}>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--dim)' }}>{acc.waba_id}</span>
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <input value={wabaEditForm.waba_name} onChange={e => setWabaEditForm(f => ({ ...f, waba_name: e.target.value }))}
                            style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }} />
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <select value={wabaEditForm.store} onChange={e => setWabaEditForm(f => ({ ...f, store: e.target.value }))}
                            style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}>
                            <option value="">— Pilih —</option>
                            {storeOptions.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <input value={wabaEditForm.default_source} onChange={e => setWabaEditForm(f => ({ ...f, default_source: e.target.value }))}
                            style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }} />
                        </td>
                        <td style={{ padding: '8px 6px' }}>
                          <input value={wabaEditForm.default_advertiser} onChange={e => setWabaEditForm(f => ({ ...f, default_advertiser: e.target.value }))}
                            style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }} />
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={handleWabaEditSave} style={{
                              padding: '4px 8px', borderRadius: 4, border: 'none',
                              background: '#25D366', color: '#fff', fontSize: 10, cursor: 'pointer',
                            }}>Simpan</button>
                            <button onClick={() => setWabaEditingId(null)} style={{
                              padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)',
                              background: 'transparent', color: 'var(--dim)', fontSize: 10, cursor: 'pointer',
                            }}>Batal</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                            background: acc.is_active ? 'var(--badge-green-bg)' : 'var(--border)',
                            color: acc.is_active ? 'var(--green)' : 'var(--dim)',
                          }}>
                            {acc.is_active ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 11 }}>
                          {acc.waba_id}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text)', fontWeight: 600 }}>{acc.waba_name}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{acc.store}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{acc.default_source}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{acc.default_advertiser}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => handleWabaEdit(acc)} style={{
                              padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)',
                              background: 'transparent', color: '#60a5fa', fontSize: 11, cursor: 'pointer',
                            }}>Edit</button>
                            <button onClick={() => handleWabaToggleActive(acc)} style={{
                              padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)',
                              background: 'transparent', fontSize: 11, cursor: 'pointer',
                              color: acc.is_active ? 'var(--yellow)' : 'var(--green)',
                            }}>
                              {acc.is_active ? 'Nonaktifkan' : 'Aktifkan'}
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

      {/* ─── WABA Sync Logs ─── */}
      {wabaLogs.length > 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Riwayat Sync WABA</div>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>5 sync terakhir</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 500 }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['Waktu', 'Range', 'Akun', 'Baris', 'Status', 'Durasi'].map(h => (
                    <th key={h} style={{
                      padding: '10px 12px', textAlign: 'left', color: 'var(--dim)',
                      fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                      borderBottom: '2px solid var(--border)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wabaLogs.map(log => {
                  const ss = statusStyle(log.status);
                  return (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontSize: 11 }}>
                        {new Date(log.created_at).toLocaleString('id-ID', {
                          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: 11 }}>
                        {log.date_range_start === log.date_range_end
                          ? log.date_range_start
                          : `${log.date_range_start} ~ ${log.date_range_end}`}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{log.accounts_synced}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{log.rows_inserted}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                          background: ss.bg, color: ss.color,
                        }}>{ss.label}</span>
                        {log.error_message && (
                          <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {log.error_message}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: 11 }}>
                        {log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* ═══ XLSX ADS UPLOAD ═══ */}
      <XlsxAdsUploader />
    </div>
  );
}

// ═══════════════════════════════════════════════════
// XLSX ADS UPLOADER
// ═══════════════════════════════════════════════════
function XlsxAdsUploader() {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (newFiles: FileList | null) => {
    if (!newFiles) return;
    const xlsxFiles = Array.from(newFiles).filter(f =>
      f.name.endsWith('.xlsx') || f.name.endsWith('.xls')
    );
    setFiles(prev => [...prev, ...xlsxFiles]);
  };

  const uploadAll = async () => {
    if (files.length === 0) return;
    setUploading(true);
    const newResults: any[] = [];

    // Dynamic import xlsx for client-side parsing
    const XLSX = await import('xlsx');

    for (const file of files) {
      try {
        // Parse xlsx client-side
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
        const adsSheet = wb.Sheets['Ads'] || wb.Sheets['ads'] || wb.Sheets['ADS'];
        if (!adsSheet) {
          newResults.push({ filename: file.name, error: `Sheet "Ads" not found. Available: ${wb.SheetNames.join(', ')}` });
          continue;
        }

        const rawRows: any[][] = XLSX.utils.sheet_to_json(adsSheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });

        // Find header row
        let headerIdx = -1;
        for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
          const row = (rawRows[i] || []).map((v: any) => String(v || '').trim());
          if (row.includes('Date') && row.includes('Spent')) { headerIdx = i; break; }
        }
        if (headerIdx === -1) {
          newResults.push({ filename: file.name, error: 'Header row with "Date" and "Spent" not found' });
          continue;
        }

        const headers = rawRows[headerIdx].map((v: any) => String(v || '').trim());
        const ci = {
          date: headers.indexOf('Date'), ad_account: headers.indexOf('Ad Account'),
          spent: headers.indexOf('Spent'), objective: headers.indexOf('Objective'),
          source: headers.indexOf('Source'), store: headers.indexOf('Store'),
          advertiser: headers.indexOf('Advertiser'),
        };

        // Extract rows as JSON
        const rows = [];
        for (let i = headerIdx + 1; i < rawRows.length; i++) {
          const r = rawRows[i];
          if (!r || !r[ci.date]) continue;
          rows.push({
            date: String(r[ci.date] || '').trim(),
            ad_account: ci.ad_account >= 0 ? String(r[ci.ad_account] || '').trim() : '',
            spent: String(r[ci.spent] || '0'),
            objective: ci.objective >= 0 ? String(r[ci.objective] || '').trim() : '',
            source: ci.source >= 0 ? String(r[ci.source] || '').trim() : '',
            store: ci.store >= 0 ? String(r[ci.store] || '').trim() : '',
            advertiser: ci.advertiser >= 0 ? String(r[ci.advertiser] || '').trim() : '',
          });
        }

        // Send parsed JSON to API
        const res = await fetch('/api/xlsx-ads-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, rows }),
        });
        const data = await res.json();
        newResults.push({ filename: file.name, ...data });
      } catch (err: any) {
        newResults.push({ filename: file.name, error: err.message });
      }
    }

    setResults(newResults);
    setFiles([]);
    setUploading(false);
  };

  const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx));

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginTop: 20 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Upload Ads from Excel</h3>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--dim)' }}>
        Upload .xlsx files with an "Ads" sheet. Columns: Date, Ad Account, Spent, Objective, Source, Store, Advertiser.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls'; inp.multiple = true; inp.onchange = () => handleFiles(inp.files); inp.click(); }}
        style={{
          border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 10, padding: '24px 16px', textAlign: 'center', cursor: 'pointer',
          background: dragOver ? 'var(--accent-subtle)' : 'transparent',
          transition: 'all 0.2s',
        }}
      >
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
          {dragOver ? 'Drop files here' : 'Drag & drop .xlsx files or click to browse'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
          Supports multiple files (one per month)
        </div>
      </div>

      {/* File queue */}
      {files.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--bg-deep)' }}>
              <span style={{ fontSize: 12, color: 'var(--text)' }}>{f.name}</span>
              <button onClick={(e) => { e.stopPropagation(); removeFile(i); }} style={{
                background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 11, fontWeight: 600,
              }}>Remove</button>
            </div>
          ))}
          <button onClick={uploadAll} disabled={uploading} style={{
            marginTop: 10, padding: '8px 20px', borderRadius: 8, border: 'none',
            background: uploading ? 'var(--dim)' : 'var(--accent)',
            color: '#fff', fontSize: 13, fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer',
          }}>
            {uploading ? 'Uploading...' : `Upload ${files.length} file${files.length > 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Upload Results</h4>
          {results.map((r, i) => (
            <div key={i} style={{
              padding: '10px 14px', borderRadius: 8, marginBottom: 6,
              background: r.success ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)',
              border: `1px solid ${r.success ? 'var(--green)' : 'var(--red)'}20`,
            }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: r.success ? 'var(--green)' : 'var(--red)' }}>
                {r.filename}
              </div>
              {r.success ? (
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {r.inserted} rows inserted
                  {r.skipped > 0 && `, ${r.skipped} skipped`}
                  {r.skippedStores?.length > 0 && ` (${r.skippedStores.join(', ')})`}
                  {r.dateRange && ` — ${r.dateRange.from} to ${r.dateRange.to}`}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>{r.error}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

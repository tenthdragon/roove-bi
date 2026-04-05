// @ts-nocheck
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSupabase } from '@/lib/supabase-browser';
import { uploadExcelData, fetchAllUsers, updateUserRole } from '@/lib/actions';
import { invalidateAll } from '@/lib/dashboard-cache';
import SheetManager from '@/components/SheetManager';
import ConnectionManager from '@/components/ConnectionManager';
import SyncManager from '@/components/SyncManager';
import FinancialSheetManager from '@/components/FinancialSheetManager';
import CsvOrderUploader from '@/components/CsvOrderUploader';
import BrandManager from '@/components/BrandManager';
import MetaManager from '@/components/MetaManager';
// WebhookManager merged into ConnectionManager
import WarehouseSheetManager from '@/components/WarehouseSheetManager';

const TABS = [
  { id: 'daily', label: 'Daily Data' },
  { id: 'meta', label: 'Meta Ads' },
  { id: 'financial', label: 'Financial' },
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'brands', label: 'Brands' },
  { id: 'connection', label: 'Connection' },
  { id: 'sync', label: 'Sync' },
  { id: 'data_ref', label: 'Data Reference' },
  { id: 'users', label: 'Users' },
  { id: 'logs', label: 'Logs' },
];

export default function AdminPage() {
  const supabase = useSupabase();
  const searchParams = useSearchParams();
  const showAdvanced = searchParams.get('advanced') === 'true';

  const [profile, setProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('daily');

  // Upload states
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  // Logs states
  const [logsData, setLogsData] = useState([]);
  const [excelImports, setExcelImports] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logFilter, setLogFilter] = useState('all');

  // Data Reference states
  const [commRates, setCommRates] = useState([]);
  const [commLoading, setCommLoading] = useState(false);
  const [commSaving, setCommSaving] = useState(false);
  const [commMsg, setCommMsg] = useState(null);
  const [editingRate, setEditingRate] = useState(null); // { channel, rate, effective_from, isNew }

  // Tax Rate states
  const [taxRates, setTaxRates] = useState([]);
  const [taxLoading, setTaxLoading] = useState(false);
  const [taxSaving, setTaxSaving] = useState(false);
  const [taxMsg, setTaxMsg] = useState(null);
  const [editingTax, setEditingTax] = useState(null); // { name, rate, effective_from, isNew }

  // Monthly Overhead states
  const [overheadData, setOverheadData] = useState([]);
  const [overheadLoading, setOverheadLoading] = useState(false);
  const [overheadSaving, setOverheadSaving] = useState(false);
  const [overheadMsg, setOverheadMsg] = useState(null);
  const [editingOverhead, setEditingOverhead] = useState(null); // { year_month, amount, isNew }

  // Business Tax Config states
  const [bizTaxData, setBizTaxData] = useState([]);
  const [bizTaxLoading, setBizTaxLoading] = useState(false);
  const [bizTaxSaving, setBizTaxSaving] = useState(false);
  const [bizTaxMsg, setBizTaxMsg] = useState(null);

  // Business → Warehouse Mapping states
  const [whMappingData, setWhMappingData] = useState([]);
  const [whMappingLoading, setWhMappingLoading] = useState(false);
  const [whMappingSaving, setWhMappingSaving] = useState(false);
  const [whMappingMsg, setWhMappingMsg] = useState(null);

  // User management states
  const [users, setUsers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('admin');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState(null);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        setProfile(p);
        if (p?.role === 'owner') {
          const { data: u } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
          setUsers(u || []);
        }
      }
    }
    init();
  }, [supabase]);

  // Load logs when tab becomes active
  useEffect(() => {
    if (activeTab !== 'logs' || logsData.length > 0) return;
    (async () => {
      setLogsLoading(true);
      try {
        const [{ data: syncLogs }, { data: imports }] = await Promise.all([
          supabase.from('scalev_sync_log').select('*').order('started_at', { ascending: false }).limit(100),
          supabase.from('data_imports').select('*').order('imported_at', { ascending: false }).limit(100),
        ]);
        setLogsData(syncLogs || []);
        setExcelImports(imports || []);
      } catch (err) {
        console.error('Failed to load logs:', err);
      } finally {
        setLogsLoading(false);
      }
    })();
  }, [activeTab, supabase]);

  const refreshUsers = useCallback(async () => {
    const { data: u } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
    setUsers(u || []);
  }, [supabase]);

  // Load commission rates when Data Reference tab is active
  const loadCommRates = useCallback(async () => {
    setCommLoading(true);
    try {
      const { data, error } = await supabase
        .from('marketplace_commission_rates')
        .select('*')
        .order('channel')
        .order('effective_from', { ascending: false });
      if (error) throw error;
      setCommRates(data || []);
    } catch (err) {
      console.error('Failed to load commission rates:', err);
    } finally {
      setCommLoading(false);
    }
  }, [supabase]);

  // Load tax rates
  const loadTaxRates = useCallback(async () => {
    setTaxLoading(true);
    try {
      const { data, error } = await supabase
        .from('tax_rates')
        .select('*')
        .order('name')
        .order('effective_from', { ascending: false });
      if (error) throw error;
      setTaxRates(data || []);
    } catch (err) {
      console.error('Failed to load tax rates:', err);
    } finally {
      setTaxLoading(false);
    }
  }, [supabase]);

  // Load monthly overhead
  const loadOverhead = useCallback(async () => {
    setOverheadLoading(true);
    try {
      const { data, error } = await supabase
        .from('monthly_overhead')
        .select('*')
        .order('year_month', { ascending: false });
      if (error) throw error;
      setOverheadData(data || []);
    } catch (err) {
      console.error('Failed to load overhead:', err);
    } finally {
      setOverheadLoading(false);
    }
  }, [supabase]);

  // Load business tax config
  const loadBizTax = useCallback(async () => {
    setBizTaxLoading(true);
    try {
      const { data, error } = await supabase
        .from('scalev_webhook_businesses')
        .select('id, business_code, business_name, tax_rate_name, is_active')
        .order('id');
      if (error) throw error;
      setBizTaxData(data || []);
    } catch (err) {
      console.error('Failed to load business tax config:', err);
    } finally {
      setBizTaxLoading(false);
    }
  }, [supabase]);

  // Business → Warehouse Mapping
  const loadWhMapping = useCallback(async () => {
    setWhMappingLoading(true);
    try {
      const { data, error } = await supabase
        .from('warehouse_business_mapping')
        .select('*, scalev_webhook_businesses!inner(business_name)')
        .order('business_code');
      if (error) throw error;
      setWhMappingData(data || []);
    } catch (err) {
      console.error('Failed to load warehouse mapping:', err);
    } finally {
      setWhMappingLoading(false);
    }
  }, [supabase]);

  const handleWhMappingChange = async (id, field, value) => {
    setWhMappingSaving(true);
    setWhMappingMsg(null);
    try {
      const { error } = await supabase
        .from('warehouse_business_mapping')
        .update({ [field]: value })
        .eq('id', id);
      if (error) throw error;
      setWhMappingMsg({ type: 'success', text: 'Mapping updated' });
      await loadWhMapping();
    } catch (err) {
      setWhMappingMsg({ type: 'error', text: err.message || 'Gagal menyimpan' });
    } finally {
      setWhMappingSaving(false);
    }
  };

  const handleBizTaxChange = async (bizId, newTaxRateName) => {
    setBizTaxSaving(true);
    setBizTaxMsg(null);
    try {
      const { error } = await supabase
        .from('scalev_webhook_businesses')
        .update({ tax_rate_name: newTaxRateName })
        .eq('id', bizId);
      if (error) throw error;
      setBizTaxMsg({ type: 'success', text: 'Tax config updated' });
      await loadBizTax();
    } catch (err) {
      setBizTaxMsg({ type: 'error', text: err.message || 'Gagal menyimpan' });
    } finally {
      setBizTaxSaving(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'data_ref') {
      if (commRates.length === 0) loadCommRates();
      if (taxRates.length === 0) loadTaxRates();
      if (overheadData.length === 0) loadOverhead();
      if (bizTaxData.length === 0) loadBizTax();
      if (whMappingData.length === 0) loadWhMapping();
    }
  }, [activeTab]);

  const handleSaveRate = async (row) => {
    if (!row.channel || !row.rate || !row.effective_from) {
      setCommMsg({ type: 'error', text: 'Semua field harus diisi' });
      return;
    }
    setCommSaving(true);
    setCommMsg(null);
    try {
      const rateNum = parseFloat(row.rate);
      if (isNaN(rateNum) || rateNum < 0 || rateNum > 1) {
        throw new Error('Rate harus berupa desimal antara 0 dan 1 (contoh: 0.19 = 19%)');
      }
      const { error } = await supabase
        .from('marketplace_commission_rates')
        .upsert({
          channel: row.channel,
          rate: rateNum,
          effective_from: row.effective_from,
        }, { onConflict: 'channel,effective_from' });
      if (error) throw error;
      setCommMsg({ type: 'success', text: `Rate ${row.channel} berhasil disimpan` });
      setEditingRate(null);
      await loadCommRates();
    } catch (err) {
      setCommMsg({ type: 'error', text: err.message || 'Gagal menyimpan' });
    } finally {
      setCommSaving(false);
    }
  };

  const handleDeleteRate = async (id) => {
    if (!confirm('Hapus rate ini? Data mp_admin_cost akan otomatis dihitung ulang.')) return;
    try {
      const { error } = await supabase.from('marketplace_commission_rates').delete().eq('id', id);
      if (error) throw error;
      setCommMsg({ type: 'success', text: 'Rate dihapus' });
      await loadCommRates();
    } catch (err) {
      setCommMsg({ type: 'error', text: err.message || 'Gagal menghapus' });
    }
  };

  const handleSaveTax = async (row) => {
    if (!row.name || !row.rate || !row.effective_from) {
      setTaxMsg({ type: 'error', text: 'Semua field harus diisi' });
      return;
    }
    setTaxSaving(true);
    setTaxMsg(null);
    try {
      const rateNum = parseFloat(row.rate);
      if (isNaN(rateNum) || rateNum < 0 || rateNum > 100) {
        throw new Error('Rate harus berupa angka persentase antara 0 dan 100 (contoh: 11 = 11%)');
      }
      const { error } = await supabase
        .from('tax_rates')
        .upsert({
          name: row.name.trim(),
          rate: rateNum,
          effective_from: row.effective_from,
        }, { onConflict: 'name,effective_from' });
      if (error) throw error;
      setTaxMsg({ type: 'success', text: `Tax rate ${row.name} berhasil disimpan` });
      setEditingTax(null);
      await loadTaxRates();
    } catch (err) {
      setTaxMsg({ type: 'error', text: err.message || 'Gagal menyimpan' });
    } finally {
      setTaxSaving(false);
    }
  };

  const handleDeleteTax = async (id) => {
    if (!confirm('Hapus tax rate ini?')) return;
    try {
      const { error } = await supabase.from('tax_rates').delete().eq('id', id);
      if (error) throw error;
      setTaxMsg({ type: 'success', text: 'Tax rate dihapus' });
      await loadTaxRates();
    } catch (err) {
      setTaxMsg({ type: 'error', text: err.message || 'Gagal menghapus' });
    }
  };

  const handleSaveOverhead = async (row) => {
    if (!row.year_month || !row.amount) {
      setOverheadMsg({ type: 'error', text: 'Bulan dan nominal harus diisi' });
      return;
    }
    setOverheadSaving(true);
    setOverheadMsg(null);
    try {
      const amount = parseFloat(String(row.amount).replace(/[^0-9.-]/g, ''));
      if (isNaN(amount) || amount < 0) {
        throw new Error('Nominal harus berupa angka positif');
      }
      const { error } = await supabase
        .from('monthly_overhead')
        .upsert({
          year_month: row.year_month,
          amount,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'year_month' });
      if (error) throw error;
      setOverheadMsg({ type: 'success', text: `Overhead ${row.year_month} berhasil disimpan` });
      setEditingOverhead(null);
      await loadOverhead();
    } catch (err) {
      setOverheadMsg({ type: 'error', text: err.message || 'Gagal menyimpan' });
    } finally {
      setOverheadSaving(false);
    }
  };

  const handleDeleteOverhead = async (id) => {
    if (!confirm('Hapus overhead ini?')) return;
    try {
      const { error } = await supabase.from('monthly_overhead').delete().eq('id', id);
      if (error) throw error;
      setOverheadMsg({ type: 'success', text: 'Overhead dihapus' });
      await loadOverhead();
    } catch (err) {
      setOverheadMsg({ type: 'error', text: err.message || 'Gagal menghapus' });
    }
  };

  const handleUpload = useCallback(async (file) => {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setUploadError('File harus berformat .xlsx');
      return;
    }
    setUploading(true);
    setUploadError('');
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await uploadExcelData(formData);
      invalidateAll(); // Clear dashboard cache so fresh data shows up
      setUploadResult(result);
    } catch (err) {
      setUploadError(err.message || 'Upload gagal');
    } finally {
      setUploading(false);
    }
  }, []);

  const handleRoleChange = async (userId, newRole) => {
    try {
      const tabs = newRole === 'brand_manager' ? ['marketing'] : newRole === 'sales_manager' ? ['channels'] : [];
      await updateUserRole(userId, newRole, tabs, []);
      await refreshUsers();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail || !inviteEmail.includes('@')) {
      setInviteMsg({ type: 'error', text: 'Masukkan email yang valid' });
      return;
    }
    setInviting(true);
    setInviteMsg(null);
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteMsg({ type: 'error', text: data.error || 'Invite gagal' });
      } else {
        setInviteMsg({ type: 'success', text: data.message });
        setInviteEmail('');
        await refreshUsers();
      }
    } catch (err) {
      setInviteMsg({ type: 'error', text: err.message || 'Invite gagal' });
    } finally {
      setInviting(false);
    }
  };

  if (profile?.role !== 'owner' && profile?.role !== 'finance' && profile?.role !== 'staff') {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--dim)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Akses Ditolak</div>
        <div>Hanya Owner dan Finance yang bisa mengakses halaman ini.</div>
      </div>
    );
  }

  const roleLabel = (r) => {
    switch (r) {
      case 'owner': return { text: 'Owner', bg: 'var(--accent-subtle)', color: '#818cf8' };
      case 'admin': return { text: 'Admin', bg: 'var(--badge-green-bg)', color: 'var(--green)' };
      case 'finance': return { text: 'Finance', bg: 'var(--accent-subtle)', color: '#60a5fa' };
      case 'brand_manager': return { text: 'Brand Manager', bg: 'var(--badge-yellow-bg)', color: 'var(--yellow)' };
      case 'sales_manager': return { text: 'Sales Manager', bg: 'var(--accent-subtle)', color: '#c084fc' };
      case 'pending': return { text: 'Menunggu Approval', bg: 'var(--badge-red-bg)', color: 'var(--red)' };
      case 'staff': return { text: 'Staff', bg: 'var(--accent-subtle)', color: '#38bdf8' };
      case 'direktur_operasional': return { text: 'Direktur Ops', bg: 'var(--badge-green-bg)', color: '#34d399' };
      case 'warehouse_manager': return { text: 'WH Manager', bg: 'var(--accent-subtle)', color: '#06b6d4' };
      case 'ppic': return { text: 'PPIC', bg: 'var(--badge-yellow-bg)', color: '#f59e0b' };
      default: return { text: r, bg: 'var(--border)', color: 'var(--dim)' };
    }
  };

  // Filter tabs based on role
  const visibleTabs = TABS.filter(t => {
    if (t.id === 'users' && profile?.role !== 'owner') return false;
    if (t.id === 'brands' && profile?.role !== 'owner') return false;
    if (t.id === 'data_ref' && profile?.role !== 'owner') return false;
    return true;
  });

  return (
    <div className="fade-in">
      {/* Header */}
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Admin</h2>

      {/* Tab Navigation */}
      <div style={{
        display: 'flex', gap: 2, marginBottom: 20,
        borderBottom: '1px solid var(--border)', paddingBottom: 0,
        overflowX: 'auto', WebkitOverflowScrolling: 'touch',
      }}>
        {visibleTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px', background: 'none', border: 'none', whiteSpace: 'nowrap', flexShrink: 0,
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--text)' : 'var(--dim)',
              fontSize: 13, fontWeight: activeTab === tab.id ? 700 : 500,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ TAB: DAILY DATA ═══ */}
      {activeTab === 'daily' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Google Sheets Sync */}
          <SheetManager />

          {/* Excel Upload — only visible with ?advanced=true */}
          {showAdvanced && (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Upload Data Excel</div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>
                Upload file .xlsx. Upload ulang bulan yang sama akan menimpa data sebelumnya.
              </div>
              <div
                className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault(); setDragOver(false);
                  const f = e.dataTransfer.files[0];
                  if (f) handleUpload(f);
                }}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file'; input.accept = '.xlsx,.xls';
                  input.onchange = (e) => { const f = e.target.files[0]; if (f) handleUpload(f); };
                  input.click();
                }}
              >
                {uploading ? (
                  <div>
                    <div className="spinner" style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%', margin: '0 auto 12px' }} />
                    <div style={{ color: 'var(--dim)' }}>Mengupload & memproses data...</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 28, marginBottom: 6 }}>📁</div>
                    <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Drag & drop file Excel di sini</div>
                    <div style={{ fontSize: 11, color: 'var(--dim)' }}>atau klik untuk memilih file</div>
                  </div>
                )}
              </div>
              {uploadResult && (
                <div style={{ marginTop: 12, padding: 12, background: 'var(--badge-green-bg)', borderRadius: 8, color: 'var(--green)', fontSize: 13 }}>
                  ✅ Berhasil! Periode: {uploadResult.period.month}/{uploadResult.period.year}. Data: {uploadResult.counts.dailyProduct} daily, {uploadResult.counts.dailyChannel} channel, {uploadResult.counts.ads} ads.
                </div>
              )}
              {uploadError && (
                <div style={{ marginTop: 12, padding: 12, background: 'var(--badge-red-bg)', borderRadius: 8, color: 'var(--red)', fontSize: 13 }}>
                  ❌ {uploadError}
                </div>
              )}
            </div>
          )}

          {/* CSV Order Upload */}
          <CsvOrderUploader />
        </div>
      )}

      {/* ═══ TAB: META ADS ═══ */}
      {activeTab === 'meta' && (
        <MetaManager />
      )}

      {/* ═══ TAB: FINANCIAL ═══ */}
      {activeTab === 'financial' && (
        <FinancialSheetManager />
      )}

      {/* ═══ TAB: WAREHOUSE ═══ */}
      {activeTab === 'warehouse' && (
        <WarehouseSheetManager />
      )}

      {/* ═══ TAB: BRANDS ═══ */}
      {activeTab === 'brands' && (
        <BrandManager />
      )}

      {/* ═══ TAB: SCALEV API ═══ */}
      {activeTab === 'connection' && (
        <ConnectionManager />
      )}

      {/* ═══ TAB: SYNC ═══ */}
      {activeTab === 'sync' && (
        <SyncManager />
      )}

      {/* ═══ TAB: DATA REFERENCE ═══ */}
      {activeTab === 'data_ref' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Marketplace Commission Rates */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Marketplace Commission Rates</div>
              <button
                onClick={() => setEditingRate({ channel: '', rate: '', effective_from: new Date().toISOString().slice(0, 10), isNew: true })}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600 }}
              >
                + Tambah Rate
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>
              Rate komisi marketplace yang digunakan untuk menghitung biaya admin (mp_admin_cost = net_sales × rate).
              Perubahan rate akan berlaku sesuai tanggal efektif.
            </div>

            {commMsg && (
              <div style={{
                marginBottom: 12, padding: 10, borderRadius: 6, fontSize: 12,
                background: commMsg.type === 'success' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)',
                color: commMsg.type === 'success' ? 'var(--green)' : 'var(--red)'
              }}>
                {commMsg.type === 'success' ? '✅' : '❌'} {commMsg.text}
              </div>
            )}

            {/* Add/Edit Form */}
            {editingRate && (
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: 'var(--text)' }}>
                  {editingRate.isNew ? 'Tambah Rate Baru' : `Edit Rate — ${editingRate.channel}`}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '1 1 140px' }}>
                    <label style={{ fontSize: 10, color: 'var(--dim)', display: 'block', marginBottom: 3 }}>Channel</label>
                    {editingRate.isNew ? (
                      <select
                        value={editingRate.channel}
                        onChange={e => setEditingRate({ ...editingRate, channel: e.target.value })}
                        style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12 }}
                      >
                        <option value="">— Pilih Channel —</option>
                        {['TikTok Shop', 'Shopee', 'Lazada', 'BliBli', 'Tokopedia'].map(ch => (
                          <option key={ch} value={ch}>{ch}</option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ padding: '7px 10px', fontSize: 12, color: 'var(--text-secondary)' }}>{editingRate.channel}</div>
                    )}
                  </div>
                  <div style={{ flex: '0 0 120px' }}>
                    <label style={{ fontSize: 10, color: 'var(--dim)', display: 'block', marginBottom: 3 }}>Rate (desimal)</label>
                    <input
                      type="text"
                      value={editingRate.rate}
                      onChange={e => setEditingRate({ ...editingRate, rate: e.target.value })}
                      placeholder="0.19"
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12, outline: 'none' }}
                    />
                    {editingRate.rate && !isNaN(parseFloat(editingRate.rate)) && (
                      <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>= {(parseFloat(editingRate.rate) * 100).toFixed(2)}%</div>
                    )}
                  </div>
                  <div style={{ flex: '0 0 140px' }}>
                    <label style={{ fontSize: 10, color: 'var(--dim)', display: 'block', marginBottom: 3 }}>Berlaku Sejak</label>
                    <input
                      type="date"
                      value={editingRate.effective_from}
                      onChange={e => setEditingRate({ ...editingRate, effective_from: e.target.value })}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12, outline: 'none' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => handleSaveRate(editingRate)}
                      disabled={commSaving}
                      style={{ padding: '7px 16px', borderRadius: 6, border: 'none', cursor: commSaving ? 'not-allowed' : 'pointer', background: 'var(--green)', color: '#fff', fontSize: 12, fontWeight: 600, opacity: commSaving ? 0.6 : 1 }}
                    >
                      {commSaving ? 'Saving...' : 'Simpan'}
                    </button>
                    <button
                      onClick={() => { setEditingRate(null); setCommMsg(null); }}
                      style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }}
                    >
                      Batal
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Rates Table */}
            {commLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <div className="spinner" style={{ width: 28, height: 28, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%' }} />
              </div>
            ) : commRates.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--dim)', fontSize: 13 }}>Belum ada data commission rate</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg)' }}>
                      {['Channel', 'Rate', 'Berlaku Sejak', 'Aksi'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', borderBottom: '2px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {commRates.map((r) => (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>{r.channel}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{(r.rate * 100).toFixed(2)}%</span>
                          <span style={{ color: 'var(--dim)', marginLeft: 6, fontSize: 10 }}>({r.rate})</span>
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>
                          {new Date(r.effective_from).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => setEditingRate({ channel: r.channel, rate: String(r.rate), effective_from: r.effective_from, isNew: false })}
                              style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: '#60a5fa', fontSize: 11, fontWeight: 500 }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteRate(r.id)}
                              style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid var(--badge-red-bg)', cursor: 'pointer', background: 'transparent', color: 'var(--red)', fontSize: 11, fontWeight: 500 }}
                            >
                              Hapus
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Company PKP Status */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Company PKP Status</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>
              Status Pengusaha Kena Pajak (PKP) per perusahaan. Jika PKP, maka PPN sesuai rate di Tax Rates akan diterapkan.
            </div>

            {bizTaxMsg && (
              <div style={{
                marginBottom: 12, padding: 10, borderRadius: 6, fontSize: 12,
                background: bizTaxMsg.type === 'success' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)',
                color: bizTaxMsg.type === 'success' ? 'var(--green)' : 'var(--red)'
              }}>
                {bizTaxMsg.type === 'success' ? '\u2705' : '\u274c'} {bizTaxMsg.text}
              </div>
            )}

            {bizTaxLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <div className="spinner" style={{ width: 28, height: 28, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%' }} />
              </div>
            ) : bizTaxData.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--dim)', fontSize: 13 }}>Belum ada data bisnis</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg)' }}>
                      {['Perusahaan', 'Kode', 'Status', 'PKP'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', borderBottom: '2px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bizTaxData.map((b) => (
                      <tr key={b.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>{b.business_name}</td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{b.business_code}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: b.is_active ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)', color: b.is_active ? 'var(--green)' : 'var(--red)' }}>
                            {b.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <select
                            value={b.tax_rate_name || 'PPN'}
                            onChange={(e) => handleBizTaxChange(b.id, e.target.value)}
                            disabled={bizTaxSaving}
                            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, cursor: bizTaxSaving ? 'not-allowed' : 'pointer' }}
                          >
                            <option value="PPN">PKP</option>
                            <option value="NONE">Non-PKP</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Business → Warehouse Mapping */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Business → Gudang Mapping</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>
              Mapping bisnis ScaleV ke entity gudang yang stoknya berkurang saat order shipped. Contoh: RTI = marketing, tapi shipment dari gudang RLB.
            </div>

            {whMappingMsg && (
              <div style={{
                marginBottom: 12, padding: 10, borderRadius: 6, fontSize: 12,
                background: whMappingMsg.type === 'success' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)',
                color: whMappingMsg.type === 'success' ? 'var(--green)' : 'var(--red)'
              }}>
                {whMappingMsg.type === 'success' ? '\u2705' : '\u274c'} {whMappingMsg.text}
              </div>
            )}

            {whMappingLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <div className="spinner" style={{ width: 28, height: 28, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%' }} />
              </div>
            ) : whMappingData.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--dim)', fontSize: 13 }}>Belum ada mapping. Jalankan migration 067 terlebih dahulu.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg)' }}>
                      {['Business', 'Kode', 'Deduct dari Gudang', 'Status', 'Catatan'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', borderBottom: '2px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {whMappingData.map((m) => (
                      <tr key={m.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>{m.scalev_webhook_businesses?.business_name || m.business_code}</td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{m.business_code}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <select
                            value={`${m.deduct_warehouse} - ${m.deduct_entity}`}
                            onChange={(e) => {
                              const [wh, ent] = e.target.value.split(' - ');
                              handleWhMappingChange(m.id, 'deduct_warehouse', wh);
                              handleWhMappingChange(m.id, 'deduct_entity', ent);
                            }}
                            disabled={whMappingSaving}
                            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: whMappingSaving ? 'not-allowed' : 'pointer' }}
                          >
                            <option value="BTN - RTI">BTN - RTI</option>
                            <option value="BTN - RLB">BTN - RLB</option>
                            <option value="BTN - RLT">BTN - RLT</option>
                            <option value="BTN - JHN">BTN - JHN</option>
                          </select>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: m.is_active ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)', color: m.is_active ? 'var(--green)' : 'var(--red)', cursor: 'pointer' }}
                            onClick={() => handleWhMappingChange(m.id, 'is_active', !m.is_active)}>
                            {m.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: 11 }}>{m.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Tax Rates (PPN) */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Tax Rates</div>
              <button
                onClick={() => setEditingTax({ name: 'PPN', rate: '', effective_from: new Date().toISOString().slice(0, 10), isNew: true })}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600 }}
              >
                + Tambah Rate
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>
              Tax rate (PPN) yang digunakan untuk konversi harga inklusif pajak ke harga sebelum pajak (before tax).
              Rate disimpan dalam persen (contoh: 11 = 11%). Perubahan rate berlaku sesuai tanggal efektif.
            </div>

            {taxMsg && (
              <div style={{
                marginBottom: 12, padding: 10, borderRadius: 6, fontSize: 12,
                background: taxMsg.type === 'success' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)',
                color: taxMsg.type === 'success' ? 'var(--green)' : 'var(--red)'
              }}>
                {taxMsg.type === 'success' ? '✅' : '❌'} {taxMsg.text}
              </div>
            )}

            {/* Add/Edit Tax Form */}
            {editingTax && (
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: 'var(--text)' }}>
                  {editingTax.isNew ? 'Tambah Tax Rate Baru' : `Edit Tax Rate — ${editingTax.name}`}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '1 1 140px' }}>
                    <label style={{ fontSize: 10, color: 'var(--dim)', display: 'block', marginBottom: 3 }}>Nama</label>
                    <input
                      type="text"
                      value={editingTax.name}
                      onChange={e => setEditingTax({ ...editingTax, name: e.target.value })}
                      placeholder="PPN"
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12, outline: 'none' }}
                    />
                  </div>
                  <div style={{ flex: '0 0 120px' }}>
                    <label style={{ fontSize: 10, color: 'var(--dim)', display: 'block', marginBottom: 3 }}>Rate (%)</label>
                    <input
                      type="text"
                      value={editingTax.rate}
                      onChange={e => setEditingTax({ ...editingTax, rate: e.target.value })}
                      placeholder="11"
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12, outline: 'none' }}
                    />
                    {editingTax.rate && !isNaN(parseFloat(editingTax.rate)) && (
                      <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>Divisor: {(1 + parseFloat(editingTax.rate) / 100).toFixed(4)}</div>
                    )}
                  </div>
                  <div style={{ flex: '0 0 140px' }}>
                    <label style={{ fontSize: 10, color: 'var(--dim)', display: 'block', marginBottom: 3 }}>Berlaku Sejak</label>
                    <input
                      type="date"
                      value={editingTax.effective_from}
                      onChange={e => setEditingTax({ ...editingTax, effective_from: e.target.value })}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12, outline: 'none' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => handleSaveTax(editingTax)}
                      disabled={taxSaving}
                      style={{ padding: '7px 16px', borderRadius: 6, border: 'none', cursor: taxSaving ? 'not-allowed' : 'pointer', background: 'var(--green)', color: '#fff', fontSize: 12, fontWeight: 600, opacity: taxSaving ? 0.6 : 1 }}
                    >
                      {taxSaving ? 'Saving...' : 'Simpan'}
                    </button>
                    <button
                      onClick={() => { setEditingTax(null); setTaxMsg(null); }}
                      style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }}
                    >
                      Batal
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Tax Rates Table */}
            {taxLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <div className="spinner" style={{ width: 28, height: 28, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%' }} />
              </div>
            ) : taxRates.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--dim)', fontSize: 13 }}>Belum ada data tax rate</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg)' }}>
                      {['Nama', 'Rate', 'Divisor', 'Berlaku Sejak', 'Aksi'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', borderBottom: '2px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {taxRates.map((r) => (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>{r.name}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{Number(r.rate).toFixed(1)}%</span>
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                          {(1 + Number(r.rate) / 100).toFixed(4)}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>
                          {new Date(r.effective_from).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => setEditingTax({ name: r.name, rate: String(r.rate), effective_from: r.effective_from, isNew: false })}
                              style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: '#60a5fa', fontSize: 11, fontWeight: 500 }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteTax(r.id)}
                              style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid var(--badge-red-bg)', cursor: 'pointer', background: 'transparent', color: 'var(--red)', fontSize: 11, fontWeight: 500 }}
                            >
                              Hapus
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Formula PPN */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Formula PPN</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Semua channel menggunakan formula divisor: <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>harga ÷ 1.{taxRates.find(t => t.name === 'PPN')?.rate || 11}</span>
            </div>
          </div>

          {/* Monthly Overhead */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Monthly Overhead</div>
              <button
                onClick={() => {
                  const now = new Date();
                  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                  setEditingOverhead({ year_month: ym, amount: '', isNew: true });
                }}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600 }}
              >
                + Set Bulan
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>
              Estimasi biaya overhead bulanan (gaji, sewa, operasional). Digunakan di Tren Harian untuk menghitung Est. Net Profit.
            </div>

            {overheadMsg && (
              <div style={{
                marginBottom: 12, padding: 10, borderRadius: 6, fontSize: 12,
                background: overheadMsg.type === 'success' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)',
                color: overheadMsg.type === 'success' ? 'var(--green)' : 'var(--red)'
              }}>
                {overheadMsg.type === 'success' ? '✅' : '❌'} {overheadMsg.text}
              </div>
            )}

            {/* Add/Edit Overhead Form */}
            {editingOverhead && (
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: 'var(--text)' }}>
                  {editingOverhead.isNew ? 'Set Overhead Bulan Baru' : `Edit Overhead — ${editingOverhead.year_month}`}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '0 0 150px' }}>
                    <label style={{ fontSize: 10, color: 'var(--dim)', display: 'block', marginBottom: 3 }}>Bulan</label>
                    <input
                      type="month"
                      value={editingOverhead.year_month}
                      onChange={e => setEditingOverhead({ ...editingOverhead, year_month: e.target.value })}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12, outline: 'none' }}
                    />
                  </div>
                  <div style={{ flex: '1 1 200px' }}>
                    <label style={{ fontSize: 10, color: 'var(--dim)', display: 'block', marginBottom: 3 }}>Overhead (Rp)</label>
                    <input
                      type="text"
                      value={editingOverhead.amount}
                      onChange={e => setEditingOverhead({ ...editingOverhead, amount: e.target.value })}
                      placeholder="1000000000"
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12, outline: 'none', fontFamily: 'monospace' }}
                    />
                    {editingOverhead.amount && !isNaN(parseFloat(String(editingOverhead.amount).replace(/[^0-9.-]/g, ''))) && (
                      <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>
                        = Rp {parseFloat(String(editingOverhead.amount).replace(/[^0-9.-]/g, '')).toLocaleString('id-ID')}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => handleSaveOverhead(editingOverhead)}
                      disabled={overheadSaving}
                      style={{ padding: '7px 16px', borderRadius: 6, border: 'none', cursor: overheadSaving ? 'not-allowed' : 'pointer', background: 'var(--green)', color: '#fff', fontSize: 12, fontWeight: 600, opacity: overheadSaving ? 0.6 : 1 }}
                    >
                      {overheadSaving ? 'Saving...' : 'Simpan'}
                    </button>
                    <button
                      onClick={() => { setEditingOverhead(null); setOverheadMsg(null); }}
                      style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }}
                    >
                      Batal
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Overhead Table */}
            {overheadLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <div className="spinner" style={{ width: 28, height: 28, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%' }} />
              </div>
            ) : overheadData.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--dim)', fontSize: 13 }}>Belum ada data overhead</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg)' }}>
                      {['Bulan', 'Overhead', 'Per Hari', 'Aksi'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: h === 'Aksi' ? 'left' : h === 'Bulan' ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', borderBottom: '2px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overheadData.map((r) => {
                      const [y, m] = r.year_month.split('-').map(Number);
                      const daysInMonth = new Date(y, m, 0).getDate();
                      const perDay = Number(r.amount) / daysInMonth;
                      return (
                        <tr key={r.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                          <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>
                            {new Date(y, m - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>
                            Rp {Number(r.amount).toLocaleString('id-ID')}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: 11 }}>
                            Rp {Math.round(perDay).toLocaleString('id-ID')}/hari ({daysInMonth}d)
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={() => setEditingOverhead({ year_month: r.year_month, amount: String(r.amount), isNew: false })}
                                style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: '#60a5fa', fontSize: 11, fontWeight: 500 }}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteOverhead(r.id)}
                                style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid var(--badge-red-bg)', cursor: 'pointer', background: 'transparent', color: 'var(--red)', fontSize: 11, fontWeight: 500 }}
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
        </div>
      )}

      {/* ═══ TAB: LOGS ═══ */}
      {activeTab === 'logs' && (() => {
        const WEBHOOK_LABELS = {
          webhook: 'Webhook', webhook_created: 'Order Created', webhook_updated: 'Order Updated',
          webhook_deleted: 'Order Deleted', webhook_status_changed: 'Status Changed',
          webhook_payment_changed: 'Payment Changed', webhook_epayment: 'E-Payment Created',
        };
        const isWebhook = (t) => t === 'webhook' || (t && t.startsWith('webhook_'));
        const buildDetail = (log) => {
          const parts = [];
          if (log.orders_fetched) parts.push(`${log.orders_fetched} rows`);
          if (log.orders_inserted) parts.push(`${log.orders_inserted} baru`);
          if (log.orders_updated) parts.push(`${log.orders_updated} diperkaya`);
          return parts.join(' · ') || '—';
        };
        const merged = [];
        for (const log of logsData) {
          merged.push({
            id: `sync-${log.id}`, time: log.started_at,
            type: log.sync_type === 'csv_upload' ? 'CSV Upload' :
                  log.sync_type === 'ops_upload' ? 'OPS Upload' :
                  isWebhook(log.sync_type) ? 'Webhook' :
                  log.sync_type === 'full' ? 'Scalev Full Sync' :
                  log.sync_type === 'incremental' ? 'Scalev Incremental' : log.sync_type || 'Sync',
            webhookEvent: WEBHOOK_LABELS[log.sync_type] || null,
            status: log.status, detail: buildDetail(log),
            filename: log.filename || null, uploadedBy: log.uploaded_by || null,
            error: log.error_message,
            category: log.sync_type === 'csv_upload' || log.sync_type === 'ops_upload' ? 'csv' :
                      isWebhook(log.sync_type) ? 'webhook' : 'scalev',
          });
        }
        for (const imp of excelImports) {
          merged.push({
            id: `excel-${imp.id}`, time: imp.imported_at, type: 'Excel Upload',
            status: imp.status === 'completed' ? 'success' : imp.status,
            detail: `Periode: ${imp.period_month}/${imp.period_year} — ${imp.row_count || 0} rows`,
            filename: imp.filename || null, uploadedBy: null, error: null, category: 'excel',
          });
        }
        merged.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
        const filtered = logFilter === 'all' ? merged : merged.filter(l => l.category === logFilter);

        const LOG_FILTERS = [
          { id: 'all', label: 'Semua', count: null },
          { id: 'csv', label: 'CSV Upload', count: logsData.filter(l => l.sync_type === 'csv_upload' || l.sync_type === 'ops_upload').length },
          { id: 'webhook', label: 'Webhook', count: logsData.filter(l => isWebhook(l.sync_type)).length },
          { id: 'scalev', label: 'Scalev Sync', count: logsData.filter(l => !isWebhook(l.sync_type) && l.sync_type !== 'csv_upload' && l.sync_type !== 'ops_upload').length },
          { id: 'excel', label: 'Excel Upload', count: excelImports.length },
        ];
        const statusStyle = (s) => {
          switch (s) {
            case 'success': return { bg: 'var(--badge-green-bg)', color: 'var(--green)', label: 'Sukses' };
            case 'partial': return { bg: 'var(--badge-yellow-bg)', color: 'var(--yellow)', label: 'Partial' };
            case 'error': return { bg: 'var(--badge-red-bg)', color: 'var(--red)', label: 'Error' };
            case 'running': return { bg: 'var(--accent-subtle)', color: '#60a5fa', label: 'Running' };
            default: return { bg: 'var(--border)', color: 'var(--dim)', label: s };
          }
        };
        const typeStyle = (t) => {
          if (t.includes('CSV') || t.includes('OPS')) return { bg: 'var(--accent-subtle)', color: '#06b6d4' };
          if (t === 'Webhook' || t.includes('Webhook')) return { bg: 'var(--green-subtle)', color: '#22c55e' };
          if (t.includes('Scalev')) return { bg: 'var(--accent-subtle)', color: '#8b5cf6' };
          if (t.includes('Excel')) return { bg: 'var(--accent-subtle)', color: 'var(--accent)' };
          return { bg: 'var(--border)', color: 'var(--dim)' };
        };

        return (
          <div>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--dim)' }}>Riwayat semua upload dan sync data</p>
            <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
              {LOG_FILTERS.map(f => (
                <button key={f.id} onClick={() => setLogFilter(f.id)} style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid',
                  borderColor: logFilter === f.id ? 'var(--accent)' : 'var(--border)',
                  background: logFilter === f.id ? 'var(--accent-subtle)' : 'transparent',
                  color: logFilter === f.id ? '#60a5fa' : 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>
                  {f.label} {f.count !== null && <span style={{ opacity: 0.7 }}>({f.count})</span>}
                </button>
              ))}
            </div>
            {logsLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                <div className="spinner" style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%' }} />
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--dim)' }}>Belum ada log aktivitas</div>
            ) : (
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg)' }}>
                        {['Waktu', 'Tipe', 'Status', 'Detail', 'File', 'Oleh'].map(h => (
                          <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', borderBottom: '2px solid var(--border)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((log) => {
                        const ss = statusStyle(log.status);
                        const ts = typeStyle(log.type);
                        return (
                          <tr key={log.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                            <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontSize: 11 }}>
                              {new Date(log.time).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, background: ts.bg, color: ts.color }}>{log.type}</span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: ss.bg, color: ss.color }}>{ss.label}</span>
                            </td>
                            <td style={{ padding: '10px 12px', color: 'var(--text)' }}>
                              {log.webhookEvent && (
                                <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 600, background: 'var(--border)', color: 'var(--text-secondary)', marginRight: 6 }}>{log.webhookEvent}</span>
                              )}
                              {log.detail}
                              {log.error && (
                                <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 2, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.error}</div>
                              )}
                            </td>
                            <td style={{ padding: '10px 12px', color: 'var(--dim)', fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.filename || '—'}</td>
                            <td style={{ padding: '10px 12px', color: 'var(--dim)', fontSize: 11 }}>{log.uploadedBy || '—'}</td>
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
      })()}

      {/* ═══ TAB: USERS ═══ */}
      {activeTab === 'users' && profile?.role === 'owner' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Invite Form */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Invite User Baru</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>
              Masukkan email dan pilih role. User akan menerima email untuk set password.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ fontSize: 11, color: 'var(--dim)', display: 'block', marginBottom: 4 }}>Email</label>
                <input
                  type="email" value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="nama@email.com"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, outline: 'none' }}
                />
              </div>
              <div style={{ flex: '0 0 140px' }}>
                <label style={{ fontSize: 11, color: 'var(--dim)', display: 'block', marginBottom: 4 }}>Role</label>
                <select
                  value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}
                >
                  <option value="admin">Admin</option>
                  <option value="finance">Finance</option>
                  <option value="direktur_operasional">Direktur Operasional</option>
                  <option value="warehouse_manager">Warehouse Manager</option>
                  <option value="ppic">PPIC</option>
                  <option value="brand_manager">Brand Manager</option>
                  <option value="sales_manager">Sales Manager</option>
                  <option value="staff">Staff</option>
                </select>
              </div>
              <button
                onClick={handleInvite} disabled={inviting}
                style={{
                  padding: '8px 20px', borderRadius: 6, border: 'none',
                  cursor: inviting ? 'not-allowed' : 'pointer',
                  background: inviting ? 'var(--border)' : 'var(--accent)', color: '#fff',
                  fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                  opacity: inviting ? 0.6 : 1
                }}
              >
                {inviting ? 'Mengundang...' : '+ Invite'}
              </button>
            </div>
            {inviteMsg && (
              <div style={{
                marginTop: 10, padding: 10, borderRadius: 6, fontSize: 12,
                background: inviteMsg.type === 'success' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)',
                color: inviteMsg.type === 'success' ? 'var(--green)' : 'var(--red)'
              }}>
                {inviteMsg.type === 'success' ? '✅' : '❌'} {inviteMsg.text}
              </div>
            )}
          </div>

          {/* Role Legend */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10 }}>
            {['owner', 'admin', 'finance', 'direktur_operasional', 'warehouse_manager', 'ppic', 'staff', 'brand_manager', 'sales_manager', 'pending'].map(r => {
              const rl = roleLabel(r);
              const desc = r === 'owner' ? 'akses penuh' : r === 'admin' ? 'read-only' : r === 'finance' ? 'sync/upload' : r === 'direktur_operasional' ? 'semua + notif gudang' : r === 'warehouse_manager' ? 'gudang ops' : r === 'ppic' ? 'stock masuk' : r === 'brand_manager' ? 'marketing' : r === 'sales_manager' ? 'channel' : r === 'staff' ? 'admin only' : 'pending';
              return (
                <span key={r} style={{ padding: '2px 8px', borderRadius: 5, background: rl.bg, color: rl.color, fontWeight: 600 }}>
                  {rl.text} — {desc}
                </span>
              );
            })}
          </div>

          {/* User List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {users.map((u) => {
              const rl = roleLabel(u.role);
              return (
                <div key={u.id} style={{
                  padding: 14, background: 'var(--card)', borderRadius: 8,
                  border: u.role === 'pending' ? '1px solid var(--badge-red-bg)' : '1px solid var(--border)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  flexWrap: 'wrap', gap: 8
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{u.email}</div>
                    <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: rl.bg, color: rl.color }}>
                      {rl.text}
                    </span>
                  </div>
                  {u.id !== profile?.id && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {u.role === 'pending' ? (
                        <>
                          <button onClick={() => handleRoleChange(u.id, 'staff')} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--accent-subtle)', color: '#38bdf8', fontSize: 12, fontWeight: 600 }}>✓ Staff</button>
                          <button onClick={() => handleRoleChange(u.id, 'admin')} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--badge-green-bg)', color: 'var(--green)', fontSize: 12, fontWeight: 600 }}>✓ Admin</button>
                          <button onClick={() => handleRoleChange(u.id, 'finance')} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--accent-subtle)', color: '#60a5fa', fontSize: 12, fontWeight: 600 }}>✓ Finance</button>
                          <button onClick={() => handleRoleChange(u.id, 'brand_manager')} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 12, fontWeight: 600 }}>✓ Brand Manager</button>
                          <button onClick={() => handleRoleChange(u.id, 'sales_manager')} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--accent-subtle)', color: '#c084fc', fontSize: 12, fontWeight: 600 }}>✓ Sales Manager</button>
                        </>
                      ) : (
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12 }}
                        >
                          <option value="staff">Staff</option>
                          <option value="admin">Admin</option>
                          <option value="finance">Finance</option>
                          <option value="direktur_operasional">Direktur Operasional</option>
                          <option value="warehouse_manager">Warehouse Manager</option>
                          <option value="ppic">PPIC</option>
                          <option value="brand_manager">Brand Manager</option>
                          <option value="sales_manager">Sales Manager</option>
                          <option value="pending">Revoke Access</option>
                        </select>
                      )}
                      {/* Telegram Chat ID */}
                      {u.role === 'direktur_operasional' && (
                        <input
                          type="text"
                          placeholder="Telegram Chat ID"
                          defaultValue={u.telegram_chat_id || ''}
                          onBlur={async (e) => {
                            const val = e.target.value.trim();
                            try {
                              await supabase.from('profiles').update({ telegram_chat_id: val || null }).eq('id', u.id);
                            } catch {}
                          }}
                          style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, width: 140 }}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// @ts-nocheck
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSupabase } from '@/lib/supabase-browser';
import { uploadExcelData, fetchAllUsers, updateUserRole } from '@/lib/actions';
import { invalidateAll } from '@/lib/dashboard-cache';
import SheetManager from '@/components/SheetManager';
import ScalevManager from '@/components/ScalevManager';
import FinancialSheetManager from '@/components/FinancialSheetManager';
import CsvOrderUploader from '@/components/CsvOrderUploader';
import BrandManager from '@/components/BrandManager';
import MetaManager from '@/components/MetaManager';

const TABS = [
  { id: 'daily', label: 'Daily Data' },
  { id: 'meta', label: 'Meta Ads' },
  { id: 'financial', label: 'Financial' },
  { id: 'brands', label: 'Brands' },
  { id: 'scalev', label: 'Scalev API' },
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

  useEffect(() => {
    if (activeTab === 'data_ref' && commRates.length === 0) loadCommRates();
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
      // Trigger MV refresh so mp_admin_cost recalculates
      supabase.rpc('refresh_order_views', { use_concurrent: true }).then(() => {}).catch(() => {});
    } catch (err) {
      setCommMsg({ type: 'error', text: err.message || 'Gagal menyimpan' });
    } finally {
      setCommSaving(false);
    }
  };

  const handleDeleteRate = async (id) => {
    if (!confirm('Hapus rate ini? Data mp_admin_cost yang sudah dihitung tidak akan berubah sampai views di-refresh.')) return;
    try {
      const { error } = await supabase.from('marketplace_commission_rates').delete().eq('id', id);
      if (error) throw error;
      setCommMsg({ type: 'success', text: 'Rate dihapus' });
      await loadCommRates();
    } catch (err) {
      setCommMsg({ type: 'error', text: err.message || 'Gagal menghapus' });
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
      <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Akses Ditolak</div>
        <div>Hanya Owner dan Finance yang bisa mengakses halaman ini.</div>
      </div>
    );
  }

  const roleLabel = (r) => {
    switch (r) {
      case 'owner': return { text: 'Owner', bg: '#312e81', color: '#818cf8' };
      case 'admin': return { text: 'Admin', bg: '#064e3b', color: '#10b981' };
      case 'finance': return { text: 'Finance', bg: '#1e3a5f', color: '#60a5fa' };
      case 'brand_manager': return { text: 'Brand Manager', bg: '#78350f', color: '#f59e0b' };
      case 'sales_manager': return { text: 'Sales Manager', bg: '#4a1d6e', color: '#c084fc' };
      case 'pending': return { text: 'Menunggu Approval', bg: '#7f1d1d', color: '#ef4444' };
      case 'staff': return { text: 'Staff', bg: '#1e3a5f', color: '#38bdf8' };
      default: return { text: r, bg: '#1a2744', color: '#64748b' };
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
        borderBottom: '1px solid #1a2744', paddingBottom: 0,
      }}>
        {visibleTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px', background: 'none', border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
              color: activeTab === tab.id ? '#e2e8f0' : '#64748b',
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
            <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Upload Data Excel</div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
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
                    <div className="spinner" style={{ width: 32, height: 32, border: '3px solid #1a2744', borderTop: '3px solid #3b82f6', borderRadius: '50%', margin: '0 auto 12px' }} />
                    <div style={{ color: '#64748b' }}>Mengupload & memproses data...</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 28, marginBottom: 6 }}>📁</div>
                    <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Drag & drop file Excel di sini</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>atau klik untuk memilih file</div>
                  </div>
                )}
              </div>
              {uploadResult && (
                <div style={{ marginTop: 12, padding: 12, background: '#064e3b', borderRadius: 8, color: '#10b981', fontSize: 13 }}>
                  ✅ Berhasil! Periode: {uploadResult.period.month}/{uploadResult.period.year}. Data: {uploadResult.counts.dailyProduct} daily, {uploadResult.counts.dailyChannel} channel, {uploadResult.counts.ads} ads.
                </div>
              )}
              {uploadError && (
                <div style={{ marginTop: 12, padding: 12, background: '#7f1d1d', borderRadius: 8, color: '#ef4444', fontSize: 13 }}>
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

      {/* ═══ TAB: BRANDS ═══ */}
      {activeTab === 'brands' && (
        <BrandManager />
      )}

      {/* ═══ TAB: SCALEV API ═══ */}
      {activeTab === 'scalev' && (
        <ScalevManager />
      )}

      {/* ═══ TAB: DATA REFERENCE ═══ */}
      {activeTab === 'data_ref' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Marketplace Commission Rates */}
          <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Marketplace Commission Rates</div>
              <button
                onClick={() => setEditingRate({ channel: '', rate: '', effective_from: new Date().toISOString().slice(0, 10), isNew: true })}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#3b82f6', color: '#fff', fontSize: 12, fontWeight: 600 }}
              >
                + Tambah Rate
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
              Rate komisi marketplace yang digunakan untuk menghitung biaya admin (mp_admin_cost = net_sales × rate).
              Perubahan rate akan berlaku sesuai tanggal efektif.
            </div>

            {commMsg && (
              <div style={{
                marginBottom: 12, padding: 10, borderRadius: 6, fontSize: 12,
                background: commMsg.type === 'success' ? '#064e3b' : '#7f1d1d',
                color: commMsg.type === 'success' ? '#10b981' : '#ef4444'
              }}>
                {commMsg.type === 'success' ? '✅' : '❌'} {commMsg.text}
              </div>
            )}

            {/* Add/Edit Form */}
            {editingRate && (
              <div style={{ background: '#0b1121', border: '1px solid #1a2744', borderRadius: 8, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: '#e2e8f0' }}>
                  {editingRate.isNew ? 'Tambah Rate Baru' : `Edit Rate — ${editingRate.channel}`}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '1 1 140px' }}>
                    <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Channel</label>
                    {editingRate.isNew ? (
                      <select
                        value={editingRate.channel}
                        onChange={e => setEditingRate({ ...editingRate, channel: e.target.value })}
                        style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #1a2744', background: '#111a2e', color: '#e2e8f0', fontSize: 12 }}
                      >
                        <option value="">— Pilih Channel —</option>
                        {['TikTok', 'Shopee', 'Lazada', 'BliBli', 'Tokopedia'].map(ch => (
                          <option key={ch} value={ch}>{ch}</option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ padding: '7px 10px', fontSize: 12, color: '#94a3b8' }}>{editingRate.channel}</div>
                    )}
                  </div>
                  <div style={{ flex: '0 0 120px' }}>
                    <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Rate (desimal)</label>
                    <input
                      type="text"
                      value={editingRate.rate}
                      onChange={e => setEditingRate({ ...editingRate, rate: e.target.value })}
                      placeholder="0.19"
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #1a2744', background: '#111a2e', color: '#e2e8f0', fontSize: 12, outline: 'none' }}
                    />
                    {editingRate.rate && !isNaN(parseFloat(editingRate.rate)) && (
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>= {(parseFloat(editingRate.rate) * 100).toFixed(2)}%</div>
                    )}
                  </div>
                  <div style={{ flex: '0 0 140px' }}>
                    <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Berlaku Sejak</label>
                    <input
                      type="date"
                      value={editingRate.effective_from}
                      onChange={e => setEditingRate({ ...editingRate, effective_from: e.target.value })}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #1a2744', background: '#111a2e', color: '#e2e8f0', fontSize: 12, outline: 'none' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => handleSaveRate(editingRate)}
                      disabled={commSaving}
                      style={{ padding: '7px 16px', borderRadius: 6, border: 'none', cursor: commSaving ? 'not-allowed' : 'pointer', background: '#10b981', color: '#fff', fontSize: 12, fontWeight: 600, opacity: commSaving ? 0.6 : 1 }}
                    >
                      {commSaving ? 'Saving...' : 'Simpan'}
                    </button>
                    <button
                      onClick={() => { setEditingRate(null); setCommMsg(null); }}
                      style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid #1a2744', cursor: 'pointer', background: 'transparent', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}
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
                <div className="spinner" style={{ width: 28, height: 28, border: '3px solid #1a2744', borderTop: '3px solid #3b82f6', borderRadius: '50%' }} />
              </div>
            ) : commRates.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#64748b', fontSize: 13 }}>Belum ada data commission rate</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#0b1121' }}>
                      {['Channel', 'Rate', 'Berlaku Sejak', 'Aksi'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', borderBottom: '2px solid #1a2744' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {commRates.map((r) => (
                      <tr key={r.id} style={{ borderBottom: '1px solid #0f172a' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: '#e2e8f0' }}>{r.channel}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{(r.rate * 100).toFixed(2)}%</span>
                          <span style={{ color: '#64748b', marginLeft: 6, fontSize: 10 }}>({r.rate})</span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#94a3b8' }}>
                          {new Date(r.effective_from).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => setEditingRate({ channel: r.channel, rate: String(r.rate), effective_from: r.effective_from, isNew: false })}
                              style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid #1a2744', cursor: 'pointer', background: 'transparent', color: '#60a5fa', fontSize: 11, fontWeight: 500 }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteRate(r.id)}
                              style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid #7f1d1d', cursor: 'pointer', background: 'transparent', color: '#ef4444', fontSize: 11, fontWeight: 500 }}
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
            case 'success': return { bg: '#064e3b', color: '#10b981', label: 'Sukses' };
            case 'partial': return { bg: '#78350f', color: '#f59e0b', label: 'Partial' };
            case 'error': return { bg: '#7f1d1d', color: '#ef4444', label: 'Error' };
            case 'running': return { bg: '#1e3a5f', color: '#60a5fa', label: 'Running' };
            default: return { bg: '#1a2744', color: '#64748b', label: s };
          }
        };
        const typeStyle = (t) => {
          if (t.includes('CSV') || t.includes('OPS')) return { bg: '#164e63', color: '#06b6d4' };
          if (t === 'Webhook' || t.includes('Webhook')) return { bg: '#14532d', color: '#22c55e' };
          if (t.includes('Scalev')) return { bg: '#2e1065', color: '#8b5cf6' };
          if (t.includes('Excel')) return { bg: '#1e3a5f', color: '#3b82f6' };
          return { bg: '#1a2744', color: '#64748b' };
        };

        return (
          <div>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#64748b' }}>Riwayat semua upload dan sync data</p>
            <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
              {LOG_FILTERS.map(f => (
                <button key={f.id} onClick={() => setLogFilter(f.id)} style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid',
                  borderColor: logFilter === f.id ? '#3b82f6' : '#1a2744',
                  background: logFilter === f.id ? 'rgba(59,130,246,0.12)' : 'transparent',
                  color: logFilter === f.id ? '#60a5fa' : '#94a3b8',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>
                  {f.label} {f.count !== null && <span style={{ opacity: 0.7 }}>({f.count})</span>}
                </button>
              ))}
            </div>
            {logsLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                <div className="spinner" style={{ width: 32, height: 32, border: '3px solid #1a2744', borderTop: '3px solid #3b82f6', borderRadius: '50%' }} />
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Belum ada log aktivitas</div>
            ) : (
              <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
                    <thead>
                      <tr style={{ background: '#0b1121' }}>
                        {['Waktu', 'Tipe', 'Status', 'Detail', 'File', 'Oleh'].map(h => (
                          <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', borderBottom: '2px solid #1a2744' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((log) => {
                        const ss = statusStyle(log.status);
                        const ts = typeStyle(log.type);
                        return (
                          <tr key={log.id} style={{ borderBottom: '1px solid #0f172a' }}>
                            <td style={{ padding: '10px 12px', color: '#94a3b8', whiteSpace: 'nowrap', fontSize: 11 }}>
                              {new Date(log.time).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, background: ts.bg, color: ts.color }}>{log.type}</span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: ss.bg, color: ss.color }}>{ss.label}</span>
                            </td>
                            <td style={{ padding: '10px 12px', color: '#e2e8f0' }}>
                              {log.webhookEvent && (
                                <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 600, background: '#1a2744', color: '#94a3b8', marginRight: 6 }}>{log.webhookEvent}</span>
                              )}
                              {log.detail}
                              {log.error && (
                                <div style={{ fontSize: 10, color: '#ef4444', marginTop: 2, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.error}</div>
                              )}
                            </td>
                            <td style={{ padding: '10px 12px', color: '#64748b', fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.filename || '—'}</td>
                            <td style={{ padding: '10px 12px', color: '#64748b', fontSize: 11 }}>{log.uploadedBy || '—'}</td>
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
          <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Invite User Baru</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
              Masukkan email dan pilih role. User akan menerima email untuk set password.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Email</label>
                <input
                  type="email" value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="nama@email.com"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #1a2744', background: '#0b1121', color: '#e2e8f0', fontSize: 13, outline: 'none' }}
                />
              </div>
              <div style={{ flex: '0 0 140px' }}>
                <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Role</label>
                <select
                  value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #1a2744', background: '#0b1121', color: '#e2e8f0', fontSize: 13 }}
                >
                  <option value="admin">Admin</option>
                  <option value="finance">Finance</option>
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
                  background: inviting ? '#1a2744' : '#3b82f6', color: '#fff',
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
                background: inviteMsg.type === 'success' ? '#064e3b' : '#7f1d1d',
                color: inviteMsg.type === 'success' ? '#10b981' : '#ef4444'
              }}>
                {inviteMsg.type === 'success' ? '✅' : '❌'} {inviteMsg.text}
              </div>
            )}
          </div>

          {/* Role Legend */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10 }}>
            {['owner', 'admin', 'finance', 'staff', 'brand_manager', 'sales_manager', 'pending'].map(r => {
              const rl = roleLabel(r);
              const desc = r === 'owner' ? 'akses penuh' : r === 'admin' ? 'read-only' : r === 'finance' ? 'sync/upload' : r === 'brand_manager' ? 'marketing' : r === 'sales_manager' ? 'channel' : r === 'staff' ? 'staff' : 'pending';
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
                  padding: 14, background: '#111a2e', borderRadius: 8,
                  border: u.role === 'pending' ? '1px solid #7f1d1d' : '1px solid #1a2744',
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
                          <button onClick={() => handleRoleChange(u.id, 'admin')} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#064e3b', color: '#10b981', fontSize: 12, fontWeight: 600 }}>✓ Admin</button>
                          <button onClick={() => handleRoleChange(u.id, 'finance')} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#1e3a5f', color: '#60a5fa', fontSize: 12, fontWeight: 600 }}>✓ Finance</button>
                          <button onClick={() => handleRoleChange(u.id, 'brand_manager')} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#78350f', color: '#f59e0b', fontSize: 12, fontWeight: 600 }}>✓ Brand Manager</button>
                          <button onClick={() => handleRoleChange(u.id, 'sales_manager')} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#4a1d6e', color: '#c084fc', fontSize: 12, fontWeight: 600 }}>✓ Sales Manager</button>
                        </>
                      ) : (
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #1a2744', background: '#0b1121', color: '#e2e8f0', fontSize: 12 }}
                        >
                          <option value="staff">Staff</option>
                          <option value="admin">Admin</option>
                          <option value="finance">Finance</option>
                          <option value="brand_manager">Brand Manager</option>
                          <option value="sales_manager">Sales Manager</option>
                          <option value="pending">Revoke Access</option>
                        </select>
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

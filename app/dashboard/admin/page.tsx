// @ts-nocheck
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { uploadExcelData, fetchAllUsers, updateUserRole } from '@/lib/actions';
import {
  deleteCommissionRate,
  deleteMonthlyOverhead,
  deleteTaxRate,
  getAdminBootstrap,
  getAdminDataReferenceSnapshot,
  getAdminLogsSnapshot,
  updateTelegramChatId,
  saveCommissionRate,
  saveMonthlyOverhead,
  saveRolePermissionsMatrix,
  saveTaxRate,
  getRolePermissionsMatrix,
} from '@/lib/admin-actions';
import { MATRIX_ROLES, PERMISSION_GROUPS } from '@/lib/utils';
import { usePermissions } from '@/lib/PermissionsContext';
import { invalidateAll } from '@/lib/dashboard-cache';
import SheetManager from '@/components/SheetManager';
import SyncManager from '@/components/SyncManager';
import FinancialSheetManager from '@/components/FinancialSheetManager';
import CsvOrderUploader from '@/components/CsvOrderUploader';
import MetaManager from '@/components/MetaManager';
import WarehouseSheetManager from '@/components/WarehouseSheetManager';

const TABS = [
  { id: 'daily', label: 'Daily Data' },
  { id: 'meta', label: 'Meta Ads' },
  { id: 'financial', label: 'Financial' },
  { id: 'warehouse', label: 'Warehouse' },
  // Connection + PKP moved to Business Settings
  { id: 'sync', label: 'Sync' },
  { id: 'data_ref', label: 'Data Reference' },
  { id: 'users', label: 'Users' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'logs', label: 'Logs' },
];

export default function AdminPage() {
  const { can } = usePermissions();
  const searchParams = useSearchParams();
  const showAdvanced = searchParams.get('advanced') === 'true';

  const [profile, setProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('daily');
  const [bootstrapping, setBootstrapping] = useState(true);

  // Upload states
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  // Logs states
  const [logsData, setLogsData] = useState([]);
  const [excelImports, setExcelImports] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [logsInitialized, setLogsInitialized] = useState(false);
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
  const [dataRefInitialized, setDataRefInitialized] = useState(false);

  // User management states
  const [users, setUsers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('admin');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState(null);

  const visibleTabs = TABS.filter((tab) => {
    if ((tab.id === 'users' || tab.id === 'permissions') && profile?.role !== 'owner') return false;
    if (tab.id === 'data_ref' && profile?.role !== 'owner') return false;
    if (profile?.role === 'owner') return true;
    return can(`admin:${tab.id}`);
  });

  const currentTabId = visibleTabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : visibleTabs[0]?.id || activeTab;

  useEffect(() => {
    let mounted = true;

    async function init() {
      setBootstrapping(true);
      try {
        const bootstrap = await getAdminBootstrap();
        if (!mounted) return;
        setProfile(bootstrap.profile);
        setUsers(bootstrap.users || []);
      } catch (err) {
        console.error('Failed to bootstrap admin page:', err);
        if (mounted) setProfile(null);
      } finally {
        if (mounted) setBootstrapping(false);
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (visibleTabs.length > 0 && currentTabId !== activeTab) {
      setActiveTab(currentTabId);
    }
  }, [activeTab, currentTabId, visibleTabs.length]);

  const refreshUsers = useCallback(async () => {
    const allUsers = await fetchAllUsers();
    setUsers(allUsers || []);
  }, []);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError('');
    try {
      const snapshot = await getAdminLogsSnapshot();
      setLogsData(snapshot.syncLogs || []);
      setExcelImports(snapshot.imports || []);
    } catch (err) {
      console.error('Failed to load logs:', err);
      setLogsError(err.message || 'Gagal memuat log aktivitas');
    } finally {
      setLogsLoading(false);
    }
  }, []);

  // Load logs when tab becomes active
  useEffect(() => {
    if (currentTabId !== 'logs' || logsInitialized) return;
    setLogsInitialized(true);
    void loadLogs();
  }, [currentTabId, loadLogs, logsInitialized]);

  const loadDataReference = useCallback(async () => {
    setCommLoading(true);
    setTaxLoading(true);
    setOverheadLoading(true);
    try {
      const snapshot = await getAdminDataReferenceSnapshot();
      setCommRates(snapshot.commRates || []);
      setTaxRates(snapshot.taxRates || []);
      setOverheadData(snapshot.overheadData || []);
      setCommMsg(null);
      setTaxMsg(null);
      setOverheadMsg(null);
    } catch (err) {
      console.error('Failed to load data reference:', err);
      const message = err.message || 'Gagal memuat data reference';
      setCommMsg({ type: 'error', text: message });
      setTaxMsg({ type: 'error', text: message });
      setOverheadMsg({ type: 'error', text: message });
    } finally {
      setCommLoading(false);
      setTaxLoading(false);
      setOverheadLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentTabId !== 'data_ref' || dataRefInitialized) return;
    setDataRefInitialized(true);
    void loadDataReference();
  }, [currentTabId, dataRefInitialized, loadDataReference]);

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
      await saveCommissionRate({
        channel: row.channel,
        rate: rateNum,
        effective_from: row.effective_from,
      });
      setCommMsg({ type: 'success', text: `Rate ${row.channel} berhasil disimpan` });
      setEditingRate(null);
      await loadDataReference();
    } catch (err) {
      setCommMsg({ type: 'error', text: err.message || 'Gagal menyimpan' });
    } finally {
      setCommSaving(false);
    }
  };

  const handleDeleteRate = async (id) => {
    if (!confirm('Hapus rate ini? Data mp_admin_cost akan otomatis dihitung ulang.')) return;
    try {
      await deleteCommissionRate(id);
      setCommMsg({ type: 'success', text: 'Rate dihapus' });
      await loadDataReference();
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
      await saveTaxRate({
        name: row.name.trim(),
        rate: rateNum,
        effective_from: row.effective_from,
      });
      setTaxMsg({ type: 'success', text: `Tax rate ${row.name} berhasil disimpan` });
      setEditingTax(null);
      await loadDataReference();
    } catch (err) {
      setTaxMsg({ type: 'error', text: err.message || 'Gagal menyimpan' });
    } finally {
      setTaxSaving(false);
    }
  };

  const handleDeleteTax = async (id) => {
    if (!confirm('Hapus tax rate ini?')) return;
    try {
      await deleteTaxRate(id);
      setTaxMsg({ type: 'success', text: 'Tax rate dihapus' });
      await loadDataReference();
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
      await saveMonthlyOverhead({
        year_month: row.year_month,
        amount,
      });
      setOverheadMsg({ type: 'success', text: `Overhead ${row.year_month} berhasil disimpan` });
      setEditingOverhead(null);
      await loadDataReference();
    } catch (err) {
      setOverheadMsg({ type: 'error', text: err.message || 'Gagal menyimpan' });
    } finally {
      setOverheadSaving(false);
    }
  };

  const handleDeleteOverhead = async (id) => {
    if (!confirm('Hapus overhead ini?')) return;
    try {
      await deleteMonthlyOverhead(id);
      setOverheadMsg({ type: 'success', text: 'Overhead dihapus' });
      await loadDataReference();
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
    const normalizedInviteEmail = inviteEmail.trim().toLowerCase();

    if (!normalizedInviteEmail || !normalizedInviteEmail.includes('@')) {
      setInviteMsg({ type: 'error', text: 'Masukkan email yang valid' });
      return;
    }
    setInviting(true);
    setInviteMsg(null);
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedInviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteMsg({ type: 'error', text: data.error || 'Invite gagal' });
      } else {
        setInviteMsg({
          type: data.partial ? 'warning' : 'success',
          text: data.message,
          link: data.recoveryLink || null,
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
          copyStatus: null,
        });
        setInviteEmail('');
        await refreshUsers();
      }
    } catch (err) {
      setInviteMsg({ type: 'error', text: err.message || 'Invite gagal' });
    } finally {
      setInviting(false);
    }
  };

  const roleLabel = (r) => {
    switch (r) {
      case 'owner':              return { text: 'Owner',             bg: 'var(--accent-subtle)',    color: '#818cf8' };
      case 'admin':              return { text: 'Admin',             bg: 'var(--badge-green-bg)',   color: 'var(--green)' };
      case 'direktur_ops':       return { text: 'Direktur Ops',      bg: 'var(--badge-green-bg)',   color: '#34d399' };
      case 'staf_ops':           return { text: 'Staf Ops',          bg: 'var(--accent-subtle)',    color: '#38bdf8' };
      case 'direktur_finance':   return { text: 'Direktur Finance',  bg: 'var(--accent-subtle)',    color: '#60a5fa' };
      case 'staf_finance':       return { text: 'Staf Finance',      bg: 'var(--accent-subtle)',    color: '#93c5fd' };
      case 'brand_manager':      return { text: 'Brand Manager',     bg: 'var(--badge-yellow-bg)',  color: 'var(--yellow)' };
      case 'sales_manager':      return { text: 'Sales Manager',     bg: 'var(--accent-subtle)',    color: '#c084fc' };
      case 'warehouse_manager':  return { text: 'WH Manager',        bg: 'var(--accent-subtle)',    color: '#06b6d4' };
      case 'ppic_manager':       return { text: 'PPIC Manager',      bg: 'var(--badge-yellow-bg)',  color: '#f59e0b' };
      case 'pending':            return { text: 'Menunggu Approval', bg: 'var(--badge-red-bg)',     color: 'var(--red)' };
      // legacy fallbacks
      case 'finance':            return { text: 'Finance (lama)',    bg: 'var(--accent-subtle)',    color: '#60a5fa' };
      case 'staff':              return { text: 'Staff (lama)',      bg: 'var(--accent-subtle)',    color: '#38bdf8' };
      case 'direktur_operasional': return { text: 'Dir. Ops (lama)',  bg: 'var(--badge-green-bg)',  color: '#34d399' };
      case 'ppic':               return { text: 'PPIC (lama)',       bg: 'var(--badge-yellow-bg)',  color: '#f59e0b' };
      default: return { text: r, bg: 'var(--border)', color: 'var(--dim)' };
    }
  };

  if (bootstrapping) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <div className="spinner" style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%' }} />
      </div>
    );
  }

  if (!profile?.role || profile.role === 'pending') {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--dim)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Akses Ditolak</div>
        <div>Anda tidak memiliki akses ke halaman ini.</div>
      </div>
    );
  }

  if (visibleTabs.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--dim)' }}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>🛡️</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Akses Admin Belum Tersedia</div>
        <div>Akun ini belum memiliki izin sub-tab Admin yang bisa dibuka.</div>
      </div>
    );
  }

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
              borderBottom: currentTabId === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: currentTabId === tab.id ? 'var(--text)' : 'var(--dim)',
              fontSize: 13, fontWeight: currentTabId === tab.id ? 700 : 500,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ TAB: DAILY DATA ═══ */}
      {currentTabId === 'daily' && (
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
      {currentTabId === 'meta' && (
        <MetaManager />
      )}

      {/* ═══ TAB: FINANCIAL ═══ */}
      {currentTabId === 'financial' && (
        <FinancialSheetManager />
      )}

      {/* ═══ TAB: WAREHOUSE ═══ */}
      {currentTabId === 'warehouse' && (
        <WarehouseSheetManager />
      )}

      {/* Connection + PKP moved to Business Settings */}

      {/* ═══ TAB: SYNC ═══ */}
      {currentTabId === 'sync' && (
        <SyncManager />
      )}

      {/* ═══ TAB: DATA REFERENCE ═══ */}
      {currentTabId === 'data_ref' && (
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

          {/* Company PKP + Warehouse Mapping moved to Business Settings */}

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
      {currentTabId === 'logs' && (() => {
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
            ) : logsError ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--red)' }}>{logsError}</div>
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
      {currentTabId === 'users' && profile?.role === 'owner' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Invite Form */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Invite User Baru</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>
              Masukkan email dan pilih role. Setelah user dibuat, link set password akan disiapkan untuk dibagikan.
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
                  {MATRIX_ROLES.map(mr => (
                    <option key={mr.id} value={mr.id}>{mr.label}</option>
                  ))}
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
                background: inviteMsg.type === 'success'
                  ? 'var(--badge-green-bg)'
                  : inviteMsg.type === 'warning'
                    ? 'var(--badge-yellow-bg)'
                    : 'var(--badge-red-bg)',
                color: inviteMsg.type === 'success'
                  ? 'var(--green)'
                  : inviteMsg.type === 'warning'
                    ? 'var(--badge-yellow-text)'
                    : 'var(--red)'
              }}>
                <div>
                  {inviteMsg.type === 'success' ? '✅' : inviteMsg.type === 'warning' ? '⚠️' : '❌'} {inviteMsg.text}
                </div>
                {inviteMsg.warnings?.length > 0 && (
                  <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                    {inviteMsg.warnings.map((warning, idx) => (
                      <div key={idx}>- {warning}</div>
                    ))}
                  </div>
                )}
                {inviteMsg.link && (
                  <div style={{
                    marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)',
                    display: 'grid', gap: 8
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--dim)' }}>Link set password</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <input
                        readOnly
                        value={inviteMsg.link}
                        style={{
                          flex: '1 1 360px', minWidth: 0, padding: '8px 10px',
                          borderRadius: 6, border: '1px solid var(--border)',
                          background: 'var(--bg)', color: 'var(--text)', fontSize: 11
                        }}
                      />
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(inviteMsg.link);
                            setInviteMsg(prev => prev ? { ...prev, copyStatus: 'Link berhasil dicopy.' } : prev);
                          } catch {
                            setInviteMsg(prev => prev ? { ...prev, copyStatus: 'Gagal copy otomatis. Silakan copy manual.' } : prev);
                          }
                        }}
                        style={{
                          padding: '8px 12px', borderRadius: 6, border: 'none',
                          cursor: 'pointer', background: 'var(--accent)', color: '#fff',
                          fontSize: 12, fontWeight: 600
                        }}
                      >
                        Copy Link
                      </button>
                    </div>
                    {inviteMsg.copyStatus && (
                      <div style={{ fontSize: 11, color: 'var(--dim)' }}>{inviteMsg.copyStatus}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Role Legend */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10 }}>
            {[
              { r: 'owner',             desc: 'akses penuh' },
              { r: 'admin',             desc: 'lihat semua, atur via matrix' },
              { r: 'direktur_ops',      desc: 'operasional + notif gudang' },
              { r: 'staf_ops',          desc: 'akses via matrix' },
              { r: 'direktur_finance',  desc: 'finance + laporan' },
              { r: 'staf_finance',      desc: 'akses via matrix' },
              { r: 'brand_manager',     desc: 'marketing & brand' },
              { r: 'sales_manager',     desc: 'channel & sales' },
              { r: 'warehouse_manager', desc: 'gudang ops' },
              { r: 'ppic_manager',      desc: 'PPIC & stock masuk' },
              { r: 'pending',           desc: 'belum disetujui' },
            ].map(({ r, desc }) => {
              const rl = roleLabel(r);
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
                          {MATRIX_ROLES.map(mr => {
                            const rl = roleLabel(mr.id);
                            return (
                              <button key={mr.id} onClick={() => handleRoleChange(u.id, mr.id)}
                                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: rl.bg, color: rl.color, fontSize: 12, fontWeight: 600 }}>
                                ✓ {mr.label}
                              </button>
                            );
                          })}
                        </>
                      ) : (
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12 }}
                        >
                          {MATRIX_ROLES.map(mr => (
                            <option key={mr.id} value={mr.id}>{mr.label}</option>
                          ))}
                          <option value="pending">Revoke Access</option>
                        </select>
                      )}
                      {/* Telegram Chat ID */}
                      {(u.role === 'direktur_ops' || u.role === 'direktur_operasional') && (
                        <input
                          type="text"
                          placeholder="Telegram Chat ID"
                          defaultValue={u.telegram_chat_id || ''}
                          onBlur={async (e) => {
                            const val = e.target.value.trim();
                            try {
                              await updateTelegramChatId(u.id, val || null);
                              await refreshUsers();
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

      {currentTabId === 'permissions' && profile?.role === 'owner' && (
        <PermissionsMatrix />
      )}
    </div>
  );
}

// ============================================================
// Permissions Matrix Component
// ============================================================
function PermissionsMatrix() {
  const [matrix, setMatrix] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadMatrix() {
      setLoading(true);
      setError('');
      try {
        const data = await getRolePermissionsMatrix();
        if (!mounted) return;

        const nextMatrix: Record<string, Set<string>> = {};
        MATRIX_ROLES.forEach((role) => {
          nextMatrix[role.id] = new Set();
        });

        (data ?? []).forEach((row: any) => {
          if (!nextMatrix[row.role]) nextMatrix[row.role] = new Set();
          nextMatrix[row.role].add(row.permission_key);
        });

        setMatrix(nextMatrix);
      } catch (err: any) {
        if (mounted) setError(err.message || 'Gagal memuat permission matrix');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadMatrix();
    return () => {
      mounted = false;
    };
  }, []);

  const toggle = (role: string, key: string) => {
    setMatrix(prev => {
      const next = { ...prev, [role]: new Set(prev[role]) };
      if (next[role].has(key)) next[role].delete(key);
      else next[role].add(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const serializedMatrix: Record<string, string[]> = {};
      MATRIX_ROLES.forEach((role) => {
        serializedMatrix[role.id] = Array.from(matrix[role.id] || []);
      });

      await saveRolePermissionsMatrix(serializedMatrix);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan permission matrix');
    } finally {
      setSaving(false);
    }
  };

  const thStyle: React.CSSProperties = {
    padding: '6px 10px', fontSize: 11, fontWeight: 700, color: 'var(--dim)',
    textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
  };
  const tdStyle: React.CSSProperties = {
    padding: '5px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)',
  };
  const labelStyle: React.CSSProperties = {
    padding: '5px 12px', fontSize: 12, color: 'var(--text)', fontWeight: 500,
    textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  };
  const groupHeaderStyle: React.CSSProperties = {
    padding: '8px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.05em', color: 'var(--dim)', background: 'var(--bg)',
    borderBottom: '1px solid var(--border)',
  };

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Permission Matrix</div>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>Centang untuk memberi akses. Owner selalu punya akses penuh.</div>
        </div>
        <button onClick={save} disabled={saving}
          style={{ padding: '7px 18px', borderRadius: 7, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
            background: saved ? 'var(--green)' : 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600 }}>
          {saving ? 'Menyimpan...' : saved ? '✓ Tersimpan' : 'Simpan'}
        </button>
      </div>
      {error && (
        <div style={{ padding: '12px 20px', background: 'var(--badge-red-bg)', color: 'var(--red)', fontSize: 12 }}>
          ❌ {error}
        </div>
      )}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <div className="spinner" style={{ width: 28, height: 28, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%' }} />
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left', minWidth: 180 }}>Fitur / Halaman</th>
                {MATRIX_ROLES.map(r => (
                  <th key={r.id} style={thStyle}>{r.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map(group => (
                <>
                  <tr key={group.label}>
                    <td colSpan={MATRIX_ROLES.length + 1} style={groupHeaderStyle}>{group.label}</td>
                  </tr>
                  {group.keys.map(({ key, label }) => (
                    <tr key={key} style={{ background: 'var(--card)' }}>
                      <td style={labelStyle}>{label}</td>
                      {MATRIX_ROLES.map(r => (
                        <td key={r.id} style={tdStyle}>
                          <input
                            type="checkbox"
                            checked={matrix[r.id]?.has(key) ?? false}
                            onChange={() => toggle(r.id, key)}
                            style={{ cursor: 'pointer', width: 15, height: 15 }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

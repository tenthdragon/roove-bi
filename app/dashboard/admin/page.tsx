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

const TABS = [
  { id: 'daily', label: 'Daily Data' },
  { id: 'financial', label: 'Financial' },
  { id: 'brands', label: 'Brands' },
  { id: 'scalev', label: 'Scalev API' },
  { id: 'users', label: 'Users' },
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

  const refreshUsers = useCallback(async () => {
    const { data: u } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
    setUsers(u || []);
  }, [supabase]);

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
      const tabs = newRole === 'brand_manager' ? ['marketing'] : [];
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
      case 'pending': return { text: 'Menunggu Approval', bg: '#7f1d1d', color: '#ef4444' };
      case 'staff': return { text: 'Staff', bg: '#1e3a5f', color: '#38bdf8' };
      default: return { text: r, bg: '#1a2744', color: '#64748b' };
    }
  };

  // Filter tabs based on role
  const visibleTabs = TABS.filter(t => {
    if (t.id === 'users' && profile?.role !== 'owner') return false;
    if (t.id === 'brands' && profile?.role !== 'owner') return false;
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
        <a href="/dashboard/admin/logs" style={{
          padding: '8px 16px', background: 'none', border: 'none',
          borderBottom: '2px solid transparent',
          color: '#64748b', fontSize: 13, fontWeight: 500,
          textDecoration: 'none', cursor: 'pointer', transition: 'all 0.15s',
          display: 'flex', alignItems: 'center',
        }}>
          Logs
        </a>
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
            {['owner', 'admin', 'finance', 'staff', 'brand_manager', 'pending'].map(r => {
              const rl = roleLabel(r);
              const desc = r === 'owner' ? 'akses penuh' : r === 'admin' ? 'read-only' : r === 'finance' ? 'sync/upload' : r === 'brand_manager' ? 'marketing' : r === 'staff' ? 'staff' : 'pending';
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

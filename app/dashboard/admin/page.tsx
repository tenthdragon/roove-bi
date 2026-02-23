// @ts-nocheck
'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { uploadExcelData, fetchAllUsers, updateUserRole } from '@/lib/actions';
import SheetManager from '@/components/SheetManager';
import ScalevManager from '@/components/ScalevManager';
import FinancialSheetManager from '@/components/FinancialSheetManager';
import CsvOrderUploader from '@/components/CsvOrderUploader';

// ── Collapsible Section Component ──
function Section({ title, subtitle, color, icon, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 0', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ width: 4, height: 20, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', flex: 1 }}>{title}</span>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500, marginRight: 8 }}>{subtitle}</span>
        <span style={{
          fontSize: 14, color: '#64748b', transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>▼</span>
      </button>
      {open && <div style={{ paddingTop: 4 }}>{children}</div>}
    </div>
  );
}

export default function AdminPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [imports, setImports] = useState([]);
  const [users, setUsers] = useState([]);
  const [dragOver, setDragOver] = useState(false);
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
        if (p?.role === 'owner' || p?.role === 'finance') {
          const { data: i } = await supabase.from('data_imports').select('*').order('imported_at', { ascending: false }).limit(5);
          setImports(i || []);
        }
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
    setUploading(true); setUploadError(''); setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await uploadExcelData(formData);
      setUploadResult(result);
      const { data: i } = await supabase.from('data_imports').select('*').order('imported_at', { ascending: false }).limit(5);
      setImports(i || []);
    } catch (err) {
      setUploadError(err.message || 'Upload gagal');
    } finally {
      setUploading(false);
    }
  }, [supabase]);

  const handleRoleChange = async (userId, newRole) => {
    try {
      const tabs = newRole === 'brand_manager' ? ['marketing'] : [];
      await updateUserRole(userId, newRole, tabs, []);
      await refreshUsers();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const handleInvite = async () => {
    if (!inviteEmail || !inviteEmail.includes('@')) {
      setInviteMsg({ type: 'error', text: 'Masukkan email yang valid' }); return;
    }
    setInviting(true); setInviteMsg(null);
    try {
      const res = await fetch('/api/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) { setInviteMsg({ type: 'error', text: data.error || 'Invite gagal' }); }
      else { setInviteMsg({ type: 'success', text: data.message }); setInviteEmail(''); await refreshUsers(); }
    } catch (err) { setInviteMsg({ type: 'error', text: err.message || 'Invite gagal' }); }
    finally { setInviting(false); }
  };

  if (profile?.role !== 'owner' && profile?.role !== 'finance') {
    return <div style={{ textAlign:'center', padding:60, color:'#64748b' }}>
      <div style={{ fontSize:48, marginBottom:16 }}>🔒</div>
      <div style={{ fontSize:18, fontWeight:600 }}>Akses Ditolak</div>
      <div>Hanya Owner dan Finance yang bisa mengakses halaman ini.</div>
    </div>;
  }

  const roleLabel = (r) => {
    switch(r) {
      case 'owner': return { text: 'Owner', bg: '#312e81', color: '#818cf8' };
      case 'admin': return { text: 'Admin', bg: '#064e3b', color: '#10b981' };
      case 'finance': return { text: 'Finance', bg: '#1e3a5f', color: '#60a5fa' };
      case 'brand_manager': return { text: 'Brand Manager', bg: '#78350f', color: '#f59e0b' };
      case 'pending': return { text: 'Menunggu Approval', bg: '#7f1d1d', color: '#ef4444' };
      default: return { text: r, bg: '#1a2744', color: '#64748b' };
    }
  };

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Admin</h2>
        <a href="/dashboard/admin/logs" style={{
          padding: '6px 14px', borderRadius: 8, border: '1px solid #1a2744',
          color: '#64748b', fontSize: 12, fontWeight: 600, textDecoration: 'none',
          background: '#0b1121',
        }}>
          📋 Lihat Semua Log
        </a>
      </div>

      {/* SECTION 1: DAILY REPORT */}
      <Section title="Daily Report" subtitle="Google Sheets + Excel upload" color="#3b82f6">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SheetManager />

          <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:20 }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>Upload Data Excel</div>
            <div style={{ fontSize:12, color:'#64748b', marginBottom:14 }}>
              Upload file .xlsx. Upload ulang bulan yang sama akan menimpa data sebelumnya.
            </div>
            <div
              className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = '.xlsx,.xls';
                input.onchange = (e) => { const f = e.target.files[0]; if (f) handleUpload(f); };
                input.click();
              }}
            >
              {uploading ? (
                <div><div className="spinner" style={{ width:32, height:32, border:'3px solid #1a2744', borderTop:'3px solid #3b82f6', borderRadius:'50%', margin:'0 auto 12px' }} /><div style={{ color:'#64748b' }}>Mengupload & memproses data...</div></div>
              ) : (
                <div>
                  <div style={{ fontSize:32, marginBottom:8 }}>📁</div>
                  <div style={{ fontWeight:600, marginBottom:4 }}>Drag & drop file Excel di sini</div>
                  <div style={{ fontSize:12, color:'#64748b' }}>atau klik untuk memilih file</div>
                </div>
              )}
            </div>
            {uploadResult && (
              <div style={{ marginTop:12, padding:12, background:'#064e3b', borderRadius:8, color:'#10b981', fontSize:13 }}>
                ✅ Berhasil! Periode: {uploadResult.period.month}/{uploadResult.period.year}.
                Data: {uploadResult.counts.dailyProduct} daily, {uploadResult.counts.dailyChannel} channel, {uploadResult.counts.ads} ads.
              </div>
            )}
            {uploadError && (
              <div style={{ marginTop:12, padding:12, background:'#7f1d1d', borderRadius:8, color:'#ef4444', fontSize:13 }}>❌ {uploadError}</div>
            )}
          </div>
        </div>
      </Section>

      {/* SECTION 2: FINANCIAL REPORT */}
      <Section title="Financial Report" subtitle="PL, CF, BS, Rasio" color="#10b981">
        <FinancialSheetManager />
      </Section>

      {/* SECTION 3: SCALEV API */}
      <Section title="Scalev API" subtitle="Auto-sync order data" color="#8b5cf6">
        <ScalevManager />
      </Section>

      {/* SECTION 4: CSV ORDER UPLOAD */}
      <Section title="Customer Data (CSV)" subtitle="Upload CSV Scalev export" color="#06b6d4">
        <CsvOrderUploader />
      </Section>

      {/* SECTION 5: USER MANAGEMENT */}
      {profile?.role === 'owner' && (
        <Section title="Kelola User" subtitle="Invite dan atur role" color="#f59e0b" defaultOpen>
          <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:20 }}>
            {/* Invite Form */}
            <div style={{ marginBottom:20, padding:16, background:'#0b1121', borderRadius:8, border:'1px solid #1a2744' }}>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>Invite User Baru</div>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:12 }}>
                Masukkan email dan pilih role. User akan menerima email untuk set password.
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'flex-end' }}>
                <div style={{ flex:'1 1 200px' }}>
                  <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:4 }}>Email</label>
                  <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                    placeholder="nama@email.com"
                    style={{ width:'100%', padding:'8px 12px', borderRadius:6, border:'1px solid #1a2744', background:'#111a2e', color:'#e2e8f0', fontSize:13, outline:'none' }}
                  />
                </div>
                <div style={{ flex:'0 0 140px' }}>
                  <label style={{ fontSize:11, color:'#64748b', display:'block', marginBottom:4 }}>Role</label>
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                    style={{ width:'100%', padding:'8px 12px', borderRadius:6, border:'1px solid #1a2744', background:'#111a2e', color:'#e2e8f0', fontSize:13 }}>
                    <option value="admin">Admin</option>
                    <option value="finance">Finance</option>
                    <option value="brand_manager">Brand Manager</option>
                  </select>
                </div>
                <button onClick={handleInvite} disabled={inviting}
                  style={{ padding:'8px 20px', borderRadius:6, border:'none', cursor: inviting ? 'not-allowed' : 'pointer', background: inviting ? '#1a2744' : '#3b82f6', color:'#fff', fontSize:13, fontWeight:600, whiteSpace:'nowrap', opacity: inviting ? 0.6 : 1 }}>
                  {inviting ? 'Mengundang...' : '+ Invite'}
                </button>
              </div>
              {inviteMsg && (
                <div style={{ marginTop:10, padding:10, borderRadius:6, fontSize:12, background: inviteMsg.type === 'success' ? '#064e3b' : '#7f1d1d', color: inviteMsg.type === 'success' ? '#10b981' : '#ef4444' }}>
                  {inviteMsg.type === 'success' ? '✅' : '❌'} {inviteMsg.text}
                </div>
              )}
            </div>

            {/* Role Legend */}
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16, fontSize:11 }}>
              {['owner','admin','finance','brand_manager','pending'].map(r => {
                const rl = roleLabel(r);
                const desc = r === 'owner' ? 'akses penuh' : r === 'admin' ? 'read-only' : r === 'finance' ? 'sync/upload' : r === 'brand_manager' ? 'marketing' : 'pending';
                return <span key={r} style={{ padding:'3px 8px', borderRadius:5, background:rl.bg, color:rl.color, fontWeight:600 }}>{rl.text} — {desc}</span>;
              })}
            </div>

            {/* User List */}
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {users.map((u) => {
                const rl = roleLabel(u.role);
                return (
                  <div key={u.id} style={{
                    padding:14, background:'#0b1121', borderRadius:8,
                    border: u.role==='pending' ? '1px solid #7f1d1d' : '1px solid #1a2744',
                    display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8
                  }}>
                    <div>
                      <div style={{ fontWeight:600, fontSize:13 }}>{u.email}</div>
                      <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700, background:rl.bg, color:rl.color }}>{rl.text}</span>
                    </div>
                    {u.id !== profile?.id && (
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                        {u.role === 'pending' ? (
                          <>
                            <button onClick={() => handleRoleChange(u.id, 'admin')} style={{ padding:'6px 14px', borderRadius:6, border:'none', cursor:'pointer', background:'#064e3b', color:'#10b981', fontSize:12, fontWeight:600 }}>✓ Admin</button>
                            <button onClick={() => handleRoleChange(u.id, 'finance')} style={{ padding:'6px 14px', borderRadius:6, border:'none', cursor:'pointer', background:'#1e3a5f', color:'#60a5fa', fontSize:12, fontWeight:600 }}>✓ Finance</button>
                            <button onClick={() => handleRoleChange(u.id, 'brand_manager')} style={{ padding:'6px 14px', borderRadius:6, border:'none', cursor:'pointer', background:'#78350f', color:'#f59e0b', fontSize:12, fontWeight:600 }}>✓ Brand Manager</button>
                          </>
                        ) : (
                          <select value={u.role} onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            style={{ padding:'5px 10px', borderRadius:6, border:'1px solid #1a2744', background:'#111a2e', color:'#e2e8f0', fontSize:12 }}>
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
        </Section>
      )}
    </div>
  );
}

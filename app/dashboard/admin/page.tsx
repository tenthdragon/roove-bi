// @ts-nochecks
'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { uploadExcelData, fetchAllUsers, updateUserRole } from '@/lib/actions';
import SheetManager from '@/components/SheetManager';
import ScalevManager from '@/components/ScalevManager';
import FinancialSheetManager from '@/components/FinancialSheetManager';

export default function AdminPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [uploadError, setUploadError] = useState('');
  const [imports, setImports] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        setProfile(p);
        if (p?.role === 'owner' || p?.role === 'finance') {
          const { data: i } = await supabase.from('data_imports').select('*').order('imported_at', { ascending: false });
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

  const handleUpload = useCallback(async (file: File) => {
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
      setUploadResult(result);
      const { data: i } = await supabase.from('data_imports').select('*').order('imported_at', { ascending: false });
      setImports(i || []);
    } catch (err: any) {
      setUploadError(err.message || 'Upload gagal');
    } finally {
      setUploading(false);
    }
  }, [supabase]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const tabs = newRole === 'brand_manager' ? ['marketing'] : [];
      await updateUserRole(userId, newRole, tabs, []);
      const { data: u } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
      setUsers(u || []);
    } catch (err: any) {
      alert('Error: ' + err.message);
    }
  };

  if (profile?.role !== 'owner' && profile?.role !== 'finance') {
    return <div style={{ textAlign:'center', padding:60, color:'#64748b' }}>
      <div style={{ fontSize:48, marginBottom:16 }}>🔒</div>
      <div style={{ fontSize:18, fontWeight:600 }}>Akses Ditolak</div>
      <div>Hanya Owner dan Finance yang bisa mengakses halaman ini.</div>
    </div>;
  }

  const roleLabel = (r: string) => {
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
      <h2 style={{ margin:'0 0 20px', fontSize:18, fontWeight:700 }}>Admin</h2>

      {/* ════════════════════════════════════════════════════════ */}
      {/* SECTION 1: DAILY REPORT                                */}
      {/* ════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom:24 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
          <div style={{ width:4, height:20, borderRadius:2, background:'#3b82f6' }} />
          <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:'#e2e8f0' }}>Daily Report</h3>
          <span style={{ fontSize:11, color:'#64748b', fontWeight:500 }}>Data penjualan harian per produk & channel</span>
        </div>

        {/* 1.1 Google Sheets Integration */}
        <div style={{ marginBottom:12 }}>
          <SheetManager />
        </div>

        {/* 1.2 Upload Data Excel */}
        <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:20, marginBottom:12 }}>
          <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>Upload Data Excel</div>
          <div style={{ fontSize:12, color:'#64748b', marginBottom:14 }}>
            Upload file .xlsx sebagai alternatif Google Sheets. Upload ulang bulan yang sama akan menimpa data sebelumnya.
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
              input.type = 'file';
              input.accept = '.xlsx,.xls';
              input.onchange = (e: any) => { const f = e.target.files[0]; if (f) handleUpload(f); };
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

        {/* Import History */}
        {imports.length > 0 && (
          <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:20 }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:12 }}>Riwayat Import</div>
            <div className="table-scroll">
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:500 }}>
                <thead><tr style={{ borderBottom:'2px solid #1a2744' }}>
                  {['Periode','File','Status','Rows','Waktu'].map(h => (
                    <th key={h} style={{ padding:'8px 10px', textAlign:'left', color:'#64748b', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {imports.map((imp: any) => (
                    <tr key={imp.id} style={{ borderBottom:'1px solid #1a2744' }}>
                      <td style={{ padding:'8px 10px', fontWeight:600 }}>{imp.period_month}/{imp.period_year}</td>
                      <td style={{ padding:'8px 10px', color:'#64748b', maxWidth:150, overflow:'hidden', textOverflow:'ellipsis' }}>{imp.filename}</td>
                      <td style={{ padding:'8px 10px' }}>
                        <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700,
                          background: imp.status==='completed'?'#064e3b':'#7f1d1d',
                          color: imp.status==='completed'?'#10b981':'#ef4444',
                        }}>{imp.status}</span>
                      </td>
                      <td style={{ padding:'8px 10px', fontFamily:'monospace' }}>{imp.row_count}</td>
                      <td style={{ padding:'8px 10px', color:'#64748b' }}>{new Date(imp.imported_at).toLocaleString('id-ID')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════ */}
      {/* SECTION 2: FINANCIAL REPORT                            */}
      {/* ════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom:24 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
          <div style={{ width:4, height:20, borderRadius:2, background:'#10b981' }} />
          <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:'#e2e8f0' }}>Financial Report</h3>
          <span style={{ fontSize:11, color:'#64748b', fontWeight:500 }}>Laporan keuangan PL, CF, BS, Rasio</span>
        </div>
        <FinancialSheetManager />
      </div>

      {/* ════════════════════════════════════════════════════════ */}
      {/* SECTION 3: SCALEV API                                  */}
      {/* ════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom:24 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
          <div style={{ width:4, height:20, borderRadius:2, background:'#8b5cf6' }} />
          <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:'#e2e8f0' }}>Scalev API</h3>
          <span style={{ fontSize:11, color:'#64748b', fontWeight:500 }}>Tarik data order otomatis dari Scalev</span>
        </div>
        <ScalevManager />
      </div>

      {/* ════════════════════════════════════════════════════════ */}
      {/* SECTION 4: USER MANAGEMENT (Owner Only)                */}
      {/* ════════════════════════════════════════════════════════ */}
      {profile?.role === 'owner' && (
        <div style={{ marginBottom:24 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
            <div style={{ width:4, height:20, borderRadius:2, background:'#f59e0b' }} />
            <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:'#e2e8f0' }}>Kelola User</h3>
            <span style={{ fontSize:11, color:'#64748b', fontWeight:500 }}>Approve dan atur role akses</span>
          </div>

          <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:20 }}>
            <div style={{ fontSize:12, color:'#64748b', marginBottom:16 }}>
              Bagikan URL login ke tim. Mereka signup, lalu Anda approve dan atur role di sini.
            </div>

            {/* Role Legend */}
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16, fontSize:11 }}>
              {['owner','admin','finance','brand_manager','pending'].map(r => {
                const rl = roleLabel(r);
                const desc = r === 'owner' ? 'akses penuh + upload' : r === 'admin' ? 'semua tab (read-only)' : r === 'finance' ? 'semua tab + sync/upload' : r === 'brand_manager' ? 'marketing only' : 'belum di-approve';
                return (
                  <span key={r} style={{ padding:'3px 8px', borderRadius:5, background:rl.bg, color:rl.color, fontWeight:600 }}>
                    {rl.text} — {desc}
                  </span>
                );
              })}
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {users.map((u: any) => {
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
                        {u.role === 'pending' && (
                          <>
                            <button onClick={() => handleRoleChange(u.id, 'admin')}
                              style={{ padding:'6px 14px', borderRadius:6, border:'none', cursor:'pointer',
                                background:'#064e3b', color:'#10b981', fontSize:12, fontWeight:600 }}>
                              ✓ Admin
                            </button>
                            <button onClick={() => handleRoleChange(u.id, 'finance')}
                              style={{ padding:'6px 14px', borderRadius:6, border:'none', cursor:'pointer',
                                background:'#1e3a5f', color:'#60a5fa', fontSize:12, fontWeight:600 }}>
                              ✓ Finance
                            </button>
                            <button onClick={() => handleRoleChange(u.id, 'brand_manager')}
                              style={{ padding:'6px 14px', borderRadius:6, border:'none', cursor:'pointer',
                                background:'#78350f', color:'#f59e0b', fontSize:12, fontWeight:600 }}>
                              ✓ Brand Manager
                            </button>
                          </>
                        )}
                        {u.role !== 'pending' && (
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
        </div>
      )}
    </div>
  );
}

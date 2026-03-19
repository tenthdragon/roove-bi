'use client';

import { useState, useEffect } from 'react';
import {
  fetchSheetConnections,
  addSheetConnection,
  removeSheetConnection,
  toggleSheetConnection,
} from '@/lib/sheet-actions';

interface SheetConnection {
  id: string;
  spreadsheet_id: string;
  label: string;
  is_active: boolean;
  created_at: string;
  last_synced: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
}

export default function SheetManager() {
  const [connections, setConnections] = useState<SheetConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newSpreadsheetId, setNewSpreadsheetId] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const SERVICE_EMAIL = 'roove-bi-reader@roove-bi.iam.gserviceaccount.com';

  useEffect(() => { loadConnections(); }, []);

  async function loadConnections() {
    try {
      setLoading(true);
      const data = await fetchSheetConnections();
      setConnections(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newSpreadsheetId.trim() || !newLabel.trim()) return;
    try {
      setAdding(true);
      setError(null);
      setSuccess(null);
      let spreadsheetId = newSpreadsheetId.trim();
      const urlMatch = spreadsheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (urlMatch) spreadsheetId = urlMatch[1];
      await addSheetConnection(spreadsheetId, newLabel.trim());
      setNewSpreadsheetId('');
      setNewLabel('');
      setSuccess('Spreadsheet berhasil ditambahkan!');
      await loadConnections();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: string) {
    if (!confirm('Yakin hapus koneksi ini?')) return;
    try {
      setError(null);
      await removeSheetConnection(id);
      await loadConnections();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleToggle(id: string, isActive: boolean) {
    try {
      setError(null);
      await toggleSheetConnection(id, !isActive);
      await loadConnections();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleSync() {
    try {
      setSyncing(true);
      setError(null);
      setSuccess(null);

      // Call the unified API route instead of the server action.
      // This ensures brandList is always fetched from the database,
      // identical to how the Vercel cron job triggers sync.
      const res = await fetch('/api/sync', { method: 'POST' });
      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || `Sync failed (${res.status})`);
      }

      setSuccess(`Sync selesai: ${result.synced} berhasil, ${result.failed} gagal`);
      await loadConnections();
    } catch (err: any) {
      setError(`Sync gagal: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ fontSize:15, fontWeight:700 }}>Google Sheets Integration</div>
        <button
          onClick={handleSync}
          disabled={syncing || connections.filter(c => c.is_active).length === 0}
          style={{
            padding:'7px 16px', borderRadius:8, border:'none',
            cursor: syncing ? 'not-allowed' : 'pointer',
            background: syncing ? 'var(--border)' : 'var(--green)',
            color: syncing ? 'var(--dim)' : '#fff',
            fontSize:12, fontWeight:600,
            opacity: connections.filter(c => c.is_active).length === 0 ? 0.5 : 1,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={syncing ? { animation: 'spin 1s linear infinite' } : undefined}><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      <div style={{ fontSize:12, color:'var(--dim)', marginBottom:16 }}>
        Hubungkan Google Sheets agar data otomatis tersinkron. Auto-sync berjalan setiap 1 jam.
      </div>

      {/* Info box */}
      <div style={{ background:'var(--accent-subtle)', border:'1px solid var(--border)', borderRadius:8, padding:12, marginBottom:16, fontSize:12, color:'var(--accent)' }}>
        <div style={{ fontWeight:600, marginBottom:6 }}>Cara menambahkan spreadsheet:</div>
        <div style={{ color:'var(--accent)', lineHeight:1.8 }}>
          1. Buka Google Sheet → klik Share → tambahkan: <code style={{ background:'var(--bg-deep)', padding:'2px 6px', borderRadius:4, fontSize:11 }}>{SERVICE_EMAIL}</code><br/>
          2. Set sebagai <strong>Viewer</strong><br/>
          3. Copy Spreadsheet ID dari URL (atau paste URL lengkap) ke form di bawah
        </div>
      </div>

      {/* Error/Success */}
      {error && (
        <div style={{ marginBottom:12, padding:12, background:'var(--badge-red-bg)', borderRadius:8, color:'var(--red)', fontSize:13 }}>
          ❌ {error}
        </div>
      )}
      {success && (
        <div style={{ marginBottom:12, padding:12, background:'var(--badge-green-bg)', borderRadius:8, color:'var(--green)', fontSize:13 }}>
          ✅ {success}
        </div>
      )}

      {/* Add form */}
      <form onSubmit={handleAdd} style={{ marginBottom:20 }}>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
          <input
            type="text"
            placeholder="Label (misal: Feb 2026)"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            style={{
              flex:'0 0 180px', padding:'8px 12px', background:'var(--bg)',
              border:'1px solid var(--border)', borderRadius:8, color:'var(--text)',
              fontSize:13, outline:'none'
            }}
          />
          <input
            type="text"
            placeholder="Spreadsheet ID atau URL lengkap"
            value={newSpreadsheetId}
            onChange={e => setNewSpreadsheetId(e.target.value)}
            style={{
              flex:1, minWidth:200, padding:'8px 12px', background:'var(--bg)',
              border:'1px solid var(--border)', borderRadius:8, color:'var(--text)',
              fontSize:13, outline:'none'
            }}
          />
        </div>
        <button
          type="submit"
          disabled={adding || !newSpreadsheetId.trim() || !newLabel.trim()}
          style={{
            padding:'8px 16px', borderRadius:8, border:'none',
            cursor: adding ? 'not-allowed' : 'pointer',
            background:'var(--accent)', color:'#fff', fontSize:12, fontWeight:600,
            opacity: (!newSpreadsheetId.trim() || !newLabel.trim()) ? 0.5 : 1,
          }}
        >
          {adding ? 'Menambahkan...' : '+ Tambah Spreadsheet'}
        </button>
      </form>

      {/* Connections list */}
      {loading ? (
        <div style={{ color:'var(--dim)', fontSize:13 }}>Memuat...</div>
      ) : connections.length === 0 ? (
        <div style={{ color:'var(--dim)', fontSize:13 }}>Belum ada spreadsheet yang terhubung.</div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {connections.map(conn => (
            <div
              key={conn.id}
              style={{
                padding:14, background:'var(--bg)', borderRadius:8,
                border:'1px solid var(--border)',
                opacity: conn.is_active ? 1 : 0.5,
                display:'flex', justifyContent:'space-between', alignItems:'flex-start',
                flexWrap:'wrap', gap:8,
              }}
            >
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{
                    width:8, height:8, borderRadius:'50%', display:'inline-block',
                    background: conn.last_sync_status === 'success' ? 'var(--green)' :
                                conn.last_sync_status === 'error' ? 'var(--red)' : 'var(--dim)',
                  }} />
                  <span style={{ fontWeight:600, fontSize:13 }}>{conn.label}</span>
                  {!conn.is_active && (
                    <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:600, background:'var(--border)', color:'var(--dim)' }}>Nonaktif</span>
                  )}
                </div>
                <div style={{ fontSize:11, color:'var(--dim)', marginTop:4, fontFamily:'monospace' }}>
                  {conn.spreadsheet_id}
                </div>
                <div style={{ display:'flex', gap:16, marginTop:6, fontSize:11, color:'var(--dim)' }}>
                  <span>Terakhir sync: {formatDate(conn.last_synced)}</span>
                  {conn.last_sync_message && (
                    <span style={{ color: conn.last_sync_status === 'error' ? 'var(--red)' : 'var(--green)' }}>
                      {conn.last_sync_message}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <button
                  onClick={() => handleToggle(conn.id, conn.is_active)}
                  style={{
                    padding:'5px 12px', borderRadius:6, border:'1px solid var(--border)',
                    background:'transparent', color:'var(--text-secondary)', fontSize:11, cursor:'pointer',
                  }}
                >
                  {conn.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                </button>
                <button
                  onClick={() => handleRemove(conn.id)}
                  style={{
                    padding:'5px 12px', borderRadius:6, border:'1px solid var(--badge-red-bg)',
                    background:'transparent', color:'var(--red)', fontSize:11, cursor:'pointer',
                  }}
                >
                  Hapus
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

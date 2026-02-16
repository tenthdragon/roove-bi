// components/FinancialSheetManager.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  getFinancialConnections,
  addFinancialConnection,
  removeFinancialConnection,
  toggleFinancialConnection,
  triggerFinancialSync,
} from '@/lib/financial-actions';

interface Connection {
  id: string;
  spreadsheet_id: string;
  label: string;
  is_active: boolean;
  last_synced: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
}

export default function FinancialSheetManager() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadConnections();
  }, []);

  async function loadConnections() {
    try {
      const data = await getFinancialConnections();
      setConnections(data);
    } catch (e: any) {
      setMessage('Error: ' + e.message);
    }
  }

  async function handleAdd() {
    if (!newId.trim() || !newLabel.trim()) return;
    setLoading(true);
    try {
      await addFinancialConnection(newId.trim(), newLabel.trim());
      setNewId('');
      setNewLabel('');
      setMessage('Spreadsheet berhasil ditambahkan');
      await loadConnections();
    } catch (e: any) {
      setMessage('Error: ' + e.message);
    }
    setLoading(false);
  }

  async function handleRemove(id: string) {
    if (!confirm('Yakin hapus koneksi ini?')) return;
    try {
      await removeFinancialConnection(id);
      setMessage('Koneksi dihapus');
      await loadConnections();
    } catch (e: any) {
      setMessage('Error: ' + e.message);
    }
  }

  async function handleToggle(id: string, current: boolean) {
    try {
      await toggleFinancialConnection(id, current);
      await loadConnections();
    } catch (e: any) {
      setMessage('Error: ' + e.message);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setMessage('Syncing financial data...');
    try {
      const result = await triggerFinancialSync();
      const detail = result.results?.map((r: any) =>
        r.success
          ? `✅ ${r.label}: PL ${r.plRows}, CF ${r.cfRows}, Rasio ${r.ratioRows} rows (${r.months?.length} months)`
          : `❌ ${r.label}: ${r.error}`
      ).join('\n') || '';
      setMessage(`Sync selesai: ${result.synced} berhasil, ${result.failed || 0} gagal\n${detail}`);
      await loadConnections();
    } catch (e: any) {
      setMessage('Sync error: ' + e.message);
    }
    setSyncing(false);
  }

  return (
    <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📊 Financial Report Sync</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
        Hubungkan Google Sheets laporan keuangan (PL, CF, Rasio)
      </div>

      {/* Add new connection */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Label (misal: 2025)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          style={{
            background: '#0b1121', border: '1px solid #1a2744', borderRadius: 8,
            padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', width: 130,
          }}
        />
        <input
          type="text"
          placeholder="Spreadsheet ID"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          style={{
            background: '#0b1121', border: '1px solid #1a2744', borderRadius: 8,
            padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', flex: 1,
          }}
        />
        <button
          onClick={handleAdd}
          disabled={loading || !newId.trim() || !newLabel.trim()}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#064e3b', color: '#10b981', fontSize: 13, fontWeight: 600,
            opacity: loading || !newId.trim() || !newLabel.trim() ? 0.5 : 1,
          }}
        >
          {loading ? '...' : '+ Tambah'}
        </button>
      </div>

      {/* Sync button */}
      <button
        onClick={handleSync}
        disabled={syncing || connections.filter(c => c.is_active).length === 0}
        style={{
          padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: '#1e3a5f', color: '#3b82f6', fontSize: 13, fontWeight: 600,
          marginBottom: 12,
          opacity: syncing || connections.filter(c => c.is_active).length === 0 ? 0.5 : 1,
        }}
      >
        {syncing ? '⏳ Syncing...' : '🔄 Sync Now'}
      </button>

      {/* Status message */}
      {message && (
        <div style={{
          padding: 12, background: '#0b1121', border: '1px solid #1a2744',
          borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#94a3b8',
          whiteSpace: 'pre-wrap',
        }}>
          {message}
        </div>
      )}

      {/* Connection list */}
      {connections.length === 0 ? (
        <div style={{ color: '#64748b', fontSize: 13 }}>Belum ada spreadsheet terhubung</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {connections.map((conn) => (
            <div
              key={conn.id}
              style={{
                padding: 12, background: '#0b1121', borderRadius: 8,
                border: '1px solid #1a2744',
                opacity: conn.is_active ? 1 : 0.5,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                flexWrap: 'wrap', gap: 8,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: conn.is_active ? '#10b981' : '#64748b',
                    display: 'inline-block',
                  }} />
                  <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{conn.label}</span>
                  <span style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace' }}>
                    {conn.spreadsheet_id.substring(0, 20)}...
                  </span>
                </div>
                {conn.last_synced && (
                  <div style={{ marginTop: 4, fontSize: 11, color: '#64748b' }}>
                    Last sync: {new Date(conn.last_synced).toLocaleString('id-ID')} —{' '}
                    <span style={{ color: conn.last_sync_status === 'error' ? '#ef4444' : '#10b981' }}>
                      {conn.last_sync_message}
                    </span>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => handleToggle(conn.id, conn.is_active)}
                  style={{
                    padding: '4px 10px', borderRadius: 6, border: '1px solid #1a2744',
                    cursor: 'pointer', background: 'transparent', color: '#64748b',
                    fontSize: 11, fontWeight: 600,
                  }}
                >
                  {conn.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                </button>
                <button
                  onClick={() => handleRemove(conn.id)}
                  style={{
                    padding: '4px 10px', borderRadius: 6, border: '1px solid #7f1d1d',
                    cursor: 'pointer', background: 'transparent', color: '#ef4444',
                    fontSize: 11, fontWeight: 600,
                  }}
                >
                  Hapus
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info */}
      <div style={{ marginTop: 16, fontSize: 11, color: '#475569' }}>
        <div>Share spreadsheet ke: <code style={{ color: '#64748b' }}>roove-bi-reader@roove-bi.iam.gserviceaccount.com</code> (Viewer)</div>
        <div style={{ marginTop: 4 }}>Data: PL (Laba Rugi), CF (Cash Flow), Rasio Keuangan. Auto-sync 1x/hari.</div>
        <div style={{ marginTop: 4 }}>⚠️ Revenue basis: PL = Delivered | Daily Income = Confirmed (normal ada selisih)</div>
      </div>
    </div>
  );
}

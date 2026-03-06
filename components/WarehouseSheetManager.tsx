// components/WarehouseSheetManager.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  getWarehouseConnections,
  addWarehouseConnection,
  removeWarehouseConnection,
  toggleWarehouseConnection,
  triggerWarehouseSync,
} from '@/lib/warehouse-actions';

interface Connection {
  id: string;
  spreadsheet_id: string;
  label: string;
  warehouse_name: string;
  is_active: boolean;
  last_synced: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
}

export default function WarehouseSheetManager() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newWarehouse, setNewWarehouse] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadConnections();
  }, []);

  async function loadConnections() {
    try {
      const data = await getWarehouseConnections();
      setConnections(data);
    } catch (e: any) {
      setMessage('Error: ' + e.message);
    }
  }

  async function handleAdd() {
    if (!newId.trim() || !newLabel.trim() || !newWarehouse.trim()) return;
    setLoading(true);
    try {
      await addWarehouseConnection(newId.trim(), newLabel.trim(), newWarehouse.trim());
      setNewId('');
      setNewLabel('');
      setNewWarehouse('');
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
      await removeWarehouseConnection(id);
      setMessage('Koneksi dihapus');
      await loadConnections();
    } catch (e: any) {
      setMessage('Error: ' + e.message);
    }
  }

  async function handleToggle(id: string, current: boolean) {
    try {
      await toggleWarehouseConnection(id, current);
      await loadConnections();
    } catch (e: any) {
      setMessage('Error: ' + e.message);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setMessage('Syncing warehouse data...');
    try {
      const result = await triggerWarehouseSync();
      const detail = result.results?.map((r: any) =>
        r.success
          ? `${r.label}: Summary ${r.summaryRows}, Daily ${r.dailyRows}, SO ${r.soRows} rows`
          : `${r.label}: ${r.error}`
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
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Warehouse Stock Card Sync</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
        Hubungkan Google Sheets kartu stock gudang (Summary, Mingguan)
      </div>

      {/* Add new connection */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Label (misal: Feb 2026)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          style={{
            background: '#0b1121', border: '1px solid #1a2744', borderRadius: 8,
            padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', width: 140,
          }}
        />
        <input
          type="text"
          placeholder="Nama Gudang (misal: RLB BTN)"
          value={newWarehouse}
          onChange={(e) => setNewWarehouse(e.target.value)}
          style={{
            background: '#0b1121', border: '1px solid #1a2744', borderRadius: 8,
            padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', width: 160,
          }}
        />
        <input
          type="text"
          placeholder="Spreadsheet ID"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          style={{
            background: '#0b1121', border: '1px solid #1a2744', borderRadius: 8,
            padding: '8px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', flex: 1, minWidth: 180,
          }}
        />
        <button
          onClick={handleAdd}
          disabled={loading || !newId.trim() || !newLabel.trim() || !newWarehouse.trim()}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#064e3b', color: '#10b981', fontSize: 13, fontWeight: 600,
            opacity: loading || !newId.trim() || !newLabel.trim() || !newWarehouse.trim() ? 0.5 : 1,
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
        {syncing ? 'Syncing...' : 'Sync Now'}
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
                  <span style={{
                    padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                    background: '#1e3a5f', color: '#60a5fa',
                  }}>
                    {conn.warehouse_name}
                  </span>
                  <span style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace' }}>
                    {conn.spreadsheet_id.substring(0, 16)}...
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
        <div style={{ marginTop: 4 }}>Format: Sheet "Summary [Bulan Tahun]" (ringkasan), "Mingguan" (stock opname).</div>
        <div style={{ marginTop: 4 }}>Judul spreadsheet harus mengandung: "KARTU STOCK [NAMA GUDANG] - [Bulan] [Tahun]"</div>
      </div>
    </div>
  );
}

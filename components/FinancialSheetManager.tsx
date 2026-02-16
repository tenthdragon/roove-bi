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
      setMessage(`Error: ${e.message}`);
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
      setMessage(`Error: ${e.message}`);
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
      setMessage(`Error: ${e.message}`);
    }
  }

  async function handleToggle(id: string, current: boolean) {
    try {
      await toggleFinancialConnection(id, current);
      await loadConnections();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
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
      setMessage(`Sync error: ${e.message}`);
    }
    setSyncing(false);
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6 mt-6">
      <h2 className="text-lg font-bold text-white mb-1">📊 Financial Report Sync</h2>
      <p className="text-gray-400 text-sm mb-4">
        Hubungkan Google Sheets laporan keuangan (PL, CF, Rasio)
      </p>

      {/* Add new connection */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Label (misal: 2025)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          className="bg-gray-700 text-white px-3 py-2 rounded text-sm w-32"
        />
        <input
          type="text"
          placeholder="Spreadsheet ID"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          className="bg-gray-700 text-white px-3 py-2 rounded text-sm flex-1"
        />
        <button
          onClick={handleAdd}
          disabled={loading || !newId.trim() || !newLabel.trim()}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium"
        >
          {loading ? '...' : '+ Tambah'}
        </button>
      </div>

      {/* Sync button */}
      <button
        onClick={handleSync}
        disabled={syncing || connections.filter(c => c.is_active).length === 0}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium mb-4"
      >
        {syncing ? '⏳ Syncing...' : '🔄 Sync Now'}
      </button>

      {/* Status message */}
      {message && (
        <div className="bg-gray-900 border border-gray-700 rounded p-3 mb-4 text-sm text-gray-300 whitespace-pre-wrap">
          {message}
        </div>
      )}

      {/* Connection list */}
      {connections.length === 0 ? (
        <p className="text-gray-500 text-sm">Belum ada spreadsheet terhubung</p>
      ) : (
        <div className="space-y-2">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className={`border rounded p-3 ${conn.is_active ? 'border-gray-600 bg-gray-750' : 'border-gray-700 bg-gray-800 opacity-60'}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${conn.is_active ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                    <span className="text-white text-sm font-medium">{conn.label}</span>
                    <span className="text-gray-500 text-xs truncate">{conn.spreadsheet_id}</span>
                  </div>
                  {conn.last_synced && (
                    <div className="mt-1 text-xs text-gray-400">
                      Last sync: {new Date(conn.last_synced).toLocaleString('id-ID')} —{' '}
                      <span className={conn.last_sync_status === 'error' ? 'text-red-400' : 'text-green-400'}>
                        {conn.last_sync_message}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleToggle(conn.id, conn.is_active)}
                    className="text-xs px-3 py-1 rounded border border-gray-600 text-gray-300 hover:bg-gray-600"
                  >
                    {conn.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                  <button
                    onClick={() => handleRemove(conn.id)}
                    className="text-xs px-3 py-1 rounded border border-red-700 text-red-400 hover:bg-red-900/30"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info */}
      <div className="mt-4 text-xs text-gray-500">
        <p>Share spreadsheet ke: <code className="text-gray-400">roove-bi-reader@roove-bi.iam.gserviceaccount.com</code> (Viewer)</p>
        <p className="mt-1">Auto-sync setiap jam. Data: PL (Laba Rugi), CF (Cash Flow), Rasio Keuangan.</p>
        <p className="mt-1">⚠️ Revenue basis: PL = Delivered | Daily Income = Confirmed (normal ada selisih)</p>
      </div>
    </div>
  );
}

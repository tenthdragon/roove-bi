// components/ScalevManager.tsx
'use client';

import { useState, useEffect } from 'react';
import { getScalevStatus, saveScalevApiKey, triggerScalevSync } from '@/lib/scalev-actions';

interface SyncLog {
  id: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  orders_fetched: number;
  orders_inserted: number;
  orders_updated: number;
  error_message: string | null;
  sync_type: string;
}

interface ScalevStatus {
  configured: boolean;
  configId: number | null;
  lastSyncId: number;
  totalOrders: number;
  shippedOrders: number;
  lastSync: SyncLog | null;
  recentSyncs: SyncLog[];
}

export default function ScalevManager() {
  const [status, setStatus] = useState<ScalevStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showApiForm, setShowApiForm] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const s = await getScalevStatus();
      setStatus(s);
      setShowApiForm(!s.configured);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveApiKey() {
    if (!apiKey.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      await saveScalevApiKey(apiKey.trim());
      setMessage({ type: 'success', text: 'API key berhasil disimpan!' });
      setShowApiForm(false);
      setApiKey('');
      await loadStatus();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleSync(mode: 'incremental' | 'full') {
    setSyncing(true);
    setMessage(null);
    try {
      const result = await triggerScalevSync(mode);
      setMessage({
        type: 'success',
        text: `Sync selesai! ${result.orders_fetched} orders di-fetch, ${result.orders_inserted} di-insert.`
      });
      await loadStatus();
    } catch (err: any) {
      setMessage({ type: 'error', text: `Sync gagal: ${err.message}` });
    } finally {
      setSyncing(false);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  if (loading && !status) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <p className="text-gray-500">Memuat status Scalev...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Scalev API Integration</h2>
          <p className="text-sm text-gray-500">
            Otomatis tarik data order dari Scalev — tidak perlu upload Excel manual
          </p>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-medium ${
          status?.configured
            ? 'bg-green-100 text-green-700'
            : 'bg-yellow-100 text-yellow-700'
        }`}>
          {status?.configured ? 'Terhubung' : 'Belum dikonfigurasi'}
        </div>
      </div>

      {/* Messages */}
      {message && (
        <div className={`p-3 rounded-lg text-sm ${
          message.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* API Key Configuration */}
      {showApiForm && (
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="font-medium text-gray-700 mb-2">Konfigurasi API Key</h3>
          <p className="text-xs text-gray-500 mb-3">
            Ambil API key dari Scalev dashboard &rarr; Settings &rarr; API Keys
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk_xxxxxxxxxx..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={handleSaveApiKey}
              disabled={!apiKey.trim() || loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Simpan
            </button>
          </div>
        </div>
      )}

      {/* Stats & Controls */}
      {status?.configured && (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-blue-50 rounded-lg">
              <p className="text-xs text-blue-600 font-medium">Total Orders</p>
              <p className="text-xl font-bold text-blue-800">
                {(status.totalOrders || 0).toLocaleString('id-ID')}
              </p>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <p className="text-xs text-green-600 font-medium">Shipped Orders</p>
              <p className="text-xl font-bold text-green-800">
                {(status.shippedOrders || 0).toLocaleString('id-ID')}
              </p>
            </div>
            <div className="p-3 bg-purple-50 rounded-lg">
              <p className="text-xs text-purple-600 font-medium">Last Sync ID</p>
              <p className="text-xl font-bold text-purple-800">
                {(status.lastSyncId || 0).toLocaleString('id-ID')}
              </p>
            </div>
            <div className="p-3 bg-orange-50 rounded-lg">
              <p className="text-xs text-orange-600 font-medium">Last Sync</p>
              <p className="text-sm font-bold text-orange-800">
                {status.lastSync
                  ? formatDate(status.lastSync.started_at)
                  : 'Belum pernah'}
              </p>
            </div>
          </div>

          {/* Sync Controls */}
          <div className="flex gap-3">
            <button
              onClick={() => handleSync('incremental')}
              disabled={syncing}
              className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? 'Syncing...' : 'Sync Incremental'}
            </button>
            <button
              onClick={() => handleSync('full')}
              disabled={syncing}
              className="px-4 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Full Sync
            </button>
            <button
              onClick={() => setShowApiForm(true)}
              className="px-4 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200"
            >
              Ganti API Key
            </button>
          </div>

          {/* Sync History */}
          {status.recentSyncs.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Riwayat Sync</h3>
              <div className="space-y-2">
                {status.recentSyncs.map((sync) => (
                  <div key={sync.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${
                        sync.status === 'success' ? 'bg-green-500'
                        : sync.status === 'error' ? 'bg-red-500'
                        : 'bg-yellow-500 animate-pulse'
                      }`} />
                      <span className="text-gray-600">
                        {formatDate(sync.started_at)}
                      </span>
                      <span className="text-gray-400 text-xs uppercase">
                        {sync.sync_type}
                      </span>
                    </div>
                    <div className="text-gray-500">
                      {sync.status === 'success' && (
                        <span>{sync.orders_fetched} fetched, {sync.orders_inserted} inserted</span>
                      )}
                      {sync.status === 'error' && (
                        <span className="text-red-500">{sync.error_message?.slice(0, 50)}</span>
                      )}
                      {sync.status === 'running' && (
                        <span className="text-yellow-600">Berjalan...</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

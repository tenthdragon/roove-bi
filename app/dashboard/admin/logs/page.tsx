// @ts-nocheck
// app/dashboard/admin/logs/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase-browser';

export default function LogsPage() {
  const supabase = createClient();
  const [logs, setLogs] = useState([]);
  const [excelImports, setExcelImports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => { loadLogs(); }, []);

  async function loadLogs() {
    setLoading(true);
    try {
      // Scalev sync + CSV upload logs
      const { data: syncLogs } = await supabase
        .from('scalev_sync_log')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(100);

      // Excel import logs
      const { data: imports } = await supabase
        .from('data_imports')
        .select('*')
        .order('imported_at', { ascending: false })
        .limit(100);

      setLogs(syncLogs || []);
      setExcelImports(imports || []);
    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      setLoading(false);
    }
  }

  // Merge and sort all logs by time
  const allLogs = (() => {
    const merged = [];

    for (const log of logs) {
      merged.push({
        id: `sync-${log.id}`,
        time: log.started_at,
        type: log.sync_type === 'csv_upload' ? 'CSV Upload' :
              log.sync_type === 'full' ? 'Scalev Full Sync' :
              log.sync_type === 'incremental' ? 'Scalev Incremental' : log.sync_type || 'Sync',
        status: log.status,
        detail: buildSyncDetail(log),
        filename: log.filename || null,
        uploadedBy: log.uploaded_by || null,
        error: log.error_message,
        category: log.sync_type === 'csv_upload' ? 'csv' : 'scalev',
      });
    }

    for (const imp of excelImports) {
      merged.push({
        id: `excel-${imp.id}`,
        time: imp.imported_at,
        type: 'Excel Upload',
        status: imp.status === 'completed' ? 'success' : imp.status,
        detail: `Periode: ${imp.period_month}/${imp.period_year} — ${imp.row_count || 0} rows`,
        filename: imp.filename || null,
        uploadedBy: null,
        error: null,
        category: 'excel',
      });
    }

    merged.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    if (filter === 'all') return merged;
    return merged.filter(l => l.category === filter);
  })();

  function buildSyncDetail(log) {
    const parts = [];
    if (log.orders_fetched) parts.push(`${log.orders_fetched} rows`);
    if (log.orders_inserted) parts.push(`${log.orders_inserted} baru`);
    if (log.orders_updated) parts.push(`${log.orders_updated} diperkaya`);
    return parts.join(' · ') || '—';
  }

  const FILTERS = [
    { id: 'all', label: 'Semua', count: null },
    { id: 'csv', label: 'CSV Upload', count: logs.filter(l => l.sync_type === 'csv_upload').length },
    { id: 'scalev', label: 'Scalev Sync', count: logs.filter(l => l.sync_type !== 'csv_upload').length },
    { id: 'excel', label: 'Excel Upload', count: excelImports.length },
  ];

  const statusStyle = (status) => {
    switch (status) {
      case 'success': return { bg: '#064e3b', color: '#10b981', label: 'Sukses' };
      case 'partial': return { bg: '#78350f', color: '#f59e0b', label: 'Partial' };
      case 'error': return { bg: '#7f1d1d', color: '#ef4444', label: 'Error' };
      case 'running': return { bg: '#1e3a5f', color: '#60a5fa', label: 'Running' };
      default: return { bg: '#1a2744', color: '#64748b', label: status };
    }
  };

  const typeStyle = (type) => {
    if (type.includes('CSV')) return { bg: '#164e63', color: '#06b6d4' };
    if (type.includes('Scalev')) return { bg: '#2e1065', color: '#8b5cf6' };
    if (type.includes('Excel')) return { bg: '#1e3a5f', color: '#3b82f6' };
    return { bg: '#1a2744', color: '#64748b' };
  };

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>Log Aktivitas Data</h2>
          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Riwayat semua upload dan sync data</p>
        </div>
        <a href="/dashboard/admin" style={{
          padding: '6px 14px', borderRadius: 8, border: '1px solid #1a2744',
          color: '#64748b', fontSize: 12, fontWeight: 600, textDecoration: 'none',
          background: '#0b1121',
        }}>
          ← Kembali ke Admin
        </a>
      </div>

      {/* Filter Pills */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '6px 14px', borderRadius: 20, border: '1px solid',
            borderColor: filter === f.id ? '#3b82f6' : '#1a2744',
            background: filter === f.id ? 'rgba(59,130,246,0.12)' : 'transparent',
            color: filter === f.id ? '#60a5fa' : '#94a3b8',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            {f.label} {f.count !== null && <span style={{ opacity: 0.7 }}>({f.count})</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="spinner" style={{ width: 32, height: 32, border: '3px solid #1a2744', borderTop: '3px solid #3b82f6', borderRadius: '50%' }} />
        </div>
      ) : allLogs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Belum ada log aktivitas</div>
      ) : (
        <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
              <thead>
                <tr style={{ background: '#0b1121' }}>
                  {['Waktu', 'Tipe', 'Status', 'Detail', 'File', 'Oleh'].map(h => (
                    <th key={h} style={{
                      padding: '10px 12px', textAlign: 'left', color: '#64748b',
                      fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                      borderBottom: '2px solid #1a2744',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allLogs.map((log) => {
                  const ss = statusStyle(log.status);
                  const ts = typeStyle(log.type);
                  return (
                    <tr key={log.id} style={{ borderBottom: '1px solid #0f172a' }}>
                      <td style={{ padding: '10px 12px', color: '#94a3b8', whiteSpace: 'nowrap', fontSize: 11 }}>
                        {new Date(log.time).toLocaleString('id-ID', {
                          day: '2-digit', month: 'short', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                          background: ts.bg, color: ts.color,
                        }}>{log.type}</span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                          background: ss.bg, color: ss.color,
                        }}>{ss.label}</span>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#e2e8f0' }}>
                        {log.detail}
                        {log.error && (
                          <div style={{ fontSize: 10, color: '#ef4444', marginTop: 2, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {log.error}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#64748b', fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {log.filename || '—'}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#64748b', fontSize: 11 }}>
                        {log.uploadedBy || '—'}
                      </td>
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
}

// components/CsvOrderUploader.tsx
'use client';

import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase-browser';

export default function CsvOrderUploader() {
  const supabase = createClient();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);

  // Load upload history
  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from('scalev_sync_log')
      .select('*')
      .eq('sync_type', 'csv_upload')
      .order('started_at', { ascending: false })
      .limit(10);
    setHistory(data || []);
  }, [supabase]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleUpload = useCallback(async (file) => {
    if (!file.name.endsWith('.csv')) {
      setError('File harus berformat .csv (semicolon-delimited dari Scalev export)');
      return;
    }

    setUploading(true);
    setError('');
    setResult(null);

    try {
      // Get current user email for tracking
      const { data: { user } } = await supabase.auth.getUser();

      const formData = new FormData();
      formData.append('file', file);
      if (user?.email) formData.append('uploaded_by', user.email);
      formData.append('filename', file.name);

      const res = await fetch('/api/csv-upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Upload gagal');
        return;
      }
      setResult(data);
      await loadHistory();
    } catch (err) {
      setError(err.message || 'Upload gagal');
    } finally {
      setUploading(false);
    }
  }, [supabase, loadHistory]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Upload Area */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Upload CSV Order</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          Upload file CSV export dari Scalev. Order baru akan ditambahkan, order yang sudah ada akan diperkaya (customer_type, lokasi, dll).
        </div>

        <div
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
            input.accept = '.csv';
            input.onchange = (e) => { const f = e.target.files[0]; if (f) handleUpload(f); };
            input.click();
          }}
          style={{
            border: `2px dashed ${dragOver ? '#06b6d4' : '#1a2744'}`,
            borderRadius: 10, padding: '24px 16px', textAlign: 'center',
            cursor: uploading ? 'not-allowed' : 'pointer',
            background: dragOver ? 'rgba(6,182,212,0.06)' : '#0b1121',
            transition: 'all 0.2s',
          }}
        >
          {uploading ? (
            <div>
              <div className="spinner" style={{
                width: 32, height: 32,
                border: '3px solid #1a2744', borderTop: '3px solid #06b6d4',
                borderRadius: '50%', margin: '0 auto 12px',
              }} />
              <div style={{ color: '#06b6d4', fontWeight: 600, fontSize: 13 }}>Mengupload & memproses CSV...</div>
              <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>Memeriksa duplikat & memperkaya data</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 28, marginBottom: 6 }}>📋</div>
              <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Drag & drop file CSV di sini</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>atau klik untuk memilih file (.csv semicolon-delimited)</div>
            </div>
          )}
        </div>

        {result && (
          <div style={{ marginTop: 14, padding: 14, background: '#064e3b', borderRadius: 8, border: '1px solid #065f46' }}>
            <div style={{ color: '#10b981', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
              ✅ {result.message}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
              <StatBox label="Total Rows" value={result.stats.totalRows} color="#94a3b8" />
              <StatBox label="Baru Ditambahkan" value={result.stats.newInserted} color="#10b981" />
              <StatBox label="Diperkaya" value={result.stats.updated || 0} color="#06b6d4" />
              {result.stats.errors > 0 && (
                <StatBox label="Error" value={result.stats.errors} color="#ef4444" />
              )}
            </div>
            {result.stats.errorDetails && result.stats.errorDetails.length > 0 && (
              <div style={{ marginTop: 10, padding: 10, background: '#7f1d1d', borderRadius: 6, fontSize: 11 }}>
                <div style={{ color: '#fca5a5', fontWeight: 600, marginBottom: 4 }}>Error details:</div>
                {result.stats.errorDetails.map((e, i) => (
                  <div key={i} style={{ color: '#fca5a5', marginBottom: 2 }}>• {e}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 14, padding: 12, background: '#7f1d1d', borderRadius: 8, color: '#ef4444', fontSize: 13 }}>
            ❌ {error}
          </div>
        )}
      </div>

      {/* Upload History */}
      {history.length > 0 && (
        <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Riwayat Upload CSV</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 550 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #1a2744' }}>
                  {['Waktu', 'File', 'Status', 'Baru', 'Diperkaya', 'Oleh'].map(h => (
                    <th key={h} style={{
                      padding: '8px 10px', textAlign: 'left', color: '#64748b',
                      fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} style={{ borderBottom: '1px solid #0f172a' }}>
                    <td style={{ padding: '8px 10px', color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {new Date(h.started_at).toLocaleString('id-ID', { 
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#e2e8f0', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {h.filename || 'CSV Upload'}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{
                        padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                        background: h.status === 'success' ? '#064e3b' : h.status === 'partial' ? '#78350f' : '#7f1d1d',
                        color: h.status === 'success' ? '#10b981' : h.status === 'partial' ? '#f59e0b' : '#ef4444',
                      }}>
                        {h.status === 'success' ? 'Sukses' : h.status === 'partial' ? 'Partial' : 'Error'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#10b981' }}>
                      {h.orders_inserted || 0}
                    </td>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#06b6d4' }}>
                      {h.orders_updated || 0}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#94a3b8', fontSize: 11 }}>
                      {h.uploaded_by || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ padding: 10, background: '#0b1121', borderRadius: 6, border: '1px solid #1a2744' }}>
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "'JetBrains Mono', monospace" }}>{value.toLocaleString('id-ID')}</div>
    </div>
  );
}

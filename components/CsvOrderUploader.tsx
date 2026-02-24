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
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from('scalev_sync_log')
      .select('*')
      .eq('sync_type', 'csv_upload')
      .order('started_at', { ascending: false })
      .limit(5);
    setHistory(data || []);
  }, [supabase]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleUpload = useCallback(async (file) => {
    if (!file.name.endsWith('.csv')) {
      setError('File harus berformat .csv (semicolon-delimited dari Scalev export)');
      return;
    }
    setUploading(true); setError(''); setResult(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const text = await file.text();
      const lines = text.split('\n');
      const header = lines[0];
      const dataLines = lines.slice(1).filter(l => l.trim());
      
      const CHUNK_SIZE = 3000;
      const totalChunks = Math.ceil(dataLines.length / CHUNK_SIZE);
      
      let finalResult = null;
      
      for (let c = 0; c < totalChunks; c++) {
        const chunkLines = dataLines.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
        const csvChunk = header + '\n' + chunkLines.join('\n');
        const blob = new Blob([csvChunk], { type: 'text/csv' });
        const chunkFile = new File([blob], file.name, { type: 'text/csv' });
        
        const formData = new FormData();
        formData.append('file', chunkFile);
        if (user?.email) formData.append('uploaded_by', user.email);
        formData.append('filename', `${file.name} (part ${c + 1}/${totalChunks})`);

        const res = await fetch('/api/csv-upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) { setError(data.error || `Upload gagal di chunk ${c + 1}`); return; }
        
        if (!finalResult) {
          finalResult = data;
        } else {
          finalResult.stats.totalRows += data.stats.totalRows;
          finalResult.stats.newInserted += data.stats.newInserted;
          finalResult.stats.updated += data.stats.updated;
          finalResult.stats.errors += data.stats.errors;
          finalResult.stats.lineItems = (finalResult.stats.lineItems || 0) + (data.stats.lineItems || 0);
        }
      }
      
      if (finalResult) {
        finalResult.message = `Upload selesai (${totalChunks} parts)! ${finalResult.stats.newInserted} order baru, ${finalResult.stats.updated} order diperkaya, ${finalResult.stats.lineItems || 0} line items, ${finalResult.stats.errors} error.`;
        setResult(finalResult);
      }
      await loadHistory();
    } catch (err) { setError(err.message || 'Upload gagal'); }
    finally { setUploading(false); }
  }, [supabase, loadHistory]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Upload Area */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Upload CSV Order</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          Upload CSV export dari Scalev. Order baru ditambahkan, yang sudah ada diperkaya (customer_type, lokasi, dll).
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '.csv';
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
              <div className="spinner" style={{ width: 32, height: 32, border: '3px solid #1a2744', borderTop: '3px solid #06b6d4', borderRadius: '50%', margin: '0 auto 12px' }} />
              <div style={{ color: '#06b6d4', fontWeight: 600, fontSize: 13 }}>Mengupload & memproses CSV...</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 28, marginBottom: 6 }}>📋</div>
              <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Drag & drop file CSV di sini</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>atau klik untuk memilih file</div>
            </div>
          )}
        </div>

        {/* Upload Result */}
        {result && (
          <div style={{ marginTop: 14, padding: 14, background: '#064e3b', borderRadius: 8, border: '1px solid #065f46' }}>
            <div style={{ color: '#10b981', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>✅ {result.message}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
              <StatBox label="Total Rows" value={result.stats.totalRows} color="#94a3b8" />
              <StatBox label="Baru" value={result.stats.newInserted} color="#10b981" />
              <StatBox label="Diperkaya" value={result.stats.updated || 0} color="#06b6d4" />
              {result.stats.errors > 0 && <StatBox label="Error" value={result.stats.errors} color="#ef4444" />}
            </div>
            {result.stats.errorDetails?.length > 0 && (
              <div style={{ marginTop: 10, padding: 10, background: '#7f1d1d', borderRadius: 6, fontSize: 11 }}>
                {result.stats.errorDetails.map((e, i) => <div key={i} style={{ color: '#fca5a5', marginBottom: 2 }}>• {e}</div>)}
              </div>
            )}
          </div>
        )}
        {error && <div style={{ marginTop: 14, padding: 12, background: '#7f1d1d', borderRadius: 8, color: '#ef4444', fontSize: 13 }}>❌ {error}</div>}
      </div>

      {/* Recent History - Collapsible */}
      {history.length > 0 && (
        <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, overflow: 'hidden' }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 20px', background: 'none', border: 'none', cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
              Riwayat Upload Terakhir <span style={{ fontWeight: 400, color: '#64748b' }}>({history.length})</span>
            </span>
            <span style={{ fontSize: 12, color: '#64748b', transform: showHistory ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▼</span>
          </button>
          {showHistory && (
            <div style={{ padding: '0 20px 16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {history.map((h) => (
                  <div key={h.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 12px', background: '#0b1121', border: '1px solid #1a2744', borderRadius: 8, fontSize: 12,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: h.status === 'success' ? '#10b981' : h.status === 'partial' ? '#f59e0b' : '#ef4444',
                      }} />
                      <span style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {new Date(h.started_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {h.filename && (
                        <span style={{ color: '#64748b', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {h.filename}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      {h.orders_inserted > 0 && <span style={{ color: '#10b981', fontSize: 11 }}>+{h.orders_inserted}</span>}
                      {h.orders_updated > 0 && <span style={{ color: '#06b6d4', fontSize: 11 }}>↑{h.orders_updated}</span>}
                      {h.uploaded_by && <span style={{ color: '#475569', fontSize: 10 }}>{h.uploaded_by.split('@')[0]}</span>}
                    </div>
                  </div>
                ))}
              </div>
              <a href="/dashboard/admin/logs" style={{
                display: 'block', textAlign: 'center', marginTop: 10,
                color: '#3b82f6', fontSize: 12, fontWeight: 600, textDecoration: 'none',
              }}>
                Lihat semua log →
              </a>
            </div>
          )}
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

// components/CsvOrderUploader.tsx
'use client';

import { useState, useCallback } from 'react';

export default function CsvOrderUploader() {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleUpload = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setError('File harus berformat .csv (semicolon-delimited dari Scalev export)');
      return;
    }

    setUploading(true);
    setError('');
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

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
    } catch (err: any) {
      setError(err.message || 'Upload gagal');
    } finally {
      setUploading(false);
    }
  }, []);

  return (
    <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Upload CSV Order</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
        Upload file CSV export dari Scalev. Data dengan order_id yang sudah ada akan di-skip (tidak duplikat). 
        Data baru akan ditambahkan ke database.
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) handleUpload(f);
        }}
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.csv';
          input.onchange = (e: any) => { const f = e.target.files[0]; if (f) handleUpload(f); };
          input.click();
        }}
        style={{
          border: `2px dashed ${dragOver ? '#3b82f6' : '#1a2744'}`,
          borderRadius: 10,
          padding: '24px 16px',
          textAlign: 'center',
          cursor: uploading ? 'not-allowed' : 'pointer',
          background: dragOver ? 'rgba(59,130,246,0.06)' : '#0b1121',
          transition: 'all 0.2s',
        }}
      >
        {uploading ? (
          <div>
            <div className="spinner" style={{
              width: 32, height: 32,
              border: '3px solid #1a2744', borderTop: '3px solid #8b5cf6',
              borderRadius: '50%', margin: '0 auto 12px',
            }} />
            <div style={{ color: '#8b5cf6', fontWeight: 600, fontSize: 13 }}>Mengupload & memproses CSV...</div>
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>Memeriksa duplikat & menyimpan data baru</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 28, marginBottom: 6 }}>📋</div>
            <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Drag & drop file CSV di sini</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>atau klik untuk memilih file (.csv semicolon-delimited)</div>
          </div>
        )}
      </div>

      {/* Success Result */}
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
              {result.stats.errorDetails.map((e: string, i: number) => (
                <div key={i} style={{ color: '#fca5a5', marginBottom: 2 }}>• {e}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ marginTop: 14, padding: 12, background: '#7f1d1d', borderRadius: 8, color: '#ef4444', fontSize: 13 }}>
          ❌ {error}
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 10, background: '#0b1121', borderRadius: 6, border: '1px solid #1a2744' }}>
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "'JetBrains Mono', monospace" }}>{value.toLocaleString('id-ID')}</div>
    </div>
  );
}

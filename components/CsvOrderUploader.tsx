// components/CsvOrderUploader.tsx
'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSupabase } from '@/lib/supabase-browser';

export default function CsvOrderUploader() {
  const supabase = useSupabase();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [fileQueue, setFileQueue] = useState<{ name: string; status: 'pending' | 'processing' | 'done'; chunk: number; totalChunks: number; pct: number }[]>([]);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from('scalev_sync_log')
      .select('*')
      .in('sync_type', ['csv_upload', 'ops_upload'])
      .order('started_at', { ascending: false })
      .limit(5);
    setHistory(data || []);
  }, [supabase]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleUpload = useCallback(async (files: File[]) => {
    const csvFiles = files.filter(f => f.name.endsWith('.csv'));
    const skipped = files.length - csvFiles.length;
    if (csvFiles.length === 0) {
      setError('Tidak ada file .csv yang ditemukan.' + (skipped > 0 ? ` ${skipped} file non-CSV di-skip.` : ''));
      return;
    }

    setUploading(true);
    setError('');
    setResults([]);

    // Initialize queue
    const initialQueue = csvFiles.map(f => ({ name: f.name, status: 'pending' as const, chunk: 0, totalChunks: 1, pct: 0 }));
    setFileQueue(initialQueue);

    const allResults: any[] = [];

    try {
      const { data: { user } } = await supabase.auth.getUser();

      for (let fi = 0; fi < csvFiles.length; fi++) {
        const file = csvFiles[fi];

        // Mark as processing
        setFileQueue(q => q.map((item, i) => i === fi ? { ...item, status: 'processing' } : item));

        try {
          const text = await file.text();
          const lines = text.split('\n');
          const header = lines[0];
          const dataLines = lines.slice(1).filter(l => l.trim());

          if (dataLines.length === 0) {
            allResults.push({ filename: file.name, error: 'File kosong (tidak ada data rows)' });
            setFileQueue(q => q.map((item, i) => i === fi ? { ...item, status: 'done', pct: 100 } : item));
            setResults([...allResults]);
            continue;
          }

          const CHUNK_SIZE = 3000;
          const totalChunks = Math.ceil(dataLines.length / CHUNK_SIZE);
          let finalResult: any = null;
          let fileError = false;

          setFileQueue(q => q.map((item, i) => i === fi ? { ...item, totalChunks } : item));

          for (let c = 0; c < totalChunks; c++) {
            // Update chunk progress
            setFileQueue(q => q.map((item, i) => i === fi ? { ...item, chunk: c, pct: Math.round((c / totalChunks) * 100) } : item));

            const chunkLines = dataLines.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
            const csvChunk = header + '\n' + chunkLines.join('\n');
            const blob = new Blob([csvChunk], { type: 'text/csv' });
            const chunkFile = new File([blob], file.name, { type: 'text/csv' });

            const formData = new FormData();
            formData.append('file', chunkFile);
            if (user?.email) formData.append('uploaded_by', user.email);
            formData.append('filename', csvFiles.length > 1
              ? `${file.name} (file ${fi + 1}/${csvFiles.length}${totalChunks > 1 ? `, part ${c + 1}/${totalChunks}` : ''})`
              : `${file.name}${totalChunks > 1 ? ` (part ${c + 1}/${totalChunks})` : ''}`
            );

            const res = await fetch('/api/csv-upload', { method: 'POST', body: formData });
            const data = await res.json();

            if (!res.ok) {
              allResults.push({ filename: file.name, error: data.error || `Upload gagal di chunk ${c + 1}` });
              fileError = true;
              break;
            }

            if (!finalResult) {
              finalResult = { ...data, filename: file.name };
            } else {
              finalResult.stats.totalRows += data.stats.totalRows;
              finalResult.stats.newInserted += data.stats.newInserted;
              finalResult.stats.updated += data.stats.updated;
              finalResult.stats.errors += data.stats.errors;
              finalResult.stats.lineItems = (finalResult.stats.lineItems || 0) + (data.stats.lineItems || 0);
              if (data.stats.cogsLookedUp) {
                finalResult.stats.cogsLookedUp = (finalResult.stats.cogsLookedUp || 0) + data.stats.cogsLookedUp;
              }
            }

            // Update progress after chunk completes
            setFileQueue(q => q.map((item, i) => i === fi ? { ...item, chunk: c + 1, pct: Math.round(((c + 1) / totalChunks) * 100) } : item));
          }

          if (!fileError && finalResult) allResults.push(finalResult);
        } catch (fileErr: any) {
          allResults.push({ filename: file.name, error: fileErr.message || 'Error tidak diketahui' });
        }

        // Mark done
        setFileQueue(q => q.map((item, i) => i === fi ? { ...item, status: 'done', pct: 100 } : item));
        setResults([...allResults]);
      }

      setResults(allResults);
      await loadHistory();
    } catch (err: any) {
      setError(err.message || 'Upload gagal');
    } finally {
      setUploading(false);
    }
  }, [supabase, loadHistory]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
      {/* Upload Area */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Upload CSV Order</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          Upload CSV dari <strong style={{ color: '#06b6d4' }}>Scalev</strong> (semicolon) atau <strong style={{ color: '#10b981' }}>Tim Ops</strong> (comma, marketplace).
          Format otomatis terdeteksi.
        </div>

        {/* Format info */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: '#0e2a47', color: '#06b6d4', fontWeight: 600 }}>
            📋 Scalev → financial + COGS
          </span>
          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: '#052e16', color: '#10b981', fontWeight: 600 }}>
            👥 Tim Ops → customer identity
          </span>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault(); setDragOver(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) handleUpload(files);
          }}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv';
            input.multiple = true;
            input.onchange = (e: any) => {
              const files = Array.from(e.target.files) as File[];
              if (files.length > 0) handleUpload(files);
            };
            input.click();
          }}
          style={{
            border: `2px dashed ${dragOver ? '#06b6d4' : '#1a2744'}`,
            borderRadius: 10,
            padding: '24px 16px',
            textAlign: 'center',
            cursor: uploading ? 'not-allowed' : 'pointer',
            background: dragOver ? 'rgba(6,182,212,0.06)' : '#0b1121',
            transition: 'all 0.2s',
          }}
        >
          {uploading ? (
            <div>
              <div className="spinner" style={{
                width: 24, height: 24,
                border: '3px solid #1a2744', borderTop: '3px solid #06b6d4',
                borderRadius: '50%', margin: '0 auto 8px'
              }} />
              <div style={{ color: '#06b6d4', fontWeight: 600, fontSize: 12 }}>
                {(() => {
                  const processing = fileQueue.find(f => f.status === 'processing');
                  const done = fileQueue.filter(f => f.status === 'done').length;
                  if (processing) return `${done + 1}/${fileQueue.length}: ${processing.name}`;
                  return 'Memproses...';
                })()}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 28, marginBottom: 6 }}>📋</div>
              <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Drag & drop file CSV di sini</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Bisa pilih banyak file sekaligus (Scalev + Tim Ops campur)</div>
            </div>
          )}
        </div>

        {/* Upload Results & Progress */}
        {(results.length > 0 || fileQueue.length > 0) && (
          <div style={{ marginTop: 14, background: '#0b1121', borderRadius: 8, border: '1px solid #1a2744', overflow: 'hidden' }}>
            <div style={{ padding: '6px 12px', background: '#111a2e', borderBottom: '1px solid #1a2744', display: 'flex', gap: 12, fontSize: 9, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
              <span style={{ flex: 1, minWidth: 0 }}>File</span>
              <span style={{ width: 40, textAlign: 'right' }}>Rows</span>
              <span style={{ width: 40, textAlign: 'right' }}>Baru</span>
              <span style={{ width: 40, textAlign: 'right' }}>Fix</span>
              <span style={{ width: 40, textAlign: 'right' }}>Items</span>
            </div>
            {fileQueue.map((fq, idx) => {
              const result = results.find(r => r.filename === fq.name);
              const isError = result?.error;
              const isDone = fq.status === 'done' && result && !isError;
              const isProcessing = fq.status === 'processing';
              const isPending = fq.status === 'pending';

              return (
                <div key={idx} style={{
                  borderBottom: idx < fileQueue.length - 1 ? '1px solid #1a2744' : 'none',
                  position: 'relative', overflow: 'hidden',
                }}>
                  {/* Progress bar background for processing files */}
                  {isProcessing && (
                    <div style={{
                      position: 'absolute', top: 0, left: 0, bottom: 0,
                      width: `${Math.max(fq.pct, 15)}%`,
                      background: 'linear-gradient(90deg, rgba(6,182,212,0.15), rgba(6,182,212,0.05))',
                      borderRight: fq.pct > 0 && fq.pct < 100 ? '2px solid rgba(6,182,212,0.4)' : 'none',
                      transition: 'width 0.4s ease',
                    }} />
                  )}
                  <div style={{
                    display: 'flex', gap: 12, alignItems: 'center',
                    padding: '5px 12px', fontSize: 11,
                    position: 'relative',
                    opacity: isPending ? 0.4 : 1,
                  }}>
                    {isError ? (
                      <span style={{ flex: 1, color: '#ef4444', fontSize: 11 }}>❌ {fq.name}: {result.error}</span>
                    ) : (
                      <>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                          {isDone && <span style={{ color: '#10b981', fontSize: 10, flexShrink: 0 }}>✅</span>}
                          {isProcessing && <span style={{ color: '#06b6d4', fontSize: 10, flexShrink: 0, display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>}
                          {isPending && <span style={{ color: '#475569', fontSize: 10, flexShrink: 0 }}>⏳</span>}
                          {isDone && (
                            <span style={{
                              fontSize: 8, padding: '1px 4px', borderRadius: 3, fontWeight: 700, flexShrink: 0,
                              background: result.stats.format === 'ops-marketplace' ? '#052e16' : '#0e2a47',
                              color: result.stats.format === 'ops-marketplace' ? '#10b981' : '#06b6d4',
                            }}>
                              {result.stats.format === 'ops-marketplace' ? 'OPS' : 'SCV'}
                            </span>
                          )}
                          <span style={{
                            color: isDone ? '#e2e8f0' : isProcessing ? '#06b6d4' : '#475569',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11,
                          }}>
                            {fq.name}
                          </span>
                        </div>
                        {isDone ? (
                          <>
                            <span style={{ width: 40, textAlign: 'right', color: '#94a3b8', fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{result.stats.totalRows}</span>
                            <span style={{ width: 40, textAlign: 'right', color: '#10b981', fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{result.stats.newInserted}</span>
                            <span style={{ width: 40, textAlign: 'right', color: '#06b6d4', fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{result.stats.updated || 0}</span>
                            <span style={{ width: 40, textAlign: 'right', color: '#8b5cf6', fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{result.stats.lineItems || 0}</span>
                          </>
                        ) : isProcessing && fq.totalChunks > 1 ? (
                          <span style={{ width: 172, textAlign: 'right', color: '#475569', fontSize: 10 }}>
                            chunk {fq.chunk}/{fq.totalChunks}
                          </span>
                        ) : (
                          <span style={{ width: 172 }} />
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {results.filter(r => !r.error).length > 1 && !uploading && (
              <div style={{
                display: 'flex', gap: 12, padding: '5px 12px', fontSize: 10, fontWeight: 700,
                borderTop: '1px solid #1e3a5f', background: '#111a2e',
              }}>
                <span style={{ flex: 1, color: '#64748b' }}>Total ({results.filter(r => !r.error).length} files)</span>
                <span style={{ width: 40, textAlign: 'right', color: '#94a3b8', fontFamily: "'JetBrains Mono', monospace" }}>
                  {results.filter(r => !r.error).reduce((s, r) => s + r.stats.totalRows, 0)}
                </span>
                <span style={{ width: 40, textAlign: 'right', color: '#10b981', fontFamily: "'JetBrains Mono', monospace" }}>
                  {results.filter(r => !r.error).reduce((s, r) => s + r.stats.newInserted, 0)}
                </span>
                <span style={{ width: 40, textAlign: 'right', color: '#06b6d4', fontFamily: "'JetBrains Mono', monospace" }}>
                  {results.filter(r => !r.error).reduce((s, r) => s + (r.stats.updated || 0), 0)}
                </span>
                <span style={{ width: 40, textAlign: 'right', color: '#8b5cf6', fontFamily: "'JetBrains Mono', monospace" }}>
                  {results.filter(r => !r.error).reduce((s, r) => s + (r.stats.lineItems || 0), 0)}
                </span>
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

      {/* Recent History */}
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
            <span style={{
              fontSize: 12, color: '#64748b',
              transform: showHistory ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform 0.2s'
            }}>▼</span>
          </button>

          {showHistory && (
            <div style={{ padding: '0 20px 16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {history.map((h) => (
                  <div key={h.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 12px', background: '#0b1121',
                    border: '1px solid #1a2744', borderRadius: 8, fontSize: 12,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: h.status === 'success' ? '#10b981' : h.status === 'partial' ? '#f59e0b' : '#ef4444',
                      }} />
                      <span style={{
                        fontSize: 10, padding: '1px 5px', borderRadius: 3, fontWeight: 700, flexShrink: 0,
                        background: h.sync_type === 'ops_upload' ? '#052e16' : '#0e2a47',
                        color: h.sync_type === 'ops_upload' ? '#10b981' : '#06b6d4',
                      }}>
                        {h.sync_type === 'ops_upload' ? 'OPS' : 'SCV'}
                      </span>
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

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 10, background: '#0b1121', borderRadius: 6, border: '1px solid #1a2744' }}>
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "'JetBrains Mono', monospace" }}>
        {value.toLocaleString('id-ID')}
      </div>
    </div>
  );
}

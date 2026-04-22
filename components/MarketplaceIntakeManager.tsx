// @ts-nocheck
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const panelStyle = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 16,
  boxShadow: 'var(--shadow)',
};

const STATUS_META = {
  ready: { label: 'Ready', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  needs_review: { label: 'Needs Review', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  identified: { label: 'Identified', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  not_identified: { label: 'Not Identified', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  store_unmapped: { label: 'Store Unmapped', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  entity_mismatch: { label: 'Entity Mismatch', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

function fmtNumber(value) {
  return new Intl.NumberFormat('id-ID').format(Number(value || 0));
}

function fmtCurrency(value) {
  return `Rp ${fmtNumber(Math.round(Number(value || 0)))}`;
}

function getCurrentMonthValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function fmtDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function fmtMonthLabel(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return value || '-';
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
  }).format(parsed);
}

function StatusPill({ status }) {
  const meta = STATUS_META[status] || { label: status, color: 'var(--dim)', bg: 'rgba(148,163,184,0.12)' };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 9px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: meta.bg,
        color: meta.color,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  );
}

function SummaryCard({ label, value, tone = 'default', helper }) {
  const color = tone === 'danger'
    ? '#ef4444'
    : tone === 'warn'
      ? '#f59e0b'
      : tone === 'success'
        ? '#22c55e'
        : 'var(--text)';

  const bg = tone === 'danger'
    ? 'rgba(239,68,68,0.08)'
    : tone === 'warn'
      ? 'rgba(245,158,11,0.08)'
      : tone === 'success'
        ? 'rgba(34,197,94,0.08)'
        : 'var(--bg)';

  return (
    <div
      style={{
        background: bg,
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 14,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800, color }}>
        {fmtNumber(value)}
      </div>
      {helper ? (
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dim)' }}>{helper}</div>
      ) : null}
    </div>
  );
}

export default function MarketplaceIntakeManager() {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [search, setSearch] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState({});
  const [manualSelections, setManualSelections] = useState({});
  const [lineSearchQueries, setLineSearchQueries] = useState({});
  const [lineSearchResults, setLineSearchResults] = useState({});
  const [searchingLineKey, setSearchingLineKey] = useState('');
  const [historyMonth, setHistoryMonth] = useState(getCurrentMonthValue());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyRows, setHistoryRows] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [selectedBatchDetail, setSelectedBatchDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  function getLineKey(orderId, lineIndex) {
    return `${orderId}::${lineIndex}`;
  }

  useEffect(() => {
    loadHistory(getCurrentMonthValue());
  }, []);

  async function loadBatchDetail(batchId) {
    if (!batchId) {
      setSelectedBatchId(null);
      setSelectedBatchDetail(null);
      return;
    }

    setDetailLoading(true);
    setHistoryError('');

    try {
      const res = await fetch(`/api/marketplace-intake/history/${batchId}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal membaca detail riwayat intake.');
      }
      setSelectedBatchId(Number(batchId));
      setSelectedBatchDetail(data);
    } catch (err) {
      console.error(err);
      setHistoryError(err?.message || 'Gagal membaca detail riwayat intake.');
      setSelectedBatchId(null);
      setSelectedBatchDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadHistory(month, preferredBatchId = null) {
    const monthValue = String(month || getCurrentMonthValue());
    setHistoryLoading(true);
    setHistoryError('');

    try {
      const res = await fetch(`/api/marketplace-intake/history?month=${encodeURIComponent(monthValue)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal membaca riwayat intake.');
      }

      const rows = data.batches || [];
      setHistoryRows(rows);

      const nextSelectedBatchId = preferredBatchId
        || (rows.some((row) => Number(row.id) === Number(selectedBatchId)) ? Number(selectedBatchId) : null);

      if (nextSelectedBatchId) {
        await loadBatchDetail(nextSelectedBatchId);
      } else {
        setSelectedBatchId(null);
        setSelectedBatchDetail(null);
      }
    } catch (err) {
      console.error(err);
      setHistoryError(err?.message || 'Gagal membaca riwayat intake.');
      setHistoryRows([]);
      setSelectedBatchId(null);
      setSelectedBatchDetail(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  const visibleOrders = useMemo(() => {
    if (!preview?.orders) return [];
    const query = String(search || '').trim().toLowerCase();
    return preview.orders.filter((order) => {
      if (issuesOnly && order.orderStatus === 'ready') return false;
      if (!query) return true;
      const haystack = [
        order.externalOrderId,
        order.customerLabel,
        order.finalStoreName,
        ...(order.issueCodes || []),
        ...(order.lines || []).flatMap((line) => [
          line.mpSku,
          line.mpProductName,
          line.matchedEntityLabel,
          line.mappedStoreName,
        ]),
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [issuesOnly, preview, search]);

  const unresolvedSelectionCount = useMemo(() => {
    if (!preview?.orders) return 0;
    let missing = 0;
    for (const order of preview.orders) {
      for (const line of order.lines || []) {
        if (line.lineStatus === 'not_identified' && !manualSelections[getLineKey(order.externalOrderId, line.lineIndex)]) {
          missing += 1;
        }
      }
    }
    return missing;
  }, [manualSelections, preview]);

  const blockingOrderCount = useMemo(() => {
    if (!preview?.orders) return 0;
    let count = 0;
    for (const order of preview.orders) {
      const unresolvedLineWithoutSelection = (order.lines || []).some((line) => (
        line.lineStatus === 'not_identified'
        && !manualSelections[getLineKey(order.externalOrderId, line.lineIndex)]
      ));
      const hasBlockingIssue = (order.lines || []).some((line) => line.lineStatus === 'store_unmapped' || line.lineStatus === 'entity_mismatch')
        || (order.issueCodes || []).includes('store_amount_tie');
      if (unresolvedLineWithoutSelection || hasBlockingIssue) count += 1;
    }
    return count;
  }, [manualSelections, preview]);

  const canConfirm = Boolean(
    preview
    && preview.summary
    && preview.summary.totalOrders > 0
    && preview.summary.unresolvedStoreLines === 0
    && unresolvedSelectionCount === 0
    && blockingOrderCount === 0
    && !confirming,
  );

  async function handleUpload(file) {
    if (!file) return;
    setUploading(true);
    setError('');
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('filename', file.name);

      const res = await fetch('/api/marketplace-intake/preview', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal membaca file Shopee RLT.');
      }

      const initialSelections = {};
      for (const order of data.orders || []) {
        for (const line of order.lines || []) {
          if (line.selectedSuggestion) {
            initialSelections[getLineKey(order.externalOrderId, line.lineIndex)] = line.selectedSuggestion;
          }
        }
      }

      setPreview(data);
      setExpandedOrders({});
      setSearch('');
      setIssuesOnly(Boolean(data.summary?.needsReviewOrders));
      setManualSelections(initialSelections);
      setLineSearchQueries({});
      setLineSearchResults({});
      setMessage({
        type: 'success',
        text: `Preview selesai. ${fmtNumber(data.summary?.readyOrders || 0)} order siap, ${fmtNumber(data.summary?.needsReviewOrders || 0)} perlu review, ${fmtNumber(Object.keys(initialSelections).length)} line sudah preselect dari ingatan manual.`,
      });
    } catch (err) {
      console.error(err);
      setPreview(null);
      setError(err?.message || 'Gagal memproses file Shopee RLT.');
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirm() {
    if (!preview || !canConfirm) return;

    setConfirming(true);
    setError('');
    setMessage(null);

    try {
      const res = await fetch('/api/marketplace-intake/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preview,
          manualSelections: Object.entries(manualSelections).map(([key, candidate]) => {
            const [externalOrderId, lineIndexText] = key.split('::');
            return {
              externalOrderId,
              lineIndex: Number(lineIndexText),
              scalevBundleId: Number(candidate?.scalevBundleId || 0),
            };
          }).filter((row) => row.externalOrderId && Number.isFinite(row.lineIndex) && row.scalevBundleId > 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal menyimpan preview intake.');
      }

      const savedMonth = String(preview.sourceOrderDate || getCurrentMonthValue()).slice(0, 7);
      setPreview(null);
      setExpandedOrders({});
      setManualSelections({});
      setLineSearchQueries({});
      setLineSearchResults({});
      setSearch('');
      setIssuesOnly(false);
      setHistoryMonth(savedMonth);
      await loadHistory(savedMonth, data.batchId);

      setMessage({
        type: 'success',
        text: data.message || `Batch #${data.batchId} berhasil disimpan dan masuk ke riwayat.`,
      });
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal menyimpan preview intake.');
    } finally {
      setConfirming(false);
    }
  }

  function toggleExpanded(orderId) {
    setExpandedOrders((current) => ({
      ...current,
      [orderId]: !current[orderId],
    }));
  }

  function setManualSelection(orderId, lineIndex, candidate) {
    const key = getLineKey(orderId, lineIndex);
    setManualSelections((current) => ({
      ...current,
      [key]: candidate,
    }));
  }

  async function handleSearchBundles(orderId, lineIndex) {
    const key = getLineKey(orderId, lineIndex);
    const query = String(lineSearchQueries[key] || '').trim();
    if (query.length < 2) return;

    setSearchingLineKey(key);
    try {
      const res = await fetch(`/api/marketplace-intake/search-bundles?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal mencari bundle.');
      }
      setLineSearchResults((current) => ({
        ...current,
        [key]: data.results || [],
      }));
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal mencari bundle.');
    } finally {
      setSearchingLineKey('');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Upload Shopee RLT</div>
            <div style={{ fontSize: 13, color: 'var(--dim)', maxWidth: 840, lineHeight: 1.6 }}>
              Halaman ini hanya membaca export <strong>Shopee RLT</strong>. File yang namanya mengandung <strong>SPX</strong> tetap diperlakukan sebagai Shopee.
              App akan match exact <strong>SKU Excel</strong> ke <strong>bundle custom_id</strong> di business <strong>RLT</strong>, lalu mengklasifikasikan store secara langsung berdasarkan keluarga bundle tersebut.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 11, padding: '5px 10px', borderRadius: 999, background: 'rgba(238,77,45,0.12)', color: '#ee4d2d', fontWeight: 700 }}>
              Source: Shopee RLT
            </span>
            <span style={{ fontSize: 11, padding: '5px 10px', borderRadius: 999, background: 'rgba(59,130,246,0.12)', color: '#60a5fa', fontWeight: 700 }}>
              Business: RLT
            </span>
          </div>
        </div>

        {message ? (
          <div
            style={{
              marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 10,
              fontSize: 13,
              background: message.type === 'success' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
              color: message.type === 'success' ? '#6ee7b7' : '#fca5a5',
              border: `1px solid ${message.type === 'success' ? 'rgba(16,185,129,0.24)' : 'rgba(239,68,68,0.24)'}`,
            }}
          >
            {message.text}
          </div>
        ) : null}

        {error ? (
          <div
            style={{
              marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 10,
              fontSize: 13,
              background: 'rgba(239,68,68,0.12)',
              color: '#fca5a5',
              border: '1px solid rgba(239,68,68,0.24)',
            }}
          >
            {error}
          </div>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleUpload(file);
            event.target.value = '';
          }}
        />

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const file = event.dataTransfer.files?.[0];
            if (file) handleUpload(file);
          }}
          onClick={() => {
            if (uploading) return;
            inputRef.current?.click();
          }}
          style={{
            border: `2px dashed ${dragOver ? '#ee4d2d' : 'var(--border)'}`,
            borderRadius: 12,
            padding: '26px 18px',
            textAlign: 'center',
            background: dragOver ? 'rgba(238,77,45,0.05)' : 'var(--bg)',
            cursor: uploading ? 'wait' : 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          {uploading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  border: '3px solid var(--border)',
                  borderTopColor: '#ee4d2d',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <div style={{ fontSize: 13, fontWeight: 700, color: '#ee4d2d' }}>Membaca file Shopee RLT…</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              <div style={{ fontSize: 30 }}>📦</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Drag & drop file Shopee RLT di sini</div>
              <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                Support `.xlsx`, `.xls`, atau `.csv` Shopee/SPX
              </div>
            </div>
          )}
        </div>

        <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
      </div>

      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Riwayat Intake</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
              Month selector di bawah ini mengikuti <strong>tanggal order file</strong>, bukan jam upload. Batch siang dan sore di hari order yang sama akan tetap muncul terpisah.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="month"
              value={historyMonth}
              onChange={async (event) => {
                const nextMonth = event.target.value || getCurrentMonthValue();
                setHistoryMonth(nextMonth);
                await loadHistory(nextMonth);
              }}
              style={{
                padding: '9px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              onClick={() => loadHistory(historyMonth, selectedBatchId)}
              style={{
                padding: '9px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {historyLoading ? 'Memuat...' : 'Refresh'}
            </button>
          </div>
        </div>

        {historyError ? (
          <div
            style={{
              marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 10,
              fontSize: 13,
              background: 'rgba(239,68,68,0.12)',
              color: '#fca5a5',
              border: '1px solid rgba(239,68,68,0.24)',
            }}
          >
            {historyError}
          </div>
        ) : null}

        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Tanggal Order</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Uploaded</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Batch</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>File</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Order</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Line</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Siap</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Uploaded By</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row) => {
                const isSelected = Number(selectedBatchId) === Number(row.id);
                return (
                  <tr
                    key={row.id}
                    onClick={() => loadBatchDetail(row.id)}
                    style={{
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(59,130,246,0.08)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>{row.sourceOrderDate || '-'}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>{fmtDateTime(row.confirmedAt)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700 }}>#{row.id}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>{row.filename}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtNumber(row.totalOrders)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtNumber(row.totalLines)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtNumber(row.readyOrders)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>{row.uploadedByEmail || '-'}</td>
                  </tr>
                );
              })}

              {!historyLoading && historyRows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 18, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
                    Belum ada riwayat intake untuk bulan order {fmtMonthLabel(historyMonth)}.
                  </td>
                </tr>
              ) : null}

              {historyLoading ? (
                <tr>
                  <td colSpan={8} style={{ padding: 18, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
                    Memuat riwayat intake...
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {detailLoading ? (
          <div style={{ marginTop: 14, fontSize: 13, color: 'var(--dim)' }}>Memuat detail batch...</div>
        ) : null}

        {selectedBatchDetail?.batch ? (
          <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>Detail Batch #{selectedBatchDetail.batch.id}</div>
                <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
                  {selectedBatchDetail.batch.filename} • tanggal order {selectedBatchDetail.batch.sourceOrderDate || '-'} • uploaded {fmtDateTime(selectedBatchDetail.batch.confirmedAt)}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                {fmtNumber(selectedBatchDetail.batch.totalOrders)} order • {fmtNumber(selectedBatchDetail.batch.totalLines)} line • {fmtNumber(selectedBatchDetail.batch.readyOrders)} siap
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Order MP</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Customer</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Store Final</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Line</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Amount</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Status</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Tracking</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedBatchDetail.orders || []).map((order) => (
                    <tr key={order.externalOrderId}>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700 }}>{order.externalOrderId}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>{order.customerLabel || order.recipientName || '-'}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>{order.finalStoreName || '-'}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtNumber(order.lineCount)}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtCurrency(order.orderAmount)}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>{order.orderStatus}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>{order.trackingNumber || '-'}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>{(order.issueCodes || []).join(', ') || '-'}</td>
                    </tr>
                  ))}

                  {(selectedBatchDetail.orders || []).length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 18, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
                        Batch ini belum memiliki order yang tersimpan.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      {preview ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 12,
            }}
          >
            <SummaryCard label="Total Order" value={preview.summary.totalOrders} />
            <SummaryCard label="Total Line" value={preview.summary.totalLines} />
            <SummaryCard label="Ready" value={preview.summary.readyOrders} tone="success" />
            <SummaryCard label="Needs Review" value={preview.summary.needsReviewOrders} tone={preview.summary.needsReviewOrders > 0 ? 'warn' : 'default'} />
            <SummaryCard label="Identified" value={preview.summary.identifiedLines} tone="success" />
            <SummaryCard label="Unidentified" value={preview.summary.unidentifiedLines} tone={preview.summary.unidentifiedLines > 0 ? 'danger' : 'default'} />
            <SummaryCard label="Store Unresolved" value={preview.summary.unresolvedStoreLines} tone={preview.summary.unresolvedStoreLines > 0 ? 'warn' : 'default'} />
            <SummaryCard label="Mixed Store" value={preview.summary.mixedStoreOrders} helper="Sudah dipilih store nominal terbesar jika tidak tie." />
          </div>

          <div style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Preview Mapping</div>
                <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
                  File: <strong>{preview.filename}</strong> • tanggal order file <strong>{preview.sourceOrderDate || '-'}</strong> • {fmtNumber(preview.rowCount)} row sumber • classifier opinionated {'Shopee RLT -> RLT'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari order, SKU, store, atau issue…"
                  style={{
                    minWidth: 260,
                    padding: '9px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => setIssuesOnly((value) => !value)}
                  style={{
                    padding: '9px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: issuesOnly ? 'rgba(245,158,11,0.12)' : 'var(--bg)',
                    color: issuesOnly ? '#f59e0b' : 'var(--text-secondary)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {issuesOnly ? 'Menampilkan Issue Saja' : 'Filter Issue'}
                </button>
              </div>
            </div>

                            {!canConfirm ? (
              <div
                style={{
                  marginBottom: 12,
                  padding: '10px 12px',
                  borderRadius: 10,
                  fontSize: 13,
                  background: 'rgba(245,158,11,0.12)',
                  color: '#fcd34d',
                  border: '1px solid rgba(245,158,11,0.24)',
                }}
              >
                Confirm akan aktif setelah semua line unidentified punya bundle pilihan dan tidak ada issue order-level lain. Saat ini masih ada {fmtNumber(unresolvedSelectionCount)} line belum dipilih dan {fmtNumber(blockingOrderCount)} order masih blocking.
              </div>
            ) : null}

            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
              <div style={{ minWidth: 1080 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '150px 170px 120px 240px 140px 120px 100px',
                    gap: 0,
                    padding: '10px 12px',
                    fontSize: 11,
                    fontWeight: 800,
                    color: 'var(--dim)',
                    background: 'var(--bg)',
                    borderBottom: '1px solid var(--border)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  <div>Order MP</div>
                  <div>Customer</div>
                  <div>Line / Amount</div>
                  <div>Store Final</div>
                  <div>Issue</div>
                  <div>Status</div>
                  <div />
                </div>

                {visibleOrders.map((order) => {
                  const isExpanded = Boolean(expandedOrders[order.externalOrderId]);
                  return (
                    <div key={order.externalOrderId} style={{ borderBottom: '1px solid var(--border)' }}>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '150px 170px 120px 240px 140px 120px 100px',
                          gap: 0,
                          padding: '12px',
                          alignItems: 'center',
                          fontSize: 13,
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{order.externalOrderId}</div>
                        <div style={{ color: 'var(--text-secondary)' }}>{order.customerLabel || 'Tanpa nama'}</div>
                        <div>
                          <div style={{ fontWeight: 700 }}>{fmtNumber(order.lineCount)} line</div>
                          <div style={{ fontSize: 12, color: 'var(--dim)' }}>{fmtCurrency(order.orderAmount)}</div>
                        </div>
                        <div>
                          <div style={{ fontWeight: 700 }}>{order.finalStoreName || 'Belum terklasifikasi'}</div>
                          <div style={{ fontSize: 12, color: 'var(--dim)' }}>{order.finalStoreResolution}</div>
                        </div>
                        <div style={{ color: 'var(--dim)', fontSize: 12 }}>
                          {(order.issueCodes || []).length ? order.issueCodes.join(', ') : 'Tidak ada'}
                        </div>
                        <div><StatusPill status={order.orderStatus} /></div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => toggleExpanded(order.externalOrderId)}
                            style={{
                              padding: '7px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--border)',
                              background: 'var(--bg)',
                              color: 'var(--text-secondary)',
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {isExpanded ? 'Hide' : 'Detail'}
                          </button>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div style={{ padding: '0 12px 12px' }}>
                          <div
                            style={{
                              border: '1px solid var(--border)',
                              borderRadius: 12,
                              overflow: 'hidden',
                              background: 'var(--bg)',
                            }}
                          >
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '170px 220px 220px 220px 120px 120px',
                                padding: '10px 12px',
                                fontSize: 11,
                                fontWeight: 800,
                                color: 'var(--dim)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                                borderBottom: '1px solid var(--border)',
                              }}
                            >
                              <div>Custom ID / SKU</div>
                              <div>Produk MP</div>
                              <div>Entity Scalev</div>
                              <div>Store Mapping</div>
                              <div>Qty / Amount</div>
                              <div>Status</div>
                            </div>

                            {(order.lines || []).map((line) => {
                              const lineKey = getLineKey(order.externalOrderId, line.lineIndex);
                              const selectedCandidate = manualSelections[lineKey] || line.selectedSuggestion || null;
                              const searchResults = lineSearchResults[lineKey] || [];

                              return (
                                <div
                                  key={`${order.externalOrderId}-${line.lineIndex}`}
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: '170px 220px 220px 220px 120px 120px',
                                    padding: '12px',
                                    fontSize: 13,
                                    borderBottom: '1px solid var(--border)',
                                    alignItems: 'start',
                                  }}
                                >
                                  <div>
                                    <div style={{ fontWeight: 700 }}>{line.detectedCustomId || 'Kosong'}</div>
                                    {line.mpVariation ? (
                                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dim)' }}>{line.mpVariation}</div>
                                    ) : null}
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: 700 }}>{line.mpProductName}</div>
                                    {(line.issueCodes || []).length ? (
                                      <div style={{ marginTop: 6, fontSize: 12, color: (line.issueCodes || []).includes('remembered_manual_match') ? '#93c5fd' : '#fca5a5' }}>
                                        {(line.issueCodes || []).join(', ')}
                                      </div>
                                    ) : null}
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: 700 }}>
                                      {selectedCandidate?.entityLabel || line.matchedEntityLabel || 'Belum match'}
                                    </div>
                                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dim)' }}>
                                      {selectedCandidate?.customId || line.detectedCustomId || '-'}
                                      {(selectedCandidate?.source || line.matchedEntitySource) ? ` • ${selectedCandidate?.source || line.matchedEntitySource}` : ''}
                                    </div>

                                    {line.lineStatus === 'not_identified' ? (
                                      <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                                        {(line.suggestionCandidates || []).length ? (
                                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                            {(line.suggestionCandidates || []).map((candidate) => (
                                              <button
                                                key={`${lineKey}-${candidate.entityKey}`}
                                                onClick={() => setManualSelection(order.externalOrderId, line.lineIndex, candidate)}
                                                style={{
                                                  padding: '6px 8px',
                                                  borderRadius: 8,
                                                  border: `1px solid ${selectedCandidate?.entityKey === candidate.entityKey ? '#2563eb' : 'var(--border)'}`,
                                                  background: selectedCandidate?.entityKey === candidate.entityKey ? 'rgba(37,99,235,0.12)' : 'var(--bg)',
                                                  color: selectedCandidate?.entityKey === candidate.entityKey ? '#93c5fd' : 'var(--text-secondary)',
                                                  fontSize: 11,
                                                  fontWeight: 700,
                                                  cursor: 'pointer',
                                                  textAlign: 'left',
                                                }}
                                              >
                                                {candidate.customId || candidate.entityLabel}
                                              </button>
                                            ))}
                                          </div>
                                        ) : null}

                                        <div style={{ display: 'flex', gap: 6 }}>
                                          <input
                                            value={lineSearchQueries[lineKey] || ''}
                                            onChange={(event) => setLineSearchQueries((current) => ({
                                              ...current,
                                              [lineKey]: event.target.value,
                                            }))}
                                            placeholder="Cari bundle RLT…"
                                            style={{
                                              width: '100%',
                                              padding: '7px 10px',
                                              borderRadius: 8,
                                              border: '1px solid var(--border)',
                                              background: 'var(--card)',
                                              color: 'var(--text)',
                                              fontSize: 12,
                                              outline: 'none',
                                            }}
                                          />
                                          <button
                                            onClick={() => handleSearchBundles(order.externalOrderId, line.lineIndex)}
                                            style={{
                                              padding: '7px 10px',
                                              borderRadius: 8,
                                              border: '1px solid var(--border)',
                                              background: 'var(--bg)',
                                              color: 'var(--text-secondary)',
                                              fontSize: 12,
                                              fontWeight: 700,
                                              cursor: 'pointer',
                                            }}
                                          >
                                            {searchingLineKey === lineKey ? '...' : 'Cari'}
                                          </button>
                                        </div>

                                        {searchResults.length ? (
                                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                            {searchResults.map((candidate) => (
                                              <button
                                                key={`${lineKey}-search-${candidate.entityKey}`}
                                                onClick={() => setManualSelection(order.externalOrderId, line.lineIndex, candidate)}
                                                style={{
                                                  padding: '6px 8px',
                                                  borderRadius: 8,
                                                  border: `1px solid ${selectedCandidate?.entityKey === candidate.entityKey ? '#2563eb' : 'var(--border)'}`,
                                                  background: selectedCandidate?.entityKey === candidate.entityKey ? 'rgba(37,99,235,0.12)' : 'var(--bg)',
                                                  color: selectedCandidate?.entityKey === candidate.entityKey ? '#93c5fd' : 'var(--text-secondary)',
                                                  fontSize: 11,
                                                  fontWeight: 700,
                                                  cursor: 'pointer',
                                                  textAlign: 'left',
                                                }}
                                              >
                                                {candidate.customId || candidate.entityLabel}
                                              </button>
                                            ))}
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: 700 }}>
                                      {selectedCandidate?.storeName || line.mappedStoreName || 'Belum termapping'}
                                    </div>
                                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dim)' }}>
                                      {selectedCandidate?.classifierLabel || line.matchedRuleLabel || 'Classifier belum mengenali keluarga bundle ini'}
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: 700 }}>{fmtNumber(line.quantity)} pcs</div>
                                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dim)' }}>{fmtCurrency(line.lineSubtotal)}</div>
                                  </div>
                                  <div>
                                    <StatusPill status={line.lineStatus === 'not_identified' && selectedCandidate ? 'identified' : line.lineStatus} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {visibleOrders.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
                    Tidak ada order yang cocok dengan filter saat ini.
                  </div>
                ) : null}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: canConfirm ? '#2563eb' : 'var(--bg)',
                  color: canConfirm ? '#fff' : 'var(--dim)',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: canConfirm ? (confirming ? 'wait' : 'pointer') : 'not-allowed',
                }}
              >
                {confirming ? 'Menyimpan…' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

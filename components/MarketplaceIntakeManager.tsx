// @ts-nocheck
'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

const panelStyle = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 16,
  boxShadow: 'var(--shadow)',
};

const REVIEW_STATUS_META = {
  ready: { label: 'Ready', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  needs_review: { label: 'Needs Review', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  identified: { label: 'Identified', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  not_identified: { label: 'Not Identified', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  store_unmapped: { label: 'Store Unmapped', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  entity_mismatch: { label: 'Entity Mismatch', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

const WAREHOUSE_STATUS_META = {
  staged: { label: 'Staged', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
  scheduled: { label: 'Scheduled', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  hold: { label: 'Hold', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  canceled: { label: 'Canceled', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

function fmtNumber(value) {
  return new Intl.NumberFormat('id-ID').format(Number(value || 0));
}

function fmtCurrency(value) {
  return `Rp ${fmtNumber(Math.round(Number(value || 0)))}`;
}

function getCurrentDateValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function fmtDateLabel(value) {
  if (!value) return '-';
  const parsed = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) return value || '-';
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(parsed);
}

function StatusPill({ status, warehouse = false }) {
  const metaSource = warehouse ? WAREHOUSE_STATUS_META : REVIEW_STATUS_META;
  const meta = metaSource[status] || { label: status, color: 'var(--dim)', bg: 'rgba(148,163,184,0.12)' };
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

function ActionButton({ children, onClick, tone = 'default', disabled = false }) {
  const palette = tone === 'primary'
    ? { bg: '#2563eb', color: '#fff', border: '#2563eb' }
    : tone === 'warn'
      ? { bg: 'rgba(245,158,11,0.12)', color: '#fcd34d', border: 'rgba(245,158,11,0.24)' }
      : tone === 'danger'
        ? { bg: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: 'rgba(239,68,68,0.24)' }
        : { bg: 'var(--bg)', color: 'var(--text-secondary)', border: 'var(--border)' };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '7px 10px',
        borderRadius: 8,
        border: `1px solid ${palette.border}`,
        background: disabled ? 'var(--bg)' : palette.bg,
        color: disabled ? 'var(--dim)' : palette.color,
        fontSize: 12,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function DetailLineTable({ order }) {
  return (
    <div style={{ padding: 12, background: 'rgba(255,255,255,0.02)', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, color: 'var(--dim)' }}>
        <span>File: <strong style={{ color: 'var(--text-secondary)' }}>{order.batchFilename}</strong></span>
        <span>Uploaded: <strong style={{ color: 'var(--text-secondary)' }}>{fmtDateTime(order.uploadedAt)}</strong></span>
        <span>Store: <strong style={{ color: 'var(--text-secondary)' }}>{order.finalStoreName || '-'}</strong></span>
        <span>Tracking: <strong style={{ color: 'var(--text-secondary)' }}>{order.trackingNumber || '-'}</strong></span>
      </div>

      {(order.issueCodes || []).length ? (
        <div style={{ fontSize: 12, color: '#fcd34d' }}>
          Issue intake: {order.issueCodes.join(', ')}
        </div>
      ) : null}

      {order.warehouseNote ? (
        <div style={{ fontSize: 12, color: '#93c5fd' }}>
          Catatan warehouse: {order.warehouseNote}
        </div>
      ) : null}

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
          <thead>
            <tr style={{ background: 'var(--bg)' }}>
              <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Line</th>
              <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>SKU MP</th>
              <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Produk MP</th>
              <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Custom ID</th>
              <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Entity</th>
              <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Store</th>
              <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Qty</th>
              <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Subtotal</th>
              <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {(order.lines || []).map((line) => (
              <tr key={`${order.id}-${line.lineIndex}`}>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>{line.lineIndex + 1}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>{line.mpSku || '-'}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                  {line.mpProductName}
                  {line.mpVariation ? ` / ${line.mpVariation}` : ''}
                </td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>{line.detectedCustomId || '-'}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>{line.matchedEntityLabel || '-'}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>{line.mappedStoreName || '-'}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12 }}>{fmtNumber(line.quantity)}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12 }}>{fmtCurrency(line.lineSubtotal)}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                  {line.lineStatus}{line.issueCodes?.length ? ` • ${line.issueCodes.join(', ')}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MarketplaceIntakeManager() {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [workspaceActionLoading, setWorkspaceActionLoading] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [search, setSearch] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [expandedPreviewOrders, setExpandedPreviewOrders] = useState({});
  const [expandedWorkspaceOrders, setExpandedWorkspaceOrders] = useState({});
  const [manualSelections, setManualSelections] = useState({});
  const [lineSearchQueries, setLineSearchQueries] = useState({});
  const [lineSearchResults, setLineSearchResults] = useState({});
  const [searchingLineKey, setSearchingLineKey] = useState('');
  const [workspaceDate, setWorkspaceDate] = useState(getCurrentDateValue());
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspace, setWorkspace] = useState(null);
  const [selectedStagedOrders, setSelectedStagedOrders] = useState({});

  function getLineKey(orderId, lineIndex) {
    return `${orderId}::${lineIndex}`;
  }

  useEffect(() => {
    loadWorkspace(getCurrentDateValue());
  }, []);

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

  const selectedStagedOrderIds = useMemo(() => {
    return Object.entries(selectedStagedOrders)
      .filter(([, checked]) => Boolean(checked))
      .map(([orderId]) => Number(orderId))
      .filter((id) => Number.isFinite(id) && id > 0);
  }, [selectedStagedOrders]);

  const allVisibleStagedSelected = useMemo(() => {
    const stagedOrders = workspace?.stagedOrders || [];
    if (stagedOrders.length === 0) return false;
    return stagedOrders.every((order) => Boolean(selectedStagedOrders[order.id]));
  }, [selectedStagedOrders, workspace]);

  async function loadWorkspace(date) {
    const shipmentDate = String(date || getCurrentDateValue());
    setWorkspaceLoading(true);
    setWorkspaceError('');

    try {
      const res = await fetch(`/api/marketplace-intake/workspace?shipmentDate=${encodeURIComponent(shipmentDate)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal membaca workspace warehouse.');
      }

      setWorkspace(data);
      setSelectedStagedOrders((current) => {
        const allowed = new Set((data.stagedOrders || []).map((order) => Number(order.id)));
        return Object.fromEntries(
          Object.entries(current).filter(([orderId, checked]) => checked && allowed.has(Number(orderId))),
        );
      });
    } catch (err) {
      console.error(err);
      setWorkspace(null);
      setWorkspaceError(err?.message || 'Gagal membaca workspace warehouse.');
    } finally {
      setWorkspaceLoading(false);
    }
  }

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
      setExpandedPreviewOrders({});
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

      setPreview(null);
      setExpandedPreviewOrders({});
      setManualSelections({});
      setLineSearchQueries({});
      setLineSearchResults({});
      setSearch('');
      setIssuesOnly(false);
      await loadWorkspace(workspaceDate);

      setMessage({
        type: 'success',
        text: data.message || `Batch #${data.batchId} berhasil masuk ke workspace warehouse. Data ini belum ikut proses downstream sampai shipment date diisi.`,
      });
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal menyimpan preview intake.');
    } finally {
      setConfirming(false);
    }
  }

  function togglePreviewOrder(orderId) {
    setExpandedPreviewOrders((current) => ({
      ...current,
      [orderId]: !current[orderId],
    }));
  }

  function toggleWorkspaceOrder(orderId) {
    setExpandedWorkspaceOrders((current) => ({
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

  function toggleStagedSelection(orderId) {
    setSelectedStagedOrders((current) => ({
      ...current,
      [orderId]: !current[orderId],
    }));
  }

  function toggleSelectAllStaged() {
    const stagedOrders = workspace?.stagedOrders || [];
    if (stagedOrders.length === 0) return;
    const shouldSelectAll = !allVisibleStagedSelected;
    setSelectedStagedOrders((current) => ({
      ...current,
      ...Object.fromEntries(stagedOrders.map((order) => [order.id, shouldSelectAll])),
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

  async function applyWorkspaceAction({ orderIds, warehouseStatus, shipmentDate, successText }) {
    if (!orderIds?.length) return;
    const actionKey = `${warehouseStatus}:${orderIds.join(',')}`;
    setWorkspaceActionLoading(actionKey);
    setWorkspaceError('');
    setMessage(null);

    try {
      const res = await fetch('/api/marketplace-intake/workspace/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderIds,
          shipmentDate,
          warehouseStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memperbarui workspace warehouse.');
      }

      setSelectedStagedOrders({});
      await loadWorkspace(workspaceDate);
      setMessage({
        type: 'success',
        text: successText || `${fmtNumber(data.updatedCount || orderIds.length)} order berhasil diperbarui.`,
      });
    } catch (err) {
      console.error(err);
      setWorkspaceError(err?.message || 'Gagal memperbarui workspace warehouse.');
    } finally {
      setWorkspaceActionLoading('');
    }
  }

  const stagedOrders = workspace?.stagedOrders || [];
  const shipmentOrders = workspace?.shipmentOrders || [];

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
                  File: <strong>{preview.filename}</strong> • tanggal order file <strong>{preview.sourceOrderDate || '-'}</strong> • {fmtNumber(preview.rowCount)} row sumber • classifier opinionated Shopee RLT → RLT
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
                <ActionButton
                  onClick={() => setIssuesOnly((value) => !value)}
                  tone={issuesOnly ? 'warn' : 'default'}
                >
                  {issuesOnly ? 'Menampilkan Issue Saja' : 'Filter Issue'}
                </ActionButton>
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
                  const isExpanded = Boolean(expandedPreviewOrders[order.externalOrderId]);
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
                          <ActionButton onClick={() => togglePreviewOrder(order.externalOrderId)}>
                            {isExpanded ? 'Hide' : 'Detail'}
                          </ActionButton>
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
                                          <ActionButton onClick={() => handleSearchBundles(order.externalOrderId, line.lineIndex)}>
                                            {searchingLineKey === lineKey ? '...' : 'Cari'}
                                          </ActionButton>
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
              <ActionButton onClick={handleConfirm} tone="primary" disabled={!canConfirm}>
                {confirming ? 'Menyimpan…' : 'Confirm & Save'}
              </ActionButton>
            </div>
          </div>
        </>
      ) : null}

      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Workspace Warehouse</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4, maxWidth: 860, lineHeight: 1.6 }}>
              Upload yang sudah <strong>Confirm & Save</strong> akan masuk ke workspace ini sebagai data <strong>staging</strong>. Data baru dianggap valid downstream setelah warehouse memberi <strong>shipment date</strong>. Selector di bawah selalu mengikuti tanggal shipment nyata, bukan tanggal order dan bukan jam upload.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="date"
              value={workspaceDate}
              onChange={async (event) => {
                const nextDate = event.target.value || getCurrentDateValue();
                setWorkspaceDate(nextDate);
                await loadWorkspace(nextDate);
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
            <ActionButton
              onClick={async () => {
                const today = getCurrentDateValue();
                setWorkspaceDate(today);
                await loadWorkspace(today);
              }}
            >
              Hari Ini
            </ActionButton>
            <ActionButton onClick={() => loadWorkspace(workspaceDate)}>
              {workspaceLoading ? 'Memuat...' : 'Refresh'}
            </ActionButton>
          </div>
        </div>

        {workspaceError ? (
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
            {workspaceError}
          </div>
        ) : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <SummaryCard label="Belum Dijadwalkan" value={workspace?.summary?.stagedCount || 0} tone={(workspace?.summary?.stagedCount || 0) > 0 ? 'warn' : 'default'} />
          <SummaryCard label={`Scheduled ${fmtDateLabel(workspaceDate)}`} value={workspace?.summary?.scheduledCount || 0} tone="success" />
          <SummaryCard label={`Hold ${fmtDateLabel(workspaceDate)}`} value={workspace?.summary?.holdCount || 0} tone={(workspace?.summary?.holdCount || 0) > 0 ? 'warn' : 'default'} />
          <SummaryCard label={`Canceled ${fmtDateLabel(workspaceDate)}`} value={workspace?.summary?.canceledCount || 0} tone={(workspace?.summary?.canceledCount || 0) > 0 ? 'danger' : 'default'} />
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>Belum Dijadwalkan</div>
                <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
                  Order di bawah ini masih pre-valid. Pilih semuanya lalu tetapkan shipment date <strong>{fmtDateLabel(workspaceDate)}</strong> jika sudah siap.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <ActionButton onClick={toggleSelectAllStaged}>
                  {allVisibleStagedSelected ? 'Unselect All' : 'Select All'}
                </ActionButton>
                <ActionButton
                  onClick={() => applyWorkspaceAction({
                    orderIds: selectedStagedOrderIds,
                    warehouseStatus: 'scheduled',
                    shipmentDate: workspaceDate,
                    successText: `${fmtNumber(selectedStagedOrderIds.length)} order dijadwalkan ke shipment ${fmtDateLabel(workspaceDate)}.`,
                  })}
                  tone="primary"
                  disabled={!selectedStagedOrderIds.length || Boolean(workspaceActionLoading)}
                >
                  Jadwalkan ke {fmtDateLabel(workspaceDate)}
                </ActionButton>
                <ActionButton
                  onClick={() => applyWorkspaceAction({
                    orderIds: selectedStagedOrderIds,
                    warehouseStatus: 'hold',
                    shipmentDate: workspaceDate,
                    successText: `${fmtNumber(selectedStagedOrderIds.length)} order ditandai hold untuk shipment ${fmtDateLabel(workspaceDate)}.`,
                  })}
                  tone="warn"
                  disabled={!selectedStagedOrderIds.length || Boolean(workspaceActionLoading)}
                >
                  Hold Terpilih
                </ActionButton>
                <ActionButton
                  onClick={() => applyWorkspaceAction({
                    orderIds: selectedStagedOrderIds,
                    warehouseStatus: 'canceled',
                    shipmentDate: workspaceDate,
                    successText: `${fmtNumber(selectedStagedOrderIds.length)} order ditandai canceled pada shipment ${fmtDateLabel(workspaceDate)}.`,
                  })}
                  tone="danger"
                  disabled={!selectedStagedOrderIds.length || Boolean(workspaceActionLoading)}
                >
                  Cancel Terpilih
                </ActionButton>
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1160 }}>
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <th style={{ width: 46, padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                      <input type="checkbox" checked={allVisibleStagedSelected} onChange={toggleSelectAllStaged} />
                    </th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Order MP</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Customer</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Batch / Uploaded</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Store Final</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Line</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Amount</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Status</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }} />
                  </tr>
                </thead>
                <tbody>
                  {stagedOrders.map((order) => {
                    const isOpen = Boolean(expandedWorkspaceOrders[`staged:${order.id}`]);
                    return (
                      <Fragment key={`staged-${order.id}`}>
                        <tr>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={Boolean(selectedStagedOrders[order.id])}
                              onChange={() => toggleStagedSelection(order.id)}
                            />
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700 }}>{order.externalOrderId}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>{order.customerLabel || order.recipientName || '-'}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                            <div style={{ fontWeight: 700 }}>{order.batchFilename}</div>
                            <div style={{ color: 'var(--dim)', marginTop: 4 }}>{fmtDateTime(order.uploadedAt)}</div>
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>{order.finalStoreName || '-'}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtNumber(order.lineCount)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtCurrency(order.orderAmount)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                            <StatusPill status={order.warehouseStatus} warehouse />
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              <ActionButton
                                onClick={() => applyWorkspaceAction({
                                  orderIds: [order.id],
                                  warehouseStatus: 'scheduled',
                                  shipmentDate: workspaceDate,
                                  successText: `Order ${order.externalOrderId} dijadwalkan ke shipment ${fmtDateLabel(workspaceDate)}.`,
                                })}
                                tone="primary"
                                disabled={Boolean(workspaceActionLoading)}
                              >
                                Jadwalkan
                              </ActionButton>
                              <ActionButton
                                onClick={() => applyWorkspaceAction({
                                  orderIds: [order.id],
                                  warehouseStatus: 'hold',
                                  shipmentDate: workspaceDate,
                                  successText: `Order ${order.externalOrderId} ditandai hold untuk shipment ${fmtDateLabel(workspaceDate)}.`,
                                })}
                                tone="warn"
                                disabled={Boolean(workspaceActionLoading)}
                              >
                                Hold
                              </ActionButton>
                              <ActionButton
                                onClick={() => applyWorkspaceAction({
                                  orderIds: [order.id],
                                  warehouseStatus: 'canceled',
                                  shipmentDate: workspaceDate,
                                  successText: `Order ${order.externalOrderId} ditandai canceled pada shipment ${fmtDateLabel(workspaceDate)}.`,
                                })}
                                tone="danger"
                                disabled={Boolean(workspaceActionLoading)}
                              >
                                Cancel
                              </ActionButton>
                              <ActionButton onClick={() => toggleWorkspaceOrder(`staged:${order.id}`)}>
                                {isOpen ? 'Hide' : 'Detail'}
                              </ActionButton>
                            </div>
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr>
                            <td colSpan={9} style={{ padding: 0, borderBottom: '1px solid var(--border)' }}>
                              <DetailLineTable order={order} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}

                  {!workspaceLoading && stagedOrders.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: 18, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
                        Tidak ada order staged. Semua upload yang sudah disimpan dan belum punya shipment date akan muncul di sini.
                      </td>
                    </tr>
                  ) : null}

                  {workspaceLoading ? (
                    <tr>
                      <td colSpan={9} style={{ padding: 18, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
                        Memuat workspace warehouse...
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>Shipment {fmtDateLabel(workspaceDate)}</div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
                Hanya order yang sudah memiliki shipment date <strong>{fmtDateLabel(workspaceDate)}</strong> yang muncul di bawah ini. Inilah data yang nanti valid untuk diteruskan downstream.
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1140 }}>
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Order MP</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Customer</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Batch / Uploaded</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Store Final</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Line</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Amount</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Status</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Updated</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }} />
                  </tr>
                </thead>
                <tbody>
                  {shipmentOrders.map((order) => {
                    const isOpen = Boolean(expandedWorkspaceOrders[`shipment:${order.id}`]);
                    return (
                      <Fragment key={`shipment-${order.id}`}>
                        <tr>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700 }}>{order.externalOrderId}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>{order.customerLabel || order.recipientName || '-'}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                            <div style={{ fontWeight: 700 }}>{order.batchFilename}</div>
                            <div style={{ color: 'var(--dim)', marginTop: 4 }}>{fmtDateTime(order.uploadedAt)}</div>
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>{order.finalStoreName || '-'}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtNumber(order.lineCount)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtCurrency(order.orderAmount)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                            <StatusPill status={order.warehouseStatus} warehouse />
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                            {fmtDateTime(order.warehouseUpdatedAt)}
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              {order.warehouseStatus !== 'scheduled' ? (
                                <ActionButton
                                  onClick={() => applyWorkspaceAction({
                                    orderIds: [order.id],
                                    warehouseStatus: 'scheduled',
                                    shipmentDate: workspaceDate,
                                    successText: `Order ${order.externalOrderId} dikembalikan ke scheduled ${fmtDateLabel(workspaceDate)}.`,
                                  })}
                                  tone="primary"
                                  disabled={Boolean(workspaceActionLoading)}
                                >
                                  Scheduled
                                </ActionButton>
                              ) : null}
                              {order.warehouseStatus !== 'hold' ? (
                                <ActionButton
                                  onClick={() => applyWorkspaceAction({
                                    orderIds: [order.id],
                                    warehouseStatus: 'hold',
                                    shipmentDate: workspaceDate,
                                    successText: `Order ${order.externalOrderId} ditandai hold untuk shipment ${fmtDateLabel(workspaceDate)}.`,
                                  })}
                                  tone="warn"
                                  disabled={Boolean(workspaceActionLoading)}
                                >
                                  Hold
                                </ActionButton>
                              ) : null}
                              {order.warehouseStatus !== 'canceled' ? (
                                <ActionButton
                                  onClick={() => applyWorkspaceAction({
                                    orderIds: [order.id],
                                    warehouseStatus: 'canceled',
                                    shipmentDate: workspaceDate,
                                    successText: `Order ${order.externalOrderId} ditandai canceled pada shipment ${fmtDateLabel(workspaceDate)}.`,
                                  })}
                                  tone="danger"
                                  disabled={Boolean(workspaceActionLoading)}
                                >
                                  Cancel
                                </ActionButton>
                              ) : null}
                              <ActionButton
                                onClick={() => applyWorkspaceAction({
                                  orderIds: [order.id],
                                  warehouseStatus: 'staged',
                                  shipmentDate: null,
                                  successText: `Order ${order.externalOrderId} dikembalikan ke staging.`,
                                })}
                                disabled={Boolean(workspaceActionLoading)}
                              >
                                Reset
                              </ActionButton>
                              <ActionButton onClick={() => toggleWorkspaceOrder(`shipment:${order.id}`)}>
                                {isOpen ? 'Hide' : 'Detail'}
                              </ActionButton>
                            </div>
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr>
                            <td colSpan={9} style={{ padding: 0, borderBottom: '1px solid var(--border)' }}>
                              <DetailLineTable order={order} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}

                  {!workspaceLoading && shipmentOrders.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: 18, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
                        Belum ada order dengan shipment date {fmtDateLabel(workspaceDate)}.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

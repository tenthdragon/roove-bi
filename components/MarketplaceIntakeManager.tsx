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
  staged: { label: 'Belum Dikirim', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
  scheduled: { label: 'Shipped', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
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
        <span>Updated: <strong style={{ color: 'var(--text-secondary)' }}>{fmtDateTime(order.warehouseUpdatedAt)}</strong></span>
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

function groupOrdersByBatch(orders) {
  const grouped = new Map();

  for (const order of orders || []) {
    const key = String(order.batchId || '');
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        batchId: order.batchId,
        batchFilename: order.batchFilename,
        uploadedAt: order.uploadedAt,
        uploadedByEmail: order.uploadedByEmail,
        orders: [order],
        orderIds: [order.id],
        totalOrders: 1,
        totalLines: Number(order.lineCount || 0),
        totalAmount: Number(order.orderAmount || 0),
        statusCounts: {
          staged: order.warehouseStatus === 'staged' ? 1 : 0,
          scheduled: order.warehouseStatus === 'scheduled' ? 1 : 0,
          hold: order.warehouseStatus === 'hold' ? 1 : 0,
          canceled: order.warehouseStatus === 'canceled' ? 1 : 0,
        },
      });
      continue;
    }

    existing.orders.push(order);
    existing.orderIds.push(order.id);
    existing.totalOrders += 1;
    existing.totalLines += Number(order.lineCount || 0);
    existing.totalAmount += Number(order.orderAmount || 0);
    existing.statusCounts[order.warehouseStatus] = (existing.statusCounts[order.warehouseStatus] || 0) + 1;
  }

  return Array.from(grouped.values()).sort((left, right) => {
    const leftTime = new Date(left.uploadedAt || 0).getTime();
    const rightTime = new Date(right.uploadedAt || 0).getTime();
    if (rightTime !== leftTime) return rightTime - leftTime;
    return Number(right.batchId || 0) - Number(left.batchId || 0);
  });
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
  const [expandedWorkspaceBatches, setExpandedWorkspaceBatches] = useState({});
  const [expandedWorkspaceOrders, setExpandedWorkspaceOrders] = useState({});
  const [manualSelections, setManualSelections] = useState({});
  const [lineSearchQueries, setLineSearchQueries] = useState({});
  const [lineSearchResults, setLineSearchResults] = useState({});
  const [searchingLineKey, setSearchingLineKey] = useState('');
  const [workspaceDate, setWorkspaceDate] = useState(getCurrentDateValue());
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspace, setWorkspace] = useState(null);

  function getLineKey(orderId, lineIndex) {
    return `${orderId}::${lineIndex}`;
  }

  useEffect(() => {
    loadWorkspace(getCurrentDateValue());
  }, []);

  const effectivePreviewOrders = useMemo(() => {
    if (!preview?.orders) return [];

    return preview.orders.map((order) => {
      const lines = (order.lines || []).map((line) => {
        const lineKey = getLineKey(order.externalOrderId, line.lineIndex);
        const selectedCandidate = manualSelections[lineKey] || line.selectedSuggestion || null;
        let effectiveStatus = line.lineStatus;
        let effectiveEntityLabel = line.matchedEntityLabel;
        let effectiveCustomId = line.detectedCustomId;
        let effectiveStoreName = line.mappedStoreName;
        let effectiveEntitySource = line.matchedEntitySource;
        let effectiveClassifierLabel = line.matchedRuleLabel;
        const effectiveIssueCodes = new Set(line.issueCodes || []);

        if (selectedCandidate) {
          effectiveEntityLabel = selectedCandidate.entityLabel || effectiveEntityLabel;
          effectiveCustomId = selectedCandidate.customId || effectiveCustomId;
          effectiveStoreName = selectedCandidate.storeName || effectiveStoreName;
          effectiveEntitySource = selectedCandidate.source || effectiveEntitySource;
          effectiveClassifierLabel = selectedCandidate.classifierLabel || effectiveClassifierLabel;

          if (selectedCandidate.storeName) {
            effectiveStatus = 'identified';
            effectiveIssueCodes.delete('custom_id_not_found');
            effectiveIssueCodes.delete('custom_id_ambiguous');
            effectiveIssueCodes.delete('store_classifier_missing');
            effectiveIssueCodes.delete('entity_mismatch');
          } else if (line.lineStatus !== 'identified') {
            effectiveStatus = 'store_unmapped';
            effectiveIssueCodes.delete('custom_id_not_found');
            effectiveIssueCodes.delete('custom_id_ambiguous');
            effectiveIssueCodes.add('store_classifier_missing');
          }
        }

        return {
          ...line,
          selectedCandidate,
          effectiveStatus,
          effectiveEntityLabel,
          effectiveCustomId,
          effectiveStoreName,
          effectiveEntitySource,
          effectiveClassifierLabel,
          effectiveIssueCodes: Array.from(effectiveIssueCodes),
        };
      });

      const issueCodes = new Set(
        (order.issueCodes || []).filter((code) => !['custom_id_not_found', 'custom_id_ambiguous', 'store_classifier_missing', 'store_amount_tie'].includes(code)),
      );
      const identifiedLineCount = lines.filter((line) => line.effectiveStatus !== 'not_identified').length;
      const classifiedLineCount = lines.filter((line) => line.effectiveStatus === 'identified').length;
      const storeTotals = new Map();

      for (const line of lines) {
        for (const code of line.effectiveIssueCodes || []) {
          if (code !== 'remembered_manual_match') {
            issueCodes.add(code);
          }
        }
        if (!line.effectiveStoreName || line.effectiveStatus !== 'identified') continue;
        storeTotals.set(line.effectiveStoreName, (storeTotals.get(line.effectiveStoreName) || 0) + Number(line.lineSubtotal || 0));
      }

      let finalStoreName = null;
      let finalStoreResolution = 'unclassified';
      let orderStatus = 'needs_review';

      if (classifiedLineCount === lines.length && storeTotals.size === 1) {
        finalStoreName = Array.from(storeTotals.keys())[0];
        finalStoreResolution = 'single_store';
        orderStatus = 'ready';
      } else if (classifiedLineCount === lines.length && storeTotals.size > 1) {
        const ranked = Array.from(storeTotals.entries()).sort((left, right) => right[1] - left[1]);
        if (ranked[0] && ranked[1] && ranked[0][1] === ranked[1][1]) {
          issueCodes.add('store_amount_tie');
          finalStoreResolution = 'ambiguous';
        } else if (ranked[0]) {
          finalStoreName = ranked[0][0];
          finalStoreResolution = 'dominant_amount';
          orderStatus = 'ready';
        }
      }

      if (lines.some((line) => line.effectiveStatus === 'store_unmapped')) {
        issueCodes.add('store_classifier_missing');
      }
      if (lines.some((line) => line.effectiveStatus === 'not_identified')) {
        issueCodes.add('custom_id_not_found');
      }

      return {
        ...order,
        lines,
        issueCodes: Array.from(issueCodes),
        identifiedLineCount,
        classifiedLineCount,
        finalStoreName,
        finalStoreResolution,
        orderStatus,
      };
    });
  }, [manualSelections, preview]);

  const effectivePreviewSummary = useMemo(() => {
    const totalLines = effectivePreviewOrders.reduce((sum, order) => sum + Number(order.lineCount || 0), 0);
    const identifiedLines = effectivePreviewOrders.reduce((sum, order) => sum + Number(order.identifiedLineCount || 0), 0);
    const classifiedLines = effectivePreviewOrders.reduce((sum, order) => sum + Number(order.classifiedLineCount || 0), 0);
    const unidentifiedLines = effectivePreviewOrders.reduce(
      (sum, order) => sum + (order.lines || []).filter((line) => line.effectiveStatus === 'not_identified').length,
      0,
    );
    const unresolvedStoreLines = effectivePreviewOrders.reduce(
      (sum, order) => sum + (order.lines || []).filter((line) => line.effectiveStatus === 'store_unmapped' || line.effectiveStatus === 'entity_mismatch').length,
      0,
    );

    return {
      totalOrders: effectivePreviewOrders.length,
      totalLines,
      readyOrders: effectivePreviewOrders.filter((order) => order.orderStatus === 'ready').length,
      needsReviewOrders: effectivePreviewOrders.filter((order) => order.orderStatus === 'needs_review').length,
      mixedStoreOrders: effectivePreviewOrders.filter((order) => order.isMixedStore).length,
      identifiedLines,
      classifiedLines,
      unidentifiedLines,
      unresolvedStoreLines,
    };
  }, [effectivePreviewOrders]);

  const visibleOrders = useMemo(() => {
    if (!effectivePreviewOrders.length) return [];
    const query = String(search || '').trim().toLowerCase();
    return effectivePreviewOrders.filter((order) => {
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
          line.effectiveEntityLabel,
          line.effectiveStoreName,
        ]),
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [effectivePreviewOrders, issuesOnly, search]);

  const unresolvedSelectionCount = useMemo(() => {
    return effectivePreviewSummary.unidentifiedLines;
  }, [effectivePreviewSummary.unidentifiedLines]);

  const blockingOrderCount = useMemo(() => {
    return effectivePreviewSummary.needsReviewOrders;
  }, [effectivePreviewSummary.needsReviewOrders]);

  const canConfirm = Boolean(
    preview
    && effectivePreviewSummary.totalOrders > 0
    && effectivePreviewSummary.unidentifiedLines === 0
    && effectivePreviewSummary.unresolvedStoreLines === 0
    && effectivePreviewSummary.needsReviewOrders === 0
    && !confirming,
  );

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
              mappedStoreName: candidate?.storeName || null,
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

  function toggleWorkspaceBatch(batchKey) {
    setExpandedWorkspaceBatches((current) => ({
      ...current,
      [batchKey]: !current[batchKey],
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

  const stagedOrders = useMemo(() => workspace?.stagedOrders || [], [workspace?.stagedOrders]);
  const shipmentOrders = useMemo(() => workspace?.shipmentOrders || [], [workspace?.shipmentOrders]);
  const stagedBatches = useMemo(() => groupOrdersByBatch(stagedOrders), [stagedOrders]);
  const shipmentBatches = useMemo(() => groupOrdersByBatch(shipmentOrders), [shipmentOrders]);
  const allStagedOrderIds = useMemo(() => stagedOrders.map((order) => Number(order.id)).filter((id) => Number.isFinite(id) && id > 0), [stagedOrders]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Upload Shopee RLT</div>
            <div style={{ fontSize: 13, color: 'var(--dim)', maxWidth: 840, lineHeight: 1.6 }}>
              Halaman ini hanya membaca export <strong>Shopee RLT</strong>. File yang namanya mengandung <strong>SPX</strong> tetap diperlakukan sebagai Shopee.
              App akan match exact <strong>SKU Excel</strong> ke <strong>bundle custom_id</strong> di business <strong>RLT</strong>, lalu mencari store exact dari relasi bundle di Scalev.
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
            <SummaryCard label="Total Order" value={effectivePreviewSummary.totalOrders} />
            <SummaryCard label="Total Line" value={effectivePreviewSummary.totalLines} />
            <SummaryCard label="Ready" value={effectivePreviewSummary.readyOrders} tone="success" />
            <SummaryCard label="Needs Review" value={effectivePreviewSummary.needsReviewOrders} tone={effectivePreviewSummary.needsReviewOrders > 0 ? 'warn' : 'default'} />
            <SummaryCard label="Identified" value={effectivePreviewSummary.identifiedLines} tone="success" />
            <SummaryCard label="Unidentified" value={effectivePreviewSummary.unidentifiedLines} tone={effectivePreviewSummary.unidentifiedLines > 0 ? 'danger' : 'default'} />
            <SummaryCard label="Store Unresolved" value={effectivePreviewSummary.unresolvedStoreLines} tone={effectivePreviewSummary.unresolvedStoreLines > 0 ? 'warn' : 'default'} />
            <SummaryCard label="Mixed Store" value={effectivePreviewSummary.mixedStoreOrders} helper="Sudah dipilih store nominal terbesar jika tidak tie." />
          </div>

          <div style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Preview Mapping</div>
                <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
                  File: <strong>{preview.filename}</strong> • tanggal order file <strong>{preview.sourceOrderDate || '-'}</strong> • {fmtNumber(preview.rowCount)} row sumber • exact bundle match + exact store lookup
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
                Confirm akan aktif setelah semua line bermasalah benar-benar resolved. Saat ini masih ada {fmtNumber(unresolvedSelectionCount)} line belum teridentifikasi, {fmtNumber(effectivePreviewSummary.unresolvedStoreLines)} line belum punya store valid, dan {fmtNumber(blockingOrderCount)} order masih blocking.
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
                              const selectedCandidate = line.selectedCandidate || null;
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
                                    {(line.effectiveIssueCodes || []).length ? (
                                      <div style={{ marginTop: 6, fontSize: 12, color: (line.effectiveIssueCodes || []).includes('remembered_manual_match') ? '#93c5fd' : '#fca5a5' }}>
                                        {(line.effectiveIssueCodes || []).join(', ')}
                                      </div>
                                    ) : null}
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: 700 }}>
                                      {line.effectiveEntityLabel || 'Belum match'}
                                    </div>
                                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dim)' }}>
                                      {line.effectiveCustomId || '-'}
                                      {line.effectiveEntitySource ? ` • ${line.effectiveEntitySource}` : ''}
                                    </div>

                                    {line.effectiveStatus !== 'identified' ? (
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

                                        {selectedCandidate?.storeCandidates?.length > 1 && !selectedCandidate?.storeName ? (
                                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                            {selectedCandidate.storeCandidates.map((storeName) => (
                                              <button
                                                key={`${lineKey}-store-${storeName}`}
                                                onClick={() => setManualSelection(order.externalOrderId, line.lineIndex, {
                                                  ...selectedCandidate,
                                                  storeName,
                                                  classifierLabel: 'Manual store selection',
                                                })}
                                                style={{
                                                  padding: '6px 8px',
                                                  borderRadius: 8,
                                                  border: '1px solid var(--border)',
                                                  background: 'var(--bg)',
                                                  color: 'var(--text-secondary)',
                                                  fontSize: 11,
                                                  fontWeight: 700,
                                                  cursor: 'pointer',
                                                  textAlign: 'left',
                                                }}
                                              >
                                                {storeName}
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
                                      {line.effectiveStoreName || 'Belum termapping'}
                                    </div>
                                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dim)' }}>
                                      {line.effectiveClassifierLabel || 'Belum ada store valid untuk custom_id ini'}
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: 700 }}>{fmtNumber(line.quantity)} pcs</div>
                                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dim)' }}>{fmtCurrency(line.lineSubtotal)}</div>
                                  </div>
                                  <div>
                                    <StatusPill status={line.effectiveStatus} />
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
          <SummaryCard label="Belum Dikirim" value={workspace?.summary?.stagedCount || 0} tone={(workspace?.summary?.stagedCount || 0) > 0 ? 'warn' : 'default'} />
          <SummaryCard label={`Shipped ${fmtDateLabel(workspaceDate)}`} value={workspace?.summary?.scheduledCount || 0} tone="success" />
          <SummaryCard label={`Hold ${fmtDateLabel(workspaceDate)}`} value={workspace?.summary?.holdCount || 0} tone={(workspace?.summary?.holdCount || 0) > 0 ? 'warn' : 'default'} />
          <SummaryCard label={`Canceled ${fmtDateLabel(workspaceDate)}`} value={workspace?.summary?.canceledCount || 0} tone={(workspace?.summary?.canceledCount || 0) > 0 ? 'danger' : 'default'} />
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>Belum Dikirim</div>
                <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
                  Batch di bawah ini masih pre-valid. Warehouse bisa membuka detail batch untuk melihat order-order di dalamnya, lalu menandai seluruh batch atau order tertentu sebagai <strong>shipped {fmtDateLabel(workspaceDate)}</strong>.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <ActionButton
                  onClick={() => applyWorkspaceAction({
                    orderIds: allStagedOrderIds,
                    warehouseStatus: 'scheduled',
                    shipmentDate: workspaceDate,
                    successText: `${fmtNumber(allStagedOrderIds.length)} order yang belum dikirim ditandai shipped ${fmtDateLabel(workspaceDate)}.`,
                  })}
                  tone="primary"
                  disabled={!allStagedOrderIds.length || Boolean(workspaceActionLoading)}
                >
                  Shipped Semua Staged
                </ActionButton>
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Batch</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Uploaded</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Order</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Line</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Amount</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Ringkasan</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }} />
                  </tr>
                </thead>
                <tbody>
                  {stagedBatches.map((batch) => {
                    const batchKey = `staged-batch:${batch.batchId}`;
                    const isBatchOpen = Boolean(expandedWorkspaceBatches[batchKey]);
                    return (
                      <Fragment key={batchKey}>
                        <tr>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700 }}>
                            #{batch.batchId} • {batch.batchFilename}
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>{fmtDateTime(batch.uploadedAt)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtNumber(batch.totalOrders)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtNumber(batch.totalLines)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtCurrency(batch.totalAmount)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--dim)' }}>
                            {fmtNumber(batch.totalOrders)} order belum dikirim
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              <ActionButton
                                onClick={() => applyWorkspaceAction({
                                  orderIds: batch.orderIds,
                                  warehouseStatus: 'scheduled',
                                  shipmentDate: workspaceDate,
                                  successText: `Batch #${batch.batchId} ditandai shipped ${fmtDateLabel(workspaceDate)}.`,
                                })}
                                tone="primary"
                                disabled={Boolean(workspaceActionLoading)}
                              >
                                Shipped Semua
                              </ActionButton>
                              <ActionButton onClick={() => toggleWorkspaceBatch(batchKey)}>
                                {isBatchOpen ? 'Hide' : 'Detail'}
                              </ActionButton>
                            </div>
                          </td>
                        </tr>
                        {isBatchOpen ? (
                          <tr>
                            <td colSpan={7} style={{ padding: 12, borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                              <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
                                  <thead>
                                    <tr style={{ background: 'var(--bg)' }}>
                                      <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Order MP</th>
                                      <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Customer</th>
                                      <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Store Final</th>
                                      <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Line</th>
                                      <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Amount</th>
                                      <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Status</th>
                                      <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }} />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {batch.orders.map((order) => {
                                      const orderKey = `staged:${order.id}`;
                                      const isOrderOpen = Boolean(expandedWorkspaceOrders[orderKey]);
                                      return (
                                        <Fragment key={orderKey}>
                                          <tr>
                                            <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700 }}>{order.externalOrderId}</td>
                                            <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>{order.customerLabel || order.recipientName || '-'}</td>
                                            <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>{order.finalStoreName || '-'}</td>
                                            <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12 }}>{fmtNumber(order.lineCount)}</td>
                                            <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12 }}>{fmtCurrency(order.orderAmount)}</td>
                                            <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                                              <StatusPill status={order.warehouseStatus} warehouse />
                                            </td>
                                            <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                                <ActionButton
                                                  onClick={() => applyWorkspaceAction({
                                                    orderIds: [order.id],
                                                    warehouseStatus: 'scheduled',
                                                    shipmentDate: workspaceDate,
                                                    successText: `Order ${order.externalOrderId} ditandai shipped ${fmtDateLabel(workspaceDate)}.`,
                                                  })}
                                                  tone="primary"
                                                  disabled={Boolean(workspaceActionLoading)}
                                                >
                                                  Shipped
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
                                                <ActionButton onClick={() => toggleWorkspaceOrder(orderKey)}>
                                                  {isOrderOpen ? 'Hide' : 'Detail'}
                                                </ActionButton>
                                              </div>
                                            </td>
                                          </tr>
                                          {isOrderOpen ? (
                                            <tr>
                                              <td colSpan={7} style={{ padding: 0, borderBottom: '1px solid var(--border)' }}>
                                                <DetailLineTable order={order} />
                                              </td>
                                            </tr>
                                          ) : null}
                                        </Fragment>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}

                  {!workspaceLoading && stagedOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 18, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
                        Tidak ada batch yang belum dikirim. Semua upload yang sudah disimpan dan belum punya shipment date akan muncul di sini.
                      </td>
                    </tr>
                  ) : null}

                  {workspaceLoading ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 18, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
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
              <div style={{ fontSize: 15, fontWeight: 800 }}>Shipped {fmtDateLabel(workspaceDate)}</div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
                Batch yang sudah ditandai shipped untuk tanggal <strong>{fmtDateLabel(workspaceDate)}</strong> akan muncul di bawah ini. Buka batch untuk melihat order-order di dalamnya, lalu buka order jika perlu melihat line item.
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Batch</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Uploaded</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Order</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Line</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Amount</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Ringkasan</th>
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }} />
                  </tr>
                </thead>
                <tbody>
                  {shipmentBatches.map((batch) => {
                    const batchKey = `shipment-batch:${batch.batchId}`;
                    const isBatchOpen = Boolean(expandedWorkspaceBatches[batchKey]);
                    return (
                      <Fragment key={batchKey}>
                        <tr>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700 }}>
                            #{batch.batchId} • {batch.batchFilename}
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>{fmtDateTime(batch.uploadedAt)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtNumber(batch.totalOrders)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtNumber(batch.totalLines)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtCurrency(batch.totalAmount)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--dim)' }}>
                            {fmtNumber(batch.statusCounts.scheduled || 0)} shipped • {fmtNumber(batch.statusCounts.hold || 0)} hold • {fmtNumber(batch.statusCounts.canceled || 0)} canceled
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              <ActionButton onClick={() => toggleWorkspaceBatch(batchKey)}>
                                {isBatchOpen ? 'Hide' : 'Detail'}
                              </ActionButton>
                            </div>
                          </td>
                        </tr>
                        {isBatchOpen ? (
                          <tr>
                            <td colSpan={7} style={{ padding: 0, borderBottom: '1px solid var(--border)' }}>
                              <div style={{ padding: 12, background: 'rgba(255,255,255,0.02)' }}>
                                <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                                    <thead>
                                      <tr style={{ background: 'var(--bg)' }}>
                                        <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Order MP</th>
                                        <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Customer</th>
                                        <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Store Final</th>
                                        <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Line</th>
                                        <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12, color: 'var(--dim)' }}>Amount</th>
                                        <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Status</th>
                                        <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }} />
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {batch.orders.map((order) => {
                                        const orderKey = `shipment:${order.id}`;
                                        const isOrderOpen = Boolean(expandedWorkspaceOrders[orderKey]);
                                        return (
                                          <Fragment key={orderKey}>
                                            <tr>
                                              <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700 }}>{order.externalOrderId}</td>
                                              <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>{order.customerLabel || order.recipientName || '-'}</td>
                                              <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>{order.finalStoreName || '-'}</td>
                                              <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12 }}>{fmtNumber(order.lineCount)}</td>
                                              <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12 }}>{fmtCurrency(order.orderAmount)}</td>
                                              <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                                                <StatusPill status={order.warehouseStatus} warehouse />
                                              </td>
                                              <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                                  {order.warehouseStatus !== 'scheduled' ? (
                                                    <ActionButton
                                                      onClick={() => applyWorkspaceAction({
                                                        orderIds: [order.id],
                                                        warehouseStatus: 'scheduled',
                                                        shipmentDate: workspaceDate,
                                                        successText: `Order ${order.externalOrderId} ditandai shipped ${fmtDateLabel(workspaceDate)}.`,
                                                      })}
                                                      tone="primary"
                                                      disabled={Boolean(workspaceActionLoading)}
                                                    >
                                                      Shipped
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
                                                  <ActionButton onClick={() => toggleWorkspaceOrder(orderKey)}>
                                                    {isOrderOpen ? 'Hide' : 'Detail'}
                                                  </ActionButton>
                                                </div>
                                              </td>
                                            </tr>
                                            {isOrderOpen ? (
                                              <tr>
                                                <td colSpan={7} style={{ padding: 0, borderBottom: '1px solid var(--border)' }}>
                                                  <DetailLineTable order={order} />
                                                </td>
                                              </tr>
                                            ) : null}
                                          </Fragment>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}

                  {!workspaceLoading && shipmentOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 18, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
                        Belum ada batch yang ditandai shipped untuk tanggal {fmtDateLabel(workspaceDate)}.
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

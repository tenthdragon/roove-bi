// @ts-nocheck
'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  getMarketplaceIntakeSourceConfig,
  listMarketplaceIntakeUploadSourceConfigs,
} from '@/lib/marketplace-intake-sources';
import { invalidateAll } from '@/lib/dashboard-cache';

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

const MARKETPLACE_SOURCE_OPTIONS = listMarketplaceIntakeUploadSourceConfigs();
const WORKSPACE_SOURCE_OPTIONS = [
  { sourceKey: 'all', sourceLabel: 'Semua Marketplace', businessCode: 'ALL' },
  ...MARKETPLACE_SOURCE_OPTIONS,
];

function fmtNumber(value) {
  return new Intl.NumberFormat('id-ID').format(Number(value || 0));
}

function fmtCurrency(value) {
  return `Rp ${fmtNumber(Math.round(Number(value || 0)))}`;
}

function cleanText(value) {
  return String(value ?? '').trim();
}

const NON_BLOCKING_PREVIEW_ISSUE_CODES = new Set([
  'remembered_manual_match',
  'manual_match_confirmed',
  'sku_alias_applied',
]);

function isActionablePreviewIssueCode(code) {
  return !NON_BLOCKING_PREVIEW_ISSUE_CODES.has(String(code || '').trim());
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

function fmtShortDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
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

function fmtCompactDate(value) {
  if (!value) return '-';
  const parsed = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) return value || '-';
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
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

function SyncStatusPill({ status, successLabel, failedLabel, idleLabel, partialLabel }) {
  const meta = status === 'success'
    ? { label: successLabel, color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.24)' }
    : status === 'partial'
      ? { label: partialLabel || 'Sebagian', color: '#fcd34d', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.24)' }
    : status === 'failed'
      ? { label: failedLabel, color: '#fca5a5', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.24)' }
      : { label: idleLabel, color: 'var(--dim)', bg: 'rgba(148,163,184,0.10)', border: 'var(--border)' };

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
        border: `1px solid ${meta.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  );
}

function getWorkspaceScalevSyncMeta(sync, loading) {
  if (loading) {
    return {
      label: 'Cek App ↔ Scalev…',
      tone: 'default',
      helper: 'Sedang membandingkan batch marketplace yang sudah dipush ke Scalev.',
    };
  }

  if (!sync || sync.status === 'empty') {
    return {
      label: 'Belum Ada Cek Scalev',
      tone: 'default',
      helper: 'Belum ada batch shipped pada scope ini yang pernah dipush ke Scalev.',
    };
  }

  if (sync.status === 'accurate') {
    return {
      label: 'App ↔ Scalev Akur',
      tone: 'success',
      helper: `${fmtNumber(sync.eligibleOrderCount || 0)} order yang sudah dipush ke Scalev cocok dengan posisi di app.`,
    };
  }

  const gapCount = Number(sync.missingOrderCount || 0) + Number(sync.wrongDateCount || 0);
  return {
    label: `Perlu Sinkron (${fmtNumber(gapCount)})`,
    tone: 'warn',
    helper: `${fmtNumber(sync.missingOrderCount || 0)} order belum ada di app, ${fmtNumber(sync.wrongDateCount || 0)} masih jatuh di tanggal yang berbeda.`,
  };
}

function FeedbackNotice({ message, compact = false }) {
  if (!message?.text) return null;

  const meta = message.type === 'success'
    ? {
      bg: 'rgba(34,197,94,0.12)',
      color: '#86efac',
      border: 'rgba(34,197,94,0.24)',
    }
    : message.type === 'error'
      ? {
        bg: 'rgba(239,68,68,0.12)',
        color: '#fca5a5',
        border: 'rgba(239,68,68,0.24)',
      }
      : {
        bg: 'rgba(148,163,184,0.12)',
        color: 'var(--text-secondary)',
        border: 'var(--border)',
      };

  return (
    <div
      style={{
        padding: compact ? '8px 10px' : '10px 12px',
        borderRadius: 10,
        fontSize: compact ? 12 : 13,
        background: meta.bg,
        color: meta.color,
        border: `1px solid ${meta.border}`,
      }}
    >
      {message.text}
    </div>
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

function formatIssueDetailValues(values = [], fallback = '-') {
  const cleaned = Array.from(new Set((values || []).map((value) => cleanText(value)).filter(Boolean)));
  if (cleaned.length === 0) return fallback;
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length <= 3) return cleaned.join(' • ');
  return `${cleaned.slice(0, 3).join(' • ')} • +${fmtNumber(cleaned.length - 3)} lainnya`;
}

function describeIssueField(cluster, field) {
  const hasSellerSku = Array.isArray(cluster.sellerSkus) && cluster.sellerSkus.length > 0;
  const hasMpSku = Array.isArray(cluster.mpSkus) && cluster.mpSkus.length > 0;
  const hasPlatformSkuId = Array.isArray(cluster.platformSkuIds) && cluster.platformSkuIds.length > 0;
  const hasVariation = Array.isArray(cluster.variations) && cluster.variations.length > 0;
  const hasEntity = Array.isArray(cluster.currentEntities) && cluster.currentEntities.length > 0;
  const hasStore = Array.isArray(cluster.currentStores) && cluster.currentStores.length > 0;

  if (field === 'sellerSku') {
    if (hasSellerSku) return { text: formatIssueDetailValues(cluster.sellerSkus), tone: 'ok' };
    if (hasPlatformSkuId || hasMpSku) return { text: 'Kosong, wajar karena matcher lain masih tersedia', tone: 'ok' };
    return { text: 'Kosong, butuh matcher lain untuk dinormalisasi', tone: 'problem' };
  }

  if (field === 'mpSku') {
    if (hasMpSku) return { text: formatIssueDetailValues(cluster.mpSkus), tone: 'ok' };
    if (hasSellerSku || hasPlatformSkuId) return { text: 'Kosong, wajar karena matcher lain sudah tersedia', tone: 'ok' };
    return { text: 'Kosong, butuh dibantu dari nama produk', tone: 'problem' };
  }

  if (field === 'platformSkuId') {
    if (hasPlatformSkuId) return { text: formatIssueDetailValues(cluster.platformSkuIds), tone: 'ok' };
    if (hasSellerSku || hasMpSku) return { text: 'Kosong, wajar karena matcher SKU lain sudah tersedia', tone: 'ok' };
    return { text: 'Kosong, butuh matcher lain', tone: 'problem' };
  }

  if (field === 'variation') {
    if (hasVariation) return { text: formatIssueDetailValues(cluster.variations), tone: 'ok' };
    return { text: 'Kosong, wajar kalau produk ini memang tidak punya varian', tone: 'ok' };
  }

  if (field === 'entity') {
    if (hasEntity) return { text: formatIssueDetailValues(cluster.currentEntities), tone: 'ok' };
    return { text: 'Belum match, butuh dipilih', tone: 'problem' };
  }

  if (field === 'store') {
    if (hasStore) return { text: formatIssueDetailValues(cluster.currentStores), tone: 'ok' };
    return cluster.issueKind === 'store_attribution'
      ? { text: 'Belum termapping, butuh dipilih', tone: 'problem' }
      : { text: 'Belum termapping, akan mengikuti hasil bundle dan store attribusi', tone: 'problem' };
  }

  return { text: '-', tone: 'ok' };
}

function getIssueFieldToneColor(tone) {
  return tone === 'problem' ? '#fca5a5' : '#86efac';
}

function ActionButton({ children, onClick, tone = 'default', disabled = false }) {
  const palette = tone === 'primary'
    ? { bg: '#2563eb', color: '#fff', border: '#2563eb' }
    : tone === 'success'
      ? { bg: 'rgba(34,197,94,0.12)', color: '#86efac', border: 'rgba(34,197,94,0.24)' }
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

function getAppButtonMeta(status) {
  if (status === 'success') {
    return { label: 'Sync Ulang App', tone: 'default' };
  }
  if (status === 'failed') {
    return { label: 'Coba Lagi App', tone: 'warn' };
  }
  return { label: 'Masuk ke App', tone: 'primary' };
}

function getScalevButtonMeta(status) {
  if (status === 'success') {
    return { label: 'Push Ulang Scalev', tone: 'default' };
  }
  if (status === 'failed') {
    return { label: 'Coba Lagi Scalev', tone: 'warn' };
  }
  return { label: 'Push ke Scalev', tone: 'primary' };
}

function getScalevReconcileButtonMeta(status) {
  if (status === 'success') {
    return { label: 'Tarik Ulang ID', tone: 'default' };
  }
  if (status === 'partial') {
    return { label: 'Lanjut Tarik ID', tone: 'warn' };
  }
  if (status === 'failed') {
    return { label: 'Coba Lagi ID', tone: 'warn' };
  }
  return { label: 'Tarik ID Scalev', tone: 'primary' };
}

function formatReconcileStatusText(batch) {
  if (batch.scalevLastReconcileStatus === 'success') {
    return `${fmtShortDateTime(batch.scalevLastReconcileAt)} • ${fmtNumber(batch.scalevLastReconcileMatchedCount || 0)} cocok • ${fmtNumber(batch.scalevLastReconcileUpdatedCount || 0)} update • ${fmtNumber(batch.scalevLastReconcileAlreadyLinkedCount || 0)} sudah linked`;
  }
  if (batch.scalevLastReconcileStatus === 'partial') {
    return `${fmtShortDateTime(batch.scalevLastReconcileAt)} • ${fmtNumber(batch.scalevLastReconcileMatchedCount || 0)} cocok • ${fmtNumber(batch.scalevLastReconcileUnmatchedCount || 0)} belum ketemu • ${fmtNumber(batch.scalevLastReconcileConflictCount || 0)} conflict`;
  }
  if (batch.scalevLastReconcileStatus === 'failed') {
    return batch.scalevLastReconcileError || 'Tarik Scalev ID gagal.';
  }
  return 'Belum ada percobaan tarik Scalev ID.';
}

function formatAppPromoteStatusText(batch) {
  if (batch.appLastPromoteStatus === 'success') {
    const parts = [
      fmtShortDateTime(batch.appLastPromoteAt),
      `${fmtNumber(batch.appLastPromoteInsertedCount || 0)} baru`,
      `${fmtNumber(batch.appLastPromoteUpdatedCount || 0)} update`,
    ];

    const detailParts = [];
    if (Number(batch.appLastPromoteUpdatedWebhookCount || 0) > 0) {
      detailParts.push(`${fmtNumber(batch.appLastPromoteUpdatedWebhookCount || 0)} bind webhook`);
    }
    if (Number(batch.appLastPromoteUpdatedAuthoritativeCount || 0) > 0) {
      detailParts.push(`${fmtNumber(batch.appLastPromoteUpdatedAuthoritativeCount || 0)} update authoritative`);
    }
    if (Number(batch.appLastPromoteMatchedTrackingCount || 0) > 0) {
      detailParts.push(`${fmtNumber(batch.appLastPromoteMatchedTrackingCount || 0)} via tracking`);
    }
    if (Number(batch.appLastPromoteMatchedExternalIdCount || 0) > 0) {
      detailParts.push(`${fmtNumber(batch.appLastPromoteMatchedExternalIdCount || 0)} via external ID`);
    }

    return detailParts.length ? `${parts.join(' • ')} • ${detailParts.join(' • ')}` : parts.join(' • ');
  }
  if (batch.appLastPromoteStatus === 'failed') {
    return batch.appLastPromoteError || 'Promosi ke app gagal.';
  }
  return 'Batch ini belum pernah dipromosikan ke app.';
}

function formatReconcileSuccessText(summary) {
  if (!summary) return '';
  const base = `${fmtNumber(summary.matchedCount || 0)} cocok • ${fmtNumber(summary.updatedCount || 0)} update • ${fmtNumber(summary.alreadyLinkedCount || 0)} sudah linked`;
  if (summary.status === 'success') return base;
  return `${base} • ${fmtNumber(summary.unmatchedCount || 0)} belum ketemu • ${fmtNumber(summary.conflictCount || 0)} conflict`;
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
                <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                  <div>{line.rawSellerSku || line.mpSku || line.rawPlatformSkuId || '-'}</div>
                  {line.normalizedSku && line.normalizedSku !== (line.rawSellerSku || line.mpSku || '') ? (
                    <div style={{ marginTop: 4, color: '#93c5fd' }}>Normalized → {line.normalizedSku}</div>
                  ) : null}
                  {line.skuNormalizationReason ? (
                    <div style={{ marginTop: 4, color: 'var(--dim)' }}>{line.skuNormalizationReason}</div>
                  ) : null}
                </td>
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
        appLastPromoteStatus: order.batchAppLastPromoteStatus || null,
        appLastPromoteAt: order.batchAppLastPromoteAt || null,
        appLastPromoteOrderCount: Number(order.batchAppLastPromoteOrderCount || 0),
        appLastPromoteInsertedCount: Number(order.batchAppLastPromoteInsertedCount || 0),
        appLastPromoteUpdatedCount: Number(order.batchAppLastPromoteUpdatedCount || 0),
        appLastPromoteUpdatedWebhookCount: Number(order.batchAppLastPromoteUpdatedWebhookCount || 0),
        appLastPromoteUpdatedAuthoritativeCount: Number(order.batchAppLastPromoteUpdatedAuthoritativeCount || 0),
        appLastPromoteMatchedExternalIdCount: Number(order.batchAppLastPromoteMatchedExternalIdCount || 0),
        appLastPromoteMatchedTrackingCount: Number(order.batchAppLastPromoteMatchedTrackingCount || 0),
        appLastPromoteSkippedCount: Number(order.batchAppLastPromoteSkippedCount || 0),
        appLastPromoteError: order.batchAppLastPromoteError || null,
        scalevLastSendStatus: order.batchScalevLastSendStatus || null,
        scalevLastSendAt: order.batchScalevLastSendAt || null,
        scalevLastSendRowCount: Number(order.batchScalevLastSendRowCount || 0),
        scalevLastSendError: order.batchScalevLastSendError || null,
        scalevLastReconcileStatus: order.batchScalevLastReconcileStatus || null,
        scalevLastReconcileAt: order.batchScalevLastReconcileAt || null,
        scalevLastReconcileTargetCount: Number(order.batchScalevLastReconcileTargetCount || 0),
        scalevLastReconcileMatchedCount: Number(order.batchScalevLastReconcileMatchedCount || 0),
        scalevLastReconcileUpdatedCount: Number(order.batchScalevLastReconcileUpdatedCount || 0),
        scalevLastReconcileAlreadyLinkedCount: Number(order.batchScalevLastReconcileAlreadyLinkedCount || 0),
        scalevLastReconcileUnmatchedCount: Number(order.batchScalevLastReconcileUnmatchedCount || 0),
        scalevLastReconcileConflictCount: Number(order.batchScalevLastReconcileConflictCount || 0),
        scalevLastReconcileErrorCount: Number(order.batchScalevLastReconcileErrorCount || 0),
        scalevLastReconcileError: order.batchScalevLastReconcileError || null,
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
  const [sourceKey, setSourceKey] = useState('all');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [workspaceActionLoading, setWorkspaceActionLoading] = useState('');
  const [scalevSendingBatchKey, setScalevSendingBatchKey] = useState('');
  const [scalevReconcilingBatchKey, setScalevReconcilingBatchKey] = useState('');
  const [appPromotingBatchKey, setAppPromotingBatchKey] = useState('');
  const [savingResolverRuleKey, setSavingResolverRuleKey] = useState('');
  const [savingInlineFixKey, setSavingInlineFixKey] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState(null);
  const [previewQueue, setPreviewQueue] = useState([]);
  const [activePreviewKey, setActivePreviewKey] = useState('');
  const [preview, setPreview] = useState(null);
  const [search, setSearch] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [expandedPreviewOrders, setExpandedPreviewOrders] = useState({});
  const [expandedWorkspaceBatches, setExpandedWorkspaceBatches] = useState({});
  const [expandedWorkspaceOrders, setExpandedWorkspaceOrders] = useState({});
  const [manualSelections, setManualSelections] = useState({});
  const [issueSelections, setIssueSelections] = useState({});
  const [issueSearchQueries, setIssueSearchQueries] = useState({});
  const [issueSearchResults, setIssueSearchResults] = useState({});
  const [searchingIssueKey, setSearchingIssueKey] = useState('');
  const [inlineFixOpen, setInlineFixOpen] = useState({});
  const [inlineFixForms, setInlineFixForms] = useState({});
  const [lineSearchQueries, setLineSearchQueries] = useState({});
  const [lineSearchResults, setLineSearchResults] = useState({});
  const [searchingLineKey, setSearchingLineKey] = useState('');
  const [workspaceDate, setWorkspaceDate] = useState(getCurrentDateValue());
  const [batchShipmentDates, setBatchShipmentDates] = useState({});
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspace, setWorkspace] = useState(null);
  const [workspaceScalevSync, setWorkspaceScalevSync] = useState(null);
  const [workspaceScalevSyncLoading, setWorkspaceScalevSyncLoading] = useState(false);
  const [workspaceScalevSyncError, setWorkspaceScalevSyncError] = useState('');
  const [workspaceScalevSyncModalOpen, setWorkspaceScalevSyncModalOpen] = useState(false);
  const [workspaceScalevSyncRepairing, setWorkspaceScalevSyncRepairing] = useState(false);
  const workspaceScalevSyncRequestRef = useRef('');

  const activeSource = useMemo(
    () => (preview?.source?.sourceKey ? getMarketplaceIntakeSourceConfig(preview.source.sourceKey) : null),
    [preview?.source?.sourceKey],
  );
  const activePreviewSourceKey = preview?.source?.sourceKey || '';
  const workspaceSourceOption = useMemo(
    () => WORKSPACE_SOURCE_OPTIONS.find((option) => option.sourceKey === sourceKey) || WORKSPACE_SOURCE_OPTIONS[0],
    [sourceKey],
  );
  const previewSourceLabel = preview?.source?.sourceLabel || activeSource?.sourceLabel || 'Marketplace';
  const previewSearchPlaceholder = activeSource?.searchPlaceholder || 'Cari bundle marketplace…';
  const workspaceScopeLabel = workspaceSourceOption?.sourceLabel || 'Marketplace';
  const livePreviewDrafts = useMemo(() => {
    const drafts = [...previewQueue];
    if (!preview || !activePreviewKey) return drafts;
    return upsertDraft(drafts, {
      key: activePreviewKey,
      preview,
      expandedPreviewOrders,
      manualSelections,
      issueSelections,
      issueSearchQueries,
      issueSearchResults,
      inlineFixOpen,
      inlineFixForms,
      lineSearchQueries,
      lineSearchResults,
      search,
      issuesOnly,
    });
  }, [
    activePreviewKey,
    expandedPreviewOrders,
    inlineFixForms,
    inlineFixOpen,
    issueSearchQueries,
    issueSearchResults,
    issueSelections,
    issuesOnly,
    lineSearchQueries,
    lineSearchResults,
    manualSelections,
    preview,
    previewQueue,
    search,
  ]);
  const activeAllowedStores = useMemo(() => {
    const previewStores = (preview?.source?.allowedStores || []).filter(Boolean);
    return previewStores.length > 0 ? previewStores : (activeSource?.allowedStores || []);
  }, [activeSource?.allowedStores, preview?.source?.allowedStores]);

  function getLineKey(orderId, lineIndex) {
    return `${orderId}::${lineIndex}`;
  }

  function buildDraftFromPreviewData(data) {
    const initialSelections = {};
    for (const order of data.orders || []) {
      for (const line of order.lines || []) {
        if (line.selectedSuggestion) {
          initialSelections[getLineKey(order.externalOrderId, line.lineIndex)] = line.selectedSuggestion;
        }
      }
    }

    return {
      key: `${data.source?.sourceKey || 'unknown'}::${data.fingerprint || data.filename || Date.now()}`,
      preview: data,
      expandedPreviewOrders: {},
      manualSelections: initialSelections,
      issueSelections: {},
      issueSearchQueries: {},
      issueSearchResults: {},
      inlineFixOpen: {},
      inlineFixForms: {},
      lineSearchQueries: {},
      lineSearchResults: {},
      search: '',
      issuesOnly: Boolean(data.summary?.needsReviewOrders),
    };
  }

  function upsertDraft(currentDrafts, nextDraft) {
    const existingIndex = currentDrafts.findIndex((item) => item.key === nextDraft.key);
    if (existingIndex === -1) return [...currentDrafts, nextDraft];
    const next = [...currentDrafts];
    next[existingIndex] = nextDraft;
    return next;
  }

  function clearActivePreviewEditor() {
    setActivePreviewKey('');
    setPreview(null);
    setExpandedPreviewOrders({});
    setManualSelections({});
    setIssueSelections({});
    setIssueSearchQueries({});
    setIssueSearchResults({});
    setInlineFixOpen({});
    setInlineFixForms({});
    setLineSearchQueries({});
    setLineSearchResults({});
    setSearch('');
    setIssuesOnly(false);
  }

  function snapshotActiveDraft() {
    if (!preview || !activePreviewKey) return null;
    return {
      key: activePreviewKey,
      preview,
      expandedPreviewOrders,
      manualSelections,
      issueSelections,
      issueSearchQueries,
      issueSearchResults,
      inlineFixOpen,
      inlineFixForms,
      lineSearchQueries,
      lineSearchResults,
      search,
      issuesOnly,
    };
  }

  function persistActiveDraft() {
    const snapshot = snapshotActiveDraft();
    if (!snapshot) return;
    setPreviewQueue((current) => upsertDraft(current, snapshot));
  }

  function loadDraftIntoEditor(draft) {
    if (!draft) {
      clearActivePreviewEditor();
      return;
    }
    setActivePreviewKey(draft.key);
    setPreview(draft.preview || null);
    setExpandedPreviewOrders(draft.expandedPreviewOrders || {});
    setManualSelections(draft.manualSelections || {});
    setIssueSelections(draft.issueSelections || {});
    setIssueSearchQueries(draft.issueSearchQueries || {});
    setIssueSearchResults(draft.issueSearchResults || {});
    setInlineFixOpen(draft.inlineFixOpen || {});
    setInlineFixForms(draft.inlineFixForms || {});
    setLineSearchQueries(draft.lineSearchQueries || {});
    setLineSearchResults(draft.lineSearchResults || {});
    setSearch(draft.search || '');
    setIssuesOnly(Boolean(draft.issuesOnly));
  }

  function switchToDraft(nextDraftKey) {
    if (!nextDraftKey || nextDraftKey === activePreviewKey) return;
    const nextDraft = previewQueue.find((draft) => draft.key === nextDraftKey);
    if (!nextDraft) return;
    persistActiveDraft();
    loadDraftIntoEditor(nextDraft);
  }

  function dismissDraft(draftKey) {
    if (!draftKey) return;
    const remainingDrafts = previewQueue.filter((draft) => draft.key !== draftKey);
    setPreviewQueue(remainingDrafts);
    if (draftKey === activePreviewKey) {
      if (remainingDrafts.length > 0) {
        loadDraftIntoEditor(remainingDrafts[0]);
      } else {
        clearActivePreviewEditor();
      }
    }
  }

  function getBatchShipmentDate(batchId) {
    return batchShipmentDates[String(batchId)] || workspaceDate || getCurrentDateValue();
  }

  function updateBatchShipmentDate(batchId, value) {
    const nextDate = String(value || '').trim() || getCurrentDateValue();
    setBatchShipmentDates((current) => ({
      ...current,
      [String(batchId)]: nextDate,
    }));
  }

  useEffect(() => {
    loadWorkspace(getCurrentDateValue());
  }, [sourceKey]);

  useEffect(() => {
    setBatchShipmentDates({});
    setWorkspaceError('');
    setWorkspace(null);
    setWorkspaceScalevSync(null);
    setWorkspaceScalevSyncError('');
    setWorkspaceScalevSyncModalOpen(false);
    setWorkspaceDate(getCurrentDateValue());
  }, [sourceKey]);

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
        (order.issueCodes || []).filter((code) => (
          !['custom_id_not_found', 'custom_id_ambiguous', 'store_classifier_missing', 'store_amount_tie'].includes(code)
          && isActionablePreviewIssueCode(code)
        )),
      );
      const identifiedLineCount = lines.filter((line) => line.effectiveStatus !== 'not_identified').length;
      const classifiedLineCount = lines.filter((line) => line.effectiveStatus === 'identified').length;
      const storeTotals = new Map();

      for (const line of lines) {
        for (const code of line.effectiveIssueCodes || []) {
          if (isActionablePreviewIssueCode(code)) {
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

  function getDefaultInlineFixNormalizedSku(line, candidate) {
    const candidateCustomId = cleanText(candidate?.customId);
    if (candidateCustomId) return candidateCustomId;

    const effectiveCustomId = cleanText(line.effectiveCustomId);
    if (effectiveCustomId && effectiveCustomId !== cleanText(line.rawPlatformSkuId)) return effectiveCustomId;

    const rawSellerSku = cleanText(line.rawSellerSku);
    if (rawSellerSku) return rawSellerSku;

    const normalizedSku = cleanText(line.normalizedSku);
    if (normalizedSku && normalizedSku !== cleanText(line.rawPlatformSkuId)) return normalizedSku;

    return '';
  }

  function getDefaultInlineFixReason(line) {
    return cleanText(line.skuNormalizationReason)
      || (
        line.rawPlatformSkuId
          ? 'Seller SKU kosong atau tidak stabil; intake memakai platform SKU ID sebagai matcher normalisasi.'
          : line.rawSellerSku
            ? 'SKU marketplace perlu dinormalisasi ke SKU internal sebelum klasifikasi.'
            : 'Seller SKU dan platform SKU ID kosong; intake memakai nama produk marketplace sebagai matcher normalisasi.'
      );
  }

  function getInlineFixMatcherSummary(line) {
    if (cleanText(line.rawPlatformSkuId)) {
      return `Matcher utama: Platform SKU ID ${line.rawPlatformSkuId}`;
    }
    if (cleanText(line.rawSellerSku)) {
      return `Matcher utama: Seller SKU ${line.rawSellerSku}`;
    }
    if (cleanText(line.mpSku)) {
      return `Matcher utama: SKU marketplace ${line.mpSku}`;
    }
    if (cleanText(line.mpProductName)) {
      return cleanText(line.mpVariation)
        ? `Matcher utama: Nama produk + variation (${line.mpProductName} • ${line.mpVariation})`
        : `Matcher utama: Nama produk (${line.mpProductName})`;
    }
    return 'Matcher utama akan mengikuti field mentah yang tersedia pada line ini.';
  }

  function getInlineFixMatcherPayload(line) {
    if (cleanText(line.rawPlatformSkuId)) {
      return {
        rawPlatformSkuId: line.rawPlatformSkuId,
        rawSellerSku: null,
        rawProductName: null,
        rawVariation: null,
      };
    }

    if (cleanText(line.rawSellerSku)) {
      return {
        rawPlatformSkuId: null,
        rawSellerSku: line.rawSellerSku,
        rawProductName: null,
        rawVariation: null,
      };
    }

    if (cleanText(line.mpSku)) {
      return {
        rawPlatformSkuId: null,
        rawSellerSku: line.mpSku,
        rawProductName: null,
        rawVariation: null,
      };
    }

    return {
      rawPlatformSkuId: null,
      rawSellerSku: null,
      rawProductName: line.mpProductName || null,
      rawVariation: line.mpVariation || null,
    };
  }

  function openInlineFixForLine(orderId, lineIndex, line, candidate) {
    const lineKey = getLineKey(orderId, lineIndex);
    setInlineFixOpen((current) => ({
      ...current,
      [lineKey]: true,
    }));
    setInlineFixForms((current) => ({
      ...current,
      [lineKey]: current[lineKey] || {
        normalizedSku: getDefaultInlineFixNormalizedSku(line, candidate),
        reason: getDefaultInlineFixReason(line),
      },
    }));
  }

  function closeInlineFixForLine(orderId, lineIndex) {
    const lineKey = getLineKey(orderId, lineIndex);
    setInlineFixOpen((current) => ({
      ...current,
      [lineKey]: false,
    }));
  }

  function setInlineFixField(orderId, lineIndex, field, value) {
    const lineKey = getLineKey(orderId, lineIndex);
    setInlineFixForms((current) => ({
      ...current,
      [lineKey]: {
        normalizedSku: current[lineKey]?.normalizedSku || '',
        reason: current[lineKey]?.reason || '',
        [field]: value,
      },
    }));
  }

  function updatePreviewLineLocally(orderId, lineIndex, updater) {
    setPreview((current) => {
      if (!current?.orders) return current;
      return {
        ...current,
        orders: current.orders.map((order) => {
          if (order.externalOrderId !== orderId) return order;
          return {
            ...order,
            lines: (order.lines || []).map((line) => {
              if (Number(line.lineIndex) !== Number(lineIndex)) return line;
              return updater(line);
            }),
          };
        }),
      };
    });
  }

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

  const issueClusters = useMemo(() => {
    const clusters = new Map();

    for (const order of effectivePreviewOrders) {
      for (const line of order.lines || []) {
        const meaningfulIssueCodes = (line.effectiveIssueCodes || []).filter((code) => isActionablePreviewIssueCode(code));
        const needsReview = line.effectiveStatus !== 'identified' || meaningfulIssueCodes.length > 0;
        if (!needsReview) continue;

        const issueKind = line.effectiveStatus === 'not_identified'
          ? 'entity_missing'
          : 'store_attribution';

        const matcherKind = cleanText(line.rawPlatformSkuId)
          ? 'platform_sku_id'
          : cleanText(line.rawSellerSku)
            ? 'seller_sku'
            : cleanText(line.mpSku)
              ? 'marketplace_sku'
              : 'product_name';

        const matcherValue = cleanText(line.rawPlatformSkuId)
          || cleanText(line.rawSellerSku)
          || cleanText(line.mpSku)
          || cleanText(line.mpProductName)
          || 'unknown';

        const issueKey = issueKind === 'entity_missing'
          ? [
            issueKind,
            matcherKind,
            cleanText(matcherValue).toLowerCase(),
            cleanText(line.mpProductName).toLowerCase(),
            cleanText(line.mpVariation).toLowerCase(),
          ].join('::')
          : [
            issueKind,
            cleanText(line.effectiveEntityLabel || line.matchedEntityLabel || line.effectiveCustomId || line.detectedCustomId || line.mpProductName).toLowerCase(),
            cleanText(line.mpVariation).toLowerCase(),
          ].join('::');

        const existing = clusters.get(issueKey) || {
          key: issueKey,
          issueKind,
          matcherKind,
          matcherValue,
          issueCodes: new Set(),
          members: [],
          orderIds: new Set(),
          productNames: new Set(),
          sellerSkus: new Set(),
          mpSkus: new Set(),
          platformSkuIds: new Set(),
          variations: new Set(),
          currentEntities: new Set(),
          currentStores: new Set(),
          amount: 0,
          representativeOrder: order,
          representativeLine: line,
        };

        existing.members.push({
          orderId: order.externalOrderId,
          order,
          line,
        });
        existing.orderIds.add(order.externalOrderId);
        if (cleanText(line.mpProductName)) existing.productNames.add(cleanText(line.mpProductName));
        if (cleanText(line.rawSellerSku)) existing.sellerSkus.add(cleanText(line.rawSellerSku));
        if (cleanText(line.mpSku)) existing.mpSkus.add(cleanText(line.mpSku));
        if (cleanText(line.rawPlatformSkuId)) existing.platformSkuIds.add(cleanText(line.rawPlatformSkuId));
        if (cleanText(line.mpVariation)) existing.variations.add(cleanText(line.mpVariation));
        if (cleanText(line.effectiveEntityLabel || line.matchedEntityLabel)) existing.currentEntities.add(cleanText(line.effectiveEntityLabel || line.matchedEntityLabel));
        if (cleanText(line.effectiveStoreName || line.mappedStoreName)) existing.currentStores.add(cleanText(line.effectiveStoreName || line.mappedStoreName));
        existing.amount += Number(line.lineSubtotal || 0);
        meaningfulIssueCodes.forEach((code) => existing.issueCodes.add(code));
        clusters.set(issueKey, existing);
      }
    }

    return Array.from(clusters.values())
      .map((cluster) => {
        const line = cluster.representativeLine;
        let title = '';
        let description = '';

        if (cluster.issueKind === 'entity_missing') {
          if (!cleanText(line.rawSellerSku) && !cleanText(line.rawPlatformSkuId)) {
            title = 'Nama produk belum punya matcher SKU yang jelas';
            description = `Saya hanya punya nama produk "${line.mpProductName}"${cleanText(line.mpVariation) ? ` dengan variation "${line.mpVariation}"` : ''}. Mau dipasangkan ke bundle apa ini?`;
          } else if (!cleanText(line.rawSellerSku) && cleanText(line.rawPlatformSkuId)) {
            title = 'Seller SKU kosong, tinggal Platform SKU ID';
            description = `Saya hanya menemukan Platform SKU ID "${line.rawPlatformSkuId}" untuk "${line.mpProductName}". Mau dinormalisasi ke SKU internal apa dan dipasangkan ke bundle apa?`;
          } else {
            title = 'Matcher intake belum terhubung ke bundle';
            description = `Matcher "${cluster.matcherValue}" untuk "${line.mpProductName}" belum bisa saya sambungkan ke bundle internal. Mau dipasangkan ke bundle apa?`;
          }
        } else {
          title = 'Bundle sudah ketemu, store sales belum jelas';
          description = `Saya sudah ketemu bundle "${line.effectiveEntityLabel || line.matchedEntityLabel || line.mpProductName}", tapi sales order-nya belum tahu harus diatribusikan ke store mana. Mau masuk ke store apa?`;
        }

        return {
          ...cluster,
          issueCodes: Array.from(cluster.issueCodes),
          productNames: Array.from(cluster.productNames),
          sellerSkus: Array.from(cluster.sellerSkus),
          mpSkus: Array.from(cluster.mpSkus),
          platformSkuIds: Array.from(cluster.platformSkuIds),
          variations: Array.from(cluster.variations),
          currentEntities: Array.from(cluster.currentEntities),
          currentStores: Array.from(cluster.currentStores),
          lineCount: cluster.members.length,
          orderCount: cluster.orderIds.size,
          title,
          description,
        };
      })
      .sort((left, right) => {
        if (right.lineCount !== left.lineCount) return right.lineCount - left.lineCount;
        return right.amount - left.amount;
      });
  }, [effectivePreviewOrders]);

  const visibleIssueClusters = useMemo(() => {
    const query = cleanText(search).toLowerCase();
    return issueClusters.filter((cluster) => {
      if (!query) return true;
      const haystack = [
        cluster.matcherValue,
        cluster.representativeLine?.mpProductName,
        cluster.representativeLine?.mpVariation,
        cluster.representativeLine?.effectiveEntityLabel,
        ...(cluster.issueCodes || []),
        ...(cluster.productNames || []),
        ...(cluster.sellerSkus || []),
        ...(cluster.mpSkus || []),
        ...(cluster.platformSkuIds || []),
        ...(cluster.currentEntities || []),
        ...(cluster.currentStores || []),
        ...cluster.members.map((member) => member.orderId),
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [issueClusters, search]);

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

  const sharedIssueCandidates = useMemo(() => {
    const rememberedCandidates = Object.values(manualSelections || {}).filter(Boolean);
    const clusterSelections = Object.values(issueSelections || {}).filter(Boolean);
    const previewCandidates = effectivePreviewOrders.flatMap((order) => (
      (order.lines || []).flatMap((line) => [
        line.selectedCandidate,
        line.selectedSuggestion,
      ].filter(Boolean))
    ));

    return Array.from(
      new Map(
        [
          ...rememberedCandidates,
          ...clusterSelections,
          ...previewCandidates,
        ].map((candidate) => [candidate.entityKey, candidate]),
      ).values(),
    );
  }, [effectivePreviewOrders, issueSelections, manualSelections]);

  function getIssueSelectedCandidate(cluster) {
    return issueSelections[cluster.key]
      || cluster.representativeLine.selectedCandidate
      || cluster.representativeLine.selectedSuggestion
      || null;
  }

  function getIssueCandidateOptions(cluster) {
    const issueSearchEntries = issueSearchResults[cluster.key] || [];
    return Array.from(
      new Map(
        [
          ...sharedIssueCandidates,
          ...cluster.members.flatMap((member) => member.line.suggestionCandidates || []),
          ...issueSearchEntries,
        ].map((candidate) => [candidate.entityKey, candidate]),
      ).values(),
    );
  }

  function setIssueSelection(clusterKey, candidate) {
    setIssueSelections((current) => ({
      ...current,
      [clusterKey]: candidate,
    }));
  }

  async function handleSearchIssueBundles(cluster) {
    const clusterKey = cluster.key;
    const query = String(issueSearchQueries[clusterKey] || '').trim();
    if (query.length < 2) return;
    if (!activePreviewSourceKey) {
      setError('Source preview belum terdeteksi. Upload ulang file ini.');
      return;
    }

    setSearchingIssueKey(clusterKey);
    try {
      const requestUrl = `/api/marketplace-intake/search-bundles?q=${encodeURIComponent(query)}&sourceKey=${encodeURIComponent(activePreviewSourceKey)}`;
      const res = await fetch(requestUrl);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal mencari bundle untuk issue ini.');
      }
      setIssueSearchResults((current) => ({
        ...current,
        [clusterKey]: data.results || [],
      }));
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal mencari bundle untuk issue ini.');
    } finally {
      setSearchingIssueKey('');
    }
  }

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

  async function fetchJsonWithTimeout(input, init = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(input, {
        ...init,
        signal: controller.signal,
      });
      const data = await res.json();
      return { res, data };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('Request preview timeout di localhost. Coba refresh halaman lalu upload ulang.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function loadWorkspaceScalevSync(date) {
    const shipmentDate = String(date || workspaceDate || getCurrentDateValue());
    const requestKey = `${sourceKey}::${shipmentDate}`;
    workspaceScalevSyncRequestRef.current = requestKey;
    setWorkspaceScalevSyncLoading(true);
    setWorkspaceScalevSyncError('');

    try {
      const res = await fetch(
        `/api/marketplace-intake/workspace-scalev-sync?shipmentDate=${encodeURIComponent(shipmentDate)}&sourceKey=${encodeURIComponent(sourceKey)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal mengecek akurasi Scalev vs app.');
      }

      if (workspaceScalevSyncRequestRef.current !== requestKey) return;
      setWorkspaceScalevSync(data);
    } catch (err) {
      console.error(err);
      if (workspaceScalevSyncRequestRef.current !== requestKey) return;
      setWorkspaceScalevSync(null);
      setWorkspaceScalevSyncError(err?.message || 'Gagal mengecek akurasi Scalev vs app.');
    } finally {
      if (workspaceScalevSyncRequestRef.current === requestKey) {
        setWorkspaceScalevSyncLoading(false);
      }
    }
  }

  async function loadWorkspace(date) {
    const shipmentDate = String(date || getCurrentDateValue());
    setWorkspaceLoading(true);
    setWorkspaceError('');

    try {
      const res = await fetch(
        `/api/marketplace-intake/workspace?shipmentDate=${encodeURIComponent(shipmentDate)}&sourceKey=${encodeURIComponent(sourceKey)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal membaca workspace warehouse.');
      }

      setWorkspace(data);
      void loadWorkspaceScalevSync(shipmentDate);
    } catch (err) {
      console.error(err);
      setWorkspace(null);
      setWorkspaceError(err?.message || 'Gagal membaca workspace warehouse.');
      setWorkspaceScalevSync(null);
      setWorkspaceScalevSyncError('');
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function previewSingleFile(file) {
    if (!file) return null;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('filename', file.name);

    const { res, data } = await fetchJsonWithTimeout('/api/marketplace-intake/preview', {
      method: 'POST',
      body: formData,
    }, 45000);
    if (!res.ok) {
      throw new Error(data.error || `Gagal membaca file ${file.name}.`);
    }

    return buildDraftFromPreviewData(data);
  }

  async function handleUpload(filesInput) {
    const files = Array.from(filesInput || []).filter(Boolean);
    if (!files.length) return;
    setUploading(true);
    setError('');
    setMessage(null);

    try {
      const currentSnapshot = snapshotActiveDraft();
      const successfulDrafts = [];
      const failedUploads = [];

      for (const file of files) {
        try {
          const draft = await previewSingleFile(file);
          if (draft) successfulDrafts.push(draft);
        } catch (err) {
          console.error(err);
          failedUploads.push(`${file.name}: ${err?.message || 'Gagal memproses file.'}`);
        }
      }

      if (!successfulDrafts.length) {
        throw new Error(failedUploads[0] || 'Tidak ada file yang berhasil dipreview.');
      }

      setPreviewQueue((current) => {
        let next = [...current];
        if (currentSnapshot) {
          next = upsertDraft(next, currentSnapshot);
        }
        for (const draft of successfulDrafts) {
          next = upsertDraft(next, draft);
        }
        return next;
      });

      if (!preview || !activePreviewKey) {
        loadDraftIntoEditor(successfulDrafts[0]);
      }

      if (failedUploads.length > 0) {
        setError(failedUploads.join(' | '));
      }

      const totalReady = successfulDrafts.reduce((sum, draft) => sum + Number(draft.preview?.summary?.readyOrders || 0), 0);
      const totalNeedsReview = successfulDrafts.reduce((sum, draft) => sum + Number(draft.preview?.summary?.needsReviewOrders || 0), 0);
      const totalPreselected = successfulDrafts.reduce((sum, draft) => sum + Object.keys(draft.manualSelections || {}).length, 0);
      setMessage({
        type: 'success',
        scope: 'upload',
        text: `${fmtNumber(successfulDrafts.length)} file berhasil dipreview. ${fmtNumber(totalReady)} order siap, ${fmtNumber(totalNeedsReview)} perlu review, ${fmtNumber(totalPreselected)} line sudah preselect dari ingatan manual.${failedUploads.length ? ` ${fmtNumber(failedUploads.length)} file gagal dibaca.` : ''}`,
      });
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal memproses file marketplace.');
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

      const remainingDrafts = previewQueue.filter((draft) => draft.key !== activePreviewKey);
      setPreviewQueue(remainingDrafts);
      if (remainingDrafts.length > 0) {
        loadDraftIntoEditor(remainingDrafts[0]);
      } else {
        clearActivePreviewEditor();
      }
      await loadWorkspace(workspaceDate);

      setMessage({
        type: 'success',
        scope: 'workspace',
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
    if (!activePreviewSourceKey) {
      setError('Source preview belum terdeteksi. Upload ulang file ini.');
      return;
    }

    setSearchingLineKey(key);
    try {
      const requestUrl = `/api/marketplace-intake/search-bundles?q=${encodeURIComponent(query)}&sourceKey=${encodeURIComponent(activePreviewSourceKey)}`;
      const res = await fetch(requestUrl);
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

  async function handleSaveResolverRule(order, line) {
    const lineKey = getLineKey(order.externalOrderId, line.lineIndex);
    const candidate = manualSelections[lineKey] || line.selectedCandidate || line.selectedSuggestion || null;
    if (!candidate?.entityKey || !Number(candidate?.scalevBundleId || 0)) return;
    if (!activePreviewSourceKey) {
      setError('Source preview belum terdeteksi. Upload ulang file ini.');
      return;
    }

    setSavingResolverRuleKey(lineKey);
    setError('');
    setWorkspaceError('');
    setMessage(null);

    try {
      const res = await fetch('/api/marketplace-intake/manual-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceKey: activePreviewSourceKey,
          mpSku: line.normalizedSku || line.mpSku || null,
          mpProductName: line.mpProductName,
          mpVariation: line.mpVariation || null,
          targetEntityKey: candidate.entityKey,
          targetEntityLabel: candidate.entityLabel,
          targetCustomId: candidate.customId || line.effectiveCustomId || null,
          scalevBundleId: Number(candidate.scalevBundleId || 0),
          mappedStoreName: candidate.storeName || line.effectiveStoreName || null,
          isActive: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal menyimpan rule resolver.');
      }

      setManualSelection(order.externalOrderId, line.lineIndex, {
        ...candidate,
        customId: data?.item?.targetCustomId || candidate.customId || null,
        storeName: data?.item?.mappedStoreName || candidate.storeName || null,
        classifierLabel: data?.item?.mappedStoreName
          ? 'Resolver rule tersimpan'
          : candidate.classifierLabel || 'Resolver rule tersimpan',
        source: 'manual',
      });
      setMessage({
        type: 'success',
        scope: 'preview',
        text: `Rule permanen tersimpan untuk "${line.mpProductName}". Line serupa sekarang bisa dipetakan lagi dari tab Resolver Rules.`,
      });
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal menyimpan rule resolver.');
    } finally {
      setSavingResolverRuleKey('');
    }
  }

  async function handleApplyInlineFix(order, line) {
    const lineKey = getLineKey(order.externalOrderId, line.lineIndex);
    const candidate = manualSelections[lineKey] || line.selectedCandidate || line.selectedSuggestion || null;
    const form = inlineFixForms[lineKey] || {};
    const normalizedSku = cleanText(form.normalizedSku) || cleanText(candidate?.customId) || cleanText(line.effectiveCustomId);
    const reason = cleanText(form.reason) || getDefaultInlineFixReason(line);

    if (!candidate?.entityKey || !Number(candidate?.scalevBundleId || 0)) {
      setError('Pilih entity Scalev dulu sebelum menyimpan perbaikan inline.');
      return;
    }
    if (!candidate?.storeName) {
      setError('Pilih store atribusi dulu sebelum menyimpan perbaikan inline.');
      return;
    }
    if (!normalizedSku) {
      setError('Normalized SKU wajib diisi untuk menyimpan perbaikan inline.');
      return;
    }
    if (!activePreviewSourceKey) {
      setError('Source preview belum terdeteksi. Upload ulang file ini.');
      return;
    }

    setSavingInlineFixKey(lineKey);
    setError('');
    setWorkspaceError('');
    setMessage(null);

    try {
      const matcherPayload = getInlineFixMatcherPayload(line);
      const shouldSaveAlias = Boolean(
        matcherPayload.rawPlatformSkuId
        || matcherPayload.rawSellerSku
        || matcherPayload.rawProductName
      ) && (
        !cleanText(line.normalizedSku)
        || cleanText(line.normalizedSku) !== normalizedSku
        || (line.effectiveIssueCodes || []).includes('custom_id_not_found')
        || (line.effectiveIssueCodes || []).includes('custom_id_ambiguous')
      );

      if (shouldSaveAlias) {
        const aliasRes = await fetch('/api/marketplace-intake/sku-aliases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceKey: activePreviewSourceKey,
            normalizedSku,
            reason,
            isActive: true,
            ...matcherPayload,
          }),
        });
        const aliasData = await aliasRes.json();
        if (!aliasRes.ok) {
          throw new Error(aliasData.error || 'Gagal menyimpan SKU normalization inline.');
        }
      }

      const ruleRes = await fetch('/api/marketplace-intake/manual-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceKey: activePreviewSourceKey,
          mpSku: normalizedSku,
          mpProductName: line.mpProductName,
          mpVariation: line.mpVariation || null,
          targetEntityKey: candidate.entityKey,
          targetEntityLabel: candidate.entityLabel,
          targetCustomId: candidate.customId || normalizedSku,
          scalevBundleId: Number(candidate.scalevBundleId || 0),
          mappedStoreName: candidate.storeName || null,
          isActive: true,
        }),
      });
      const ruleData = await ruleRes.json();
      if (!ruleRes.ok) {
        throw new Error(ruleData.error || 'Gagal menyimpan rule entity/store inline.');
      }

      setManualSelection(order.externalOrderId, line.lineIndex, {
        ...candidate,
        customId: ruleData?.item?.targetCustomId || candidate.customId || normalizedSku,
        storeName: ruleData?.item?.mappedStoreName || candidate.storeName || null,
        classifierLabel: 'Inline fix tersimpan',
        source: 'manual',
      });

      updatePreviewLineLocally(order.externalOrderId, line.lineIndex, (currentLine) => ({
        ...currentLine,
        normalizedSku,
        skuNormalizationSource: shouldSaveAlias
          ? (
            matcherPayload.rawPlatformSkuId
              ? 'platform_sku_alias'
              : matcherPayload.rawSellerSku
                ? 'seller_sku_alias'
                : 'product_name_alias'
          )
          : (currentLine.skuNormalizationSource || 'manual_inline_fix'),
        skuNormalizationReason: reason,
      }));

      setInlineFixOpen((current) => ({
        ...current,
        [lineKey]: false,
      }));
      setMessage({
        type: 'success',
        scope: 'preview',
        text: `Perbaikan inline tersimpan untuk "${line.mpProductName}". SKU normalization dan atribusi entity/store sekarang tersimpan permanen.`,
      });
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal menyimpan perbaikan inline.');
    } finally {
      setSavingInlineFixKey('');
    }
  }

  async function handleResolveIssueCluster(cluster) {
    const clusterKey = cluster.key;
    const representativeLine = cluster.representativeLine;
    const issueFormKey = getLineKey(cluster.representativeOrder.externalOrderId, representativeLine.lineIndex);
    const candidate = getIssueSelectedCandidate(cluster);
    const form = inlineFixForms[issueFormKey] || {};
    const normalizedSku = cleanText(form.normalizedSku) || getDefaultInlineFixNormalizedSku(representativeLine, candidate);
    const reason = cleanText(form.reason) || getDefaultInlineFixReason(representativeLine);

    if (!candidate?.entityKey || !Number(candidate?.scalevBundleId || 0)) {
      setError('Pilih bundle/entity dulu untuk menyelesaikan isu ini.');
      return;
    }
    if (!candidate?.storeName) {
      setError('Pilih store atribusi dulu untuk menyelesaikan isu ini.');
      return;
    }
    if (cluster.issueKind === 'entity_missing' && !normalizedSku) {
      setError('Normalized SKU wajib diisi untuk isu yang belum punya matcher entity.');
      return;
    }
    if (!activePreviewSourceKey) {
      setError('Source preview belum terdeteksi. Upload ulang file ini.');
      return;
    }

    setSavingInlineFixKey(clusterKey);
    setError('');
    setWorkspaceError('');
    setMessage(null);

    try {
      const matcherPayload = getInlineFixMatcherPayload(representativeLine);
      const shouldSaveAlias = cluster.issueKind === 'entity_missing'
        && Boolean(
          matcherPayload.rawPlatformSkuId
          || matcherPayload.rawSellerSku
          || matcherPayload.rawProductName,
        );

      if (shouldSaveAlias) {
        const aliasRes = await fetch('/api/marketplace-intake/sku-aliases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceKey: activePreviewSourceKey,
            normalizedSku,
            reason,
            isActive: true,
            ...matcherPayload,
          }),
        });
        const aliasData = await aliasRes.json();
        if (!aliasRes.ok) {
          throw new Error(aliasData.error || 'Gagal menyimpan SKU normalization untuk isu ini.');
        }
      }

      const ruleRes = await fetch('/api/marketplace-intake/manual-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceKey: activePreviewSourceKey,
          mpSku: normalizedSku || representativeLine.normalizedSku || representativeLine.mpSku || null,
          mpProductName: representativeLine.mpProductName,
          mpVariation: representativeLine.mpVariation || null,
          targetEntityKey: candidate.entityKey,
          targetEntityLabel: candidate.entityLabel,
          targetCustomId: candidate.customId || normalizedSku || representativeLine.effectiveCustomId || null,
          scalevBundleId: Number(candidate.scalevBundleId || 0),
          mappedStoreName: candidate.storeName || null,
          isActive: true,
        }),
      });
      const ruleData = await ruleRes.json();
      if (!ruleRes.ok) {
        throw new Error(ruleData.error || 'Gagal menyimpan rule entity/store untuk isu ini.');
      }

      setManualSelections((current) => {
        const next = { ...current };
        for (const member of cluster.members) {
          next[getLineKey(member.orderId, member.line.lineIndex)] = {
            ...candidate,
            customId: ruleData?.item?.targetCustomId || candidate.customId || normalizedSku || null,
            storeName: ruleData?.item?.mappedStoreName || candidate.storeName || null,
            classifierLabel: 'Rule issue tersimpan',
            source: 'manual',
          };
        }
        return next;
      });

      setIssueSelections((current) => {
        const next = { ...current };
        delete next[clusterKey];
        return next;
      });
      setIssueSearchQueries((current) => {
        const next = { ...current };
        delete next[clusterKey];
        return next;
      });
      setIssueSearchResults((current) => {
        const next = { ...current };
        delete next[clusterKey];
        return next;
      });
      setInlineFixOpen((current) => {
        const next = { ...current };
        delete next[clusterKey];
        return next;
      });
      setInlineFixForms((current) => {
        const next = { ...current };
        delete next[issueFormKey];
        return next;
      });

      updatePreviewLineLocally(cluster.representativeOrder.externalOrderId, representativeLine.lineIndex, (line) => ({
        ...line,
        normalizedSku: normalizedSku || line.normalizedSku,
        skuNormalizationSource: shouldSaveAlias
          ? (
            matcherPayload.rawPlatformSkuId
              ? 'platform_sku_alias'
              : matcherPayload.rawSellerSku
                ? 'seller_sku_alias'
                : 'product_name_alias'
          )
          : (line.skuNormalizationSource || 'issue_resolver'),
        skuNormalizationReason: reason || line.skuNormalizationReason,
      }));

      setMessage({
        type: 'success',
        scope: 'preview',
        text: `Isu "${cluster.title}" tersimpan. ${fmtNumber(cluster.lineCount)} line di ${fmtNumber(cluster.orderCount)} order sekarang memakai rule yang sama.`,
      });
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal menyimpan penyelesaian isu.');
    } finally {
      setSavingInlineFixKey('');
    }
  }

  async function applyWorkspaceAction({ orderIds, warehouseStatus, shipmentDate, successText, refreshDate }) {
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
          sourceKey,
          warehouseStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memperbarui workspace warehouse.');
      }

      const nextWorkspaceDate = cleanText(refreshDate || shipmentDate || workspaceDate) || getCurrentDateValue();
      setWorkspaceDate(nextWorkspaceDate);
      await loadWorkspace(nextWorkspaceDate);
      setMessage({
        type: 'success',
        scope: 'workspace',
        text: successText || `${fmtNumber(data.updatedCount || orderIds.length)} order berhasil diperbarui.`,
      });
    } catch (err) {
      console.error(err);
      setWorkspaceError(err?.message || 'Gagal memperbarui workspace warehouse.');
    } finally {
      setWorkspaceActionLoading('');
    }
  }

  async function handlePushBatchToScalev(batchId, shipmentDate = workspaceDate) {
    const batchKey = String(batchId || '');
    if (!batchKey) return;
    const targetShipmentDate = cleanText(shipmentDate) || workspaceDate || getCurrentDateValue();
    setScalevSendingBatchKey(batchKey);
    setWorkspaceError('');
    setMessage(null);

    try {
      const res = await fetch('/api/marketplace-intake/scalev-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          shipmentDate: targetShipmentDate,
          statuses: ['scheduled'],
          createType: 'regular',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal mengirim batch ke Scalev.');
      }

      setWorkspaceDate(targetShipmentDate);
      await loadWorkspace(targetShipmentDate);
      setMessage({
        type: 'success',
        scope: 'batch',
        batchId,
        text: data.reconcile
          ? `Batch #${batchId} berhasil dikirim ke Scalev (${fmtNumber(data.rowCount || 0)} row, shipment ${fmtDateLabel(targetShipmentDate)}). Tarik ID: ${formatReconcileSuccessText(data.reconcile)}.`
          : data.reconcileError
            ? `Batch #${batchId} berhasil dikirim ke Scalev (${fmtNumber(data.rowCount || 0)} row, shipment ${fmtDateLabel(targetShipmentDate)}). Tarik ID belum beres: ${data.reconcileError}`
            : `Batch #${batchId} berhasil dikirim ke Scalev (${fmtNumber(data.rowCount || 0)} row, shipment ${fmtDateLabel(targetShipmentDate)}).`,
      });
    } catch (err) {
      console.error(err);
      setWorkspaceError(err?.message || 'Gagal mengirim batch ke Scalev.');
    } finally {
      setScalevSendingBatchKey('');
    }
  }

  async function handleReconcileBatchScalev(batchId) {
    const batchKey = String(batchId || '');
    if (!batchKey) return;
    setScalevReconcilingBatchKey(batchKey);
    setWorkspaceError('');
    setMessage(null);

    try {
      const res = await fetch('/api/marketplace-intake/scalev-reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal menarik Scalev ID untuk batch ini.');
      }

      await loadWorkspace(workspaceDate);
      setMessage({
        type: 'success',
        scope: 'batch',
        batchId,
        text: `Batch #${batchId} selesai tarik Scalev ID: ${formatReconcileSuccessText(data)}.`,
      });
    } catch (err) {
      console.error(err);
      setWorkspaceError(err?.message || 'Gagal menarik Scalev ID untuk batch ini.');
    } finally {
      setScalevReconcilingBatchKey('');
    }
  }

  async function handlePromoteBatchToApp(batchId, shipmentDate = workspaceDate) {
    const batchKey = String(batchId || '');
    if (!batchKey) return;
    const targetShipmentDate = cleanText(shipmentDate) || workspaceDate || getCurrentDateValue();
    setAppPromotingBatchKey(batchKey);
    setWorkspaceError('');
    setMessage(null);

    try {
      const res = await fetch('/api/marketplace-intake/promote-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          shipmentDate: targetShipmentDate,
          statuses: ['scheduled'],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memasukkan batch ke app.');
      }

      invalidateAll();
      setWorkspaceDate(targetShipmentDate);
      await loadWorkspace(targetShipmentDate);
      setMessage({
        type: 'success',
        scope: 'batch',
        batchId,
        text: `Batch #${batchId} masuk ke app (${fmtNumber(data.insertedCount || 0)} baru, ${fmtNumber(data.updatedCount || 0)} update, ${fmtNumber(data.updatedWebhookCount || 0)} bind webhook, ${fmtNumber(data.matchedTrackingCount || 0)} via tracking, ${fmtNumber(data.skippedCount || 0)} skip).`,
      });
    } catch (err) {
      console.error(err);
      setWorkspaceError(err?.message || 'Gagal memasukkan batch ke app.');
    } finally {
      setAppPromotingBatchKey('');
    }
  }

  async function handleRepairWorkspaceScalevSync() {
    const targetShipmentDate = workspaceDate || getCurrentDateValue();
    setWorkspaceScalevSyncRepairing(true);
    setWorkspaceError('');
    setMessage(null);

    try {
      const res = await fetch('/api/marketplace-intake/workspace-scalev-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipmentDate: targetShipmentDate,
          sourceKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memperbaiki gap Scalev vs app.');
      }

      setWorkspaceScalevSync(data.inspection || null);
      invalidateAll();
      await loadWorkspace(targetShipmentDate);
      setMessage({
        type: 'success',
        scope: 'workspace',
        text: data.batchErrors?.length
          ? `Perbaikan selesai sebagian. ${fmtNumber(data.repairedBatchCount || 0)} batch berhasil diproses, ${fmtNumber(data.batchErrors.length)} batch masih error.`
          : `Perbaikan selesai. ${fmtNumber(data.repairedBatchCount || 0)} batch diproses, ${fmtNumber(data.promoteInsertedCount || 0)} row baru seeded ke app, ${fmtNumber(data.reconcileUpdatedCount || 0)} identity Scalev diikat.`,
      });
    } catch (err) {
      console.error(err);
      setWorkspaceError(err?.message || 'Gagal memperbaiki gap Scalev vs app.');
    } finally {
      setWorkspaceScalevSyncRepairing(false);
    }
  }

  const stagedOrders = useMemo(() => workspace?.stagedOrders || [], [workspace?.stagedOrders]);
  const shipmentOrders = useMemo(() => workspace?.shipmentOrders || [], [workspace?.shipmentOrders]);
  const stagedBatches = useMemo(() => groupOrdersByBatch(stagedOrders), [stagedOrders]);
  const shipmentBatches = useMemo(() => groupOrdersByBatch(shipmentOrders), [shipmentOrders]);
  const allStagedOrderIds = useMemo(() => stagedOrders.map((order) => Number(order.id)).filter((id) => Number.isFinite(id) && id > 0), [stagedOrders]);
  const previewMessage = message?.scope === 'preview' ? message : null;
  const workspaceMessage = message?.scope === 'workspace' ? message : null;
  const globalMessage = !message?.scope || message.scope === 'upload' ? message : null;
  const workspaceScalevSyncMeta = useMemo(
    () => getWorkspaceScalevSyncMeta(workspaceScalevSync, workspaceScalevSyncLoading),
    [workspaceScalevSync, workspaceScalevSyncLoading],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={panelStyle}>
        <div style={{ marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Upload Marketplace</div>
            <div style={{ fontSize: 13, color: 'var(--dim)', maxWidth: 840, lineHeight: 1.6 }}>
              Upload satu atau banyak file marketplace sekaligus. App akan mendeteksi marketplace dan business yang tepat secara otomatis untuk setiap file. Setiap file tetap diperlakukan sebagai <strong>1 marketplace</strong>, <strong>1 business</strong>, dan <strong>1 batch</strong>.
            </div>
          </div>
        </div>

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

        {globalMessage ? (
          <div style={{ marginBottom: 12 }}>
            <FeedbackNotice message={globalMessage} />
          </div>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          multiple
          style={{ display: 'none' }}
          onChange={(event) => {
            const files = event.target.files;
            if (files?.length) handleUpload(files);
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
            const files = event.dataTransfer.files;
            if (files?.length) handleUpload(files);
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
              <div style={{ fontSize: 13, fontWeight: 700, color: '#ee4d2d' }}>Membaca file marketplace…</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              <div style={{ fontSize: 30 }}>📦</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Drag & drop file marketplace di sini</div>
              <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                Support `.xlsx`, `.xls`, atau `.csv` untuk Shopee, TikTok, Blibli, dan Lazada
              </div>
            </div>
          )}
        </div>

        <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>

        {livePreviewDrafts.length > 0 ? (
          <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Queue Preview Batch
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 10,
              }}
            >
              {livePreviewDrafts.map((draft) => {
                const isActive = draft.key === activePreviewKey;
                const draftSummary = draft.preview?.summary || {};
                return (
                  <div
                    key={draft.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => switchToDraft(draft.key)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        switchToDraft(draft.key);
                      }
                    }}
                    style={{
                      textAlign: 'left',
                      padding: 12,
                      borderRadius: 12,
                      border: isActive ? '1px solid rgba(34,197,94,0.4)' : '1px solid var(--border)',
                      background: isActive ? 'rgba(34,197,94,0.08)' : 'var(--bg)',
                      color: 'var(--text)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 4 }}>
                          {draft.preview?.source?.sourceLabel || 'Marketplace'}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.45, wordBreak: 'break-word' }}>
                          {draft.preview?.filename || 'Tanpa nama file'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                        {isActive ? (
                          <div
                            style={{
                              padding: '4px 8px',
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 700,
                              background: 'rgba(34,197,94,0.12)',
                              color: '#86efac',
                            }}
                          >
                            Aktif
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            dismissDraft(draft.key);
                          }}
                          style={{
                            border: '1px solid var(--border)',
                            background: 'transparent',
                            color: 'var(--dim)',
                            borderRadius: 8,
                            padding: '4px 8px',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          Tutup
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: 12, color: 'var(--dim)' }}>
                      <span>Order {fmtNumber(draftSummary.totalOrders || 0)}</span>
                      <span>Ready {fmtNumber(draftSummary.readyOrders || 0)}</span>
                      <span>Review {fmtNumber(draftSummary.needsReviewOrders || 0)}</span>
                    </div>
                  </div>
                );
              })}
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
                <div style={{ fontSize: 16, fontWeight: 800 }}>{activeSource?.previewLabel || 'Preview Mapping Marketplace'}</div>
                <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
                  File: <strong>{preview.filename}</strong> • tanggal order file <strong>{preview.sourceOrderDate || '-'}</strong> • {fmtNumber(preview.rowCount)} row sumber • source <strong>{previewSourceLabel}</strong> • exact bundle match + local store guess
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari issue, matcher, bundle, store, atau order…"
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
              </div>
            </div>

            {previewMessage ? (
              <div style={{ marginBottom: 12 }}>
                <FeedbackNotice message={previewMessage} />
              </div>
            ) : null}

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

            <div style={{ display: 'grid', gap: 12 }}>
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
                    gridTemplateColumns: 'minmax(280px, 1.3fr) minmax(220px, 1fr) minmax(220px, 1fr) 120px 110px',
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
                  <div>Issue</div>
                  <div>Matcher Intake</div>
                  <div>Penyelesaian</div>
                  <div>Dampak</div>
                  <div>Aksi</div>
                </div>

                {visibleIssueClusters.map((cluster) => {
                  const candidate = getIssueSelectedCandidate(cluster);
                  const candidateOptions = getIssueCandidateOptions(cluster);
                  const issueFormKey = getLineKey(cluster.representativeOrder.externalOrderId, cluster.representativeLine.lineIndex);
                  const issueForm = inlineFixForms[issueFormKey] || {};
                  const normalizedSku = issueForm.normalizedSku || getDefaultInlineFixNormalizedSku(cluster.representativeLine, candidate);
                  const reason = issueForm.reason || getDefaultInlineFixReason(cluster.representativeLine);
                  const productMeta = Array.isArray(cluster.productNames) && cluster.productNames.length > 0
                    ? { text: formatIssueDetailValues(cluster.productNames), tone: 'ok' }
                    : { text: 'Kosong, butuh dibaca dari file marketplace', tone: 'problem' };
                  const sellerSkuMeta = describeIssueField(cluster, 'sellerSku');
                  const mpSkuMeta = describeIssueField(cluster, 'mpSku');
                  const platformSkuIdMeta = describeIssueField(cluster, 'platformSkuId');
                  const variationMeta = describeIssueField(cluster, 'variation');
                  const entityMeta = describeIssueField(cluster, 'entity');
                  const storeMeta = describeIssueField(cluster, 'store');
                  const storeOptions = candidate?.storeCandidates?.length
                    ? candidate.storeCandidates
                    : candidate?.storeName
                      ? [candidate.storeName, ...activeAllowedStores.filter((storeName) => storeName !== candidate.storeName)]
                      : activeAllowedStores;
                  const canSaveIssue = Boolean(
                    candidate?.entityKey
                    && Number(candidate?.scalevBundleId || 0) > 0
                    && candidate?.storeName
                    && (cluster.issueKind !== 'entity_missing' || cleanText(normalizedSku))
                  );

                  return (
                    <div
                      key={cluster.key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(280px, 1.3fr) minmax(220px, 1fr) minmax(220px, 1fr) 120px 110px',
                        gap: 0,
                        padding: '14px 12px',
                        borderBottom: '1px solid var(--border)',
                        alignItems: 'start',
                      }}
                    >
                      <div style={{ display: 'grid', gap: 8, paddingRight: 12 }}>
                        <div
                          style={{
                            display: 'grid',
                            gap: 6,
                            padding: 10,
                            borderRadius: 10,
                            border: '1px solid var(--border)',
                            background: 'rgba(148,163,184,0.06)',
                          }}
                        >
                          <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                            <strong style={{ color: 'var(--text-secondary)' }}>Produk MP:</strong>{' '}
                            <span style={{ color: getIssueFieldToneColor(productMeta.tone) }}>{productMeta.text}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                            <strong style={{ color: 'var(--text-secondary)' }}>Seller SKU:</strong>{' '}
                            <span style={{ color: getIssueFieldToneColor(sellerSkuMeta.tone) }}>{sellerSkuMeta.text}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                            <strong style={{ color: 'var(--text-secondary)' }}>SKU MP:</strong>{' '}
                            <span style={{ color: getIssueFieldToneColor(mpSkuMeta.tone) }}>{mpSkuMeta.text}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                            <strong style={{ color: 'var(--text-secondary)' }}>Platform SKU ID:</strong>{' '}
                            <span style={{ color: getIssueFieldToneColor(platformSkuIdMeta.tone) }}>{platformSkuIdMeta.text}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                            <strong style={{ color: 'var(--text-secondary)' }}>Variation:</strong>{' '}
                            <span style={{ color: getIssueFieldToneColor(variationMeta.tone) }}>{variationMeta.text}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                            <strong style={{ color: 'var(--text-secondary)' }}>Bundle saat ini:</strong>{' '}
                            <span style={{ color: getIssueFieldToneColor(entityMeta.tone) }}>{entityMeta.text}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                            <strong style={{ color: 'var(--text-secondary)' }}>Store atribusi saat ini:</strong>{' '}
                            <span style={{ color: getIssueFieldToneColor(storeMeta.tone) }}>{storeMeta.text}</span>
                          </div>
                        </div>
                        <details style={{ marginTop: 4 }}>
                          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#93c5fd' }}>
                            Lihat order yang terdampak ({fmtNumber(cluster.orderCount)} order)
                          </summary>
                          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
                            {cluster.members.slice(0, 8).map((member) => member.orderId).join(', ')}
                            {cluster.members.length > 8 ? `, +${fmtNumber(cluster.members.length - 8)} lainnya` : ''}
                          </div>
                        </details>
                      </div>

                      <div style={{ display: 'grid', gap: 8, paddingRight: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{getInlineFixMatcherSummary(cluster.representativeLine)}</div>
                        {cluster.issueKind === 'entity_missing' ? (
                          <>
                            <input
                              value={normalizedSku}
                              onChange={(event) => setInlineFixField(cluster.representativeOrder.externalOrderId, cluster.representativeLine.lineIndex, 'normalizedSku', event.target.value)}
                              placeholder="Normalized SKU"
                              style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: 8,
                                border: '1px solid var(--border)',
                                background: 'var(--card)',
                                color: 'var(--text)',
                                fontSize: 12,
                                outline: 'none',
                              }}
                            />
                            <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
                              Catatan otomatis: {reason}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
                            Bundle sudah ketemu. Yang perlu Anda tentukan tinggal store attribusinya.
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'grid', gap: 8, paddingRight: 12 }}>
                        <select
                          value={candidate?.entityKey || ''}
                          onChange={(event) => {
                            const nextCandidate = candidateOptions.find((item) => item.entityKey === event.target.value);
                            if (!nextCandidate) return;
                            setIssueSelection(cluster.key, nextCandidate);
                          }}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                            background: 'var(--card)',
                            color: 'var(--text)',
                            fontSize: 12,
                            outline: 'none',
                          }}
                        >
                          <option value="">Pilih bundle/entity…</option>
                          {candidateOptions.map((item) => (
                            <option key={`${cluster.key}-${item.entityKey}`} value={item.entityKey}>
                              {item.customId || item.entityLabel}
                            </option>
                          ))}
                        </select>

                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            value={issueSearchQueries[cluster.key] || ''}
                            onChange={(event) => setIssueSearchQueries((current) => ({
                              ...current,
                              [cluster.key]: event.target.value,
                            }))}
                            placeholder={previewSearchPlaceholder}
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--border)',
                              background: 'var(--card)',
                              color: 'var(--text)',
                              fontSize: 12,
                              outline: 'none',
                            }}
                          />
                          <ActionButton onClick={() => handleSearchIssueBundles(cluster)}>
                            {searchingIssueKey === cluster.key ? '...' : 'Cari'}
                          </ActionButton>
                        </div>

                        <select
                          value={candidate?.storeName || ''}
                          onChange={(event) => {
                            const nextStoreName = String(event.target.value || '');
                            if (!candidate || !nextStoreName) return;
                            setIssueSelection(cluster.key, {
                              ...candidate,
                              storeName: nextStoreName,
                              classifierLabel: 'Manual store attribution',
                            });
                          }}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                            background: 'var(--card)',
                            color: 'var(--text)',
                            fontSize: 12,
                            outline: 'none',
                          }}
                        >
                          <option value="">Pilih store atribusi…</option>
                          {storeOptions.map((storeName) => (
                            <option key={`${cluster.key}-store-${storeName}`} value={storeName}>
                              {storeName}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={{ display: 'grid', gap: 4 }}>
                        <div style={{ fontWeight: 800 }}>{fmtNumber(cluster.lineCount)} line</div>
                        <div style={{ fontSize: 12, color: 'var(--dim)' }}>{fmtNumber(cluster.orderCount)} order</div>
                        <div style={{ fontSize: 12, color: 'var(--dim)' }}>{fmtCurrency(cluster.amount)}</div>
                      </div>

                      <div style={{ display: 'grid', gap: 8 }}>
                        <ActionButton
                          onClick={() => handleResolveIssueCluster(cluster)}
                          tone="primary"
                          disabled={!canSaveIssue || savingInlineFixKey === cluster.key}
                        >
                          {savingInlineFixKey === cluster.key ? 'Menyimpan…' : 'Simpan'}
                        </ActionButton>
                      </div>
                    </div>
                  );
                })}

                {visibleIssueClusters.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
                    Tidak ada issue yang cocok dengan filter saat ini.
                  </div>
                ) : null}
              </div>

              <details
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  overflow: 'hidden',
                  background: 'var(--bg)',
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer',
                    padding: '12px 14px',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    background: 'rgba(148,163,184,0.06)',
                  }}
                >
                  Lihat detail per order
                </summary>
                <div style={{ overflowX: 'auto', borderTop: '1px solid var(--border)' }}>
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
                              <div>SKU MP</div>
                              <div>Produk MP</div>
                              <div>Entity Scalev</div>
                              <div>Store Mapping</div>
                              <div>Qty / Amount</div>
                              <div>Status</div>
                            </div>

                              {(order.lines || []).map((line) => {
                              const lineKey = getLineKey(order.externalOrderId, line.lineIndex);
                              const selectedCandidate = line.selectedCandidate || null;
                              const manualSelectedCandidate = manualSelections[lineKey] || null;
                              const persistCandidate = manualSelectedCandidate || (line.lineStatus !== 'identified' ? selectedCandidate : null);
                              const inlineFixCandidate = manualSelectedCandidate || selectedCandidate || line.selectedSuggestion || null;
                              const inlineFixState = inlineFixForms[lineKey] || {};
                              const inlineFixNormalizedSku = inlineFixState.normalizedSku || getDefaultInlineFixNormalizedSku(line, inlineFixCandidate);
                              const inlineFixReason = inlineFixState.reason || getDefaultInlineFixReason(line);
                              const inlineFixEnabled = Boolean(
                                cleanText(inlineFixNormalizedSku)
                                && inlineFixCandidate?.entityKey
                                && Number(inlineFixCandidate?.scalevBundleId || 0) > 0
                                && inlineFixCandidate?.storeName,
                              );
                              const actionableIssueCodes = (line.effectiveIssueCodes || []).filter((code) => isActionablePreviewIssueCode(code));
                              const shouldShowInlineFix = line.effectiveStatus !== 'identified'
                                || actionableIssueCodes.length > 0;
                              const canPersistResolverRule = Boolean(
                                persistCandidate?.entityKey
                                && Number(persistCandidate?.scalevBundleId || 0) > 0,
                              );
                              const searchResults = lineSearchResults[lineKey] || [];
                              const entityOptions = Array.from(
                                new Map(
                                  [...(line.suggestionCandidates || []), ...searchResults].map((candidate) => [candidate.entityKey, candidate]),
                                ).values(),
                              );

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
                                    <div style={{ fontWeight: 700 }}>
                                      {line.rawSellerSku || line.mpSku || line.rawPlatformSkuId || 'Kosong'}
                                    </div>
                                    {line.normalizedSku && line.normalizedSku !== (line.rawSellerSku || line.mpSku || '') ? (
                                      <div style={{ marginTop: 4, fontSize: 12, color: '#93c5fd' }}>
                                        Normalized → {line.normalizedSku}
                                      </div>
                                    ) : null}
                                    {line.skuNormalizationReason ? (
                                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dim)' }}>
                                        {line.skuNormalizationReason}
                                      </div>
                                    ) : null}
                                    {!line.rawSellerSku && line.rawPlatformSkuId ? (
                                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dim)' }}>
                                        SKU ID: {line.rawPlatformSkuId}
                                      </div>
                                    ) : null}
                                    {line.mpVariation ? (
                                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dim)' }}>{line.mpVariation}</div>
                                    ) : null}
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: 700 }}>{line.mpProductName}</div>
                                    {(line.effectiveIssueCodes || []).length ? (
                                      <div style={{ marginTop: 6, fontSize: 12, color: actionableIssueCodes.length ? '#fca5a5' : '#93c5fd' }}>
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
                                        {entityOptions.length ? (
                                          <select
                                            value={selectedCandidate?.entityKey || ''}
                                            onChange={(event) => {
                                              const nextCandidate = entityOptions.find((candidate) => candidate.entityKey === event.target.value);
                                              if (nextCandidate) {
                                                setManualSelection(order.externalOrderId, line.lineIndex, nextCandidate);
                                              }
                                            }}
                                            style={{
                                              width: '100%',
                                              padding: '8px 10px',
                                              borderRadius: 8,
                                              border: '1px solid var(--border)',
                                              background: 'var(--card)',
                                              color: 'var(--text)',
                                              fontSize: 12,
                                              outline: 'none',
                                            }}
                                          >
                                            <option value="">Pilih entity Scalev…</option>
                                            {entityOptions.map((candidate) => (
                                              <option key={`${lineKey}-${candidate.entityKey}`} value={candidate.entityKey}>
                                                {candidate.customId || candidate.entityLabel}
                                              </option>
                                            ))}
                                          </select>
                                        ) : null}

                                        <div style={{ display: 'flex', gap: 6 }}>
                                          <input
                                            value={lineSearchQueries[lineKey] || ''}
                                            onChange={(event) => setLineSearchQueries((current) => ({
                                              ...current,
                                              [lineKey]: event.target.value,
                                            }))}
                                            placeholder={previewSearchPlaceholder}
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
                                          <div style={{ fontSize: 11, color: 'var(--dim)' }}>
                                            {searchResults.length} hasil search ditambahkan ke dropdown entity.
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
                                    {line.effectiveStatus !== 'identified' && selectedCandidate?.storeCandidates?.length ? (
                                      <div style={{ marginTop: 10 }}>
                                        <select
                                          value={selectedCandidate?.storeName || ''}
                                          onChange={(event) => {
                                            const nextStoreName = String(event.target.value || '');
                                            if (!selectedCandidate || !nextStoreName) return;
                                            setManualSelection(order.externalOrderId, line.lineIndex, {
                                              ...selectedCandidate,
                                              storeName: nextStoreName,
                                              classifierLabel: 'Manual store selection',
                                            });
                                          }}
                                          style={{
                                            width: '100%',
                                            padding: '8px 10px',
                                            borderRadius: 8,
                                            border: '1px solid var(--border)',
                                            background: 'var(--card)',
                                            color: 'var(--text)',
                                            fontSize: 12,
                                            outline: 'none',
                                          }}
                                        >
                                          <option value="">Pilih store…</option>
                                          {selectedCandidate.storeCandidates.map((storeName) => (
                                            <option key={`${lineKey}-store-${storeName}`} value={storeName}>
                                              {storeName}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    ) : null}
                                    {shouldShowInlineFix ? (
                                      <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                                        <ActionButton
                                          onClick={() => {
                                            if (inlineFixOpen[lineKey]) {
                                              closeInlineFixForLine(order.externalOrderId, line.lineIndex);
                                              return;
                                            }
                                            openInlineFixForLine(order.externalOrderId, line.lineIndex, line, inlineFixCandidate);
                                          }}
                                          tone="warn"
                                        >
                                          {inlineFixOpen[lineKey] ? 'Tutup Perbaikan' : 'Perbaiki di tempat'}
                                        </ActionButton>
                                        <div style={{ fontSize: 11, color: 'var(--dim)', lineHeight: 1.5 }}>
                                          Selesaikan normalisasi SKU dan atribusi entity/store langsung dari line ini, tanpa pindah ke tab rule.
                                        </div>
                                        {inlineFixOpen[lineKey] ? (
                                          <div
                                            style={{
                                              display: 'grid',
                                              gap: 8,
                                              padding: 10,
                                              borderRadius: 10,
                                              border: '1px solid var(--border)',
                                              background: 'rgba(148,163,184,0.06)',
                                            }}
                                          >
                                            <div style={{ fontSize: 11, color: 'var(--dim)', lineHeight: 1.5 }}>
                                              {getInlineFixMatcherSummary(line)}
                                            </div>
                                            <div style={{ display: 'grid', gap: 4 }}>
                                              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                                Normalized SKU
                                              </div>
                                              <input
                                                value={inlineFixNormalizedSku}
                                                onChange={(event) => setInlineFixField(order.externalOrderId, line.lineIndex, 'normalizedSku', event.target.value)}
                                                placeholder="Contoh: PLV20-245"
                                                style={{
                                                  width: '100%',
                                                  padding: '8px 10px',
                                                  borderRadius: 8,
                                                  border: '1px solid var(--border)',
                                                  background: 'var(--card)',
                                                  color: 'var(--text)',
                                                  fontSize: 12,
                                                  outline: 'none',
                                                }}
                                              />
                                            </div>
                                            <div style={{ display: 'grid', gap: 4 }}>
                                              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                                Reason
                                              </div>
                                              <textarea
                                                value={inlineFixReason}
                                                onChange={(event) => setInlineFixField(order.externalOrderId, line.lineIndex, 'reason', event.target.value)}
                                                rows={3}
                                                placeholder="Kenapa matcher ini perlu dinormalisasi atau diatribusi manual?"
                                                style={{
                                                  width: '100%',
                                                  padding: '8px 10px',
                                                  borderRadius: 8,
                                                  border: '1px solid var(--border)',
                                                  background: 'var(--card)',
                                                  color: 'var(--text)',
                                                  fontSize: 12,
                                                  outline: 'none',
                                                  resize: 'vertical',
                                                }}
                                              />
                                            </div>
                                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                              <ActionButton
                                                onClick={() => handleApplyInlineFix(order, line)}
                                                tone="primary"
                                                disabled={!inlineFixEnabled || savingInlineFixKey === lineKey}
                                              >
                                                {savingInlineFixKey === lineKey ? 'Menyimpan…' : 'Simpan Perbaikan'}
                                              </ActionButton>
                                              {canPersistResolverRule ? (
                                                <ActionButton
                                                  onClick={() => handleSaveResolverRule(order, line)}
                                                  disabled={savingResolverRuleKey === lineKey}
                                                >
                                                  {savingResolverRuleKey === lineKey ? 'Menyimpan…' : 'Hanya Simpan Rule'}
                                                </ActionButton>
                                              ) : null}
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--dim)', lineHeight: 1.5 }}>
                                              Tombol ini menyimpan `SKU normalization` bila dibutuhkan, lalu menyimpan `Entity & Store Attribution` untuk matcher yang sama.
                                            </div>
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : null}
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
              </details>
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
              Batch <strong>{workspaceScopeLabel}</strong> yang sudah <strong>Confirm & Save</strong> akan masuk ke workspace ini sebagai data <strong>staging</strong>. Data baru dianggap valid downstream setelah warehouse memberi <strong>shipment date</strong>. Tanggal shipped utama sekarang dipilih langsung di tiap batch staged, sedangkan selector di kanan dipakai untuk <strong>melihat shipment date tertentu</strong>.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Filter Source
              </div>
              <select
                value={sourceKey}
                onChange={(event) => setSourceKey(event.target.value)}
                style={{
                  minWidth: 200,
                  padding: '9px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: 13,
                  outline: 'none',
                }}
              >
                {WORKSPACE_SOURCE_OPTIONS.map((source) => (
                  <option key={source.sourceKey} value={source.sourceKey}>
                    {source.sourceLabel} • {source.businessCode}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Lihat Shipment
            </div>
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
            <ActionButton
              onClick={() => setWorkspaceScalevSyncModalOpen(true)}
              tone={workspaceScalevSyncMeta.tone}
              disabled={workspaceLoading}
            >
              {workspaceScalevSyncMeta.label}
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

        {workspaceMessage ? (
          <div style={{ marginBottom: 12 }}>
            <FeedbackNotice message={workspaceMessage} />
          </div>
        ) : null}

        {workspaceScalevSyncError ? (
          <div style={{ marginBottom: 12 }}>
            <FeedbackNotice message={{ type: 'error', text: workspaceScalevSyncError }} compact />
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
                  Batch <strong>{workspaceScopeLabel}</strong> di bawah ini masih pre-valid. Warehouse bisa memilih <strong>tanggal shipped</strong> langsung di row batch, lalu menandai batch atau order tertentu sebagai shipped.
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
                    <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Tgl Shipped</th>
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
                    const batchShipmentDate = getBatchShipmentDate(batch.batchId);
                    const appButtonMeta = getAppButtonMeta(batch.appLastPromoteStatus);
                    const scalevButtonMeta = getScalevButtonMeta(batch.scalevLastSendStatus);
                    const reconcileButtonMeta = getScalevReconcileButtonMeta(batch.scalevLastReconcileStatus);
                    const batchMessage = message?.scope === 'batch' && String(message.batchId) === String(batch.batchId)
                      ? message
                      : null;
                    return (
                      <Fragment key={batchKey}>
                        <tr>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700 }}>
                            #{batch.batchId} • {batch.batchFilename}
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>{fmtDateTime(batch.uploadedAt)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                            <div style={{ display: 'grid', gap: 6 }}>
                              <input
                                type="date"
                                value={batchShipmentDate}
                                onChange={(event) => updateBatchShipmentDate(batch.batchId, event.target.value)}
                                style={{
                                  width: 170,
                                  padding: '8px 10px',
                                  borderRadius: 10,
                                  border: '1px solid var(--border)',
                                  background: 'var(--bg)',
                                  color: 'var(--text)',
                                  fontSize: 12,
                                  outline: 'none',
                                  colorScheme: 'dark',
                                }}
                              />
                              <div style={{ fontSize: 11, color: 'var(--dim)' }}>
                                Tanggal saat ini: <strong style={{ color: 'var(--text-secondary)' }}>{fmtCompactDate(batchShipmentDate)}</strong>. Ubah di sini sebelum klik <strong>Shipped Semua</strong>.
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtNumber(batch.totalOrders)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtNumber(batch.totalLines)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }}>{fmtCurrency(batch.totalAmount)}</td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--dim)' }}>
                            <div>{fmtNumber(batch.totalOrders)} order belum dikirim</div>
                            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <SyncStatusPill
                                  status={batch.appLastPromoteStatus}
                                  successLabel="Sudah Masuk App"
                                  failedLabel="Gagal Masuk App"
                                  idleLabel="Belum Masuk App"
                                />
                                <div style={{ fontSize: 11 }}>
                                  {formatAppPromoteStatusText(batch)}
                                </div>
                              </div>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <SyncStatusPill
                                  status={batch.scalevLastSendStatus}
                                  successLabel="Sudah Pernah Push"
                                  failedLabel="Push Scalev Gagal"
                                  idleLabel="Belum Pernah Push"
                                />
                                <div style={{ fontSize: 11 }}>
                                  {batch.scalevLastSendStatus === 'success'
                                    ? `${fmtShortDateTime(batch.scalevLastSendAt)}`
                                    : batch.scalevLastSendStatus === 'failed'
                                      ? (batch.scalevLastSendError || 'Push ke Scalev gagal.')
                                      : 'Belum ada percobaan push ke Scalev.'}
                                </div>
                              </div>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <SyncStatusPill
                                  status={batch.scalevLastReconcileStatus}
                                  successLabel="ID Scalev Terkunci"
                                  failedLabel="Tarik ID Gagal"
                                  idleLabel="Belum Tarik ID"
                                  partialLabel="ID Sebagian"
                                />
                                <div style={{ fontSize: 11 }}>
                                  {formatReconcileStatusText(batch)}
                                </div>
                              </div>
                              {batchMessage ? (
                                <FeedbackNotice message={batchMessage} compact />
                              ) : null}
                            </div>
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              <ActionButton tone={scalevButtonMeta.tone} disabled>
                                {scalevButtonMeta.label}
                              </ActionButton>
                              <ActionButton tone={reconcileButtonMeta.tone} disabled>
                                {reconcileButtonMeta.label}
                              </ActionButton>
                              <ActionButton
                                onClick={() => applyWorkspaceAction({
                                  orderIds: batch.orderIds,
                                  warehouseStatus: 'scheduled',
                                  shipmentDate: batchShipmentDate,
                                  refreshDate: batchShipmentDate,
                                  successText: `Batch #${batch.batchId} ditandai shipped ${fmtDateLabel(batchShipmentDate)}.`,
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
                            <td colSpan={8} style={{ padding: 12, borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
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
                                                    shipmentDate: batchShipmentDate,
                                                    refreshDate: batchShipmentDate,
                                                    successText: `Order ${order.externalOrderId} ditandai shipped ${fmtDateLabel(batchShipmentDate)}.`,
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
                                                    shipmentDate: batchShipmentDate,
                                                    refreshDate: batchShipmentDate,
                                                    successText: `Order ${order.externalOrderId} ditandai hold untuk shipment ${fmtDateLabel(batchShipmentDate)}.`,
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
                                                    shipmentDate: batchShipmentDate,
                                                    refreshDate: batchShipmentDate,
                                                    successText: `Order ${order.externalOrderId} ditandai canceled pada shipment ${fmtDateLabel(batchShipmentDate)}.`,
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
                      <td colSpan={8} style={{ padding: 18, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
                        Tidak ada batch yang belum dikirim. Semua upload yang sudah disimpan dan belum punya shipment date akan muncul di sini.
                      </td>
                    </tr>
                  ) : null}

                  {workspaceLoading ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 18, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
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
                Batch <strong>{workspaceScopeLabel}</strong> yang sudah ditandai shipped untuk tanggal <strong>{fmtDateLabel(workspaceDate)}</strong> akan muncul di bawah ini. Buka batch untuk melihat order-order di dalamnya, lalu buka order jika perlu melihat line item.
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
                    const appButtonMeta = getAppButtonMeta(batch.appLastPromoteStatus);
                    const scalevButtonMeta = getScalevButtonMeta(batch.scalevLastSendStatus);
                    const reconcileButtonMeta = getScalevReconcileButtonMeta(batch.scalevLastReconcileStatus);
                    const batchMessage = message?.scope === 'batch' && String(message.batchId) === String(batch.batchId)
                      ? message
                      : null;
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
                            <div>{fmtNumber(batch.statusCounts.scheduled || 0)} shipped • {fmtNumber(batch.statusCounts.hold || 0)} hold • {fmtNumber(batch.statusCounts.canceled || 0)} canceled</div>
                            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <SyncStatusPill
                                  status={batch.appLastPromoteStatus}
                                  successLabel="Sudah Masuk App"
                                  failedLabel="Gagal Masuk App"
                                  idleLabel="Belum Masuk App"
                                />
                                <div style={{ fontSize: 11 }}>
                                  {batch.appLastPromoteStatus === 'success'
                                    ? formatAppPromoteStatusText(batch)
                                    : batch.appLastPromoteStatus === 'failed'
                                      ? (batch.appLastPromoteError || 'Promosi ke app gagal.')
                                      : 'Batch shipped ini belum pernah dipromosikan ke app.'}
                                </div>
                              </div>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <SyncStatusPill
                                  status={batch.scalevLastSendStatus}
                                  successLabel="Sudah Pernah Push"
                                  failedLabel="Push Scalev Gagal"
                                  idleLabel="Belum Pernah Push"
                                />
                                <div style={{ fontSize: 11 }}>
                                  {batch.scalevLastSendStatus === 'success'
                                    ? `${fmtShortDateTime(batch.scalevLastSendAt)} • ${fmtNumber(batch.scalevLastSendRowCount || 0)} row`
                                    : batch.scalevLastSendStatus === 'failed'
                                      ? (batch.scalevLastSendError || 'Push ke Scalev gagal.')
                                      : 'Belum ada percobaan push ke Scalev.'}
                                </div>
                              </div>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <SyncStatusPill
                                  status={batch.scalevLastReconcileStatus}
                                  successLabel="ID Scalev Terkunci"
                                  failedLabel="Tarik ID Gagal"
                                  idleLabel="Belum Tarik ID"
                                  partialLabel="ID Sebagian"
                                />
                                <div style={{ fontSize: 11 }}>
                                  {formatReconcileStatusText(batch)}
                                </div>
                              </div>
                              {batchMessage ? (
                                <FeedbackNotice message={batchMessage} compact />
                              ) : null}
                            </div>
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              <ActionButton
                                onClick={() => handlePromoteBatchToApp(batch.batchId)}
                                tone={appButtonMeta.tone}
                                disabled={Boolean(appPromotingBatchKey) || Boolean(scalevSendingBatchKey) || Boolean(scalevReconcilingBatchKey) || Number(batch.statusCounts.scheduled || 0) === 0}
                              >
                                {appPromotingBatchKey === String(batch.batchId) ? 'Memasukkan…' : appButtonMeta.label}
                              </ActionButton>
                              <ActionButton
                                onClick={() => handlePushBatchToScalev(batch.batchId)}
                                tone={scalevButtonMeta.tone}
                                disabled={Boolean(scalevSendingBatchKey) || Boolean(appPromotingBatchKey) || Boolean(scalevReconcilingBatchKey) || Number(batch.statusCounts.scheduled || 0) === 0}
                              >
                                {scalevSendingBatchKey === String(batch.batchId) ? 'Mengirim…' : scalevButtonMeta.label}
                              </ActionButton>
                              <ActionButton
                                onClick={() => handleReconcileBatchScalev(batch.batchId)}
                                tone={reconcileButtonMeta.tone}
                                disabled={
                                  Boolean(scalevReconcilingBatchKey)
                                  || Boolean(scalevSendingBatchKey)
                                  || Boolean(appPromotingBatchKey)
                                  || batch.scalevLastSendStatus !== 'success'
                                  || batch.appLastPromoteStatus !== 'success'
                                }
                              >
                                {scalevReconcilingBatchKey === String(batch.batchId) ? 'Menarik…' : reconcileButtonMeta.label}
                              </ActionButton>
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

      {workspaceScalevSyncModalOpen ? (
        <div
          onClick={() => {
            if (!workspaceScalevSyncRepairing) setWorkspaceScalevSyncModalOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 60,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(760px, 100%)',
              maxHeight: '85vh',
              overflow: 'auto',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              boxShadow: 'var(--shadow)',
              padding: 18,
              display: 'grid',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Akurasi App ↔ Scalev</div>
                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
                  Scope saat ini: <strong>{workspaceScopeLabel}</strong> • shipment <strong>{fmtDateLabel(workspaceDate)}</strong>.
                </div>
              </div>
              <ActionButton
                onClick={() => setWorkspaceScalevSyncModalOpen(false)}
                disabled={workspaceScalevSyncRepairing}
              >
                Tutup
              </ActionButton>
            </div>

            <FeedbackNotice
              message={{
                type: workspaceScalevSync?.status === 'drift' ? 'error' : 'success',
                text: workspaceScalevSyncMeta.helper,
              }}
              compact
            />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 12,
              }}
            >
              <SummaryCard label="Order Scalev Scope" value={workspaceScalevSync?.eligibleOrderCount || 0} />
              <SummaryCard label="Sudah Akur di App" value={workspaceScalevSync?.matchedOrderCount || 0} tone="success" />
              <SummaryCard label="Belum Ada di App" value={workspaceScalevSync?.missingOrderCount || 0} tone={(workspaceScalevSync?.missingOrderCount || 0) > 0 ? 'danger' : 'default'} />
              <SummaryCard label="Salah Tanggal" value={workspaceScalevSync?.wrongDateCount || 0} tone={(workspaceScalevSync?.wrongDateCount || 0) > 0 ? 'warn' : 'default'} />
            </div>

            {workspaceScalevSync?.affectedBatches?.length ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>Batch yang Perlu Ditarik Ulang</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {workspaceScalevSync.affectedBatches.map((batch) => (
                    <div
                      key={`gap-batch:${batch.batchId}`}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        padding: 12,
                        background: 'var(--bg)',
                        display: 'grid',
                        gap: 4,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        #{batch.batchId} • {batch.batchFilename}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                        {batch.businessCode} • {fmtNumber(batch.orderCount || 0)} order • {fmtNumber(batch.missingCount || 0)} belum ada di app • {fmtNumber(batch.wrongDateCount || 0)} salah tanggal
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {workspaceScalevSync?.samples?.length ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>Contoh Gap</div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg)' }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Order</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Batch</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Masalah</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>Posisi App</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workspaceScalevSync.samples.map((sample) => (
                        <tr key={`gap-sample:${sample.batchId}:${sample.externalOrderId}`}>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                            <div style={{ fontWeight: 700 }}>{sample.externalOrderId}</div>
                            <div style={{ color: 'var(--dim)', marginTop: 3 }}>{sample.trackingNumber || '-'}</div>
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                            <div>#{sample.batchId}</div>
                            <div style={{ color: 'var(--dim)', marginTop: 3 }}>{sample.businessCode}</div>
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                            {sample.reason === 'missing_in_app' ? 'Belum ada row di app' : `Masih jatuh di ${sample.appShipmentDate || '-'}`}
                          </td>
                          <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                            <div>{sample.appOrderId || '-'}</div>
                            <div style={{ color: 'var(--dim)', marginTop: 3 }}>{sample.appSource || '-'}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
                Tombol perbaikan akan menjalankan <strong>Masuk ke App</strong> ulang untuk batch yang tidak akur, lalu langsung <strong>Tarik ID Scalev</strong> agar row authoritative di app cepat menempel ke identity Scalev.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <ActionButton
                  onClick={() => loadWorkspaceScalevSync(workspaceDate)}
                  disabled={workspaceScalevSyncRepairing}
                >
                  {workspaceScalevSyncLoading ? 'Mengecek…' : 'Cek Ulang'}
                </ActionButton>
                <ActionButton
                  onClick={handleRepairWorkspaceScalevSync}
                  tone="primary"
                  disabled={
                    workspaceScalevSyncRepairing
                    || workspaceScalevSyncLoading
                    || !workspaceScalevSync
                    || workspaceScalevSync.status !== 'drift'
                  }
                >
                  {workspaceScalevSyncRepairing ? 'Menarik…' : 'Tarik Order Hilang'}
                </ActionButton>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

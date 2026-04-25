// @ts-nocheck
'use client';

import { useEffect, useMemo, useState } from 'react';

const panelStyle = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 16,
  boxShadow: 'var(--shadow)',
};

function fmtNumber(value) {
  return new Intl.NumberFormat('id-ID').format(Number(value || 0));
}

function cleanText(value) {
  return String(value ?? '').trim();
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

function ReasonPill({ reason }) {
  const normalized = cleanText(reason);
  const meta = normalized === 'marketplace_webhook_unmatched'
    ? {
        label: 'Unmatched',
        color: '#fca5a5',
        bg: 'rgba(239,68,68,0.12)',
        border: 'rgba(239,68,68,0.24)',
      }
    : normalized === 'marketplace_webhook_non_authoritative_match'
      ? {
          label: 'Non-Authoritative Match',
          color: '#fcd34d',
          bg: 'rgba(245,158,11,0.12)',
          border: 'rgba(245,158,11,0.24)',
        }
      : {
          label: normalized || 'Unknown',
          color: 'var(--text-secondary)',
          bg: 'rgba(148,163,184,0.12)',
          border: 'var(--border)',
        };

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

export default function MarketplaceWebhookQuarantinePanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState({ items: [], summary: { total: 0, unmatched: 0, nonAuthoritativeMatch: 0 } });
  const [search, setSearch] = useState('');
  const [businessFilter, setBusinessFilter] = useState('all');
  const [expandedRows, setExpandedRows] = useState({});

  async function loadData() {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/marketplace-intake/quarantine?limit=200');
      const next = await res.json();
      if (!res.ok) {
        throw new Error(next.error || 'Gagal memuat webhook quarantine marketplace.');
      }
      setData(next);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Gagal memuat webhook quarantine marketplace.');
      setData({ items: [], summary: { total: 0, unmatched: 0, nonAuthoritativeMatch: 0 } });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const businessOptions = useMemo(() => {
    return Array.from(
      new Set((data.items || []).map((item) => cleanText(item.businessCode)).filter(Boolean)),
    ).sort();
  }, [data.items]);

  const filteredItems = useMemo(() => {
    const query = cleanText(search).toLowerCase();
    return (data.items || []).filter((item) => {
      if (businessFilter !== 'all' && cleanText(item.businessCode) !== businessFilter) {
        return false;
      }
      if (!query) return true;

      const haystack = [
        item.businessCode,
        item.eventType,
        item.orderId,
        item.externalId,
        item.scalevId,
        item.reason,
        item.storeName,
        item.platform,
        item.financialEntity,
        item.status,
        item.sourceClass,
        item.sourceClassReason,
      ].join(' ').toLowerCase();

      return haystack.includes(query);
    });
  }, [businessFilter, data.items, search]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Webhook Quarantine</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4, maxWidth: 880, lineHeight: 1.6 }}>
              Order marketplace yang datang dari webhook lebih dulu akan ditahan di sini agar tidak mengisi <strong>scalev_orders</strong> sebelum ada row authoritative dari <strong>Marketplace Intake</strong>.
              Panel ini dipakai untuk audit dan reconciliation identity, bukan untuk overwrite data penjualan utama.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari order_id, external_id, store, atau reason…"
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
            <select
              value={businessFilter}
              onChange={(event) => setBusinessFilter(event.target.value)}
              style={{
                minWidth: 140,
                padding: '9px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 13,
                outline: 'none',
              }}
            >
              <option value="all">Semua Business</option>
              {businessOptions.map((businessCode) => (
                <option key={businessCode} value={businessCode}>
                  {businessCode}
                </option>
              ))}
            </select>
            <ActionButton onClick={loadData} disabled={loading}>
              {loading ? 'Memuat…' : 'Refresh'}
            </ActionButton>
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

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <SummaryCard label="Total Quarantine" value={data.summary?.total || 0} tone={(data.summary?.total || 0) > 0 ? 'warn' : 'default'} />
          <SummaryCard label="Unmatched" value={data.summary?.unmatched || 0} tone={(data.summary?.unmatched || 0) > 0 ? 'danger' : 'default'} helper="Webhook marketplace belum punya row intake authoritative." />
          <SummaryCard label="Non-Authoritative Match" value={data.summary?.nonAuthoritativeMatch || 0} tone={(data.summary?.nonAuthoritativeMatch || 0) > 0 ? 'warn' : 'default'} helper="Webhook match ke row app, tapi bukan source marketplace authoritative." />
          <SummaryCard label="Visible Rows" value={filteredItems.length} helper="Hasil setelah filter pencarian dan business." />
        </div>

        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Masuk</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Business</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Event</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Order / External</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Store / Platform</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Reason</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }}>Matched Row</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontSize: 12, color: 'var(--dim)' }} />
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const isOpen = Boolean(expandedRows[item.id]);
                return (
                  <tr key={item.id}>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                      {fmtDateTime(item.createdAt)}
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700 }}>
                      {item.businessCode || '-'}
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                      {item.eventType || '-'}
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                      <div style={{ fontWeight: 700 }}>{item.orderId || '-'}</div>
                      <div style={{ marginTop: 4, color: 'var(--dim)' }}>external: {item.externalId || '-'}</div>
                      <div style={{ marginTop: 4, color: 'var(--dim)' }}>scalev: {item.scalevId || '-'}</div>
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                      <div style={{ fontWeight: 700 }}>{item.storeName || '-'}</div>
                      <div style={{ marginTop: 4, color: 'var(--dim)' }}>
                        {item.platform || '-'} • {item.financialEntity || '-'}
                      </div>
                      <div style={{ marginTop: 4, color: 'var(--dim)' }}>status: {item.status || '-'}</div>
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                      <div><ReasonPill reason={item.reason} /></div>
                      <div style={{ marginTop: 6, color: 'var(--dim)' }}>
                        {item.sourceClass || '-'} • {item.sourceClassReason || '-'}
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                      {item.matchedScalevOrderId ? `#${item.matchedScalevOrderId}` : '-'}
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 12 }}>
                      <ActionButton
                        onClick={() => setExpandedRows((current) => ({
                          ...current,
                          [item.id]: !current[item.id],
                        }))}
                      >
                        {isOpen ? 'Hide Payload' : 'Payload'}
                      </ActionButton>
                    </td>
                  </tr>
                );
              })}

              {!loading && filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 18, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
                    Tidak ada order quarantine untuk filter saat ini.
                  </td>
                </tr>
              ) : null}

              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: 18, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
                    Memuat webhook quarantine marketplace...
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {filteredItems.map((item) => {
          const isOpen = Boolean(expandedRows[item.id]);
          if (!isOpen) return null;
          return (
            <div
              key={`payload-${item.id}`}
              style={{
                marginTop: 12,
                border: '1px solid var(--border)',
                borderRadius: 12,
                overflow: 'hidden',
                background: 'var(--bg)',
              }}
            >
              <div
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--dim)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Payload #{item.id}
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  overflowX: 'auto',
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: 'var(--text-secondary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {JSON.stringify(item.payload || {}, null, 2)}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

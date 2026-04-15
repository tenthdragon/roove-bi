'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  getWarehouseActivityLogs,
  type WarehouseActivityLogPayload,
  type WarehouseActivityLogRow,
} from '@/lib/warehouse-activity-log-actions';

const inputStyle = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 10px',
  color: 'var(--text)',
  fontSize: 12,
  outline: 'none',
  width: '100%',
} as const;

const SCOPE_OPTIONS = [
  { value: 'all', label: 'Semua' },
  { value: 'legacy_scalev_mapping', label: 'Mapping Scalev' },
  { value: 'scalev_catalog_product_mapping', label: 'Product Mapping' },
  { value: 'warehouse_business_mapping', label: 'Business Mapping' },
  { value: 'scalev_catalog_sync', label: 'Catalog Sync' },
  { value: 'scalev_bundle_sync', label: 'Bundle Sync' },
  { value: 'warehouse_product_config', label: 'Master Produk' },
] as const;

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function renderScopeBadge(scope: string) {
  const palette: Record<string, { bg: string; color: string; border: string; label: string }> = {
    legacy_scalev_mapping: {
      bg: 'rgba(59,130,246,0.12)',
      border: 'rgba(96,165,250,0.24)',
      color: '#93c5fd',
      label: 'Mapping Scalev',
    },
    scalev_catalog_product_mapping: {
      bg: 'rgba(16,185,129,0.12)',
      border: 'rgba(52,211,153,0.24)',
      color: '#86efac',
      label: 'Product Mapping',
    },
    warehouse_business_mapping: {
      bg: 'rgba(245,158,11,0.12)',
      border: 'rgba(251,191,36,0.24)',
      color: '#fde68a',
      label: 'Business Mapping',
    },
    scalev_catalog_sync: {
      bg: 'rgba(168,85,247,0.12)',
      border: 'rgba(192,132,252,0.24)',
      color: '#d8b4fe',
      label: 'Catalog Sync',
    },
    scalev_bundle_sync: {
      bg: 'rgba(14,165,233,0.12)',
      border: 'rgba(56,189,248,0.24)',
      color: '#7dd3fc',
      label: 'Bundle Sync',
    },
    warehouse_product_config: {
      bg: 'rgba(148,163,184,0.12)',
      border: 'rgba(148,163,184,0.24)',
      color: '#cbd5e1',
      label: 'Master Produk',
    },
  };

  const style = palette[scope] || {
    bg: 'rgba(148,163,184,0.12)',
    border: 'rgba(148,163,184,0.24)',
    color: '#cbd5e1',
    label: scope,
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 8px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        background: style.bg,
        border: `1px solid ${style.border}`,
        color: style.color,
        whiteSpace: 'nowrap',
      }}
    >
      {style.label}
    </span>
  );
}

export default function WarehouseActivityLogTab() {
  const [payload, setPayload] = useState<WarehouseActivityLogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<(typeof SCOPE_OPTIONS)[number]['value']>('all');
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<number[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function loadLogs(nextScope: string) {
    setLoading(true);
    try {
      const nextPayload = await getWarehouseActivityLogs({
        scope: nextScope,
        limit: 250,
      });
      setPayload(nextPayload);
      setMessage(nextPayload.schema_ready ? null : nextPayload.schema_message);
    } catch (error: any) {
      setMessage(error?.message || 'Gagal memuat log aktivitas warehouse.');
      setPayload(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadLogs(scope);
  }, [scope]);

  const filteredRows = useMemo(() => {
    const rows = payload?.rows || [];
    const query = search.trim().toLowerCase();
    if (!query) return rows;

    return rows.filter((row) => {
      const haystack = [
        row.summary,
        row.screen,
        row.action,
        row.target_label,
        row.target_id,
        row.business_code,
        row.acted_by_name,
        ...(row.changed_fields || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [payload?.rows, search]);

  function toggleExpanded(id: number) {
    setExpandedIds((current) => (
      current.includes(id)
        ? current.filter((currentId) => currentId !== id)
        : [...current, id]
    ));
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Log Aktivitas Mapping</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6, maxWidth: 760 }}>
              Jejak ini mencatat perubahan manual yang sensitif di warehouse, terutama mapping Scalev, business mapping warehouse, dan aksi sync yang memengaruhi jalur komunikasi Scalev ke app.
            </div>
          </div>
          <button
            onClick={() => loadLogs(scope)}
            style={{
              padding: '7px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--dim)',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>

        {message ? (
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(251,191,36,0.24)',
              background: 'rgba(251,191,36,0.08)',
              color: '#fde68a',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {message}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SCOPE_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => setScope(option.value)}
            style={{
              padding: '5px 12px',
              borderRadius: 8,
              border: `1px solid ${scope === option.value ? 'var(--accent)' : 'var(--border)'}`,
              background: scope === option.value ? 'rgba(96,165,250,0.12)' : 'transparent',
              color: scope === option.value ? 'var(--accent)' : 'var(--dim)',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {option.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cari user, target, business, atau ringkasan..."
          style={{ ...inputStyle, minWidth: 280, width: 'auto' }}
        />
      </div>

      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--dim)', fontSize: 12 }}>
            Memuat log aktivitas...
          </div>
        ) : filteredRows.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--dim)', fontSize: 12 }}>
            Belum ada log yang cocok dengan filter saat ini.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980, fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Waktu', 'User', 'Scope', 'Ringkasan', 'Business', 'Aksi'].map((header) => (
                    <th
                      key={header}
                      style={{
                        padding: '10px 8px',
                        textAlign: 'left',
                        color: 'var(--dim)',
                        fontWeight: 700,
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const expanded = expandedIds.includes(row.id);
                  return (
                    <Fragment key={row.id}>
                      <tr style={{ borderBottom: expanded ? 'none' : '1px solid var(--bg-deep)' }}>
                        <td style={{ padding: '10px 8px', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                          {formatDateTime(row.created_at)}
                        </td>
                        <td style={{ padding: '10px 8px', color: 'var(--text)' }}>
                          {row.acted_by_name || 'System'}
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          {renderScopeBadge(row.scope)}
                        </td>
                        <td style={{ padding: '10px 8px', minWidth: 360 }}>
                          <div style={{ color: 'var(--text)', fontWeight: 600 }}>{row.summary}</div>
                          <div style={{ marginTop: 4, color: 'var(--dim)', fontSize: 10 }}>
                            {row.screen}
                            {row.target_label ? ` • ${row.target_label}` : ''}
                            {row.changed_fields?.length ? ` • ${row.changed_fields.join(', ')}` : ''}
                          </div>
                        </td>
                        <td style={{ padding: '10px 8px', color: 'var(--text)' }}>
                          {row.business_code || '-'}
                        </td>
                        <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
                          <button
                            onClick={() => toggleExpanded(row.id)}
                            style={{
                              padding: '5px 9px',
                              borderRadius: 7,
                              border: '1px solid var(--border)',
                              background: 'transparent',
                              color: '#60a5fa',
                              fontSize: 10,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {expanded ? 'Sembunyikan' : 'Detail'}
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                          <td colSpan={6} style={{ padding: '0 8px 14px' }}>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                                gap: 12,
                                background: 'rgba(15,23,42,0.3)',
                                border: '1px solid rgba(148,163,184,0.12)',
                                borderRadius: 12,
                                padding: 12,
                              }}
                            >
                              {([
                                ['Before', row.before_state],
                                ['After', row.after_state],
                                ['Context', row.context],
                              ] as const).map(([label, value]) => (
                                <div key={label}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--dim)', marginBottom: 6 }}>
                                    {label}
                                  </div>
                                  <pre
                                    style={{
                                      margin: 0,
                                      padding: 10,
                                      borderRadius: 10,
                                      background: 'rgba(2,6,23,0.45)',
                                      border: '1px solid rgba(148,163,184,0.1)',
                                      color: 'var(--text)',
                                      fontSize: 10,
                                      lineHeight: 1.6,
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word',
                                    }}
                                  >
                                    {JSON.stringify(value || {}, null, 2)}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

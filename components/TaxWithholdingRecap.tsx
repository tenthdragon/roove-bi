'use client';

// Phase 4: yearly recap per masa and pasal + KAP + KJS. One group per masa is
// one ID Billing; the table mirrors the SUBTOTAL rows of the REKAPAN workbook.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TaxWithholdingEntity } from '@/lib/tax-withholding-actions';
import { getTaxYearSummary, type TaxSummaryGroup, type TaxYearSummary } from '@/lib/tax-withholding-coretax-actions';
import { TAX_ARTICLE_LABELS } from '@/lib/tax-withholding-domain';
import {
  MONTHS,
  SummaryCard,
  cellStyle,
  downloadTextFile,
  errorText,
  formatMoney,
  headCellStyle,
  numberCellStyle,
  secondaryButtonStyle,
  type Notify,
} from '@/components/TaxWithholdingShared';

const csvCell = (value: string | number | null) => {
  const text = value === null ? '' : String(value);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function recapCsv(summary: TaxYearSummary): string {
  const lines = [['Masa', 'Pasal', 'KAP', 'KJS', 'Kode objek', 'Jumlah bupot', 'DPP', 'PPh', 'PPh belum dilaporkan', 'Draft', 'Siap', 'Di-export', 'Dilaporkan', 'Dibayar'].join(';')];
  const push = (label: string, group: TaxSummaryGroup) => lines.push([
    label, TAX_ARTICLE_LABELS[group.article], group.kap ?? '', group.kjs ?? '', group.objectCodes.join(' '), group.count,
    group.grossAmount, group.withholdingAmount, group.pendingWithholdingAmount,
    group.byStatus.draft, group.byStatus.ready, group.byStatus.exported, group.byStatus.reported, group.byStatus.paid,
  ].map(csvCell).join(';'));
  for (const month of summary.months) for (const group of month.groups) push(`${String(month.month).padStart(2, '0')}/${summary.year}`, group);
  for (const group of summary.groups) push(`Total ${summary.year}`, group);
  return `${lines.join('\n')}\n`;
}

function GroupRows({ groups, showMonth }: { groups: TaxSummaryGroup[]; showMonth?: string }) {
  return (
    <>
      {groups.map((group) => (
        <tr key={`${showMonth ?? 'y'}-${group.article}-${group.kap}-${group.kjs}`}>
          <td style={cellStyle}>{showMonth ?? ''}</td>
          <td style={cellStyle}>{TAX_ARTICLE_LABELS[group.article]}</td>
          <td style={cellStyle}><span className="tw-mono">{group.kap ?? '—'}</span></td>
          <td style={cellStyle}><span className="tw-mono">{group.kjs ?? '—'}</span></td>
          <td style={{ ...cellStyle, color: 'var(--dim)', fontSize: 12 }}>{group.objectCodes.join(', ')}</td>
          <td style={numberCellStyle}>{group.count}</td>
          <td style={numberCellStyle}>{formatMoney(group.grossAmount, 2)}</td>
          <td style={numberCellStyle}>{formatMoney(group.withholdingAmount)}</td>
          <td style={{ ...numberCellStyle, color: group.pendingWithholdingAmount !== '0' ? 'var(--yellow)' : 'var(--dim)' }}>
            {group.pendingWithholdingAmount === '0' ? 'lengkap' : formatMoney(group.pendingWithholdingAmount)}
          </td>
          <td style={{ ...cellStyle, fontSize: 12, color: 'var(--dim)', whiteSpace: 'nowrap' }}>
            {[['Draft', group.byStatus.draft], ['Siap', group.byStatus.ready], ['Di-export', group.byStatus.exported], ['Dilaporkan', group.byStatus.reported], ['Dibayar', group.byStatus.paid]]
              .filter(([, count]) => Number(count) > 0).map(([label, count]) => `${label} ${count}`).join(' · ')}
          </td>
        </tr>
      ))}
    </>
  );
}

export function TaxRecapSection({ entities, notify }: { entities: TaxWithholdingEntity[]; notify: Notify }) {
  const now = useMemo(() => new Date(), []);
  const activeEntities = useMemo(() => entities.filter((entity) => entity.is_active), [entities]);
  const [entityId, setEntityId] = useState<number>(activeEntities[0]?.id ?? entities[0]?.id ?? 0);
  const [year, setYear] = useState(now.getFullYear());
  const [summary, setSummary] = useState<TaxYearSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'months' | 'year'>('months');
  const loadSequence = useRef(0);

  useEffect(() => {
    if (!entities.some((entity) => entity.id === entityId)) setEntityId(activeEntities[0]?.id ?? entities[0]?.id ?? 0);
  }, [entities, activeEntities, entityId]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setSummary(null);
    if (!entityId) return;
    setLoading(true);
    try {
      const result = await getTaxYearSummary({ entityId, year });
      if (sequence === loadSequence.current) setSummary(result);
    } catch (error) {
      if (sequence === loadSequence.current) notify({ type: 'error', text: errorText(error) });
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [entityId, year, notify]);

  useEffect(() => {
    void load();
    return () => { loadSequence.current++; };
  }, [load]);

  const years = useMemo(() => {
    const current = now.getFullYear();
    return [current + 1, current, current - 1, current - 2];
  }, [now]);

  if (entities.length === 0) {
    return <div className="tw-notice">Belum ada pemotong. Tambahkan NPWP PT di bagian Pemotong sebelum melihat rekap.</div>;
  }

  const pending = summary ? summary.groups.reduce((sum, group) => sum + Number(group.pendingWithholdingAmount), 0) : 0;
  const reportedCount = summary ? summary.months.reduce((sum, month) => sum + month.byStatus.reported + month.byStatus.paid, 0) : 0;

  return (
    <>
      {summary ? (
        <div className="tw-summary-grid">
          <SummaryCard label={`Bukti potong ${summary.year}`} value={summary.count} hint={`${reportedCount} sudah dilaporkan ke Coretax`} />
          <SummaryCard label="Total DPP" value={formatMoney(summary.grossAmount)} />
          <SummaryCard label="Total PPh dipotong" value={formatMoney(summary.withholdingAmount)} />
          <SummaryCard label="PPh belum dilaporkan" value={formatMoney(pending)} hint={pending > 0 ? 'Draft, siap, atau di-export tanpa nomor Coretax' : 'Semua bukti potong sudah dilaporkan'} />
        </div>
      ) : null}
      <section className="tw-section">
        <div className="tw-toolbar">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select aria-label="Pemotong" className="tw-filter" value={entityId} onChange={(event) => setEntityId(Number(event.target.value))}>
              {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.legal_name}{entity.is_active ? '' : ' (nonaktif)'}</option>)}
            </select>
            <select aria-label="Tahun pajak" className="tw-filter" value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {years.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select aria-label="Tampilan rekap" className="tw-filter" value={view} onChange={(event) => setView(event.target.value as 'months' | 'year')}>
              <option value="months">Per masa</option>
              <option value="year">Total tahun</option>
            </select>
          </div>
          <div className="tw-toolbar-actions">
            <button type="button" style={secondaryButtonStyle} disabled={!summary || summary.count === 0} onClick={() => summary && downloadTextFile(`Rekap PPh ${summary.year} - ${summary.entity.legal_name}.csv`, recapCsv(summary), 'text/csv;charset=utf-8')}>Unduh CSV</button>
          </div>
        </div>
        <div style={{ padding: '10px 18px 0', fontSize: 12, color: 'var(--text-secondary)' }}>
          Satu baris per pasal, KAP dan KJS adalah satu ID Billing per masa. PPh dijumlahkan dari bukti potong yang tersimpan; kolom &ldquo;belum dilaporkan&rdquo; menandai bukti potong yang belum punya nomor Coretax.
        </div>
        {loading && !summary ? (
          <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 13 }}>Memuat…</div>
        ) : summary && summary.count === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>Belum ada bukti potong untuk tahun {summary.year}.</div>
        ) : summary ? (
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1080, fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={headCellStyle}>Masa</th>
                  <th style={headCellStyle}>Pasal</th>
                  <th style={headCellStyle}>KAP</th>
                  <th style={headCellStyle}>KJS</th>
                  <th style={headCellStyle}>Kode objek</th>
                  <th style={{ ...headCellStyle, textAlign: 'right' }}>Bupot</th>
                  <th style={{ ...headCellStyle, textAlign: 'right' }}>DPP</th>
                  <th style={{ ...headCellStyle, textAlign: 'right' }}>PPh</th>
                  <th style={{ ...headCellStyle, textAlign: 'right' }}>Belum dilaporkan</th>
                  <th style={headCellStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {view === 'year' ? (
                  <>
                    <GroupRows groups={summary.groups} showMonth={`Total ${summary.year}`} />
                    <tr>
                      <td style={{ ...cellStyle, fontWeight: 700 }} colSpan={5}>Total {summary.year}</td>
                      <td style={{ ...numberCellStyle, fontWeight: 700 }}>{summary.count}</td>
                      <td style={{ ...numberCellStyle, fontWeight: 700 }}>{formatMoney(summary.grossAmount, 2)}</td>
                      <td style={{ ...numberCellStyle, fontWeight: 700 }}>{formatMoney(summary.withholdingAmount)}</td>
                      <td style={{ ...numberCellStyle, fontWeight: 700 }}>{pending > 0 ? formatMoney(pending) : 'lengkap'}</td>
                      <td style={cellStyle}></td>
                    </tr>
                  </>
                ) : summary.months.map((month) => (
                  <React.Fragment key={month.month}>
                    <tr>
                      <td style={{ ...cellStyle, fontWeight: 700, background: 'var(--input-bg)' }} colSpan={5}>{MONTHS[month.month - 1]} {summary.year}</td>
                      <td style={{ ...numberCellStyle, fontWeight: 700, background: 'var(--input-bg)' }}>{month.count}</td>
                      <td style={{ ...numberCellStyle, fontWeight: 700, background: 'var(--input-bg)' }}>{formatMoney(month.grossAmount, 2)}</td>
                      <td style={{ ...numberCellStyle, fontWeight: 700, background: 'var(--input-bg)' }}>{formatMoney(month.withholdingAmount)}</td>
                      <td style={{ ...numberCellStyle, background: 'var(--input-bg)' }} colSpan={2}>
                        <span style={{ fontSize: 12, color: 'var(--dim)' }}>{month.byStatus.reported + month.byStatus.paid} dilaporkan · {month.byStatus.exported} di-export · {month.byStatus.draft + month.byStatus.ready} belum</span>
                      </td>
                    </tr>
                    <GroupRows groups={month.groups} showMonth="" />
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}


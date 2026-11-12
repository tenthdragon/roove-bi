'use client';

// Phase 4/5: yearly recap per masa and pasal + KAP + KJS. One group per masa is
// one ID Billing, so each group row also carries its billing/NTPN records.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TaxWithholdingEntity } from '@/lib/tax-withholding-actions';
import { getTaxYearSummary, type TaxSummaryGroup, type TaxYearSummary } from '@/lib/tax-withholding-coretax-actions';
import { TAX_ARTICLE_LABELS } from '@/lib/tax-withholding-domain';
import { listTaxPaymentRecords, type TaxPaymentRecord } from '@/lib/tax-withholding-payment-actions';
import { paymentGroupKey } from '@/lib/tax-withholding-payment';
import { PaymentCell, PaymentModal, type PaymentTarget } from '@/components/TaxWithholdingPayment';
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

function recapCsv(summary: TaxYearSummary, payments: Map<string, TaxPaymentRecord[]>): string {
  const lines = [['Masa', 'Pasal', 'KAP', 'KJS', 'Kode objek', 'Jumlah bupot', 'DPP', 'PPh', 'PPh belum dilaporkan', 'Draft', 'Siap', 'Di-export', 'Dilaporkan', 'Dibayar', 'ID Billing', 'NTPN', 'Tanggal setor', 'Jumlah disetor'].join(';')];
  const push = (label: string, group: TaxSummaryGroup, records: TaxPaymentRecord[] = []) => lines.push([
    label, TAX_ARTICLE_LABELS[group.article], group.kap ?? '', group.kjs ?? '', group.objectCodes.join(' '), group.count,
    group.grossAmount, group.withholdingAmount, group.pendingWithholdingAmount,
    group.byStatus.draft, group.byStatus.ready, group.byStatus.exported, group.byStatus.reported, group.byStatus.paid,
    records.map((record) => record.billing_id).join(' '), records.map((record) => record.ntpn ?? '-').join(' '),
    records.map((record) => record.paid_at ?? '-').join(' '), records.map((record) => record.paid_amount ?? '0').join(' '),
  ].map(csvCell).join(';'));
  for (const month of summary.months) for (const group of month.groups) push(`${String(month.month).padStart(2, '0')}/${summary.year}`, group, payments.get(paymentGroupKey({ period_month: month.month, pph_article: group.article, kap: group.kap, kjs: group.kjs })) ?? []);
  for (const group of summary.groups) push(`Total ${summary.year}`, group);
  return `${lines.join('\n')}\n`;
}

function GroupRows({ groups, showMonth, month, payments, canManage, onOpen }: {
  groups: TaxSummaryGroup[]; showMonth?: string; month: number | null; payments: Map<string, TaxPaymentRecord[]>; canManage: boolean; onOpen: (target: PaymentTarget) => void;
}) {
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
          <td style={cellStyle}>
            {month === null
              ? <span style={{ fontSize: 12, color: 'var(--dim)' }}>{formatMoney(paidTotal(payments, group))} disetor</span>
              : <PaymentCell month={month} group={group} records={payments.get(paymentGroupKey({ period_month: month, pph_article: group.article, kap: group.kap, kjs: group.kjs })) ?? []} canManage={canManage} onOpen={onOpen} />}
          </td>
        </tr>
      ))}
    </>
  );
}

/** Total paid across the year for a pasal + KAP + KJS group (year view). */
function paidTotal(payments: Map<string, TaxPaymentRecord[]>, group: TaxSummaryGroup): number {
  let total = 0;
  for (const [key, records] of payments) {
    if (!key.endsWith(`|${group.article}|${group.kap ?? ''}|${group.kjs ?? ''}`)) continue;
    for (const record of records) if (record.ntpn) total += Number(record.paid_amount ?? 0);
  }
  return total;
}

export function TaxRecapSection({ entities, canManage, notify }: { entities: TaxWithholdingEntity[]; canManage: boolean; notify: Notify }) {
  const now = useMemo(() => new Date(), []);
  const activeEntities = useMemo(() => entities.filter((entity) => entity.is_active), [entities]);
  const [entityId, setEntityId] = useState<number>(activeEntities[0]?.id ?? entities[0]?.id ?? 0);
  const [year, setYear] = useState(now.getFullYear());
  const [summary, setSummary] = useState<TaxYearSummary | null>(null);
  const [records, setRecords] = useState<TaxPaymentRecord[]>([]);
  const [target, setTarget] = useState<PaymentTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'months' | 'year'>('months');
  const loadSequence = useRef(0);

  useEffect(() => {
    if (!entities.some((entity) => entity.id === entityId)) setEntityId(activeEntities[0]?.id ?? entities[0]?.id ?? 0);
  }, [entities, activeEntities, entityId]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setSummary(null);
    setRecords([]);
    if (!entityId) return;
    setLoading(true);
    try {
      const [result, payments] = await Promise.all([getTaxYearSummary({ entityId, year }), listTaxPaymentRecords({ entityId, year })]);
      if (sequence !== loadSequence.current) return;
      setSummary(result);
      setRecords(payments);
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

  const payments = useMemo(() => {
    const map = new Map<string, TaxPaymentRecord[]>();
    for (const record of records) {
      const list = map.get(record.groupKey) ?? [];
      list.push(record);
      map.set(record.groupKey, list);
    }
    return map;
  }, [records]);
  const paidAmount = useMemo(() => records.reduce((sum, record) => sum + (record.ntpn ? Number(record.paid_amount ?? 0) : 0), 0), [records]);
  const unpaidBillings = useMemo(() => records.filter((record) => !record.ntpn).length, [records]);

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
          <SummaryCard label="PPh disetor (NTPN)" value={formatMoney(paidAmount)} hint={`${unpaidBillings} ID Billing belum disetor · sisa ${formatMoney(Math.max(0, Number(summary.withholdingAmount) - paidAmount))}`} />
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
            <button type="button" style={secondaryButtonStyle} disabled={!summary || summary.count === 0} onClick={() => summary && downloadTextFile(`Rekap PPh ${summary.year} - ${summary.entity.legal_name}.csv`, recapCsv(summary, payments), 'text/csv;charset=utf-8')}>Unduh CSV</button>
          </div>
        </div>
        <div style={{ padding: '10px 18px 0', fontSize: 12, color: 'var(--text-secondary)' }}>
          Satu baris per pasal, KAP dan KJS adalah satu ID Billing per masa. PPh dijumlahkan dari bukti potong yang tersimpan; kolom &ldquo;belum dilaporkan&rdquo; menandai bukti potong yang belum punya nomor Coretax. Kolom &ldquo;Setoran&rdquo; mencatat ID Billing dan NTPN; NTPN yang tercatat mengubah bukti potong kelompok itu menjadi dibayar.
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
                  <th style={headCellStyle}>Setoran</th>
                </tr>
              </thead>
              <tbody>
                {view === 'year' ? (
                  <>
                    <GroupRows groups={summary.groups} showMonth={`Total ${summary.year}`} month={null} payments={payments} canManage={canManage} onOpen={setTarget} />
                    <tr>
                      <td style={{ ...cellStyle, fontWeight: 700 }} colSpan={5}>Total {summary.year}</td>
                      <td style={{ ...numberCellStyle, fontWeight: 700 }}>{summary.count}</td>
                      <td style={{ ...numberCellStyle, fontWeight: 700 }}>{formatMoney(summary.grossAmount, 2)}</td>
                      <td style={{ ...numberCellStyle, fontWeight: 700 }}>{formatMoney(summary.withholdingAmount)}</td>
                      <td style={{ ...numberCellStyle, fontWeight: 700 }}>{pending > 0 ? formatMoney(pending) : 'lengkap'}</td>
                      <td style={cellStyle}></td>
                      <td style={{ ...cellStyle, fontWeight: 700, fontSize: 12 }}>{formatMoney(paidAmount)} disetor</td>
                    </tr>
                  </>
                ) : summary.months.map((month) => (
                  <React.Fragment key={month.month}>
                    <tr>
                      <td style={{ ...cellStyle, fontWeight: 700, background: 'var(--input-bg)' }} colSpan={5}>{MONTHS[month.month - 1]} {summary.year}</td>
                      <td style={{ ...numberCellStyle, fontWeight: 700, background: 'var(--input-bg)' }}>{month.count}</td>
                      <td style={{ ...numberCellStyle, fontWeight: 700, background: 'var(--input-bg)' }}>{formatMoney(month.grossAmount, 2)}</td>
                      <td style={{ ...numberCellStyle, fontWeight: 700, background: 'var(--input-bg)' }}>{formatMoney(month.withholdingAmount)}</td>
                      <td style={{ ...numberCellStyle, background: 'var(--input-bg)' }} colSpan={3}>
                        <span style={{ fontSize: 12, color: 'var(--dim)' }}>{month.byStatus.reported + month.byStatus.paid} dilaporkan · {month.byStatus.exported} di-export · {month.byStatus.draft + month.byStatus.ready} belum · {month.byStatus.paid} dibayar</span>
                      </td>
                    </tr>
                    <GroupRows groups={month.groups} showMonth="" month={month.month} payments={payments} canManage={canManage} onOpen={setTarget} />
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      {target && summary ? (
        <PaymentModal
          entityId={entityId}
          year={year}
          target={target}
          onClose={() => setTarget(null)}
          onDone={async (text) => { notify({ type: 'success', text }); setTarget(null); await load(); }}
        />
      ) : null}
    </>
  );
}


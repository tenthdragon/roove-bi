'use client';

// Phase 5: setoran per recap group. The cell lists the group's billing records
// and the modal creates or edits a kode billing, records or clears its NTPN,
// or deletes an unpaid record.

import React, { useState } from 'react';
import type { TaxSummaryGroup } from '@/lib/tax-withholding-coretax-actions';
import {
  clearTaxPaymentNtpn,
  deleteTaxPaymentRecord,
  recordTaxPaymentNtpn,
  saveTaxPaymentRecord,
  type TaxPaymentRecord,
} from '@/lib/tax-withholding-payment-actions';
import { BILLING_ID_PATTERN, NTPN_PATTERN, normalizeBillingId, normalizeNtpn, paymentGroupStatus } from '@/lib/tax-withholding-payment';
import { TAX_ARTICLE_LABELS } from '@/lib/tax-withholding-domain';
import {
  MONTHS,
  ModalShell,
  StatusPill,
  errorText,
  formatDate,
  formatMoney,
  inputStyle,
  labelStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '@/components/TaxWithholdingShared';

export type PaymentModalMode = 'billing' | 'ntpn' | 'clear-ntpn' | 'delete';
export type PaymentTarget = { month: number; group: TaxSummaryGroup; record: TaxPaymentRecord | null; mode: PaymentModalMode };

const todayIso = () => new Date().toISOString().slice(0, 10);

export function PaymentCell({ month, group, records, canManage, onOpen }: {
  month: number; group: TaxSummaryGroup; records: TaxPaymentRecord[]; canManage: boolean; onOpen: (target: PaymentTarget) => void;
}) {
  const status = paymentGroupStatus(group.withholdingAmount, records);
  const canBill = canManage && group.kap !== null && group.kjs !== null;
  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 220 }}>
      {records.map((record) => (
        <div key={record.id} style={{ fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="tw-mono">{record.billing_id}</span>
            <span style={{ color: 'var(--dim)' }}>{formatMoney(record.billing_amount)}</span>
            {record.ntpn
              ? <StatusPill tone="green">Disetor {formatDate(record.paid_at)}</StatusPill>
              : <StatusPill tone="yellow">Belum disetor</StatusPill>}
          </div>
          {record.ntpn ? <div className="tw-mono" style={{ color: 'var(--dim)', marginTop: 2 }}>NTPN {record.ntpn} · {formatMoney(record.paid_amount)}</div> : null}
          {record.billing_valid_until && !record.ntpn ? <div style={{ color: 'var(--dim)', marginTop: 2 }}>berlaku s.d. {formatDate(record.billing_valid_until)}</div> : null}
          {canManage ? (
            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginLeft: -8 }}>
              {record.ntpn ? (
                <button type="button" className="tw-action-button" style={{ color: 'var(--yellow)' }} onClick={() => onOpen({ month, group, record, mode: 'clear-ntpn' })}>Hapus NTPN</button>
              ) : (
                <>
                  <button type="button" className="tw-action-button" style={{ color: 'var(--green)' }} onClick={() => onOpen({ month, group, record, mode: 'ntpn' })}>Catat NTPN</button>
                  <button type="button" className="tw-action-button" style={{ color: 'var(--accent)' }} onClick={() => onOpen({ month, group, record, mode: 'billing' })}>Ubah</button>
                  <button type="button" className="tw-action-button" style={{ color: 'var(--red)' }} onClick={() => onOpen({ month, group, record, mode: 'delete' })}>Hapus</button>
                </>
              )}
            </div>
          ) : null}
        </div>
      ))}
      {records.length === 0 ? <div style={{ fontSize: 12, color: 'var(--dim)' }}>{group.kap === null ? 'KAP/KJS belum ada di referensi' : 'Belum ada ID Billing'}</div> : null}
      {status === 'partial' ? <div style={{ fontSize: 11, color: 'var(--yellow)' }}>Setoran kurang dari PPh terutang.</div> : null}
      {canBill ? (
        <button type="button" className="tw-action-button" style={{ color: 'var(--accent)', justifySelf: 'start', marginLeft: -8 }} onClick={() => onOpen({ month, group, record: null, mode: 'billing' })}>+ ID Billing</button>
      ) : null}
    </div>
  );
}

export function PaymentModal({ entityId, year, target, onClose, onDone }: {
  entityId: number; year: number; target: PaymentTarget; onClose: () => void; onDone: (message: string) => Promise<void>;
}) {
  const { month, group, record, mode } = target;
  const [billingId, setBillingId] = useState(record?.billing_id ?? '');
  const [amount, setAmount] = useState(record?.billing_amount ?? group.withholdingAmount);
  const [createdAt, setCreatedAt] = useState(record?.billing_created_at ?? todayIso());
  const [validUntil, setValidUntil] = useState(record?.billing_valid_until ?? '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [ntpn, setNtpn] = useState('');
  const [paidAt, setPaidAt] = useState(todayIso());
  const [paidAmount, setPaidAmount] = useState(record?.billing_amount ?? group.withholdingAmount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtitle = `${MONTHS[month - 1]} ${year} · ${TAX_ARTICLE_LABELS[group.article]} · KAP ${group.kap ?? '—'} / KJS ${group.kjs ?? '—'} · PPh terutang ${formatMoney(group.withholdingAmount)}`;
  const billingValid = BILLING_ID_PATTERN.test(normalizeBillingId(billingId));
  const ntpnValid = NTPN_PATTERN.test(normalizeNtpn(ntpn));

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      await onDone(await work());
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  if (mode === 'delete' && record) {
    return (
      <ModalShell title="Hapus ID Billing?" subtitle={subtitle} onClose={onClose} maxWidth={480}>
        <div className="tw-modal-body" style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>ID Billing <span className="tw-mono">{record.billing_id}</span> ({formatMoney(record.billing_amount)}) dihapus dari catatan. Hanya catatan tanpa NTPN yang bisa dihapus.</div>
          {error ? <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div> : null}
        </div>
        <div className="tw-modal-actions">
          <button type="button" style={secondaryButtonStyle} onClick={onClose} disabled={busy}>Batal</button>
          <button type="button" style={{ ...primaryButtonStyle, background: 'var(--red-solid)' }} disabled={busy} onClick={() => void run(async () => { await deleteTaxPaymentRecord({ id: record.id, version: record.updated_at }); return 'ID Billing dihapus.'; })}>Hapus</button>
        </div>
      </ModalShell>
    );
  }

  if (mode === 'clear-ntpn' && record) {
    return (
      <ModalShell title="Hapus NTPN?" subtitle={subtitle} onClose={onClose} maxWidth={480}>
        <div className="tw-modal-body" style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>NTPN <span className="tw-mono">{record.ntpn}</span> dihapus dari ID Billing <span className="tw-mono">{record.billing_id}</span>. Bukti potong kelompok ini kembali berstatus dilaporkan bila tidak ada setoran lain yang menutupnya.</div>
          {error ? <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div> : null}
        </div>
        <div className="tw-modal-actions">
          <button type="button" style={secondaryButtonStyle} onClick={onClose} disabled={busy}>Batal</button>
          <button type="button" style={{ ...primaryButtonStyle, background: 'var(--yellow-solid)' }} disabled={busy} onClick={() => void run(async () => { const result = await clearTaxPaymentNtpn({ id: record.id, version: record.updated_at }); return `NTPN dihapus; ${result.slipsReverted} bukti potong kembali dilaporkan.`; })}>Hapus NTPN</button>
        </div>
      </ModalShell>
    );
  }

  if (mode === 'ntpn' && record) {
    return (
      <ModalShell title="Catat NTPN" subtitle={subtitle} onClose={onClose} maxWidth={520}>
        <div className="tw-modal-body" style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>ID Billing <span className="tw-mono">{record.billing_id}</span> · {formatMoney(record.billing_amount)}. Setelah NTPN tercatat, bukti potong dilaporkan di kelompok ini berstatus dibayar.</div>
          <label style={labelStyle}>
            NTPN
            <input value={ntpn} onChange={(event) => setNtpn(event.target.value)} style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textTransform: 'uppercase' }} placeholder="16 huruf/angka" />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={labelStyle}>
              Tanggal setor
              <input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Jumlah disetor (Rp)
              <input inputMode="numeric" value={paidAmount} onChange={(event) => setPaidAmount(event.target.value.replace(/[^\d]/g, ''))} style={inputStyle} />
            </label>
          </div>
          {ntpn && !ntpnValid ? <div style={{ color: 'var(--red)', fontSize: 12 }}>NTPN harus 16 huruf besar/angka.</div> : null}
          {error ? <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div> : null}
        </div>
        <div className="tw-modal-actions">
          <button type="button" style={secondaryButtonStyle} onClick={onClose} disabled={busy}>Batal</button>
          <button type="button" style={primaryButtonStyle} disabled={busy || !ntpnValid || !paidAt || !paidAmount} onClick={() => void run(async () => {
            const result = await recordTaxPaymentNtpn({ id: record.id, version: record.updated_at, ntpn, paidAt, paidAmount });
            return `NTPN dicatat; ${result.slipsPaid} bukti potong berstatus dibayar.`;
          })}>{busy ? 'Menyimpan…' : 'Simpan NTPN'}</button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title={record ? 'Ubah ID Billing' : 'Buat ID Billing'} subtitle={subtitle} onClose={onClose} maxWidth={520}>
      <div className="tw-modal-body" style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Catat kode billing yang dibuat di DJP Online / Coretax untuk kelompok ini. Jumlah diisi dari PPh terutang; ubah bila setoran dipecah atau ada pembetulan.</div>
        <label style={labelStyle}>
          ID Billing (15 digit)
          <input value={billingId} onChange={(event) => setBillingId(event.target.value)} style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} placeholder="012345678901234" />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={labelStyle}>
            Jumlah (Rp)
            <input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ''))} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Tanggal dibuat
            <input type="date" value={createdAt} onChange={(event) => setCreatedAt(event.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Berlaku sampai (opsional)
            <input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} style={inputStyle} />
          </label>
        </div>
        <label style={labelStyle}>
          Catatan
          <input value={notes} onChange={(event) => setNotes(event.target.value)} style={inputStyle} placeholder="Opsional" />
        </label>
        {billingId && !billingValid ? <div style={{ color: 'var(--red)', fontSize: 12 }}>ID Billing harus 15 digit angka.</div> : null}
        {error ? <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div> : null}
      </div>
      <div className="tw-modal-actions">
        <button type="button" style={secondaryButtonStyle} onClick={onClose} disabled={busy}>Batal</button>
        <button type="button" style={primaryButtonStyle} disabled={busy || !billingValid || !amount || !createdAt || group.kap === null || group.kjs === null} onClick={() => void run(async () => {
          await saveTaxPaymentRecord({
            id: record?.id ?? null, version: record?.updated_at ?? null, entityId, year, month, article: group.article,
            kap: group.kap ?? '', kjs: group.kjs ?? '', billingId, billingAmount: amount, billingCreatedAt: createdAt, billingValidUntil: validUntil || null, notes,
          });
          return record ? 'ID Billing diperbarui.' : 'ID Billing dicatat.';
        })}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
      </div>
    </ModalShell>
  );
}

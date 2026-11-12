'use client';

// Phase 4 dialogs: record the numbers Coretax assigned to a masa (paste, file,
// or typed per row) and correct or clear the number of one slip.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TaxSlip } from '@/lib/tax-withholding-slip-actions';
import type { TaxWithholdingEntity } from '@/lib/tax-withholding-actions';
import {
  clearCoretaxNumber,
  previewCoretaxRecording,
  recordCoretaxNumbers,
  type CoretaxCandidate,
  type CoretaxRecordingPreview,
} from '@/lib/tax-withholding-coretax-actions';
import { coretaxNumberProblem, coretaxNumberWarning, normalizeCoretaxNumber } from '@/lib/tax-withholding-coretax';
import { IDENTITY_LABELS } from '@/lib/tax-withholding-domain';
import {
  MONTHS,
  ModalShell,
  STATUS_LABELS,
  STATUS_TONE,
  StatusPill,
  SummaryCard,
  cellStyle,
  errorText,
  formatDate,
  formatDateTime,
  formatMoney,
  headCellStyle,
  inputStyle,
  labelStyle,
  numberCellStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  type Notify,
} from '@/components/TaxWithholdingShared';

const MATCH_LABELS: Record<NonNullable<CoretaxCandidate['matchedBy']>, string> = {
  document: 'nomor dokumen',
  'document+identity': 'nomor dokumen + NPWP',
  'document+amount': 'nomor dokumen + DPP',
  'identity+amount': 'NPWP + DPP',
};

type RowDecision = { number: string; action: 'record' | 'replace' | 'keep' | 'none'; problem: string | null; warning: string | null };

function decideRow(candidate: CoretaxCandidate, typed: string | undefined, allowReplace: boolean): RowDecision {
  const number = normalizeCoretaxNumber(typed ?? candidate.proposedNumber ?? '');
  if (!number) return { number, action: 'none', problem: typed === undefined && candidate.problems.length > 0 ? candidate.problems[0] : null, warning: null };
  const problem = coretaxNumberProblem(number);
  if (problem) return { number, action: 'none', problem, warning: null };
  const warning = coretaxNumberWarning(number);
  if (candidate.status === 'reported') {
    if (candidate.coretax_slip_number === number) return { number, action: 'keep', problem: null, warning };
    return allowReplace
      ? { number, action: 'replace', problem: null, warning }
      : { number, action: 'none', problem: 'Sudah tercatat; centang izin ganti nomor untuk menimpanya.', warning };
  }
  return { number, action: 'record', problem: null, warning };
}

export function CoretaxRecordModal({ entity, year, month, onClose, onChanged, notify }: {
  entity: TaxWithholdingEntity; year: number; month: number; onClose: () => void; onChanged: () => Promise<void>; notify: Notify;
}) {
  const [preview, setPreview] = useState<CoretaxRecordingPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState<string>('');
  const [allowReplace, setAllowReplace] = useState(false);
  const [onlyPending, setOnlyPending] = useState(true);
  const [typed, setTyped] = useState<Record<number, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  // The source last matched and the batch filter live in refs so a refresh
  // never depends on them through the callback identity: changing the batch
  // issues exactly one request, with the current source, and only the latest
  // request may replace the preview.
  const sourceRef = useRef<{ text: string; file: File | null }>({ text: '', file: null });
  const batchRef = useRef(batchId);
  const requestSequence = useRef(0);

  const refresh = useCallback(async (source?: { text?: string; file?: File | null }) => {
    if (source) sourceRef.current = { text: source.text ?? '', file: source.file ?? null };
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set('entityId', String(entity.id));
      formData.set('year', String(year));
      formData.set('month', String(month));
      formData.set('batchId', batchRef.current);
      if (sourceRef.current.file) formData.set('file', sourceRef.current.file);
      else if (sourceRef.current.text.trim()) formData.set('text', sourceRef.current.text);
      const result = await previewCoretaxRecording(formData);
      if (sequence !== requestSequence.current) return;
      setPreview(result);
      setTyped({});
    } catch (err) {
      if (sequence === requestSequence.current) setError(errorText(err));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [entity.id, year, month]);

  useEffect(() => { void refresh(); }, [refresh]);
  const changeBatch = (value: string) => {
    setBatchId(value);
    batchRef.current = value;
    void refresh();
  };

  const decisions = useMemo(() => {
    const map = new Map<number, RowDecision>();
    for (const candidate of preview?.candidates ?? []) map.set(candidate.id, decideRow(candidate, typed[candidate.id], allowReplace));
    return map;
  }, [preview, typed, allowReplace]);

  const pendingAssignments = useMemo(() => {
    if (!preview) return [];
    return preview.candidates
      .map((candidate) => ({ candidate, decision: decisions.get(candidate.id)! }))
      .filter(({ decision }) => decision.action === 'record' || decision.action === 'replace')
      .map(({ candidate, decision }) => ({ slipId: candidate.id, coretaxNumber: decision.number, version: candidate.updated_at, action: decision.action }));
  }, [preview, decisions]);

  const recordCount = pendingAssignments.filter((row) => row.action === 'record').length;
  const replaceCount = pendingAssignments.filter((row) => row.action === 'replace').length;
  const problemCount = [...decisions.values()].filter((decision) => decision.problem).length;
  const duplicateNumbers = useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of pendingAssignments) seen.set(row.coretaxNumber, (seen.get(row.coretaxNumber) ?? 0) + 1);
    return [...seen.entries()].filter(([, count]) => count > 1).map(([number]) => number);
  }, [pendingAssignments]);

  const submit = async () => {
    if (!preview || pendingAssignments.length === 0 || duplicateNumbers.length > 0) return;
    if (pendingAssignments.length > preview.maxRecordSlips) {
      setError(`Maksimal ${preview.maxRecordSlips} bukti potong per pencatatan; batasi ke satu batch dulu.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await recordCoretaxNumbers({
        entityId: entity.id, year, month, allowReplace,
        assignments: pendingAssignments.map(({ slipId, coretaxNumber, version }) => ({ slipId, coretaxNumber, version })),
      });
      notify({ type: 'success', text: `${result.recorded} nomor bukti potong dicatat${result.replaced > 0 ? ` (${result.replaced} diganti)` : ''}; status menjadi dilaporkan.` });
      setText('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await Promise.all([refresh({ text: '', file: null }), onChanged()]);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const rows = (preview?.candidates ?? []).filter((candidate) => !onlyPending || candidate.status === 'exported' || decisions.get(candidate.id)?.action === 'replace' || typed[candidate.id] !== undefined);
  const canSubmit = !busy && !loading && pendingAssignments.length > 0 && duplicateNumbers.length === 0;

  return (
    <ModalShell title="Catat nomor bukti potong Coretax" subtitle={`${entity.legal_name} · ${MONTHS[month - 1]} ${year}`} onClose={onClose} maxWidth={1040}>
      <div className="tw-modal-body" style={{ display: 'grid', gap: 14 }}>
        {error ? <div className="tw-notice" style={{ color: 'var(--red)' }}>{error}</div> : null}
        {preview ? (
          <>
            <div className="tw-summary-grid">
              <SummaryCard label="Menunggu nomor" value={preview.totals.exported} hint={`${preview.totals.reported} sudah dilaporkan di masa ini`} />
              <SummaryCard label="Akan dicatat" value={recordCount} hint={replaceCount > 0 ? `${replaceCount} nomor diganti` : undefined} />
              <SummaryCard label="Baris sumber" value={preview.parsedRows} hint={preview.parsedRows > 0 ? `${preview.unmatched.length} tidak cocok · ${preview.ambiguous.length} ambigu` : 'Tempel atau unggah daftar dari Coretax'} />
              <SummaryCard label="Perlu perhatian" value={problemCount + preview.conflicts.length} hint={problemCount + preview.conflicts.length > 0 ? 'Lihat kolom nomor dan catatan di bawah' : undefined} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Setelah file XML diunggah, Coretax memberi nomor pada setiap bukti potong. Tempel dua kolom (nomor dokumen dan nomor bukti potong) dari daftar Coretax, unggah unduhannya, atau ketik nomor langsung di tabel. Nomor dicocokkan lewat nomor dokumen yang tertulis di XML (nomor faktur pajak untuk dokumen TaxInvoice).
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
              <label style={labelStyle}>
                Tempel dari Coretax / spreadsheet
                <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }} placeholder={'INV/2026/10/001\t26000UK7L\nINV/2026/10/002\t26000UK7M'} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" style={secondaryButtonStyle} disabled={loading || !text.trim()} onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ''; void refresh({ text }); }}>Cocokkan tempelan</button>
                  {text ? <button type="button" className="tw-action-button" style={{ color: 'var(--dim)' }} onClick={() => { setText(''); void refresh({ text: '', file }); }}>Kosongkan</button> : null}
                </div>
              </label>
              <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                <label style={labelStyle}>
                  Atau unggah unduhan Coretax (.xlsx / .csv)
                  <input ref={fileInput} type="file" accept=".xlsx,.xlsm,.xls,.csv,.txt" style={inputStyle} onChange={(event) => {
                    const selected = event.target.files?.[0] ?? null;
                    setFile(selected);
                    if (selected) void refresh({ file: selected, text });
                  }} />
                  {file ? <div style={{ fontSize: 12, color: 'var(--dim)', fontWeight: 400 }}>{file.name}</div> : null}
                </label>
                <label style={labelStyle}>
                  Batas ke batch
                  <select className="tw-filter" style={{ ...inputStyle, padding: '9px 12px' }} value={batchId} onChange={(event) => changeBatch(event.target.value)}>
                    <option value="">Semua batch masa ini</option>
                    {preview.batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.file_name} · {batch.exported_count} menunggu, {batch.reported_count} dilaporkan</option>)}
                  </select>
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={allowReplace} onChange={(event) => setAllowReplace(event.target.checked)} />
                  Izinkan mengganti nomor yang sudah dilaporkan (koreksi)
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={onlyPending} onChange={(event) => setOnlyPending(event.target.checked)} />
                  Tampilkan hanya yang menunggu nomor
                </label>
              </div>
            </div>
            {preview.issues.length > 0 ? <div className="tw-notice" style={{ color: 'var(--yellow)' }}>{preview.issues.join(' ')}</div> : null}
            {preview.conflicts.length > 0 ? <div className="tw-notice" style={{ color: 'var(--red)' }}>{preview.conflicts.join(' ')}</div> : null}
            {duplicateNumbers.length > 0 ? <div className="tw-notice" style={{ color: 'var(--red)' }}>Nomor yang sama diketik untuk beberapa bukti potong: {duplicateNumbers.join(', ')}.</div> : null}
            {preview.unmatched.length > 0 || preview.ambiguous.length > 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'grid', gap: 4 }}>
                {preview.unmatched.slice(0, 20).map((row) => <div key={`u-${row.line}`}>Baris {row.line}: {row.coretaxNumber ?? '(tanpa nomor)'} — {row.reason}</div>)}
                {preview.unmatched.length > 20 ? <div>… {preview.unmatched.length - 20} baris lain tidak cocok.</div> : null}
                {preview.ambiguous.map((row) => <div key={`a-${row.line}`}>Baris {row.line}: {row.coretaxNumber} cocok dengan {row.slipIds.length} bukti potong ({row.documentNumber}); ketik nomornya langsung di baris yang benar.</div>)}
              </div>
            ) : null}
            {rows.length === 0 ? (
              <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
                {preview.candidates.length === 0 ? 'Belum ada bukti potong yang di-export di masa ini.' : 'Semua bukti potong masa ini sudah punya nomor.'}
              </div>
            ) : (
              <div className="table-scroll" style={{ maxHeight: 380 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900, fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={headCellStyle}>Tanggal</th>
                      <th style={headCellStyle}>Dokumen di XML</th>
                      <th style={headCellStyle}>Lawan transaksi</th>
                      <th style={{ ...headCellStyle, textAlign: 'right' }}>PPh</th>
                      <th style={headCellStyle}>Status</th>
                      <th style={headCellStyle}>Nomor Coretax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((candidate) => {
                      const decision = decisions.get(candidate.id)!;
                      const value = typed[candidate.id] ?? candidate.proposedNumber ?? '';
                      return (
                        <tr key={candidate.id}>
                          <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{formatDate(candidate.invoice_date)}</td>
                          <td style={cellStyle}>
                            <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{candidate.document_number}</div>
                            {candidate.document_number !== candidate.invoice_number ? <div style={{ color: 'var(--dim)', fontSize: 11 }}>invoice {candidate.invoice_number}</div> : null}
                            {candidate.export_batch_id ? <div style={{ color: 'var(--dim)', fontSize: 11 }}>Batch #{candidate.export_batch_id}</div> : null}
                          </td>
                          <td style={cellStyle}>{candidate.counterparty_name}<div style={{ color: 'var(--dim)', fontSize: 11 }}>{IDENTITY_LABELS[candidate.counterparty_identity_type]} · {candidate.object_code}</div></td>
                          <td style={numberCellStyle}>{formatMoney(candidate.withholding_amount)}</td>
                          <td style={cellStyle}>
                            <StatusPill tone={STATUS_TONE[candidate.status]}>{STATUS_LABELS[candidate.status]}</StatusPill>
                            {candidate.coretax_slip_number ? <div className="tw-mono" style={{ marginTop: 4 }}>{candidate.coretax_slip_number}</div> : null}
                          </td>
                          <td style={{ ...cellStyle, minWidth: 220 }}>
                            <input
                              aria-label={`Nomor Coretax ${candidate.document_number}`}
                              value={value}
                              onChange={(event) => setTyped((current) => ({ ...current, [candidate.id]: event.target.value }))}
                              style={{ ...inputStyle, padding: '7px 10px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textTransform: 'uppercase' }}
                              placeholder="26000UK7L"
                            />
                            <div style={{ fontSize: 11, marginTop: 4, color: decision.problem ? 'var(--red)' : decision.action === 'replace' ? 'var(--yellow)' : 'var(--dim)' }}>
                              {decision.problem
                                ? decision.problem
                                : decision.action === 'record' ? `Akan dicatat${candidate.matchedBy && typed[candidate.id] === undefined ? ` · cocok lewat ${MATCH_LABELS[candidate.matchedBy]}` : ''}`
                                  : decision.action === 'replace' ? `Mengganti ${candidate.coretax_slip_number}`
                                    : decision.action === 'keep' ? 'Sama dengan yang tercatat' : candidate.status === 'exported' ? 'Belum ada nomor' : ''}
                              {decision.warning ? ` · ${decision.warning}` : ''}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {preview.batches.length > 0 ? (
              <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                {preview.batches.map((batch) => <div key={batch.id}>{batch.file_name} · dibuat {formatDateTime(batch.created_at)} · {batch.exported_count} menunggu nomor, {batch.reported_count} dilaporkan</div>)}
              </div>
            ) : null}
          </>
        ) : loading ? <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Memuat…</div> : null}
      </div>
      <div className="tw-modal-actions">
        <button type="button" style={secondaryButtonStyle} onClick={onClose} disabled={busy}>Tutup</button>
        <button type="button" style={secondaryButtonStyle} disabled={loading || busy} onClick={() => void refresh()}>Muat ulang</button>
        <button type="button" style={primaryButtonStyle} disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? 'Mencatat…' : `Catat nomor (${pendingAssignments.length})`}
        </button>
      </div>
    </ModalShell>
  );
}

/** Records, corrects or clears the Coretax number of one exported/reported slip. */
export function CoretaxNumberModal({ slip, onClose, onDone }: { slip: TaxSlip; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [value, setValue] = useState(slip.coretax_slip_number ?? '');
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const number = normalizeCoretaxNumber(value);
  const problem = number ? coretaxNumberProblem(number) : 'Nomor bukti potong kosong.';
  const warning = coretaxNumberWarning(number);
  const unchanged = slip.status === 'reported' && number === slip.coretax_slip_number;

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      await recordCoretaxNumbers({
        entityId: slip.entity_id, year: slip.period_year, month: slip.period_month, allowReplace: slip.status === 'reported',
        assignments: [{ slipId: slip.id, coretaxNumber: number, version: slip.updated_at }],
      });
      await onDone(slip.status === 'reported' ? `Nomor Coretax diganti menjadi ${number}.` : `Nomor Coretax ${number} dicatat; status menjadi dilaporkan.`);
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };
  const clear = async () => {
    setBusy('clear');
    setError(null);
    try {
      await clearCoretaxNumber({ slipId: slip.id, version: slip.updated_at });
      await onDone('Nomor Coretax dihapus; bukti potong kembali berstatus di-export.');
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  return (
    <ModalShell title={slip.status === 'reported' ? 'Ubah nomor Coretax' : 'Catat nomor Coretax'} subtitle={`${slip.invoice_number} · ${slip.counterparty_name}`} onClose={onClose} maxWidth={480}>
      <div className="tw-modal-body" style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {slip.status === 'reported'
            ? 'Perbaiki nomor bukti potong yang tercatat, atau hapus nomornya agar bukti potong kembali berstatus di-export.'
            : 'Masukkan nomor bukti potong yang diberikan Coretax setelah file XML diunggah. Status berubah menjadi dilaporkan.'}
        </div>
        <label style={labelStyle}>
          Nomor bukti potong Coretax
          <input value={value} onChange={(event) => setValue(event.target.value)} style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textTransform: 'uppercase' }} placeholder="26000UK7L" />
        </label>
        {number && problem ? <div style={{ color: 'var(--red)', fontSize: 12 }}>{problem}</div> : null}
        {warning ? <div style={{ color: 'var(--yellow)', fontSize: 12 }}>{warning}</div> : null}
        {error ? <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div> : null}
      </div>
      <div className="tw-modal-actions">
        <button type="button" style={secondaryButtonStyle} onClick={onClose} disabled={busy !== null}>Batal</button>
        {slip.status === 'reported' && slip.export_batch_id ? (
          <button type="button" style={{ ...secondaryButtonStyle, color: 'var(--yellow)' }} disabled={busy !== null} onClick={() => void clear()}>{busy === 'clear' ? 'Menghapus…' : 'Hapus nomor'}</button>
        ) : null}
        <button type="button" style={primaryButtonStyle} disabled={busy !== null || Boolean(problem) || unchanged} onClick={() => void save()}>{busy === 'save' ? 'Menyimpan…' : 'Simpan'}</button>
      </div>
    </ModalShell>
  );
}

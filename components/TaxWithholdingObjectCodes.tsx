'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { listTaxObjectCodes, saveTaxObjectCode, type TaxObjectCodeRecord } from '@/lib/tax-withholding-actions';
import { OBJECT_CODE_PREFIX_ARTICLES, TAX_ARTICLES, TAX_ARTICLE_LABELS, normalizeObjectCode, type TaxArticle } from '@/lib/tax-withholding-domain';
import {
  LoadError, ModalShell, StatusPill, SummaryCard, cellStyle, errorText, formatDateTime, headCellStyle, inputStyle, labelStyle,
  numberCellStyle, primaryButtonStyle, secondaryButtonStyle, type Notify,
} from '@/components/TaxWithholdingShared';

type CodeForm = {
  mode: 'create' | 'update';
  code: string;
  name: string;
  pphArticle: TaxArticle | '';
  ratePercent: string;
  kap: string;
  kjs: string;
  legalBasis: string;
  description: string;
  isActive: boolean;
};

const EMPTY_FORM: CodeForm = { mode: 'create', code: '', name: '', pphArticle: '', ratePercent: '', kap: '', kjs: '', legalBasis: '', description: '', isActive: true };

const formatRate = (value: number) => `${value.toLocaleString('id-ID', { maximumFractionDigits: 3 })}%`;

/** Suggest the pasal from the Coretax code prefix once it is unambiguous. */
function articleForCode(code: string): TaxArticle | null {
  const normalized = normalizeObjectCode(code);
  if (!normalized) return null;
  const allowed = OBJECT_CODE_PREFIX_ARTICLES[normalized.slice(0, 2)];
  return allowed && allowed.length === 1 ? allowed[0] : null;
}

export function ObjectCodesSection({ canManage, notify }: { canManage: boolean; notify: Notify }) {
  const [rows, setRows] = useState<TaxObjectCodeRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [article, setArticle] = useState<TaxArticle | 'all'>('all');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<CodeForm | null>(null);
  const initialForm = useRef('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async () => {
    setLoadError(null);
    try {
      setRows(await listTaxObjectCodes());
    } catch (error) {
      setLoadError(errorText(error));
    }
  };
  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (rows ?? []).filter((row) =>
      (showInactive || row.is_active)
      && (article === 'all' || row.pph_article === article)
      && (!needle || row.code.includes(needle) || row.name.toLowerCase().includes(needle) || (row.description ?? '').toLowerCase().includes(needle)));
  }, [rows, search, article, showInactive]);

  const counts = useMemo(() => {
    const all = rows ?? [];
    const active = all.filter((row) => row.is_active);
    return { active: active.length, inactive: all.length - active.length, described: active.filter((row) => row.description).length };
  }, [rows]);

  const beginEditing = (value: CodeForm) => { initialForm.current = JSON.stringify(value); setFormError(null); setEditing(value); };
  const openNew = () => beginEditing({ ...EMPTY_FORM, pphArticle: article === 'all' ? '' : article });
  const openEdit = (row: TaxObjectCodeRecord) => beginEditing({
    mode: 'update', code: row.code, name: row.name, pphArticle: row.pph_article, ratePercent: String(row.rate_percent),
    kap: row.kap ?? '', kjs: row.kjs ?? '', legalBasis: row.legal_basis ?? '', description: row.description ?? '', isActive: row.is_active,
  });

  const updateCode = (code: string) => {
    if (!editing) return;
    const suggested = articleForCode(code);
    setEditing({ ...editing, code, pphArticle: editing.pphArticle || (suggested ?? '') });
  };

  const submit = async () => {
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    try {
      const saved = await saveTaxObjectCode({
        mode: editing.mode, code: editing.code, name: editing.name, pphArticle: editing.pphArticle, ratePercent: editing.ratePercent,
        kap: editing.kap, kjs: editing.kjs, legalBasis: editing.legalBasis, description: editing.description, isActive: editing.isActive,
      });
      notify({ type: 'success', text: editing.mode === 'create' ? `Kode objek ${saved.code} ditambahkan.` : `Kode objek ${saved.code} diperbarui.` });
      setEditing(null);
      setRows((current) => {
        const others = (current ?? []).filter((row) => row.code !== saved.code);
        return [...others, saved].sort((a, b) => a.code.localeCompare(b.code));
      });
    } catch (error) {
      setFormError(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <LoadError message={loadError} onRetry={() => void load()} />;

  return (
    <section className="tw-section">
      <div className="tw-toolbar">
        <div>
          <div style={{ fontSize: 15, fontWeight: 750 }}>Referensi kode objek pajak Coretax</div>
          <div style={{ color: 'var(--dim)', fontSize: 12, marginTop: 2, maxWidth: 640 }}>
            Daftar bersama untuk semua workspace. Kode baru dari lampiran PER DJP bisa ditambahkan di sini tanpa rilis aplikasi;
            deskripsi menjelaskan cakupan kode saat memilih di form bukti potong.
          </div>
        </div>
        {canManage ? (
          <div className="tw-toolbar-actions"><button type="button" style={primaryButtonStyle} onClick={openNew}>+ Tambah kode</button></div>
        ) : null}
      </div>

      <div className="tw-summary-grid">
        <SummaryCard label="Kode aktif" value={counts.active} hint="Dipilih di form bukti potong" />
        <SummaryCard label="Dengan deskripsi" value={counts.described} hint="Dari kode aktif" />
        <SummaryCard label="Nonaktif" value={counts.inactive} hint="Tidak muncul di form" />
      </div>

      <div className="tw-filter">
        <input
          type="search" className="tw-search" style={inputStyle} value={search} aria-label="Cari kode objek"
          placeholder="Cari kode, nama, atau deskripsi…" onChange={(event) => setSearch(event.target.value)}
        />
        <select style={inputStyle} value={article} aria-label="Filter pasal" onChange={(event) => setArticle(event.target.value as TaxArticle | 'all')}>
          <option value="all">Semua pasal</option>
          {TAX_ARTICLES.map((item) => <option key={item} value={item}>{TAX_ARTICLE_LABELS[item]}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Tampilkan nonaktif
        </label>
      </div>

      {rows === null ? (
        <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>Memuat kode objek…</div>
      ) : visible.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
          {rows.length === 0 ? 'Referensi kode objek masih kosong.' : 'Tidak ada kode yang cocok dengan filter.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={headCellStyle}>Kode</th>
                <th style={headCellStyle}>Nama objek pajak</th>
                <th style={headCellStyle}>Pasal</th>
                <th style={{ ...headCellStyle, textAlign: 'right' }}>Tarif</th>
                <th style={headCellStyle}>KAP / KJS</th>
                <th style={headCellStyle}>Status</th>
                {canManage ? <th style={headCellStyle}>Aksi</th> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.code} style={{ opacity: row.is_active ? 1 : 0.6 }}>
                  <td style={cellStyle}><span className="tw-mono">{row.code}</span></td>
                  <td style={{ ...cellStyle, minWidth: 280 }}>
                    <div>{row.name}</div>
                    {row.description ? <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3, whiteSpace: 'pre-wrap' }}>{row.description}</div> : null}
                    {row.legal_basis ? <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 3 }}>Dasar: {row.legal_basis}</div> : null}
                  </td>
                  <td style={cellStyle}><StatusPill tone="accent">{TAX_ARTICLE_LABELS[row.pph_article]}</StatusPill></td>
                  <td style={numberCellStyle}>{formatRate(row.rate_percent)}</td>
                  <td style={cellStyle}><span className="tw-mono">{row.kap && row.kjs ? `${row.kap} / ${row.kjs}` : '—'}</span></td>
                  <td style={cellStyle}>
                    <StatusPill tone={row.is_active ? 'green' : 'muted'}>{row.is_active ? 'Aktif' : 'Nonaktif'}</StatusPill>
                    <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 4 }}>{formatDateTime(row.updated_at)}</div>
                  </td>
                  {canManage ? (
                    <td style={cellStyle}><button type="button" className="tw-action-button" style={{ color: 'var(--accent)' }} onClick={() => openEdit(row)}>Edit</button></td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <ModalShell
          title={editing.mode === 'create' ? 'Tambah kode objek' : `Edit kode objek ${editing.code}`}
          subtitle="Perubahan berlaku untuk bukti potong baru; bukti potong yang sudah ada tetap memakai tarif yang tersimpan."
          onClose={() => setEditing(null)} busy={saving} dirty={JSON.stringify(editing) !== initialForm.current}
        >
          <div className="tw-modal-body">
            <div className="tw-grid-2">
              <label style={labelStyle}>Kode objek (Coretax)
                <input style={inputStyle} value={editing.code} disabled={editing.mode === 'update'} placeholder="24-104-24" onChange={(event) => updateCode(event.target.value)} />
              </label>
              <label style={labelStyle}>Pasal PPh
                <select style={inputStyle} value={editing.pphArticle} onChange={(event) => setEditing({ ...editing, pphArticle: event.target.value as TaxArticle | '' })}>
                  <option value="">Pilih pasal…</option>
                  {TAX_ARTICLES.map((item) => <option key={item} value={item}>{TAX_ARTICLE_LABELS[item]}</option>)}
                </select>
              </label>
              <label style={labelStyle} className="tw-span-2">Nama objek pajak (sesuai lampiran PER)
                <input style={inputStyle} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
              </label>
              <label style={labelStyle}>Tarif dasar (%)
                <input style={inputStyle} inputMode="decimal" value={editing.ratePercent} placeholder="2" onChange={(event) => setEditing({ ...editing, ratePercent: event.target.value })} />
              </label>
              <label style={labelStyle}>Dasar hukum
                <input style={inputStyle} value={editing.legalBasis} placeholder="PER-12/PJ/2026" onChange={(event) => setEditing({ ...editing, legalBasis: event.target.value })} />
              </label>
              <label style={labelStyle}>KAP (6 digit)
                <input style={inputStyle} inputMode="numeric" value={editing.kap} placeholder="411124" onChange={(event) => setEditing({ ...editing, kap: event.target.value })} />
              </label>
              <label style={labelStyle}>KJS (3 digit)
                <input style={inputStyle} inputMode="numeric" value={editing.kjs} placeholder="104" onChange={(event) => setEditing({ ...editing, kjs: event.target.value })} />
              </label>
              <label style={labelStyle} className="tw-span-2">Deskripsi dan cakupan
                <textarea
                  style={{ ...inputStyle, minHeight: 96, resize: 'vertical' }} value={editing.description}
                  placeholder="Definisi dari PMK 141/2015, contoh transaksi yang termasuk, dan yang dikecualikan."
                  onChange={(event) => setEditing({ ...editing, description: event.target.value })}
                />
              </label>
              {editing.mode === 'update' ? (
                <label style={{ ...labelStyle, alignContent: 'end' }} className="tw-span-2">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 40 }}>
                    <input type="checkbox" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} /> Aktif (muncul di form bukti potong)
                  </span>
                </label>
              ) : null}
            </div>
            {formError ? <div style={{ color: 'var(--red)', fontSize: 13 }}>{formError}</div> : null}
          </div>
          <div className="tw-modal-actions">
            <button type="button" style={secondaryButtonStyle} data-dialog-close disabled={saving}>Batal</button>
            <button type="button" style={primaryButtonStyle} onClick={() => void submit()} disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
          </div>
        </ModalShell>
      ) : null}
    </section>
  );
}

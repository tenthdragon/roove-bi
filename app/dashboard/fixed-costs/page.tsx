'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createFixedCostCategory,
  deleteFixedCost,
  deleteSingleMonthlyOverhead,
  getFixedCostBootstrap,
  saveFixedCost,
  saveSingleMonthlyOverhead,
  setFixedCostMode,
  type FixedCostInput,
  type FixedCostMode,
  type FixedCostRecurrence,
} from '@/lib/fixed-cost-actions';
import { invalidateAll } from '@/lib/dashboard-cache';
import { useWorkspace } from '@/lib/WorkspaceContext';

type Category = {
  id: number;
  name: string;
  description: string | null;
};

type FixedCost = {
  id: number;
  category_id: number | null;
  name: string;
  amount: number;
  quantity: number;
  cost_unit: string;
  recurrence_unit: FixedCostRecurrence;
  recurrence_interval: number;
  start_date: string;
  end_date: string | null;
  due_day: number | null;
  notes: string | null;
  is_active: boolean;
  monthly_equivalent: number;
};

type MonthlyOverhead = {
  id: number;
  year_month: string;
  amount: number;
  updated_at: string;
};

const currentYearMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const formatYearMonth = (yearMonth: string) => {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
  });
};

const EMPTY_FORM: FixedCostInput = {
  name: '',
  categoryId: null,
  amount: 0,
  quantity: 1,
  costUnit: 'unit',
  recurrenceUnit: 'monthly',
  recurrenceInterval: 1,
  startDate: new Date().toISOString().slice(0, 10),
  endDate: null,
  dueDay: null,
  notes: '',
  isActive: true,
};

const RECURRENCE_LABELS: Record<FixedCostRecurrence, string> = {
  daily: 'Hari',
  weekly: 'Minggu',
  monthly: 'Bulan',
  quarterly: 'Kuartal',
  yearly: 'Tahun',
};

const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

const inputStyle = {
  width: '100%',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--input-bg)',
  color: 'var(--text)',
  padding: '10px 12px',
  fontSize: 13,
} as const;

const labelStyle = {
  display: 'grid',
  gap: 6,
  color: 'var(--text-secondary)',
  fontSize: 12,
  fontWeight: 600,
} as const;

export default function FixedCostsPage() {
  const { activeWorkspace, updateActiveWorkspaceSettings } = useWorkspace();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<FixedCost[]>([]);
  const [monthlyOverhead, setMonthlyOverhead] = useState<MonthlyOverhead[]>([]);
  const [costModel, setCostModel] = useState<FixedCostMode>(
    activeWorkspace.settings.cost_model === 'legacy_monthly_overhead'
      ? 'legacy_monthly_overhead'
      : 'detailed_fixed_costs',
  );
  const [form, setForm] = useState<FixedCostInput>(EMPTY_FORM);
  const [singleForm, setSingleForm] = useState({
    yearMonth: currentYearMonth(),
    amount: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const [singleSaving, setSingleSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getFixedCostBootstrap();
      setCategories(data.categories as Category[]);
      setItems(data.items as FixedCost[]);
      const overheadRows = data.monthlyOverhead as MonthlyOverhead[];
      setMonthlyOverhead(overheadRows);
      setSingleForm((current) => {
        const selected = overheadRows.find((row) => row.year_month === current.yearMonth);
        return { ...current, amount: selected ? String(selected.amount) : current.amount };
      });
      setCostModel(data.costModel);
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal memuat fixed costs.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSingleForm({ yearMonth: currentYearMonth(), amount: '' });
    load();
  }, [activeWorkspace.id]);

  const activeItems = useMemo(() => {
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthStart = [
      currentMonthStart.getFullYear(),
      String(currentMonthStart.getMonth() + 1).padStart(2, '0'),
      '01',
    ].join('-');
    const nextMonth = [
      nextMonthStart.getFullYear(),
      String(nextMonthStart.getMonth() + 1).padStart(2, '0'),
      '01',
    ].join('-');

    return items.filter(
      (item) =>
        item.is_active
        && item.start_date < nextMonth
        && (!item.end_date || item.end_date >= monthStart),
    );
  }, [items]);
  const activeMonthly = useMemo(
    () => activeItems.reduce((sum, item) => sum + Number(item.monthly_equivalent || 0), 0),
    [activeItems],
  );
  const currentMonthRow = monthlyOverhead.find(
    (row) => row.year_month === currentYearMonth(),
  );
  const currentMonthOverhead = currentMonthRow?.amount || 0;
  const selectedMonthlyOverhead = monthlyOverhead.find(
    (row) => row.year_month === singleForm.yearMonth,
  );
  const displayedMonthly = costModel === 'detailed_fixed_costs'
    ? activeMonthly
    : currentMonthOverhead;
  const annualRunRate = displayedMonthly * 12;

  const resetForm = () => setForm({
    ...EMPTY_FORM,
    startDate: new Date().toISOString().slice(0, 10),
  });

  const changeMode = async (mode: FixedCostMode) => {
    if (mode === costModel || modeSaving) return;
    setModeSaving(true);
    setMessage(null);
    try {
      await setFixedCostMode(mode);
      setCostModel(mode);
      updateActiveWorkspaceSettings({ cost_model: mode });
      invalidateAll();
      setMessage({
        type: 'success',
        text: mode === 'detailed_fixed_costs'
          ? 'Mode rincian biaya diaktifkan.'
          : 'Mode angka bulanan tunggal diaktifkan.',
      });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal mengganti mode fixed cost.' });
    } finally {
      setModeSaving(false);
    }
  };

  const selectOverheadMonth = (yearMonth: string) => {
    const row = monthlyOverhead.find((item) => item.year_month === yearMonth);
    setSingleForm({
      yearMonth,
      amount: row ? String(row.amount) : '',
    });
  };

  const saveMonthlyOverhead = async (event: React.FormEvent) => {
    event.preventDefault();
    setSingleSaving(true);
    setMessage(null);
    try {
      await saveSingleMonthlyOverhead({
        yearMonth: singleForm.yearMonth,
        amount: Number(singleForm.amount),
      });
      invalidateAll();
      setMessage({ type: 'success', text: `Overhead ${singleForm.yearMonth} berhasil disimpan.` });
      await load();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menyimpan overhead.' });
    } finally {
      setSingleSaving(false);
    }
  };

  const removeMonthlyOverhead = async (row: MonthlyOverhead) => {
    if (!window.confirm(`Hapus overhead ${row.year_month}?`)) return;
    try {
      await deleteSingleMonthlyOverhead(row.id);
      invalidateAll();
      if (singleForm.yearMonth === row.year_month) {
        setSingleForm((current) => ({ ...current, amount: '' }));
      }
      setMessage({ type: 'success', text: `Overhead ${row.year_month} dihapus.` });
      await load();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menghapus overhead.' });
    }
  };

  const editItem = (item: FixedCost) => {
    setForm({
      id: item.id,
      categoryId: item.category_id,
      name: item.name,
      amount: item.amount,
      quantity: item.quantity,
      costUnit: item.cost_unit,
      recurrenceUnit: item.recurrence_unit,
      recurrenceInterval: item.recurrence_interval,
      startDate: item.start_date,
      endDate: item.end_date,
      dueDay: item.due_day,
      notes: item.notes,
      isActive: item.is_active,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await saveFixedCost(form);
      invalidateAll();
      setMessage({ type: 'success', text: form.id ? 'Fixed cost diperbarui.' : 'Fixed cost ditambahkan.' });
      resetForm();
      await load();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menyimpan fixed cost.' });
    } finally {
      setSaving(false);
    }
  };

  const addCategory = async () => {
    const name = window.prompt('Nama kategori fixed cost baru:')?.trim();
    if (!name) return;
    try {
      const category = await createFixedCostCategory(name);
      setCategories((current) => [...current, category as Category]);
      setForm((current) => ({ ...current, categoryId: Number(category.id) }));
      setMessage({ type: 'success', text: `Kategori “${name}” ditambahkan.` });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menambahkan kategori.' });
    }
  };

  const remove = async (item: FixedCost) => {
    if (!window.confirm(`Hapus fixed cost “${item.name}”?`)) return;
    try {
      await deleteFixedCost(item.id);
      invalidateAll();
      if (form.id === item.id) resetForm();
      await load();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menghapus fixed cost.' });
    }
  };

  const categoryName = (categoryId: number | null) =>
    categories.find((category) => category.id === categoryId)?.name || 'Tanpa kategori';

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 1440, margin: '0 auto' }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700, marginBottom: 5 }}>
          {activeWorkspace.name}
        </div>
        <h1 style={{ margin: 0, fontSize: 24 }}>Fixed & Recurring Costs</h1>
        <p style={{ margin: '7px 0 0', color: 'var(--dim)', fontSize: 13 }}>
          Pilih perhitungan dari rincian biaya atau gunakan satu angka overhead untuk setiap bulan.
        </p>
      </div>

      <div style={{ padding: 18, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--card)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Mode perhitungan overhead</div>
          <div style={{ marginTop: 4, color: 'var(--dim)', fontSize: 12 }}>
            Mode aktif langsung dipakai di Overview dan analisis profit.
          </div>
        </div>
        <div role="radiogroup" aria-label="Mode perhitungan overhead" style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 10, background: 'var(--input-bg)', border: '1px solid var(--border)' }}>
          {([
            ['detailed_fixed_costs', 'Perinci semuanya'],
            ['legacy_monthly_overhead', 'Angka tunggal'],
          ] as const).map(([mode, label]) => {
            const selected = costModel === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={loading || modeSaving}
                onClick={() => changeMode(mode)}
                style={{ border: 0, borderRadius: 7, padding: '9px 14px', background: selected ? 'var(--accent)' : 'transparent', color: selected ? '#fff' : 'var(--text-secondary)', cursor: loading || modeSaving ? 'wait' : 'pointer', fontSize: 12, fontWeight: 700, opacity: loading || modeSaving ? 0.7 : 1 }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {message ? (
        <div role="status" style={{ padding: '10px 12px', borderRadius: 8, fontSize: 13, background: message.type === 'success' ? 'var(--green-subtle)' : 'var(--red-subtle)', color: message.type === 'success' ? 'var(--green)' : 'var(--red)' }}>
          {message.text}
        </div>
      ) : null}

      {costModel === 'detailed_fixed_costs' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            {[
              ['Estimasi per bulan', rupiah.format(activeMonthly), 'var(--accent)'],
              ['Annual run rate', rupiah.format(annualRunRate), 'var(--green)'],
              ['Cost aktif', `${activeItems.length} item`, 'var(--yellow)'],
              ['Total terdaftar', `${items.length} item`, 'var(--text-secondary)'],
            ].map(([label, value, color]) => (
              <div key={label} style={{ padding: 18, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card)' }}>
                <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>{label}</div>
                <div style={{ fontSize: 21, fontWeight: 750, color }}>{value}</div>
              </div>
            ))}
          </div>

          <form onSubmit={submit} style={{ padding: 20, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--card)', display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{form.id ? 'Edit fixed cost' : 'Tambah fixed cost'}</div>
                <div style={{ color: 'var(--dim)', fontSize: 12, marginTop: 3 }}>Satu baris untuk satu jenis pengeluaran rutin.</div>
              </div>
              {form.id ? (
                <button type="button" onClick={resetForm} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer' }}>
                  Batal edit
                </button>
              ) : null}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
              <label style={{ ...labelStyle, gridColumn: 'span 2' }}>
                Nama pengeluaran
                <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Contoh: Gaji tim customer service" style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Kategori
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={form.categoryId || ''} onChange={(event) => setForm({ ...form, categoryId: event.target.value ? Number(event.target.value) : null })} style={inputStyle}>
                    <option value="">Tanpa kategori</option>
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                  <button type="button" onClick={addCategory} title="Tambah kategori" style={{ width: 42, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--input-bg)', color: 'var(--accent)', cursor: 'pointer', fontSize: 20 }}>+</button>
                </div>
              </label>
              <label style={labelStyle}>
                Nominal per unit
                <input required type="number" min="0" value={form.amount} onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Jumlah unit
                <input required type="number" min="0.01" step="0.01" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Satuan biaya
                <input required value={form.costUnit} onChange={(event) => setForm({ ...form, costUnit: event.target.value })} placeholder="orang, akun, kantor, unit" style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Frekuensi
                <select value={form.recurrenceUnit} onChange={(event) => setForm({ ...form, recurrenceUnit: event.target.value as FixedCostRecurrence })} style={inputStyle}>
                  {Object.entries(RECURRENCE_LABELS).map(([value, label]) => <option key={value} value={value}>Setiap {label.toLowerCase()}</option>)}
                </select>
              </label>
              <label style={labelStyle}>
                Setiap berapa periode
                <input required type="number" min="1" step="1" value={form.recurrenceInterval} onChange={(event) => setForm({ ...form, recurrenceInterval: Number(event.target.value) })} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Mulai berlaku
                <input required type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Berakhir (opsional)
                <input type="date" value={form.endDate || ''} onChange={(event) => setForm({ ...form, endDate: event.target.value || null })} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Tanggal jatuh tempo
                <input type="number" min="1" max="31" value={form.dueDay || ''} onChange={(event) => setForm({ ...form, dueDay: event.target.value ? Number(event.target.value) : null })} placeholder="1–31" style={inputStyle} />
              </label>
              <label style={{ ...labelStyle, gridColumn: 'span 2' }}>
                Catatan
                <input value={form.notes || ''} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Vendor, PIC, nomor kontrak, atau informasi lain" style={inputStyle} />
              </label>
            </div>

            <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={form.isActive !== false} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
              Aktif dan diperhitungkan sebagai overhead
            </label>

            <button disabled={saving} type="submit" style={{ justifySelf: 'start', border: 0, borderRadius: 8, padding: '10px 18px', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.65 : 1 }}>
              {saving ? 'Menyimpan…' : form.id ? 'Simpan perubahan' : 'Tambah fixed cost'}
            </button>
          </form>

          <div style={{ borderRadius: 14, border: '1px solid var(--border)', background: 'var(--card)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>Rincian biaya</div>
            {loading ? (
              <div style={{ padding: 36, textAlign: 'center', color: 'var(--dim)' }}>Memuat fixed costs…</div>
            ) : items.length === 0 ? (
              <div style={{ padding: 44, textAlign: 'center', color: 'var(--dim)' }}>
                Belum ada fixed cost. Tambahkan rincian pertama melalui formulir di atas.
              </div>
            ) : (
              <div className="table-scroll">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960, fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: 'var(--dim)', textAlign: 'left' }}>
                      {['Pengeluaran', 'Kategori', 'Perhitungan', 'Frekuensi', 'Mulai', 'Estimasi / bulan', 'Status', ''].map((title) => (
                        <th key={title} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{title}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} style={{ opacity: item.is_active ? 1 : 0.55 }}>
                        <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', fontWeight: 650 }}>
                          {item.name}
                          {item.notes ? <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 3, fontWeight: 400 }}>{item.notes}</div> : null}
                        </td>
                        <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{categoryName(item.category_id)}</td>
                        <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)' }}>{item.quantity} {item.cost_unit} × {rupiah.format(item.amount)}</td>
                        <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)' }}>Setiap {item.recurrence_interval > 1 ? `${item.recurrence_interval} ` : ''}{RECURRENCE_LABELS[item.recurrence_unit].toLowerCase()}</td>
                        <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)' }}>{item.start_date}</td>
                        <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', fontWeight: 700, color: 'var(--accent)' }}>{rupiah.format(item.monthly_equivalent)}</td>
                        <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ padding: '4px 8px', borderRadius: 999, background: item.is_active ? 'var(--green-subtle)' : 'var(--input-bg)', color: item.is_active ? 'var(--green)' : 'var(--dim)', fontSize: 11 }}>
                            {item.is_active ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </td>
                        <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                          <button onClick={() => editItem(item)} style={{ border: 0, background: 'transparent', color: 'var(--accent)', cursor: 'pointer', marginRight: 10 }}>Edit</button>
                          <button onClick={() => remove(item)} style={{ border: 0, background: 'transparent', color: 'var(--red)', cursor: 'pointer' }}>Hapus</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            {[
              ['Overhead bulan ini', rupiah.format(currentMonthOverhead), 'var(--accent)'],
              ['Annual run rate', rupiah.format(annualRunRate), 'var(--green)'],
              ['Bulan tersimpan', `${monthlyOverhead.length} bulan`, 'var(--yellow)'],
              ['Status bulan ini', currentMonthRow ? 'Sudah diisi' : 'Belum diisi', currentMonthRow ? 'var(--green)' : 'var(--red)'],
            ].map(([label, value, color]) => (
              <div key={label} style={{ padding: 18, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card)' }}>
                <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>{label}</div>
                <div style={{ fontSize: 21, fontWeight: 750, color }}>{value}</div>
              </div>
            ))}
          </div>

          <form onSubmit={saveMonthlyOverhead} style={{ padding: 20, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--card)', display: 'grid', gap: 16 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Angka overhead bulanan</div>
              <div style={{ color: 'var(--dim)', fontSize: 12, marginTop: 3 }}>
                Masukkan satu angka total. Nilai bulan yang sudah ada akan diperbarui.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, maxWidth: 720 }}>
              <label style={labelStyle}>
                Bulan
                <input required type="month" value={singleForm.yearMonth} onChange={(event) => selectOverheadMonth(event.target.value)} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Total overhead (Rp)
                <input required type="number" min="0" step="1" value={singleForm.amount} onChange={(event) => setSingleForm({ ...singleForm, amount: event.target.value })} placeholder="Contoh: 250000000" style={inputStyle} />
              </label>
            </div>
            {selectedMonthlyOverhead ? (
              <div style={{ color: 'var(--dim)', fontSize: 12 }}>
                Nilai tersimpan untuk {formatYearMonth(singleForm.yearMonth)}: <strong style={{ color: 'var(--text-secondary)' }}>{rupiah.format(selectedMonthlyOverhead.amount)}</strong>
              </div>
            ) : null}
            <button disabled={singleSaving} type="submit" style={{ justifySelf: 'start', border: 0, borderRadius: 8, padding: '10px 18px', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: singleSaving ? 'wait' : 'pointer', opacity: singleSaving ? 0.65 : 1 }}>
              {singleSaving ? 'Menyimpan…' : 'Simpan angka overhead'}
            </button>
          </form>

          <div style={{ borderRadius: 14, border: '1px solid var(--border)', background: 'var(--card)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>Riwayat overhead bulanan</div>
            {loading ? (
              <div style={{ padding: 36, textAlign: 'center', color: 'var(--dim)' }}>Memuat overhead…</div>
            ) : monthlyOverhead.length === 0 ? (
              <div style={{ padding: 44, textAlign: 'center', color: 'var(--dim)' }}>
                Belum ada angka overhead. Isi bulan pertama melalui formulir di atas.
              </div>
            ) : (
              <div className="table-scroll">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620, fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: 'var(--dim)', textAlign: 'left' }}>
                      {['Bulan', 'Total overhead', 'Estimasi per hari', ''].map((title) => (
                        <th key={title} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{title}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyOverhead.map((row) => {
                      const [year, month] = row.year_month.split('-').map(Number);
                      const daysInMonth = new Date(year, month, 0).getDate();
                      return (
                        <tr key={row.id}>
                          <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', fontWeight: 650 }}>{formatYearMonth(row.year_month)}</td>
                          <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', fontWeight: 700, color: 'var(--accent)' }}>{rupiah.format(row.amount)}</td>
                          <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{rupiah.format(row.amount / daysInMonth)} / hari</td>
                          <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            <button type="button" onClick={() => selectOverheadMonth(row.year_month)} style={{ border: 0, background: 'transparent', color: 'var(--accent)', cursor: 'pointer', marginRight: 10 }}>Edit</button>
                            <button type="button" onClick={() => removeMonthlyOverhead(row)} style={{ border: 0, background: 'transparent', color: 'var(--red)', cursor: 'pointer' }}>Hapus</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, color: 'var(--dim)', fontSize: 12, lineHeight: 1.6 }}>
        Berpindah mode tidak menghapus data. Rincian biaya dan angka bulanan tetap tersimpan, tetapi hanya mode yang aktif yang dipakai dalam perhitungan dashboard.
      </div>
    </div>
  );
}

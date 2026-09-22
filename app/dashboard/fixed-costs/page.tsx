'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
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

type Category = { id: number; name: string; description: string | null };
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
type MonthlyOverhead = { id: number; year_month: string; amount: number; updated_at: string };
type PageMessage = { type: 'success' | 'error'; text: string };
type DeleteTarget =
  | { type: 'fixed-cost'; item: FixedCost }
  | { type: 'monthly-overhead'; row: MonthlyOverhead };

const currentYearMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const shiftYearMonth = (yearMonth: string, offset: number) => {
  const [year, month] = yearMonth.split('-').map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const formatYearMonth = (yearMonth: string) => {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
};

const formatDate = (date: string | null) => {
  if (!date) return 'Tanpa batas';
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
};

const daysInYearMonth = (yearMonth: string) => {
  const [year, month] = yearMonth.split('-').map(Number);
  return year && month ? new Date(year, month, 0).getDate() : 30;
};

const parseCurrencyInput = (value: string) => value.replace(/\D/g, '');
const formatNumberInput = (value: string | number) => {
  const digits = parseCurrencyInput(String(value));
  return digits ? new Intl.NumberFormat('id-ID').format(Number(digits)) : '';
};

const EMPTY_FORM: FixedCostInput = {
  name: '', categoryId: null, amount: 0, quantity: 1, costUnit: 'unit',
  recurrenceUnit: 'monthly', recurrenceInterval: 1,
  startDate: new Date().toISOString().slice(0, 10), endDate: null,
  dueDay: null, notes: '', isActive: true,
};

const RECURRENCE_LABELS: Record<FixedCostRecurrence, string> = {
  daily: 'Hari', weekly: 'Minggu', monthly: 'Bulan', quarterly: 'Kuartal', yearly: 'Tahun',
};

const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
});

const inputStyle = {
  width: '100%', border: '1px solid var(--border)', borderRadius: 8,
  background: 'var(--input-bg)', color: 'var(--text)', padding: '10px 12px',
  fontSize: 13, boxSizing: 'border-box',
} as const;
const labelStyle = {
  display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
} as const;
const secondaryButtonStyle = {
  border: '1px solid var(--border)', borderRadius: 8, padding: '9px 14px',
  color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer', fontWeight: 650,
} as const;
const primaryButtonStyle = {
  border: 0, borderRadius: 8, padding: '10px 16px', background: 'var(--accent)',
  color: '#fff', fontWeight: 700, cursor: 'pointer',
} as const;

function calculateMonthlyEquivalent(form: FixedCostInput) {
  const factor = { daily: 365 / 12, weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[form.recurrenceUnit];
  return Number(form.amount || 0) * Number(form.quantity || 0) * factor
    / Math.max(Number(form.recurrenceInterval || 1), 1);
}

function ModalShell({ title, subtitle, onClose, maxWidth = 560, children }: {
  title: string; subtitle?: string; onClose: () => void; maxWidth?: number; children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      const preferred = dialogRef.current?.querySelector<HTMLElement>('[autofocus]')
        || dialogRef.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
        || dialogRef.current?.querySelector<HTMLElement>('button:not([disabled])');
      (preferred || dialogRef.current)?.focus();
    }, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]',
        )).filter((element) => element.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="fc-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        tabIndex={-1} className="fc-modal-panel" style={{ maxWidth }}>
        <div className="fc-modal-header">
          <div>
            <div id={titleId} style={{ fontSize: 16, fontWeight: 750 }}>{title}</div>
            {subtitle ? <div style={{ marginTop: 4, color: 'var(--dim)', fontSize: 12 }}>{subtitle}</div> : null}
          </div>
          <button type="button" onClick={onClose} className="fc-close-button" aria-label="Tutup dialog">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, context, color }: {
  label: string; value: string; context?: string; color?: string;
}) {
  return (
    <div className="fc-summary-card">
      <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 750, color: color || 'var(--text)' }}>{value}</div>
      {context ? <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 5 }}>{context}</div> : null}
    </div>
  );
}

export default function FixedCostsPage() {
  const { activeWorkspace, updateActiveWorkspaceSettings } = useWorkspace();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<FixedCost[]>([]);
  const [monthlyOverhead, setMonthlyOverhead] = useState<MonthlyOverhead[]>([]);
  const [costModel, setCostModel] = useState<FixedCostMode>(
    activeWorkspace.settings.cost_model === 'legacy_monthly_overhead'
      ? 'legacy_monthly_overhead' : 'detailed_fixed_costs',
  );
  const [form, setForm] = useState<FixedCostInput>(EMPTY_FORM);
  const [singleForm, setSingleForm] = useState({ yearMonth: currentYearMonth(), amount: '' });
  const [fixedCostModal, setFixedCostModal] = useState<'create' | 'edit' | null>(null);
  const [monthlyModal, setMonthlyModal] = useState<'create' | 'edit' | null>(null);
  const [pendingMode, setPendingMode] = useState<FixedCostMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const [singleSaving, setSingleSaving] = useState(false);
  const [categorySaving, setCategorySaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<PageMessage | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getFixedCostBootstrap();
      setCategories(data.categories as Category[]);
      setItems(data.items as FixedCost[]);
      setMonthlyOverhead(data.monthlyOverhead as MonthlyOverhead[]);
      setCostModel(data.costModel);
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal memuat fixed costs.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSingleForm({ yearMonth: currentYearMonth(), amount: '' });
    setFixedCostModal(null);
    setMonthlyModal(null);
    setPendingMode(null);
    setDeleteTarget(null);
    load();
  }, [activeWorkspace.id]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), message.type === 'success' ? 4500 : 7000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const activeItems = useMemo(() => {
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthStart = [currentMonthStart.getFullYear(), String(currentMonthStart.getMonth() + 1).padStart(2, '0'), '01'].join('-');
    const nextMonth = [nextMonthStart.getFullYear(), String(nextMonthStart.getMonth() + 1).padStart(2, '0'), '01'].join('-');
    return items.filter((item) => item.is_active && item.start_date < nextMonth
      && (!item.end_date || item.end_date >= monthStart));
  }, [items]);

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('id-ID');
    return items.filter((item) => {
      if (statusFilter === 'active' && !item.is_active) return false;
      if (statusFilter === 'inactive' && item.is_active) return false;
      if (categoryFilter !== 'all' && String(item.category_id || 'none') !== categoryFilter) return false;
      if (!query) return true;
      const category = categories.find((candidate) => candidate.id === item.category_id)?.name || 'Tanpa kategori';
      return `${item.name} ${item.notes || ''} ${category}`.toLocaleLowerCase('id-ID').includes(query);
    });
  }, [items, categories, statusFilter, categoryFilter, searchQuery]);

  const activeMonthly = useMemo(
    () => activeItems.reduce((sum, item) => sum + Number(item.monthly_equivalent || 0), 0),
    [activeItems],
  );
  const currentMonth = currentYearMonth();
  const currentMonthRow = monthlyOverhead.find((row) => row.year_month === currentMonth);
  const currentMonthOverhead = currentMonthRow?.amount || 0;
  const displayedMonthly = costModel === 'detailed_fixed_costs' ? activeMonthly : currentMonthOverhead;
  const annualRunRate = displayedMonthly * 12;
  const currentYear = String(new Date().getFullYear());
  const storedMonthsThisYear = monthlyOverhead.filter((row) => row.year_month.startsWith(`${currentYear}-`)).length;
  const modalMonthlyRow = monthlyOverhead.find((row) => row.year_month === singleForm.yearMonth);
  const monthlyDailyPreview = Number(singleForm.amount || 0) / daysInYearMonth(singleForm.yearMonth);
  const fixedCostMonthlyPreview = calculateMonthlyEquivalent(form);

  const resetForm = () => {
    setForm({ ...EMPTY_FORM, startDate: new Date().toISOString().slice(0, 10) });
    setShowCategoryInput(false);
    setCategoryDraft('');
  };
  const closeFixedCostModal = () => {
    if (saving || categorySaving) return;
    setFixedCostModal(null);
    resetForm();
  };
  const openNewFixedCost = () => { resetForm(); setFixedCostModal('create'); };
  const editItem = (item: FixedCost) => {
    setForm({
      id: item.id, categoryId: item.category_id, name: item.name, amount: item.amount,
      quantity: item.quantity, costUnit: item.cost_unit, recurrenceUnit: item.recurrence_unit,
      recurrenceInterval: item.recurrence_interval, startDate: item.start_date,
      endDate: item.end_date, dueDay: item.due_day, notes: item.notes, isActive: item.is_active,
    });
    setShowCategoryInput(false);
    setCategoryDraft('');
    setFixedCostModal('edit');
  };

  const suggestedNewMonth = () => {
    const existing = new Set(monthlyOverhead.map((row) => row.year_month));
    let candidate = currentYearMonth();
    for (let index = 0; index < 24; index += 1) {
      if (!existing.has(candidate)) return candidate;
      candidate = shiftYearMonth(candidate, 1);
    }
    return currentYearMonth();
  };
  const openNewMonthlyOverhead = () => {
    setSingleForm({ yearMonth: suggestedNewMonth(), amount: '' });
    setMonthlyModal('create');
  };
  const editMonthlyOverhead = (row: MonthlyOverhead) => {
    setSingleForm({ yearMonth: row.year_month, amount: String(row.amount) });
    setMonthlyModal('edit');
  };

  const changeMode = async (mode: FixedCostMode) => {
    if (mode === costModel || modeSaving) return;
    setModeSaving(true);
    setMessage(null);
    try {
      await setFixedCostMode(mode);
      setCostModel(mode);
      updateActiveWorkspaceSettings({ cost_model: mode });
      invalidateAll();
      setPendingMode(null);
      setMessage({ type: 'success', text: mode === 'detailed_fixed_costs'
        ? 'Mode rincian biaya diaktifkan.' : 'Mode angka bulanan diaktifkan.' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal mengganti mode fixed cost.' });
    } finally {
      setModeSaving(false);
    }
  };

  const saveMonthlyOverhead = async (event: React.FormEvent) => {
    event.preventDefault();
    setSingleSaving(true);
    setMessage(null);
    try {
      await saveSingleMonthlyOverhead({ yearMonth: singleForm.yearMonth, amount: Number(singleForm.amount) });
      invalidateAll();
      const savedMonth = singleForm.yearMonth;
      setMonthlyModal(null);
      await load();
      setMessage({ type: 'success', text: `Overhead ${formatYearMonth(savedMonth)} berhasil disimpan.` });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menyimpan overhead.' });
    } finally {
      setSingleSaving(false);
    }
  };

  const submitFixedCost = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const isEdit = Boolean(form.id);
    try {
      await saveFixedCost(form);
      invalidateAll();
      setFixedCostModal(null);
      resetForm();
      await load();
      setMessage({ type: 'success', text: isEdit ? 'Fixed cost diperbarui.' : 'Fixed cost ditambahkan.' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menyimpan fixed cost.' });
    } finally {
      setSaving(false);
    }
  };

  const addCategory = async () => {
    const name = categoryDraft.trim();
    if (!name || categorySaving) return;
    setCategorySaving(true);
    setMessage(null);
    try {
      const category = await createFixedCostCategory(name);
      setCategories((current) => [...current, category as Category]);
      setForm((current) => ({ ...current, categoryId: Number(category.id) }));
      setCategoryDraft('');
      setShowCategoryInput(false);
      setMessage({ type: 'success', text: `Kategori “${name}” ditambahkan.` });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menambahkan kategori.' });
    } finally {
      setCategorySaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setMessage(null);
    try {
      if (deleteTarget.type === 'monthly-overhead') {
        await deleteSingleMonthlyOverhead(deleteTarget.row.id);
        setMessage({ type: 'success', text: `Overhead ${formatYearMonth(deleteTarget.row.year_month)} dihapus.` });
      } else {
        await deleteFixedCost(deleteTarget.item.id);
        setMessage({ type: 'success', text: `Fixed cost “${deleteTarget.item.name}” dihapus.` });
      }
      invalidateAll();
      setDeleteTarget(null);
      await load();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || (deleteTarget.type === 'monthly-overhead'
        ? 'Gagal menghapus overhead.' : 'Gagal menghapus fixed cost.') });
    } finally {
      setDeleting(false);
    }
  };

  const categoryName = (categoryId: number | null) =>
    categories.find((category) => category.id === categoryId)?.name || 'Tanpa kategori';
  const recurrenceText = (item: FixedCost) =>
    `Setiap ${item.recurrence_interval > 1 ? `${item.recurrence_interval} ` : ''}${RECURRENCE_LABELS[item.recurrence_unit].toLowerCase()}`;

  return (
    <div className="fixed-costs-page">
      <style>{`
        .fixed-costs-page{display:grid;gap:18px;max-width:1440px;margin:0 auto}
        .fixed-costs-page .fc-page-header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap}
        .fixed-costs-page .fc-mode-wrap{display:grid;justify-items:end;gap:6px}
        .fixed-costs-page .fc-mode-control{display:flex;gap:4px;padding:4px;border-radius:10px;background:var(--input-bg);border:1px solid var(--border)}
        .fixed-costs-page .fc-mode-button{border:0;border-radius:7px;padding:9px 14px;cursor:pointer;font-size:12px;font-weight:700;min-height:38px}
        .fixed-costs-page .fc-summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
        .fixed-costs-page .fc-summary-card{padding:18px;border-radius:12px;border:1px solid var(--border);background:var(--card);min-width:0}
        .fixed-costs-page .fc-section{border-radius:14px;border:1px solid var(--border);background:var(--card);overflow:hidden}
        .fixed-costs-page .fc-toolbar{padding:15px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:14px}
        .fixed-costs-page .fc-toolbar-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
        .fixed-costs-page .fc-filter{border:1px solid var(--border);border-radius:8px;background:var(--input-bg);color:var(--text);padding:9px 11px;min-height:38px;font-size:12px}
        .fixed-costs-page .fc-search{min-width:210px}
        .fixed-costs-page .fc-action-button{border:0;background:transparent;cursor:pointer;padding:8px;min-height:36px;font-weight:650}
        .fixed-costs-page .fc-current-row{background:var(--accent-subtle)}
        .fixed-costs-page .fc-status{display:inline-flex;padding:4px 8px;border-radius:999px;font-size:11px;white-space:nowrap}
        .fixed-costs-page .fc-mobile-list{display:none}
        .fixed-costs-page .fc-mobile-card{padding:15px;border-bottom:1px solid var(--border);display:grid;gap:11px}
        .fixed-costs-page .fc-mobile-card:last-child{border-bottom:0}
        .fixed-costs-page .fc-mobile-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        .fixed-costs-page .fc-mobile-actions{display:flex;gap:6px;padding-top:2px}
        .fixed-costs-page .fc-modal-backdrop{position:fixed;inset:0;z-index:1000;background:var(--overlay-bg);display:flex;align-items:center;justify-content:center;padding:18px}
        .fixed-costs-page .fc-modal-panel{width:100%;max-height:calc(100dvh - 36px);overflow:auto;background:var(--card);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);outline:none}
        .fixed-costs-page .fc-modal-header{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:17px 20px;border-bottom:1px solid var(--border);background:var(--card)}
        .fixed-costs-page .fc-close-button{width:36px;height:36px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:22px;line-height:1}
        .fixed-costs-page .fc-modal-body{padding:20px;display:grid;gap:16px}
        .fixed-costs-page .fc-modal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
        .fixed-costs-page .fc-span-2{grid-column:span 2}
        .fixed-costs-page .fc-modal-actions{position:sticky;bottom:0;z-index:2;padding:14px 20px;border-top:1px solid var(--border);background:var(--card);display:flex;justify-content:flex-end;gap:8px}
        .fixed-costs-page .fc-preview{border-radius:9px;background:var(--accent-subtle);padding:12px 14px;display:flex;justify-content:space-between;gap:12px;color:var(--text-secondary);font-size:12px}
        .fixed-costs-page .fc-toast{position:fixed;right:20px;bottom:20px;z-index:1200;max-width:min(420px,calc(100vw - 32px));padding:12px 14px;border-radius:10px;border:1px solid var(--border);box-shadow:var(--shadow);font-size:13px}
        @media(max-width:768px){
          .fixed-costs-page .fc-page-header{display:grid}.fixed-costs-page .fc-mode-wrap{width:100%;justify-items:stretch}
          .fixed-costs-page .fc-mode-control{width:100%}.fixed-costs-page .fc-mode-button{flex:1}
          .fixed-costs-page .fc-summary-grid{grid-template-columns:1fr}.fixed-costs-page .fc-toolbar{align-items:stretch;flex-direction:column}
          .fixed-costs-page .fc-toolbar-actions{justify-content:stretch}.fixed-costs-page .fc-toolbar-actions>*{flex:1 1 145px}
          .fixed-costs-page .fc-search{min-width:0}.fixed-costs-page .fc-desktop-table{display:none}.fixed-costs-page .fc-mobile-list{display:block}
          .fixed-costs-page .fc-modal-backdrop{align-items:flex-start;padding:10px}.fixed-costs-page .fc-modal-panel{max-height:calc(100dvh - 20px)}
          .fixed-costs-page .fc-modal-grid{grid-template-columns:1fr}.fixed-costs-page .fc-span-2{grid-column:span 1}
          .fixed-costs-page .fc-modal-actions{flex-direction:column-reverse}.fixed-costs-page .fc-modal-actions button{width:100%;min-height:44px}
          .fixed-costs-page .fc-toast{right:16px;bottom:16px}
        }
      `}</style>

      <header className="fc-page-header">
        <div>
          <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700, marginBottom: 5 }}>{activeWorkspace.name}</div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Fixed &amp; Recurring Costs</h1>
          <p style={{ margin: '7px 0 0', color: 'var(--dim)', fontSize: 13 }}>Kelola overhead yang digunakan dalam perhitungan profit.</p>
        </div>
        <div className="fc-mode-wrap">
          <div role="radiogroup" aria-label="Mode perhitungan overhead" className="fc-mode-control">
            {([['detailed_fixed_costs', 'Rincian biaya'], ['legacy_monthly_overhead', 'Angka bulanan']] as const)
              .map(([mode, label]) => {
                const selected = costModel === mode;
                return <button key={mode} type="button" role="radio" aria-checked={selected}
                  disabled={loading || modeSaving} onClick={() => { if (!selected) setPendingMode(mode); }}
                  className="fc-mode-button" style={{ background: selected ? 'var(--accent)' : 'transparent',
                    color: selected ? '#fff' : 'var(--text-secondary)', opacity: loading || modeSaving ? 0.7 : 1 }}>
                  {label}
                </button>;
              })}
          </div>
          <div style={{ color: 'var(--dim)', fontSize: 11 }}>Mode aktif digunakan di Overview dan analisis profit.</div>
        </div>
      </header>

      {costModel === 'detailed_fixed_costs' ? (
        <>
          <div className="fc-summary-grid">
            <SummaryCard label="Estimasi per bulan" value={rupiah.format(activeMonthly)} context="berdasarkan biaya aktif bulan ini" color="var(--accent)" />
            <SummaryCard label="Proyeksi 12 bulan" value={rupiah.format(annualRunRate)} context="berdasarkan estimasi bulan ini" color="var(--green)" />
            <SummaryCard label="Biaya aktif" value={`${activeItems.length} item`} context={`${items.length} total biaya terdaftar`} color="var(--yellow)" />
          </div>
          <section className="fc-section">
            <div className="fc-toolbar">
              <div><div style={{ fontSize: 15, fontWeight: 750 }}>Rincian biaya</div>
                <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 4 }}>Satu baris untuk satu jenis pengeluaran rutin.</div></div>
              <div className="fc-toolbar-actions">
                <input aria-label="Cari biaya" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Cari biaya…" className="fc-filter fc-search" />
                <select aria-label="Filter kategori" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="fc-filter">
                  <option value="all">Semua kategori</option><option value="none">Tanpa kategori</option>
                  {categories.map((category) => <option key={category.id} value={String(category.id)}>{category.name}</option>)}
                </select>
                <select aria-label="Filter status" value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="fc-filter">
                  <option value="all">Semua status</option><option value="active">Aktif</option><option value="inactive">Nonaktif</option>
                </select>
                <button type="button" onClick={openNewFixedCost} style={primaryButtonStyle}>+ Tambah biaya</button>
              </div>
            </div>
            {loading ? <div style={{ padding: 36, textAlign: 'center', color: 'var(--dim)' }}>Memuat fixed costs…</div>
              : items.length === 0 ? <div style={{ padding: 44, textAlign: 'center', color: 'var(--dim)' }}>
                  <div>Belum ada fixed cost.</div><button type="button" onClick={openNewFixedCost} style={{ ...primaryButtonStyle, marginTop: 14 }}>Tambah biaya pertama</button>
                </div>
              : filteredItems.length === 0 ? <div style={{ padding: 38, textAlign: 'center', color: 'var(--dim)' }}>Tidak ada biaya yang cocok dengan filter.</div>
              : <>
                <div className="table-scroll fc-desktop-table">
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980, fontSize: 13 }}>
                    <thead><tr style={{ color: 'var(--dim)', textAlign: 'left' }}>
                      {['Pengeluaran', 'Kategori', 'Perhitungan', 'Frekuensi', 'Periode', 'Estimasi / bulan', 'Status', 'Aksi'].map((title) =>
                        <th key={title} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{title}</th>)}
                    </tr></thead>
                    <tbody>{filteredItems.map((item) => <tr key={item.id} style={{ opacity: item.is_active ? 1 : 0.6 }}>
                      <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', fontWeight: 650 }}>{item.name}
                        {item.notes ? <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 3, fontWeight: 400 }}>{item.notes}</div> : null}</td>
                      <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{categoryName(item.category_id)}</td>
                      <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)' }}>{item.quantity} {item.cost_unit} × {rupiah.format(item.amount)}</td>
                      <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)' }}>{recurrenceText(item)}</td>
                      <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{formatDate(item.start_date)}{item.end_date ? ` – ${formatDate(item.end_date)}` : ''}</td>
                      <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', fontWeight: 700, color: 'var(--accent)' }}>{rupiah.format(item.monthly_equivalent)}</td>
                      <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)' }}><span className="fc-status"
                        style={{ background: item.is_active ? 'var(--green-subtle)' : 'var(--input-bg)', color: item.is_active ? 'var(--green)' : 'var(--dim)' }}>{item.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
                      <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                        <button type="button" onClick={() => editItem(item)} className="fc-action-button" style={{ color: 'var(--accent)' }}>Edit</button>
                        <button type="button" onClick={() => setDeleteTarget({ type: 'fixed-cost', item })} className="fc-action-button" style={{ color: 'var(--red)' }}>Hapus</button>
                      </td></tr>)}</tbody>
                  </table>
                </div>
                <div className="fc-mobile-list">{filteredItems.map((item) => <article key={item.id} className="fc-mobile-card" style={{ opacity: item.is_active ? 1 : 0.65 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div><div style={{ fontWeight: 750 }}>{item.name}</div><div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 4 }}>{categoryName(item.category_id)}</div></div>
                    <span className="fc-status" style={{ background: item.is_active ? 'var(--green-subtle)' : 'var(--input-bg)', color: item.is_active ? 'var(--green)' : 'var(--dim)' }}>{item.is_active ? 'Aktif' : 'Nonaktif'}</span>
                  </div>
                  <div className="fc-mobile-meta"><div><div style={{ color: 'var(--dim)', fontSize: 11 }}>Estimasi / bulan</div><div style={{ color: 'var(--accent)', fontWeight: 750, marginTop: 3 }}>{rupiah.format(item.monthly_equivalent)}</div></div>
                    <div><div style={{ color: 'var(--dim)', fontSize: 11 }}>Frekuensi</div><div style={{ marginTop: 3 }}>{recurrenceText(item)}</div></div></div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{item.quantity} {item.cost_unit} × {rupiah.format(item.amount)}</div>
                  <div className="fc-mobile-actions"><button type="button" onClick={() => editItem(item)} style={{ ...secondaryButtonStyle, color: 'var(--accent)', flex: 1 }}>Edit</button>
                    <button type="button" onClick={() => setDeleteTarget({ type: 'fixed-cost', item })} style={{ ...secondaryButtonStyle, color: 'var(--red)', flex: 1 }}>Hapus</button></div>
                </article>)}</div>
              </>}
          </section>
        </>
      ) : (
        <>
          <div className="fc-summary-grid">
            <SummaryCard label="Overhead bulan ini" value={rupiah.format(currentMonthOverhead)} context={formatYearMonth(currentMonth)} color="var(--accent)" />
            <SummaryCard label="Proyeksi 12 bulan" value={rupiah.format(annualRunRate)} context="berdasarkan overhead bulan ini" color="var(--green)" />
            <SummaryCard label="Kelengkapan data" value={`${storedMonthsThisYear} dari 12 bulan`} context={`tahun ${currentYear}`} color={storedMonthsThisYear === 12 ? 'var(--green)' : 'var(--yellow)'} />
          </div>
          <section className="fc-section">
            <div className="fc-toolbar"><div><div style={{ fontSize: 15, fontWeight: 750 }}>Overhead per bulan</div>
              <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 4 }}>Nilai terbaru ditampilkan paling atas.</div></div>
              <div className="fc-toolbar-actions"><button type="button" onClick={openNewMonthlyOverhead} style={primaryButtonStyle}>+ Tambah bulan</button></div>
            </div>
            {loading ? <div style={{ padding: 36, textAlign: 'center', color: 'var(--dim)' }}>Memuat overhead…</div>
              : monthlyOverhead.length === 0 ? <div style={{ padding: 44, textAlign: 'center', color: 'var(--dim)' }}><div>Belum ada angka overhead bulanan.</div>
                <button type="button" onClick={openNewMonthlyOverhead} style={{ ...primaryButtonStyle, marginTop: 14 }}>Tambah bulan pertama</button></div>
              : <>
                <div className="table-scroll fc-desktop-table"><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760, fontSize: 13 }}>
                  <thead><tr style={{ color: 'var(--dim)', textAlign: 'left' }}>{['Bulan', 'Total overhead', 'Estimasi per hari', 'Status', 'Aksi'].map((title) =>
                    <th key={title} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{title}</th>)}</tr></thead>
                  <tbody>{monthlyOverhead.map((row) => {
                    const isCurrentMonth = row.year_month === currentMonth;
                    return <tr key={row.id} className={isCurrentMonth ? 'fc-current-row' : undefined}>
                      <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', fontWeight: 650 }}>{formatYearMonth(row.year_month)}</td>
                      <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', fontWeight: 700, color: 'var(--accent)' }}>{rupiah.format(row.amount)}</td>
                      <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{rupiah.format(row.amount / daysInYearMonth(row.year_month))} / hari</td>
                      <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)' }}>{isCurrentMonth
                        ? <span className="fc-status" style={{ background: 'var(--green-subtle)', color: 'var(--green)' }}>Bulan berjalan</span>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                      <td style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                        <button type="button" onClick={() => editMonthlyOverhead(row)} className="fc-action-button" style={{ color: 'var(--accent)' }}>Edit</button>
                        <button type="button" onClick={() => setDeleteTarget({ type: 'monthly-overhead', row })} className="fc-action-button" style={{ color: 'var(--red)' }}>Hapus</button>
                      </td></tr>;
                  })}</tbody>
                </table></div>
                <div className="fc-mobile-list">{monthlyOverhead.map((row) => {
                  const isCurrentMonth = row.year_month === currentMonth;
                  return <article key={row.id} className="fc-mobile-card" style={{ background: isCurrentMonth ? 'var(--accent-subtle)' : 'transparent' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}><div style={{ fontWeight: 750 }}>{formatYearMonth(row.year_month)}</div>
                      {isCurrentMonth ? <span className="fc-status" style={{ background: 'var(--green-subtle)', color: 'var(--green)' }}>Bulan berjalan</span> : null}</div>
                    <div className="fc-mobile-meta"><div><div style={{ color: 'var(--dim)', fontSize: 11 }}>Total overhead</div><div style={{ color: 'var(--accent)', fontWeight: 750, marginTop: 3 }}>{rupiah.format(row.amount)}</div></div>
                      <div><div style={{ color: 'var(--dim)', fontSize: 11 }}>Estimasi / hari</div><div style={{ marginTop: 3 }}>{rupiah.format(row.amount / daysInYearMonth(row.year_month))}</div></div></div>
                    <div className="fc-mobile-actions"><button type="button" onClick={() => editMonthlyOverhead(row)} style={{ ...secondaryButtonStyle, color: 'var(--accent)', flex: 1 }}>Edit</button>
                      <button type="button" onClick={() => setDeleteTarget({ type: 'monthly-overhead', row })} style={{ ...secondaryButtonStyle, color: 'var(--red)', flex: 1 }}>Hapus</button></div>
                  </article>;
                })}</div>
              </>}
          </section>
        </>
      )}

      <div style={{ padding: 13, border: '1px solid var(--border)', borderRadius: 10, color: 'var(--dim)', fontSize: 12, lineHeight: 1.6 }}>
        Berpindah mode tidak menghapus data. Hanya mode aktif yang dipakai dalam perhitungan dashboard.
      </div>

      {fixedCostModal ? <ModalShell title={fixedCostModal === 'edit' ? 'Edit fixed cost' : 'Tambah fixed cost'}
        subtitle={fixedCostModal === 'edit' ? form.name : 'Catat satu jenis pengeluaran rutin.'} onClose={closeFixedCostModal} maxWidth={760}>
        <form onSubmit={submitFixedCost}>
          <div className="fc-modal-body"><div className="fc-modal-grid">
            <label style={labelStyle} className="fc-span-2">Nama pengeluaran
              <input required autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Contoh: Gaji tim customer service" style={inputStyle} /></label>
            <label style={labelStyle}>Kategori<div style={{ display: 'flex', gap: 7 }}>
              <select value={form.categoryId || ''} onChange={(event) => setForm({ ...form, categoryId: event.target.value ? Number(event.target.value) : null })} style={inputStyle}>
                <option value="">Tanpa kategori</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
              <button type="button" onClick={() => setShowCategoryInput((current) => !current)} aria-expanded={showCategoryInput}
                style={{ ...secondaryButtonStyle, padding: '8px 11px', whiteSpace: 'nowrap' }}>+ Kategori</button></div></label>
            <label style={labelStyle}>Nominal per unit (Rp)
              <input required inputMode="numeric" value={formatNumberInput(form.amount)}
                onChange={(event) => setForm({ ...form, amount: Number(parseCurrencyInput(event.target.value)) })}
                placeholder="Contoh: 8.500.000" style={inputStyle} /></label>
            {showCategoryInput ? <div className="fc-span-2" style={{ padding: 12, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-deep)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Kategori baru</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><input value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} placeholder="Nama kategori" style={{ ...inputStyle, flex: '1 1 220px' }} />
                <button type="button" disabled={!categoryDraft.trim() || categorySaving} onClick={addCategory}
                  style={{ ...primaryButtonStyle, opacity: !categoryDraft.trim() || categorySaving ? 0.6 : 1 }}>{categorySaving ? 'Menyimpan…' : 'Simpan kategori'}</button></div>
            </div> : null}
            <label style={labelStyle}>Jumlah unit<input required type="number" min="0.01" step="0.01" value={form.quantity}
              onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} style={inputStyle} /></label>
            <label style={labelStyle}>Satuan biaya<input required value={form.costUnit} onChange={(event) => setForm({ ...form, costUnit: event.target.value })}
              placeholder="orang, akun, kantor, unit" style={inputStyle} /></label>
            <label style={labelStyle}>Frekuensi<select value={form.recurrenceUnit} onChange={(event) => setForm({ ...form, recurrenceUnit: event.target.value as FixedCostRecurrence })} style={inputStyle}>
              {Object.entries(RECURRENCE_LABELS).map(([value, label]) => <option key={value} value={value}>Setiap {label.toLowerCase()}</option>)}</select></label>
            <label style={labelStyle}>Interval periode<input required type="number" min="1" step="1" value={form.recurrenceInterval}
              onChange={(event) => setForm({ ...form, recurrenceInterval: Number(event.target.value) })} style={inputStyle} /></label>
            <label style={labelStyle}>Mulai berlaku<input required type="date" value={form.startDate}
              onChange={(event) => setForm({ ...form, startDate: event.target.value })} style={inputStyle} /></label>
            <label style={labelStyle}>Berakhir (opsional)<input type="date" value={form.endDate || ''}
              onChange={(event) => setForm({ ...form, endDate: event.target.value || null })} style={inputStyle} /></label>
            <label style={labelStyle}>Tanggal jatuh tempo<input type="number" min="1" max="31" value={form.dueDay || ''}
              onChange={(event) => setForm({ ...form, dueDay: event.target.value ? Number(event.target.value) : null })} placeholder="1–31" style={inputStyle} /></label>
            <label style={labelStyle} className="fc-span-2">Catatan<textarea value={form.notes || ''}
              onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Vendor, PIC, nomor kontrak, atau informasi lain"
              rows={3} style={{ ...inputStyle, resize: 'vertical' }} /></label>
          </div>
          <div className="fc-preview"><span>Estimasi biaya per bulan</span><strong style={{ color: 'var(--text)' }}>{rupiah.format(fixedCostMonthlyPreview)}</strong></div>
          <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isActive !== false} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />Aktif dan diperhitungkan sebagai overhead</label>
          </div>
          <div className="fc-modal-actions"><button type="button" onClick={closeFixedCostModal} style={secondaryButtonStyle}>Batal</button>
            <button disabled={saving} type="submit" style={{ ...primaryButtonStyle, opacity: saving ? 0.65 : 1, cursor: saving ? 'wait' : 'pointer' }}>
              {saving ? 'Menyimpan…' : fixedCostModal === 'edit' ? 'Simpan perubahan' : 'Tambah fixed cost'}</button></div>
        </form>
      </ModalShell> : null}

      {monthlyModal ? <ModalShell title={monthlyModal === 'edit' ? 'Edit overhead bulanan' : 'Tambah overhead bulanan'}
        subtitle={monthlyModal === 'edit' ? formatYearMonth(singleForm.yearMonth) : 'Masukkan periode dan total overhead.'}
        onClose={() => { if (!singleSaving) setMonthlyModal(null); }} maxWidth={520}>
        <form onSubmit={saveMonthlyOverhead}><div className="fc-modal-body">
          <label style={labelStyle}>Bulan<input required autoFocus={monthlyModal === 'create'} type="month" disabled={monthlyModal === 'edit'}
            value={singleForm.yearMonth} onChange={(event) => {
              const row = monthlyOverhead.find((item) => item.year_month === event.target.value);
              setSingleForm({ yearMonth: event.target.value, amount: row ? String(row.amount) : '' });
            }} style={{ ...inputStyle, opacity: monthlyModal === 'edit' ? 0.7 : 1 }} /></label>
          <label style={labelStyle}>Total overhead (Rp)<input required autoFocus={monthlyModal === 'edit'} inputMode="numeric"
            value={formatNumberInput(singleForm.amount)} onChange={(event) => setSingleForm({ ...singleForm, amount: parseCurrencyInput(event.target.value) })}
            placeholder="Contoh: 700.000.000" style={inputStyle} /></label>
          {monthlyModal === 'create' && modalMonthlyRow ? <div style={{ color: 'var(--yellow)', fontSize: 12 }}>
            Bulan ini sudah memiliki nilai {rupiah.format(modalMonthlyRow.amount)}. Menyimpan akan memperbarui nilai tersebut.</div> : null}
          <div className="fc-preview"><span>Estimasi per hari</span><strong style={{ color: 'var(--text)' }}>{rupiah.format(monthlyDailyPreview)}</strong></div>
        </div><div className="fc-modal-actions"><button type="button" onClick={() => setMonthlyModal(null)} style={secondaryButtonStyle}>Batal</button>
          <button disabled={singleSaving} type="submit" style={{ ...primaryButtonStyle, opacity: singleSaving ? 0.65 : 1, cursor: singleSaving ? 'wait' : 'pointer' }}>
            {singleSaving ? 'Menyimpan…' : monthlyModal === 'edit' ? 'Simpan perubahan' : 'Tambah overhead'}</button></div></form>
      </ModalShell> : null}

      {pendingMode ? <ModalShell title="Ganti mode perhitungan?" onClose={() => { if (!modeSaving) setPendingMode(null); }} maxWidth={480}>
        <div className="fc-modal-body"><div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.65 }}>
          Mode <strong style={{ color: 'var(--text)' }}>{pendingMode === 'detailed_fixed_costs' ? 'Rincian biaya' : 'Angka bulanan'}</strong> akan langsung digunakan di Overview dan analisis profit. Data dari mode sebelumnya tetap tersimpan.</div></div>
        <div className="fc-modal-actions"><button type="button" disabled={modeSaving} onClick={() => setPendingMode(null)} style={secondaryButtonStyle}>Batal</button>
          <button type="button" disabled={modeSaving} onClick={() => changeMode(pendingMode)}
            style={{ ...primaryButtonStyle, opacity: modeSaving ? 0.65 : 1, cursor: modeSaving ? 'wait' : 'pointer' }}>
            {modeSaving ? 'Mengaktifkan…' : 'Aktifkan mode'}</button></div>
      </ModalShell> : null}

      {deleteTarget ? <ModalShell title={deleteTarget.type === 'monthly-overhead' ? 'Hapus overhead bulanan?' : 'Hapus fixed cost?'}
        onClose={() => { if (!deleting) setDeleteTarget(null); }} maxWidth={480}>
        <div className="fc-modal-body"><div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.65 }}>
          {deleteTarget.type === 'monthly-overhead'
            ? <>Overhead <strong style={{ color: 'var(--text)' }}>{formatYearMonth(deleteTarget.row.year_month)}</strong> sebesar <strong style={{ color: 'var(--text)' }}>{rupiah.format(deleteTarget.row.amount)}</strong> akan dihapus.</>
            : <>Fixed cost <strong style={{ color: 'var(--text)' }}>“{deleteTarget.item.name}”</strong> akan dihapus dari perhitungan berikutnya.</>}
        </div><div style={{ borderRadius: 8, padding: '10px 12px', background: 'var(--red-subtle)', color: 'var(--red)', fontSize: 12 }}>Tindakan ini tidak dapat dibatalkan.</div></div>
        <div className="fc-modal-actions"><button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)} style={secondaryButtonStyle}>Batal</button>
          <button type="button" disabled={deleting} onClick={confirmDelete}
            style={{ ...primaryButtonStyle, background: 'var(--red)', opacity: deleting ? 0.65 : 1, cursor: deleting ? 'wait' : 'pointer' }}>
            {deleting ? 'Menghapus…' : 'Hapus permanen'}</button></div>
      </ModalShell> : null}

      {message ? <div role={message.type === 'error' ? 'alert' : 'status'} className="fc-toast"
        style={{ background: message.type === 'success' ? 'var(--green-subtle)' : 'var(--red-subtle)',
          color: message.type === 'success' ? 'var(--green)' : 'var(--red)' }}>{message.text}</div> : null}
    </div>
  );
}

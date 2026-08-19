'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteMonthlyFinancialTarget,
  getFinancialTargetSettings,
  saveFinancialTarget,
  type FinancialTargetSettings,
  type WorkspaceFinancialTarget,
} from '@/lib/financial-target-actions';
import { useWorkspace } from '@/lib/WorkspaceContext';

type TargetScope = 'default' | 'month';

type TargetForm = {
  targetOperatingProfit: string;
  notes: string;
};

const EMPTY_FORM: TargetForm = {
  targetOperatingProfit: '0',
  notes: '',
};

const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

const shortMonth = new Intl.DateTimeFormat('id-ID', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});

function formatShortMonth(value?: string) {
  return value
    ? shortMonth.format(new Date(`${value}T00:00:00Z`))
    : '—';
}

const inputStyle = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-deep)',
  color: 'var(--text)',
  fontSize: 12,
  boxSizing: 'border-box' as const,
};

const labelStyle = {
  display: 'grid',
  gap: 6,
  color: 'var(--text-secondary)',
  fontSize: 11,
  fontWeight: 650,
} as const;

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function targetToForm(target: WorkspaceFinancialTarget | null): TargetForm {
  if (!target) return EMPTY_FORM;
  return {
    targetOperatingProfit: String(target.target_operating_profit),
    notes: target.notes || '',
  };
}

export default function FinancialTargetManager() {
  const { activeWorkspace } = useWorkspace();
  const [month, setMonth] = useState(currentMonth);
  const [scope, setScope] = useState<TargetScope>('month');
  const [settings, setSettings] = useState<FinancialTargetSettings | null>(null);
  const [form, setForm] = useState<TargetForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const hydrateForm = useCallback((snapshot: FinancialTargetSettings, nextScope: TargetScope) => {
    if (nextScope === 'default') {
      setForm(targetToForm(snapshot.defaultTarget));
      return;
    }
    setForm(targetToForm(snapshot.monthlyTarget || snapshot.effectiveTarget));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const snapshot = await getFinancialTargetSettings(month);
      setSettings(snapshot);
      hydrateForm(snapshot, scope);
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal memuat target finansial.' });
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [hydrateForm, month, scope]);

  useEffect(() => {
    load();
  }, [activeWorkspace.id, load]);

  const selectScope = (nextScope: TargetScope) => {
    setScope(nextScope);
    if (settings) hydrateForm(settings, nextScope);
  };

  const preview = useMemo(() => {
    const profit = Number(form.targetOperatingProfit || 0);
    const margin = settings?.weightedCm3Margin ?? null;
    const requiredCm3 = Number(settings?.monthlyOverhead || 0) + (Number.isFinite(profit) ? profit : 0);
    const targetRevenue = margin != null && margin > 0 ? requiredCm3 / margin : null;
    return {
      requiredCm3,
      targetRevenue,
    };
  }, [form.targetOperatingProfit, settings?.monthlyOverhead, settings?.weightedCm3Margin]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await saveFinancialTarget({
        scope,
        targetMonth: month,
        targetOperatingProfit: Number(form.targetOperatingProfit),
        notes: form.notes,
      });
      setMessage({
        type: 'success',
        text: scope === 'month'
          ? `Override target ${month} berhasil disimpan.`
          : `Default target workspace mulai ${month} berhasil disimpan.`,
      });
      const snapshot = await getFinancialTargetSettings(month);
      setSettings(snapshot);
      hydrateForm(snapshot, scope);
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menyimpan target finansial.' });
    } finally {
      setSaving(false);
    }
  };

  const removeMonthlyOverride = async () => {
    if (!settings?.monthlyTarget) return;
    if (!window.confirm(`Hapus override target ${month}? Bulan ini akan kembali memakai default workspace.`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await deleteMonthlyFinancialTarget(month);
      const snapshot = await getFinancialTargetSettings(month);
      setSettings(snapshot);
      hydrateForm(snapshot, 'month');
      setMessage({ type: 'success', text: `Override ${month} dihapus; target kembali memakai default workspace.` });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menghapus override target.' });
    } finally {
      setSaving(false);
    }
  };

  const configured = settings?.effectiveTarget;
  const sourceLabel = settings?.effectiveSource === 'monthly'
    ? `Override ${month}`
    : settings?.effectiveSource === 'default'
      ? `Default efektif ${settings?.defaultTarget?.effective_from?.slice(0, 7) || month}`
      : 'Belum dikonfigurasi';

  return (
    <section style={{ border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 14, padding: 20, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 750 }}>Target Profitabilitas</div>
          <div style={{ color: 'var(--dim)', fontSize: 11, lineHeight: 1.6, marginTop: 4 }}>
            Cukup tentukan target laba. Target CM3 dan revenue dihitung otomatis memakai weighted margin CM3 dari 3 bulan penuh sebelumnya.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="month"
            value={month}
            onChange={event => setMonth(event.target.value)}
            style={{ ...inputStyle, width: 'auto' }}
          />
          <span style={{ padding: '5px 9px', borderRadius: 999, background: configured ? 'var(--badge-green-bg)' : 'var(--badge-yellow-bg)', color: configured ? 'var(--green)' : 'var(--yellow)', fontSize: 10, fontWeight: 750 }}>
            {sourceLabel}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 5, padding: 4, border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg-deep)', width: 'fit-content' }}>
        {([
          ['default', `Default mulai ${month}`],
          ['month', `Override ${month}`],
        ] as Array<[TargetScope, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => selectScope(value)}
            style={{ border: 'none', borderRadius: 6, padding: '6px 11px', background: scope === value ? 'var(--accent)' : 'transparent', color: scope === value ? '#fff' : 'var(--dim)', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: 'var(--dim)', fontSize: 12, padding: 20, textAlign: 'center' }}>Memuat target finansial…</div>
      ) : (
        <form onSubmit={save} style={{ display: 'grid', gap: 15 }}>
          {scope === 'month' && !settings?.monthlyTarget && settings?.defaultTarget && (
            <div style={{ padding: 10, borderRadius: 8, background: 'var(--accent-subtle)', color: 'var(--text-secondary)', fontSize: 11 }}>
              Form ini diawali dari default workspace. Simpan hanya jika {month} memang memerlukan target berbeda.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(190px, 420px)', gap: 12 }}>
            <label style={labelStyle}>
              Target Laba Operasional
              <input
                type="number"
                min="0"
                step="1000"
                required
                value={form.targetOperatingProfit}
                onChange={event => setForm(current => ({ ...current, targetOperatingProfit: event.target.value }))}
                style={inputStyle}
              />
              <span style={{ color: 'var(--dim)', fontSize: 9, fontWeight: 400 }}>Laba setelah fixed OPEX.</span>
            </label>
          </div>

          <label style={labelStyle}>
            Catatan (opsional)
            <input
              value={form.notes}
              onChange={event => setForm(current => ({ ...current, notes: event.target.value }))}
              placeholder="Asumsi atau keputusan yang mendasari target"
              style={inputStyle}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 9 }}>
            {[
              ['Fixed OPEX Bulan Ini', rupiah.format(settings?.monthlyOverhead || 0)],
              ['Target CM3', rupiah.format(preview.requiredCm3)],
              [
                `Margin CM3 Weighted · ${formatShortMonth(settings?.weightedCm3From)}–${formatShortMonth(settings?.weightedCm3To)}`,
                settings?.weightedCm3Margin == null ? '—' : `${(settings.weightedCm3Margin * 100).toFixed(1)}%`,
              ],
              ['Target Revenue (Otomatis)', preview.targetRevenue == null ? '—' : rupiah.format(preview.targetRevenue)],
            ].map(([label, value]) => (
              <div key={label} style={{ padding: 11, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-deep)' }}>
                <div style={{ color: 'var(--dim)', fontSize: 9, marginBottom: 5 }}>{label}</div>
                <div style={{ color: 'var(--text)', fontFamily: 'monospace', fontSize: 13, fontWeight: 750 }}>{value}</div>
              </div>
            ))}
          </div>

          {message && (
            <div style={{ padding: 10, borderRadius: 8, background: message.type === 'success' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)', color: message.type === 'success' ? 'var(--green)' : 'var(--red)', fontSize: 11 }}>
              {message.type === 'success' ? '✅' : '❌'} {message.text}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ color: 'var(--dim)', fontSize: 9 }}>
              {preview.targetRevenue == null
                ? 'Target revenue tersedia setelah weighted margin CM3 memiliki nilai positif.'
                : 'Formula: Target CM3 = Fixed OPEX + Target Laba; Target Revenue = Target CM3 ÷ Weighted Margin CM3 (3 bulan).'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {scope === 'month' && settings?.monthlyTarget && (
                <button type="button" onClick={removeMonthlyOverride} disabled={saving} style={{ border: '1px solid var(--border)', borderRadius: 7, padding: '7px 12px', background: 'transparent', color: 'var(--red)', fontSize: 11, cursor: 'pointer' }}>
                  Hapus Override
                </button>
              )}
              <button type="submit" disabled={saving} style={{ border: 'none', borderRadius: 7, padding: '7px 15px', background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 750, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Menyimpan…' : scope === 'month' ? 'Simpan Override' : 'Simpan Default'}
              </button>
            </div>
          </div>
        </form>
      )}

      {(settings?.audit || []).length > 0 && (
        <details style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <summary style={{ color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Riwayat perubahan target</summary>
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            {settings!.audit.map(entry => {
              const values = entry.after_values || entry.before_values || {};
              const auditMonth = values.target_month
                ? String(values.target_month).slice(0, 7)
                : `Default mulai ${String(values.effective_from || '').slice(0, 7) || '—'}`;
              return (
                <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--dim)', fontSize: 9 }}>
                  <span>{entry.action.toUpperCase()} · {auditMonth}</span>
                  <span>{new Date(entry.changed_at).toLocaleString('id-ID')}</span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </section>
  );
}

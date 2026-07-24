// @ts-nocheck
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useDateRange } from '@/lib/DateRangeContext';
import { useActiveBrands } from '@/lib/ActiveBrandsContext';
import { useSupabaseSessionReady } from '@/lib/useSupabaseSessionReady';
import { getCommercialMomentAttribution, getOverviewPageData } from '@/lib/overview-actions';
import { getCached, setCache } from '@/lib/dashboard-cache';
import { fmtCompact, fmtRupiah } from '@/lib/utils';

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthBounds(anchor: string) {
  const [year, month] = anchor.split('-').map(Number);
  const currentDays = daysInMonth(year, month);
  const prevIndex = year * 12 + month - 2;
  const prevYear = Math.floor(prevIndex / 12);
  const prevMonth = (prevIndex % 12) + 1;
  return {
    year,
    month,
    days: currentDays,
    start: iso(year, month, 1),
    end: iso(year, month, currentDays),
    prevYear,
    prevMonth,
    prevDays: daysInMonth(prevYear, prevMonth),
    prevStart: iso(prevYear, prevMonth, 1),
    prevEnd: iso(prevYear, prevMonth, daysInMonth(prevYear, prevMonth)),
  };
}

function shiftMonth(year: number, month: number, delta: number) {
  const index = year * 12 + month - 1 + delta;
  return {
    year: Math.floor(index / 12),
    month: ((index % 12) + 12) % 12 + 1,
  };
}

function paydayStart(year: number, month: number) {
  const july2026 = 2026 * 12 + 6;
  const target = year * 12 + month - 1;
  return Math.abs(target - july2026) % 2 === 0 ? 24 : 25;
}

function normalizedEventDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return {
    iso: iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()),
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
}

function sumByDate(rows: any[], field: string, isActiveBrand: (name: string) => boolean) {
  const result: Record<number, number> = {};
  rows.forEach((row) => {
    if (!isActiveBrand(row.product)) return;
    const day = Number(String(row.date).slice(8, 10));
    result[day] = (result[day] || 0) + Number(row[field] || 0);
  });
  return result;
}

function sumFeeByDate(rows: any[], field: string, productScoped: boolean, isActiveBrand: (name: string) => boolean) {
  const result: Record<number, number> = {};
  rows.forEach((row) => {
    if (productScoped && !isActiveBrand(row.product)) return;
    const day = Number(String(row.date).slice(8, 10));
    result[day] = (result[day] || 0) + Math.abs(Number(row[field] || 0));
  });
  return result;
}

function total(values: Record<number, number>) {
  return Object.values(values).reduce((sum, value) => sum + Number(value || 0), 0);
}

function pct(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function KpiCard({ label, value, sub, tone = 'var(--accent)', badge, delta, deltaPositive, deltaContext }: any) {
  const deltaColor = deltaPositive ? 'var(--green)' : 'var(--red)';
  const deltaBg = deltaPositive ? 'var(--green-subtle)' : 'var(--red-subtle)';
  return (
    <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 16px', position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', inset:'0 0 auto', height:2, background:tone }} />
      <div style={{ display:'flex', justifyContent:'space-between', gap:8, alignItems:'center', marginBottom:7 }}>
        <div style={{ color:'var(--dim)', fontSize:10, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase' }}>{label}</div>
        {badge && <span style={{ padding:'2px 7px', borderRadius:999, background:'var(--accent-subtle)', color:tone, fontSize:9, fontWeight:700 }}>{badge}</span>}
      </div>
      <div style={{ fontFamily:'monospace', fontSize:19, lineHeight:1.15, fontWeight:700, color:'var(--text)' }}>{value}</div>
      {delta != null && (
        <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:9, flexWrap:'wrap' }}>
          <span style={{
            display:'inline-flex', alignItems:'center', gap:4, padding:'4px 8px',
            borderRadius:999, background:deltaBg, color:deltaColor,
            border:`1px solid ${deltaPositive ? 'rgba(16,185,129,.25)' : 'rgba(239,68,68,.25)'}`,
            fontFamily:'monospace', fontSize:10, fontWeight:800,
          }}>
            <span>{deltaPositive ? '▲' : '▼'}</span>
            <span>{delta}</span>
          </span>
          {deltaContext && <span style={{ color:'var(--dim)', fontSize:9, fontWeight:600 }}>{deltaContext}</span>}
        </div>
      )}
      <div style={{ color:'var(--dim)', fontSize:10, lineHeight:1.4, marginTop:5 }}>{sub}</div>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const isOperational = payload.some((item: any) => String(item.dataKey).startsWith('operational'));
  return (
    <div style={{ background:'var(--bg-deep)', border:'1px solid var(--border)', borderRadius:10, padding:'10px 12px', boxShadow:'var(--shadow)', minWidth:190 }}>
      <div style={{ fontSize:11, fontWeight:700, marginBottom:row.window ? 2 : 7 }}>
        {row.fullLabel || (isOperational ? `Operational Day ${label}` : `Tanggal ${label}`)}
      </div>
      {row.window && <div style={{ color:'var(--dim)', fontSize:9, marginBottom:7 }}>{row.window}{row.complete === false ? ` · Partial ${row.completedDays} hari` : ''}</div>}
      {payload.filter((p: any) => p.value != null).map((p: any) => {
        const eventIndex = String(p.dataKey).startsWith('eventDay') ? Number(String(p.dataKey).replace('eventDay', '')) : -1;
        const carryover = eventIndex >= 0 ? Number(row.eventCarryover?.[eventIndex] || 0) : 0;
        const sameDay = eventIndex >= 0 ? Number(row.eventSameDay?.[eventIndex] || 0) : 0;
        const operationalDate = p.dataKey === 'operationalCurrent'
          ? row.currentDate
          : p.dataKey === 'operationalPrevious'
            ? row.previousDate
            : null;
        return (
          <div key={p.dataKey} style={{ marginBottom:carryover > 0 ? 4 : 0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:16, fontSize:10, lineHeight:1.8 }}>
              <span style={{ color:p.color }}>{p.name}{operationalDate ? ` · ${operationalDate}` : ''}</span>
              <span style={{ fontFamily:'monospace', color:'var(--text)', fontWeight:600 }}>Rp {fmtCompact(p.value)}</span>
            </div>
            {carryover > 0 && (
              <div style={{ display:'flex', justifyContent:'space-between', gap:16, paddingLeft:8, color:'var(--dim)', fontSize:8, lineHeight:1.5 }}>
                <span>Same-day / shipped later</span>
                <span style={{ fontFamily:'monospace' }}>Rp {fmtCompact(sameDay)} / Rp {fmtCompact(carryover)}</span>
              </div>
            )}
          </div>
        );
      })}
      {row.window && (
        <div style={{ display:'flex', justifyContent:'space-between', gap:16, borderTop:'1px solid var(--border)', marginTop:5, paddingTop:6, fontSize:10, fontWeight:700 }}>
          <span>Total event</span>
          <span style={{ fontFamily:'monospace' }}>Rp {fmtCompact(row.total || 0)}</span>
        </div>
      )}
    </div>
  );
}

function AverageLineLabel({ viewBox, label, value, color }: any) {
  const width = 150;
  const height = 18;
  const x = Math.max(Number(viewBox?.x || 0) + 4, Number(viewBox?.x || 0) + Number(viewBox?.width || 0) - width - 4);
  const y = Number(viewBox?.y || 0) - height / 2;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={3}
        fill="rgba(3,7,18,0.62)"
      />
      <line x1={x + 7} y1={y + 9} x2={x + 19} y2={y + 9} stroke={color} strokeWidth={2} strokeDasharray="4 3" />
      <text x={x + 25} y={y + 12.5} fill="#d1d5db" fontSize={8.5} fontWeight={650}>
        {label} · Rp {fmtCompact(value)}
      </text>
    </g>
  );
}

export default function RevenueRunRatePage() {
  const { dateRange, dateExtent, loading: dateLoading } = useDateRange();
  const { isActiveBrand, loading: brandLoading, error: brandError } = useActiveBrands();
  const { ready: authReady } = useSupabaseSessionReady();
  const [data, setData] = useState<any>(null);
  const [chartMode, setChartMode] = useState<'cumulative' | 'operational' | 'commercial'>('cumulative');
  const [eventType, setEventType] = useState<'twin' | 'payday'>('twin');
  const [attributionData, setAttributionData] = useState<any[]>([]);
  const [attributionLoading, setAttributionLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const anchor = dateRange.to || dateExtent.latest;
  const bounds = useMemo(() => anchor ? monthBounds(anchor) : null, [anchor]);
  const actualTo = useMemo(() => {
    if (!bounds) return '';
    const candidates = [bounds.end, dateRange.to, dateExtent.latest].filter(Boolean).sort();
    return candidates[0] < bounds.start ? bounds.start : candidates[0];
  }, [bounds, dateRange.to, dateExtent.latest]);

  useEffect(() => {
    if (!authReady || dateLoading || brandLoading || !bounds || !actualTo) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    getOverviewPageData({
      from: bounds.start,
      to: actualTo,
      prevFrom: bounds.prevStart,
      prevTo: bounds.prevEnd,
      accessScope: 'channels',
    }).then((result) => {
      if (!cancelled) setData(result);
    }).catch((err) => {
      if (!cancelled) setError(err?.message || 'Gagal memuat analisis run-rate.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [authReady, dateLoading, brandLoading, bounds, actualTo]);

  useEffect(() => {
    if (chartMode !== 'commercial' || !authReady || dateLoading || brandLoading || !bounds || !actualTo) return;
    let cancelled = false;
    const cacheKey = `${bounds.year}-${String(bounds.month).padStart(2, '0')}`;
    const cached = getCached<any[]>('commercial_moment_attribution', cacheKey, actualTo, eventType);
    if (cached) {
      setAttributionData(cached);
      setAttributionLoading(false);
      return;
    }

    setAttributionLoading(true);
    getCommercialMomentAttribution({
      year: bounds.year,
      month: bounds.month,
      eventType,
      monthsBack: 6,
      asOf: actualTo,
    }).then((rows) => {
      if (!cancelled) {
        setAttributionData(rows || []);
        setCache('commercial_moment_attribution', cacheKey, actualTo, rows || [], eventType);
      }
    }).catch((err) => {
      if (!cancelled) setError(err?.message || 'Gagal memuat atribusi order event.');
    }).finally(() => {
      if (!cancelled) setAttributionLoading(false);
    });
    return () => { cancelled = true; };
  }, [chartMode, authReady, dateLoading, brandLoading, bounds, actualTo, eventType]);

  const analysis = useMemo(() => {
    if (!data || !bounds) return null;
    const revenue = sumByDate(data.daily || [], 'net_sales', isActiveBrand);
    const grossProfit = sumByDate(data.daily || [], 'gross_profit', isActiveBrand);
    const mp = sumFeeByDate(data.channel || [], 'mp_admin_cost', true, isActiveBrand);
    const shipping = sumFeeByDate(data.shipping || [], 'shipping_charge', true, isActiveBrand);
    const ads = sumFeeByDate(data.ads || [], 'spent', false, isActiveBrand);
    const prevRevenue = sumByDate(data.prevDaily || [], 'net_sales', isActiveBrand);
    const prevGrossProfit = sumByDate(data.prevDaily || [], 'gross_profit', isActiveBrand);
    const prevMp = sumFeeByDate(data.prevChannel || [], 'mp_admin_cost', true, isActiveBrand);
    const prevShipping = sumFeeByDate(data.prevShipping || [], 'shipping_charge', true, isActiveBrand);
    const prevAds = sumFeeByDate(data.prevAds || [], 'spent', false, isActiveBrand);

    const actualDay = Math.max(1, Math.min(bounds.days, Number(actualTo.slice(8, 10))));
    const currentRevenue = total(revenue);
    const currentCm3 = total(grossProfit) - total(mp) - total(shipping) - total(ads);
    const currentCm3Margin = currentRevenue > 0 ? currentCm3 / currentRevenue : 0;
    const projectedRevenue = currentRevenue / actualDay * bounds.days;
    const projectedCm3 = projectedRevenue * currentCm3Margin;
    const currentMonthlyOh = (data.overhead || []).reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
    const projectedProfit = projectedCm3 - currentMonthlyOh;

    const prevRevenueFull = total(prevRevenue);
    const prevCm3Full = total(prevGrossProfit) - total(prevMp) - total(prevShipping) - total(prevAds);
    const prevMonthlyOh = (data.prevOverhead || []).reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
    const prevProfitFull = prevCm3Full - prevMonthlyOh;
    const internalCashTarget = 650_000_000;
    const targetCm3 = currentMonthlyOh + internalCashTarget;
    const minimumRevenue = currentCm3Margin > 0
      ? targetCm3 / currentCm3Margin
      : 0;
    const requiredCm3MarginAtProjection = projectedRevenue > 0
      ? targetCm3 / projectedRevenue
      : 0;
    const targetRevenueToDate = minimumRevenue * actualDay / bounds.days;
    const targetCm3ToDate = targetCm3 * actualDay / bounds.days;
    const revenueTargetProgress = minimumRevenue > 0 ? currentRevenue / minimumRevenue : 0;
    const cm3TargetProgress = targetCm3 > 0 ? currentCm3 / targetCm3 : 0;
    const requiredDaily = Math.max(0, minimumRevenue - currentRevenue) / Math.max(1, bounds.days - actualDay);
    const forecastGap = projectedRevenue - prevRevenueFull;
    const comparableDays = Math.min(actualDay, bounds.prevDays);
    const dailyComparisons = Array.from({ length: comparableDays }, (_, index) => {
      const day = index + 1;
      const current = revenue[day] || 0;
      const previous = prevRevenue[day] || 0;
      return { day, current, previous, gap: current - previous };
    });
    const behindDays = dailyComparisons.filter((row) => row.gap < 0).length;
    const worstDay = dailyComparisons.reduce(
      (worst, row) => row.gap < worst.gap ? row : worst,
      dailyComparisons[0] || { day: 0, current: 0, previous: 0, gap: 0 }
    );

    let currentStreak = 0;
    let currentStreakStart = 0;
    let longestStreak = { length: 0, start: 0, end: 0 };
    dailyComparisons.forEach((row) => {
      if (row.gap < 0) {
        if (currentStreak === 0) currentStreakStart = row.day;
        currentStreak += 1;
        if (currentStreak > longestStreak.length) {
          longestStreak = { length: currentStreak, start: currentStreakStart, end: row.day };
        }
      } else {
        currentStreak = 0;
      }
    });

    const currentSeries = dailyComparisons.map((row) => row.current);
    const previousSeries = dailyComparisons.map((row) => row.previous);
    const currentMean = currentSeries.reduce((sum, value) => sum + value, 0) / Math.max(1, currentSeries.length);
    const previousMean = previousSeries.reduce((sum, value) => sum + value, 0) / Math.max(1, previousSeries.length);
    const covariance = currentSeries.reduce(
      (sum, value, index) => sum + (value - currentMean) * (previousSeries[index] - previousMean),
      0
    );
    const currentVariance = currentSeries.reduce((sum, value) => sum + Math.pow(value - currentMean, 2), 0);
    const previousVariance = previousSeries.reduce((sum, value) => sum + Math.pow(value - previousMean, 2), 0);
    const patternCorrelation = currentVariance > 0 && previousVariance > 0
      ? covariance / Math.sqrt(currentVariance * previousVariance)
      : 0;

    const currentOperationalDays = Array.from({ length: actualDay }, (_, index) => index + 1)
      .filter((day) => (revenue[day] || 0) > 0);
    const previousOperationalDays = Array.from({ length: bounds.prevDays }, (_, index) => index + 1)
      .filter((day) => (prevRevenue[day] || 0) > 0);
    const operationalChart = Array.from(
      { length: Math.max(currentOperationalDays.length, previousOperationalDays.length) },
      (_, index) => {
        const currentDay = currentOperationalDays[index];
        const previousDay = previousOperationalDays[index];
        return {
          day: `D${index + 1}`,
          operationalCurrent: currentDay ? revenue[currentDay] || 0 : null,
          operationalPrevious: previousDay ? prevRevenue[previousDay] || 0 : null,
          currentDate: currentDay ? `${currentDay} ${MONTHS[bounds.month - 1].slice(0, 3)}` : null,
          previousDate: previousDay ? `${previousDay} ${MONTHS[bounds.prevMonth - 1].slice(0, 3)}` : null,
        };
      }
    );
    const comparableOperationalDays = Math.min(currentOperationalDays.length, previousOperationalDays.length);
    const latestComparableIndex = comparableOperationalDays - 1;
    const latestOperationalCurrent = operationalChart[latestComparableIndex]?.operationalCurrent || 0;
    const latestOperationalPrevious = operationalChart[latestComparableIndex]?.operationalPrevious || 0;
    const latestOperationalGap = latestOperationalCurrent - latestOperationalPrevious;
    const latestCurrentOperationalDay = currentOperationalDays[latestComparableIndex] || null;
    const latestPreviousOperationalDay = previousOperationalDays[latestComparableIndex] || null;
    const currentOperationalAverage = currentRevenue / Math.max(1, currentOperationalDays.length);
    const previousOperationalAverage = prevRevenueFull / Math.max(1, previousOperationalDays.length);

    const attributedByPosition = new Map<string, { total: number; carryover: number; sameDay: number }>();
    attributionData.forEach((row: any) => {
      if (!isActiveBrand(row.product)) return;
      const key = `${row.event_year}-${row.event_month}-${row.event_position}`;
      const current = attributedByPosition.get(key) || { total: 0, carryover: 0, sameDay: 0 };
      const value = Number(row.net_sales || 0);
      current.total += value;
      current.carryover += Number(row.carryover_net_sales || 0);
      current.sameDay += Number(row.same_day_net_sales || 0);
      attributedByPosition.set(key, current);
    });

    function eventDefinition(year: number, month: number, type: 'twin' | 'payday') {
      if (type === 'twin') {
        const dates = [month - 1, month, month + 1].map((day) => normalizedEventDate(year, month, day));
        return {
          labels: ['H−1', 'Hari H', 'H+1'],
          dates,
          days: dates.map((date) => date.day),
        };
      }
      const start = paydayStart(year, month);
      const dates = [start, start + 1, start + 2, start + 3].map((day) => normalizedEventDate(year, month, day));
      return {
        labels: ['D1', 'D2', 'D3', 'D4'],
        dates,
        days: dates.map((date) => date.day),
      };
    }

    const eventMonths = Array.from({ length: 7 }, (_, index) => shiftMonth(bounds.year, bounds.month, -index));
    const eventSeries = eventMonths.map((eventMonth, monthIndex) => {
      const definition = eventDefinition(eventMonth.year, eventMonth.month, eventType);
      const lastEventDate = definition.dates[definition.dates.length - 1];
      const spilloverDate = normalizedEventDate(lastEventDate.year, lastEventDate.month, lastEventDate.day + 1);
      const spilloverAvailable = spilloverDate.iso <= actualTo;
      const spillover = spilloverAvailable
        ? attributionData.reduce((sum: number, row: any) => {
            if (!isActiveBrand(row.product)) return sum;
            if (Number(row.event_year) !== eventMonth.year || Number(row.event_month) !== eventMonth.month) return sum;
            if (Number(row.event_position) !== definition.dates.length) return sum;
            return sum + Number(row.before_noon_net_sales || 0);
          }, 0)
        : null;
      return {
        ...eventMonth,
        monthIndex,
        label: `${MONTHS[eventMonth.month - 1].slice(0, 3)} ${eventMonth.year}`,
        definition,
        spillover,
        spilloverDate,
        spilloverAvailable,
        values: definition.dates.map((date, position) => {
          const isFuture = date.iso > actualTo;
          if (isFuture) return null;
          return attributedByPosition.get(`${eventMonth.year}-${eventMonth.month}-${position}`)?.total ?? 0;
        }),
        carryover: definition.dates.map((_, position) =>
          attributedByPosition.get(`${eventMonth.year}-${eventMonth.month}-${position}`)?.carryover ?? 0),
        sameDay: definition.dates.map((_, position) =>
          attributedByPosition.get(`${eventMonth.year}-${eventMonth.month}-${position}`)?.sameDay ?? 0),
      };
    });
    const currentEvent = eventSeries[0];
    const previousEvent = eventSeries[1];
    const commercialChart = currentEvent.definition.labels.map((label, index) => {
      const historicalValues = eventSeries.slice(1).map((series) => series.values[index]).filter((value) => value != null);
      return {
        day: label,
        commercialCurrent: currentEvent.values[index],
        commercialPrevious: previousEvent.values[index],
        commercialAverage: historicalValues.length
          ? historicalValues.reduce((sum, value) => sum + value, 0) / historicalValues.length
          : null,
        currentDate: `${currentEvent.definition.dates[index].day} ${MONTHS[currentEvent.definition.dates[index].month - 1].slice(0, 3)}`,
        previousDate: `${previousEvent.definition.dates[index].day} ${MONTHS[previousEvent.definition.dates[index].month - 1].slice(0, 3)}`,
      };
    });
    const completedEventValues = currentEvent.values.filter((value) => value != null);
    const eventComplete = completedEventValues.length === currentEvent.values.length && currentEvent.spilloverAvailable;
    const currentEventTotal = completedEventValues.reduce((sum, value) => sum + value, 0) + Number(currentEvent.spillover || 0);
    const previousEventTotal = previousEvent.values.filter((value) => value != null).reduce((sum, value) => sum + value, 0)
      + Number(previousEvent.spillover || 0);
    const eventHistory = eventSeries.slice(1).map((series) => ({
      ...series,
      total: series.values.filter((value) => value != null).reduce((sum, value) => sum + value, 0) + Number(series.spillover || 0),
      carryoverTotal: series.carryover.reduce((sum, value) => sum + value, 0),
      window: `${series.definition.dates[0].day} ${MONTHS[series.definition.dates[0].month - 1].slice(0, 3)}–${series.definition.dates[series.definition.dates.length - 1].day} ${MONTHS[series.definition.dates[series.definition.dates.length - 1].month - 1].slice(0, 3)} + spillover ${series.spilloverDate.day} ${MONTHS[series.spilloverDate.month - 1].slice(0, 3)} ≤12`,
    }));
    const historicalAverageTotal = eventHistory.length
      ? eventHistory.reduce((sum, event) => sum + event.total, 0) / eventHistory.length
      : 0;
    const commercialMonthlyChart = [...eventSeries].reverse().map((series) => {
      const complete = series.values.every((value) => value != null) && series.spilloverAvailable;
      const totalValue = series.values.filter((value) => value != null).reduce((sum, value) => sum + value, 0)
        + Number(series.spillover || 0);
      return {
        day: `${MONTHS[series.month - 1].slice(0, 3)} ${String(series.year).slice(2)}${complete ? '' : '*'}`,
        fullLabel: series.label,
        window: `${series.definition.dates[0].day} ${MONTHS[series.definition.dates[0].month - 1].slice(0, 3)}–${series.definition.dates[series.definition.dates.length - 1].day} ${MONTHS[series.definition.dates[series.definition.dates.length - 1].month - 1].slice(0, 3)} + ${series.spilloverDate.day} ${MONTHS[series.spilloverDate.month - 1].slice(0, 3)} ≤12`,
        total: totalValue,
        complete,
        completedDays: series.values.filter((value) => value != null).length,
        eventCarryover: [...series.carryover, 0],
        eventSameDay: [...series.sameDay, Number(series.spillover || 0)],
        ...Object.fromEntries(series.values.map((value, index) => [`eventDay${index}`, value])),
        [`eventDay${series.values.length}`]: series.spillover,
      };
    });
    const currentEventDays = new Set(
      currentEvent.definition.dates
        .filter((date) => date.year === bounds.year && date.month === bounds.month)
        .map((date) => date.day)
    );
    const normalRevenue = Object.entries(revenue)
      .filter(([day]) => Number(day) <= actualDay && !currentEventDays.has(Number(day)))
      .map(([, value]) => value);
    const normalBaseline = normalRevenue.length
      ? normalRevenue.reduce((sum, value) => sum + value, 0) / normalRevenue.length
      : 0;
    const incrementalRevenue = currentEventTotal - normalBaseline * completedEventValues.length;
    const peakEventIndex = completedEventValues.length
      ? currentEvent.values.reduce((best, value, index, values) =>
          value != null && (values[best] == null || value > values[best]) ? index : best, 0)
      : 0;

    let currentCum = 0;
    let prevCum = 0;
    const currentDailyAvg = currentRevenue / actualDay;
    const chart = Array.from({ length: Math.max(bounds.days, bounds.prevDays) }, (_, index) => {
      const day = index + 1;
      if (day <= actualDay) currentCum += revenue[day] || 0;
      if (day <= bounds.prevDays) prevCum += prevRevenue[day] || 0;
      return {
        day,
        actual: day <= actualDay ? currentCum : null,
        projection: day >= actualDay && day <= bounds.days
          ? currentRevenue + currentDailyAvg * (day - actualDay)
          : null,
        previous: day <= bounds.prevDays ? prevCum : null,
        currentDaily: day <= actualDay ? (revenue[day] || 0) : null,
        previousDaily: day <= bounds.prevDays ? (prevRevenue[day] || 0) : null,
      };
    });

    return {
      chart,
      actualDay,
      currentRevenue,
      currentCm3,
      currentCm3Margin,
      projectedRevenue,
      projectedCm3,
      currentMonthlyOh,
      projectedProfit,
      prevRevenueFull,
      prevCm3Full,
      prevProfitFull,
      minimumRevenue,
      requiredCm3MarginAtProjection,
      targetCm3,
      targetRevenueToDate,
      targetCm3ToDate,
      revenueTargetProgress,
      cm3TargetProgress,
      requiredDaily,
      forecastGap,
      currentDailyAvg,
      behindDays,
      comparableDays,
      worstDay,
      longestStreak,
      patternCorrelation,
      operationalChart,
      currentOperationalDays,
      previousOperationalDays,
      comparableOperationalDays,
      latestOperationalCurrent,
      latestOperationalPrevious,
      latestOperationalGap,
      latestCurrentOperationalDay,
      latestPreviousOperationalDay,
      currentOperationalAverage,
      previousOperationalAverage,
      commercialChart,
      currentEvent,
      previousEvent,
      currentEventTotal,
      previousEventTotal,
      eventHistory,
      historicalAverageTotal,
      commercialMonthlyChart,
      eventComplete,
      completedEventDays: completedEventValues.length,
      incrementalRevenue,
      normalBaseline,
      peakEventIndex,
    };
  }, [data, bounds, actualTo, isActiveBrand, eventType, attributionData]);

  if (loading) {
    return <div style={{ minHeight:420, display:'grid', placeItems:'center' }}><div className="spinner" style={{ width:30, height:30, border:'3px solid var(--border)', borderTopColor:'var(--accent)', borderRadius:'50%' }} /></div>;
  }

  if (error || brandError) {
    return (
      <div style={{ background:'rgba(127,29,29,.15)', border:'1px solid #991b1b', borderRadius:12, padding:18, color:'#fca5a5' }}>
        <div style={{ fontWeight:700, marginBottom:5 }}>Sales Channel Analysis Gagal Dimuat</div>
        <div style={{ fontSize:12 }}>{error || brandError}</div>
      </div>
    );
  }

  if (!analysis || analysis.currentRevenue <= 0) {
    return <div style={{ padding:50, textAlign:'center', color:'var(--dim)', border:'1px solid var(--border)', borderRadius:12, background:'var(--card)' }}>Belum ada data revenue untuk bulan ini.</div>;
  }

  const monthLabel = `${MONTHS[bounds.month - 1]} ${bounds.year}`;
  const prevLabel = `${MONTHS[bounds.prevMonth - 1]} ${bounds.prevYear}`;
  const onTrack = analysis.projectedRevenue >= analysis.minimumRevenue;
  const projectedVsPrevious = analysis.prevRevenueFull > 0 ? analysis.forecastGap / analysis.prevRevenueFull * 100 : 0;
  const revenuePaceDelta = analysis.currentRevenue - analysis.targetRevenueToDate;
  const cm3PaceDelta = analysis.currentCm3 - analysis.targetCm3ToDate;
  const forecastTargetDelta = analysis.projectedRevenue - analysis.minimumRevenue;
  return (
    <div className="fade-in">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, marginBottom:18, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:10, color:'var(--accent)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:5 }}>Sales Channel / Analysis</div>
          <h2 style={{ margin:0, fontSize:20, fontWeight:750 }}>Sales Channel Analysis · {monthLabel}</h2>
          <div style={{ color:'var(--dim)', fontSize:11, marginTop:5 }}>Aktual s.d. hari ke-{analysis.actualDay} · dibandingkan dengan {prevLabel}</div>
        </div>
        <div style={{
          display:'flex', alignItems:'center', gap:8, padding:'8px 11px', borderRadius:9,
          background:onTrack ? 'var(--green-subtle)' : 'var(--red-subtle)',
          color:onTrack ? 'var(--green)' : 'var(--red)', fontSize:11, fontWeight:700,
          border:`1px solid ${onTrack ? 'rgba(16,185,129,.25)' : 'rgba(239,68,68,.25)'}`,
        }}>
          <span style={{ width:7, height:7, borderRadius:'50%', background:'currentColor' }} />
          {onTrack ? 'On track terhadap minimum revenue' : 'Di bawah minimum revenue'}
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:10, marginBottom:16 }}>
        <KpiCard
          label="Actual Revenue"
          value={`Rp ${fmtCompact(analysis.currentRevenue)}`}
          sub={`${(analysis.revenueTargetProgress * 100).toFixed(1)}% dari target bulanan Rp ${fmtCompact(analysis.minimumRevenue)}`}
          tone={revenuePaceDelta >= 0 ? 'var(--green)' : 'var(--red)'}
          badge={`Hari ${analysis.actualDay}`}
          delta={`Rp ${fmtCompact(Math.abs(revenuePaceDelta))}`}
          deltaPositive={revenuePaceDelta >= 0}
          deltaContext="vs pace target"
        />
        <KpiCard
          label="Estimated Revenue"
          value={`Rp ${fmtCompact(analysis.projectedRevenue)}`}
          sub={`${pct(projectedVsPrevious)} dibanding revenue penuh ${prevLabel}`}
          tone={forecastTargetDelta >= 0 ? 'var(--green)' : 'var(--red)'}
          badge="Ekstrapolasi"
          delta={`Rp ${fmtCompact(Math.abs(forecastTargetDelta))}`}
          deltaPositive={forecastTargetDelta >= 0}
          deltaContext="vs revenue floor"
        />
        <KpiCard
          label="Target Revenue"
          value={`Rp ${fmtCompact(analysis.minimumRevenue)}`}
          sub="Target revenue minimum untuk menjaga profitabilitas perusahaan"
          tone={onTrack ? 'var(--green)' : 'var(--yellow)'}
          badge="Revenue floor"
          delta={`Rp ${fmtCompact(Math.abs(forecastTargetDelta))}`}
          deltaPositive={forecastTargetDelta >= 0}
          deltaContext={forecastTargetDelta >= 0 ? 'forecast surplus' : 'forecast shortfall'}
        />
        <KpiCard
          label="CM3 vs Target"
          value={`Rp ${fmtCompact(analysis.currentCm3)}`}
          sub={`${(analysis.cm3TargetProgress * 100).toFixed(1)}% dari target bulanan Rp ${fmtCompact(analysis.targetCm3)}`}
          tone={cm3PaceDelta >= 0 ? 'var(--green)' : 'var(--red)'}
          badge={`${(analysis.currentCm3Margin * 100).toFixed(1)}% margin`}
          delta={`Rp ${fmtCompact(Math.abs(cm3PaceDelta))}`}
          deltaPositive={cm3PaceDelta >= 0}
          deltaContext="vs pace target"
        />
      </div>

      <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:'16px 16px 10px', marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:14 }}>
          <div>
            <div style={{ fontSize:14, fontWeight:700 }}>
              {chartMode === 'cumulative' && 'Revenue Kumulatif Harian'}
              {chartMode === 'operational' && 'Operational Revenue Pace'}
              {chartMode === 'commercial' && 'Commercial Moments'}
            </div>
            <div style={{ fontSize:10, color:'var(--dim)', marginTop:3 }}>
              {chartMode === 'cumulative' && 'Garis putus-putus meneruskan run-rate rata-rata bulan berjalan sampai akhir bulan.'}
              {chartMode === 'operational' && 'Revenue harian berdasarkan urutan hari yang menghasilkan revenue, bukan tanggal kalender.'}
              {chartMode === 'commercial' && `${eventType === 'twin' ? 'Twin Date H−1, Hari H, H+1' : 'Payday empat hari bergantian 24–27 dan 25–28'} · termasuk seluruh order pukul 00.00–11.59 pada hari pasca-event.`}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ display:'flex', padding:3, borderRadius:8, background:'var(--bg-deep)', border:'1px solid var(--border)' }}>
              {[
                ['cumulative', 'Run-rate'],
                ['operational', 'Operational Pace'],
                ['commercial', 'Commercial Moments'],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setChartMode(mode as any)}
                  style={{
                    padding:'6px 10px', border:0, borderRadius:6, cursor:'pointer',
                    background:chartMode === mode ? 'var(--accent)' : 'transparent',
                    color:chartMode === mode ? '#fff' : 'var(--dim)',
                    fontSize:10, fontWeight:700,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {chartMode === 'commercial' && (
          <div style={{ display:'flex', gap:6, marginBottom:12 }}>
            {[
              ['twin', 'Twin Date'],
              ['payday', 'Payday'],
            ].map(([type, label]) => (
              <button
                key={type}
                onClick={() => setEventType(type as 'twin' | 'payday')}
                style={{
                  padding:'6px 11px', borderRadius:999, cursor:'pointer',
                  border:`1px solid ${eventType === type ? 'var(--accent)' : 'var(--border)'}`,
                  background:eventType === type ? 'var(--accent-subtle)' : 'transparent',
                  color:eventType === type ? 'var(--accent)' : 'var(--dim)',
                  fontSize:10, fontWeight:700,
                }}
              >
                {label}
              </button>
            ))}
            <span style={{ alignSelf:'center', color:'var(--dim)', fontSize:9, marginLeft:4 }}>
              {eventType === 'payday' && `${analysis.currentEvent.definition.days[0]}–${analysis.currentEvent.definition.days[3]} ${MONTHS[bounds.month - 1]}`}
              {attributionLoading && ' · Memuat atribusi order…'}
            </span>
          </div>
        )}
        <div style={{ width:'100%', height:350 }}>
          <ResponsiveContainer>
            <ComposedChart
              data={chartMode === 'cumulative' ? analysis.chart : chartMode === 'operational' ? analysis.operationalChart : analysis.commercialMonthlyChart}
              margin={{ top:10, right:14, left:2, bottom:2 }}
            >
              <defs>
                <linearGradient id="actualRevenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.24} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="day" stroke="var(--dim)" tick={{ fontSize:10 }} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--dim)" tick={{ fontSize:10 }} tickLine={false} axisLine={false} tickFormatter={(value) => `${(value / 1e9).toFixed(1)}B`} width={45} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize:10, paddingTop:8 }} />
              {chartMode === 'cumulative' && (
                <>
                  <ReferenceLine y={analysis.minimumRevenue} stroke="#f59e0b" strokeDasharray="4 4" label={{ value:'Minimum', fill:'#f59e0b', fontSize:9, position:'insideTopRight' }} />
                  <Area type="monotone" dataKey="actual" name={monthLabel + ' aktual'} stroke="#3b82f6" strokeWidth={2.5} fill="url(#actualRevenueFill)" connectNulls={false} />
                  <Line type="monotone" dataKey="projection" name={monthLabel + ' prediksi'} stroke="#06b6d4" strokeWidth={2.2} strokeDasharray="7 5" dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="previous" name={prevLabel} stroke="#8b5cf6" strokeWidth={2} dot={false} />
                </>
              )}
              {chartMode === 'operational' && (
                <>
                  <Bar dataKey="operationalCurrent" name={monthLabel} fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={24} />
                  <Bar dataKey="operationalPrevious" name={prevLabel} fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={24} />
                  <ReferenceLine
                    y={analysis.currentOperationalAverage}
                    stroke="#3b82f6"
                    strokeWidth={1.25}
                    strokeDasharray="6 4"
                    label={<AverageLineLabel label={`Avg ${MONTHS[bounds.month - 1].slice(0, 3)}`} value={analysis.currentOperationalAverage} color="#3b82f6" />}
                  />
                  <ReferenceLine
                    y={analysis.previousOperationalAverage}
                    stroke="#8b5cf6"
                    strokeWidth={1.25}
                    strokeDasharray="6 4"
                    label={<AverageLineLabel label={`Avg ${MONTHS[bounds.prevMonth - 1].slice(0, 3)}`} value={analysis.previousOperationalAverage} color="#8b5cf6" />}
                  />
                </>
              )}
              {chartMode === 'commercial' && (
                <>
                  <ReferenceLine
                    y={analysis.historicalAverageTotal}
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    label={{ value:`Avg 6 event · Rp ${fmtCompact(analysis.historicalAverageTotal)}`, fill:'#f59e0b', fontSize:9, position:'insideTopRight' }}
                  />
                  {[...analysis.currentEvent.definition.labels, 'Spillover ≤12'].map((label: string, index: number) => (
                    <Bar
                      key={label}
                      dataKey={`eventDay${index}`}
                      name={label}
                      stackId="commercial-event"
                      fill={['#2563eb', '#06b6d4', '#8b5cf6', '#f97316', '#f59e0b'][index]}
                      radius={index === analysis.currentEvent.definition.labels.length ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      maxBarSize={62}
                    />
                  ))}
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {chartMode === 'commercial' && !analysis.eventComplete && (
          <div style={{ color:'var(--dim)', fontSize:9, margin:'-2px 0 4px', textAlign:'right' }}>
            * Bulan berjalan masih partial · menunggu event selesai dan cutoff spillover pukul 12.00 hari berikutnya
          </div>
        )}
      </div>

      {chartMode === 'operational' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:10, marginBottom:16 }}>
          <KpiCard
            label="Operational Day Selesai"
            value={`${analysis.currentOperationalDays.length} hari`}
            sub={`${analysis.comparableOperationalDays} hari dapat dibandingkan apple-to-apple`}
            tone="var(--accent)"
          />
          <KpiCard
            label="Gap Operational Day Terbaru"
            value={`${analysis.latestOperationalGap < 0 ? '−' : '+'}Rp ${fmtCompact(Math.abs(analysis.latestOperationalGap))}`}
            sub={`D${analysis.comparableOperationalDays}: ${analysis.latestCurrentOperationalDay} ${MONTHS[bounds.month - 1].slice(0, 3)} vs ${analysis.latestPreviousOperationalDay} ${MONTHS[bounds.prevMonth - 1].slice(0, 3)}`}
            tone={analysis.latestOperationalGap >= 0 ? 'var(--green)' : 'var(--red)'}
          />
          <KpiCard
            label="Rata-rata per Operational Day"
            value={`Rp ${fmtCompact(analysis.currentOperationalAverage)}`}
            sub={`Bulan lalu Rp ${fmtCompact(analysis.previousOperationalAverage)}`}
            tone="#06b6d4"
          />
          <KpiCard
            label="Operational Day vs Bulan Lalu"
            value={analysis.latestOperationalPrevious > 0 ? pct(analysis.latestOperationalGap / analysis.latestOperationalPrevious * 100) : '—'}
            sub={`Revenue D${analysis.comparableOperationalDays} dibanding D${analysis.comparableOperationalDays} bulan lalu`}
            tone={analysis.latestOperationalGap >= 0 ? 'var(--green)' : 'var(--red)'}
          />
        </div>
      )}

      {chartMode === 'commercial' && (
        <div style={{ marginBottom:16 }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:10, marginBottom:12 }}>
            <KpiCard
              label="Total Event Revenue"
              value={`Rp ${fmtCompact(analysis.currentEventTotal)}`}
              sub={analysis.eventComplete ? `Termasuk spillover Rp ${fmtCompact(analysis.currentEvent.spillover || 0)}` : 'Belum final sampai cutoff spillover pukul 12.00'}
              tone="var(--accent)"
            />
            <KpiCard
              label="Growth vs Event Sebelumnya"
              value={analysis.eventComplete && analysis.previousEventTotal > 0 ? pct((analysis.currentEventTotal - analysis.previousEventTotal) / analysis.previousEventTotal * 100) : 'Belum final'}
              sub={`Benchmark ${analysis.previousEvent.label}: Rp ${fmtCompact(analysis.previousEventTotal)}`}
              tone={analysis.eventComplete && analysis.currentEventTotal >= analysis.previousEventTotal ? 'var(--green)' : 'var(--yellow)'}
            />
            <KpiCard
              label="Peak Event Day"
              value={analysis.completedEventDays ? analysis.currentEvent.definition.labels[analysis.peakEventIndex] : 'Belum mulai'}
              sub={analysis.completedEventDays ? `Rp ${fmtCompact(analysis.currentEvent.values[analysis.peakEventIndex] || 0)}` : 'Belum ada revenue event'}
              tone="#8b5cf6"
            />
            <KpiCard
              label="Incremental Revenue"
              value={`${analysis.incrementalRevenue < 0 ? '−' : '+'}Rp ${fmtCompact(Math.abs(analysis.incrementalRevenue))}`}
              sub={`Di atas baseline normal Rp ${fmtCompact(analysis.normalBaseline)} per hari`}
              tone={analysis.incrementalRevenue >= 0 ? 'var(--green)' : 'var(--red)'}
            />
          </div>

          <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:14 }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:12, marginBottom:10 }}>
              <div>
                <div style={{ fontSize:12, fontWeight:700 }}>Histori 6 Event Sebelumnya</div>
                <div style={{ color:'var(--dim)', fontSize:9, marginTop:3 }}>Total event window + seluruh order sebelum pukul 12.00 pada hari berikutnya.</div>
              </div>
              <div style={{ color:'var(--dim)', fontSize:9, alignSelf:'center' }}>Terbaru → terlama</div>
            </div>
            <div className="no-scrollbar" style={{ display:'grid', gridTemplateColumns:'repeat(6, minmax(125px, 1fr))', gap:8, overflowX:'auto', paddingBottom:2 }}>
              {analysis.eventHistory.map((event: any, index: number) => {
                const older = analysis.eventHistory[index + 1];
                const growth = older?.total > 0 ? (event.total - older.total) / older.total * 100 : null;
                return (
                  <div key={`${event.year}-${event.month}`} style={{ background:'var(--bg-deep)', border:'1px solid var(--border)', borderRadius:9, padding:'10px 11px' }}>
                    <div style={{ color:'var(--text-secondary)', fontSize:10, fontWeight:700 }}>{event.label}</div>
                    <div style={{ color:'var(--dim)', fontSize:8, marginTop:2 }}>{event.window}</div>
                    <div style={{ fontFamily:'monospace', color:'var(--text)', fontSize:13, fontWeight:700, marginTop:9 }}>Rp {fmtCompact(event.total)}</div>
                    <div style={{ color:'var(--dim)', fontSize:8, marginTop:3 }}>Spillover ≤12 Rp {fmtCompact(event.spillover || 0)}</div>
                    <div style={{ color:growth == null ? 'var(--dim)' : growth >= 0 ? 'var(--green)' : 'var(--red)', fontSize:8, marginTop:3 }}>
                      {growth == null ? 'Benchmark awal' : `${pct(growth)} vs bulan sebelumnya`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:12 }}>
        <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:16 }}>
          <div style={{ fontSize:13, fontWeight:700, marginBottom:12 }}>Kebutuhan Sisa Bulan</div>
          <div style={{ display:'grid', gap:10 }}>
            {[
              ['Sisa revenue menuju minimum', Math.max(0, analysis.minimumRevenue - analysis.currentRevenue)],
              ['Kebutuhan rata-rata per hari tersisa', analysis.requiredDaily],
              ['Gap prediksi vs minimum', analysis.projectedRevenue - analysis.minimumRevenue],
            ].map(([label, value]: any) => (
              <div key={label} style={{ display:'flex', justifyContent:'space-between', gap:12, paddingBottom:9, borderBottom:'1px solid var(--border)' }}>
                <span style={{ color:'var(--dim)', fontSize:10 }}>{label}</span>
                <span style={{ fontFamily:'monospace', fontSize:11, fontWeight:700, color:value < 0 ? 'var(--red)' : 'var(--text)' }}>{value < 0 ? '−' : ''}Rp {fmtCompact(Math.abs(value))}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:16 }}>
          <div style={{ fontSize:13, fontWeight:700, marginBottom:12 }}>Efisiensi CM3</div>
          <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:8 }}>
            <span style={{ fontFamily:'monospace', fontSize:24, fontWeight:750, color:'#8b5cf6' }}>{(analysis.currentCm3Margin * 100).toFixed(1)}%</span>
            <span style={{ color:'var(--dim)', fontSize:10 }}>margin berjalan</span>
          </div>
          <div style={{ fontSize:11, color:'var(--text-secondary)', lineHeight:1.6 }}>
            Proyeksi CM3 <strong style={{ color:'var(--text)' }}>Rp {fmtCompact(analysis.projectedCm3)}</strong>.
            Pada prediksi revenue saat ini, margin CM3 yang dibutuhkan menjadi <strong style={{ color:analysis.currentCm3Margin >= analysis.requiredCm3MarginAtProjection ? 'var(--green)' : 'var(--yellow)' }}>{(analysis.requiredCm3MarginAtProjection * 100).toFixed(1)}%</strong>. Karena fixed cost menjadi anchor, kebutuhan margin akan naik ketika revenue turun.
          </div>
        </div>
      </div>
    </div>
  );
}

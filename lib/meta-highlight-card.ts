// Deterministic presentation only; safe for browser use, no publisher client.
import type { MetaLeakSnapshot } from './meta-highlight-snapshot';
import { formatChange, formatCount, formatDate, formatMetric } from './meta-format';
import { WORLD_LABELS } from './meta-funnel-templates';

const line = (value: string) => value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim();
const range = (value: { from: string; to: string }) => value.from === value.to ? formatDate(value.from) : `${formatDate(value.from)} – ${formatDate(value.to)}`;
const filterLabels: Record<string, string> = { cep: 'CEP', intention: 'Intention', objective: 'Objective', optimization: 'Optimasi', format: 'Format iklan', partnership: 'Partnership' };

export function renderMetaLeakCard(snapshot: MetaLeakSnapshot) {
  const { scope, finding, period, quality } = snapshot;
  const groupName = line(scope.group.name).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const title = `Meta Ads · Kebocoran tahap · ${line(scope.brand.name)} · ${groupName} · ${range(period.current)}`;
  const change = formatChange(finding.comparison.change_percent);
  const metric = finding.metric.label;
  const current = formatMetric(finding.comparison.current, 'percent', finding.spend.currency);
  const reference = formatMetric(finding.comparison.reference, 'percent', finding.spend.currency);
  let spend: string;
  try { spend = formatMetric(finding.spend.current, 'money', finding.spend.currency); }
  catch { spend = `${formatCount(finding.spend.current)} (${line(finding.spend.currency)}; belum terverifikasi)`; }
  const summary = `${metric} pada ${groupName} berubah ${change} dibanding periode sebelumnya (${reference} → ${current}).`;
  // Attributed Meta events may be fractional; do not round evidence to integers.
  const rawNumber = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 20 });
  const evidence = (value: { numerator: number; denominator: number }) => `${rawNumber.format(value.numerator)} ÷ ${rawNumber.format(value.denominator)}`;
  const comparison = { reference: { period: range(period.reference), value: reference, evidence: evidence(finding.evidence.reference) },
    current: { period: range(period.current), value: current, evidence: evidence(finding.evidence.current) } };
  const scopeLines = [
    `Workspace: ${line(scope.workspace.name)} (${scope.workspace.id})`, `Brand: ${line(scope.brand.name)} (${scope.brand.id})`,
    `Kanal: ${WORLD_LABELS[scope.world]}`, `Template: ${line(scope.template.name)}`, `Kelompok: ${groupName}`,
    `Akun kelompok: ${scope.group.account_names.map(line).join(', ') || 'Tidak tersedia'}`,
    `Filter: ${Object.entries(scope.filters).map(([key, value]) => `${filterLabels[key] || key} = ${line(value!)}`).join(' · ') || 'Tanpa filter tambahan'}`,
    'Zona waktu: WIB (Asia/Jakarta)', 'Business/store: tidak ditentukan oleh laporan ini.',
  ];
  const checks = [
    'Periksa kontribusi tiap iklan pada penurunan rasio untuk cakupan dan periode yang sama.',
    'Bandingkan perubahan creative, audience, dan penayangan sebelum menentukan tindakan.',
  ];
  const caution = 'Temuan ini belum menetapkan penyebab. Spend adalah konteks belanja, bukan estimasi kerugian.';
  const qualityLines = quality.status === 'blocked' ? ['TERTAHAN — belum layak diteruskan.', ...quality.blockers]
    : ['Lolos pemeriksaan dasar data; masih perlu review. Belum ada izin atau fasilitas pengiriman.'];
  qualityLines.push(...quality.notes);
  const sourceLines = [
    'Sumber: Roove BI · Meta Ads Funnel · Sorotan',
    `Snapshot dibuat: ${snapshot.generated_at} (waktu capture, bukan waktu sync)`,
    `Revisi laporan: ${snapshot.source.revision} · Aturan: ${snapshot.rule.version}`,
    `ID temuan: ${snapshot.finding_id}`, `ID snapshot: ${snapshot.snapshot_id}`,
    'Tautan snapshot permanen belum tersedia. Simpan JSON untuk mempertahankan bukti ini.',
  ];
  // Plain text, not HTML/Markdown supplied by untrusted ad/template names.
  const body = [summary, `${metric}\n${comparison.reference.period}: ${reference} (${comparison.reference.evidence})\n${comparison.current.period}: ${current} (${comparison.current.evidence})`,
    `Spend periode utama: ${spend}`, scopeLines.join('\n'), `Pemeriksaan yang disarankan\n${checks.map(v => `• ${v}`).join('\n')}`, caution,
    `Kualitas data\n${qualityLines.map(line).join('\n')}`, sourceLines.join('\n')].join('\n\n');
  return { template_version: 'basecamp-meta-leak/v1' as const, title, body, body_format: 'plain_text' as const,
    summary, metric, comparison, change, spend, scopeLines, checks, caution, qualityLines, sourceLines };
}

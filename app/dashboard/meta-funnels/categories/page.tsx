'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMetaTaxonomyConfiguration, previewMetaTaxonomyRule, saveMetaCepCategory, saveMetaTaxonomyRule, setMetaCepCategoryActive } from '@/lib/meta-ad-taxonomy-actions';
import { type CepCategory } from '@/lib/meta-ad-taxonomy';
import { mappingUnit } from '@/lib/meta-ad-mapping';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { usePermissions } from '@/lib/PermissionsContext';
import { useDateRange } from '@/lib/DateRangeContext';
import { formatCompactMoney } from '@/lib/meta-format';
import MetaIntentionCatalog from '@/components/MetaIntentionCatalog';
import { useMetaReportSession } from '@/lib/useMetaCachedLoad';
import MetaAdsNav from '@/components/MetaAdsNav';
import styles from '../page.module.css';

type Configuration = NonNullable<Awaited<ReturnType<typeof getMetaTaxonomyConfiguration>>['data']>;
type Preview = NonNullable<Awaited<ReturnType<typeof previewMetaTaxonomyRule>>['data']>;
type CategoryDraft = Pick<CepCategory, 'key' | 'label' | 'description' | 'revision'>;
const emptyCategory = (): CategoryDraft => ({ key: '', label: '', description: '', revision: 0 });

export default function CategoriesPage() {
  const session = useMetaReportSession();
  if (!session.key) return <div className={styles.page} role={session.error ? 'alert' : 'status'}>{session.error || 'Memverifikasi akses brand…'}</div>;
  return <CategoriesPageEditor key={session.key} />;
}
function CategoriesPageEditor() {
  const { activeWorkspace } = useWorkspace();
  const { can } = usePermissions();
  return <ClassificationEditor key={activeWorkspace.id} canManage={can('meta:taxonomy')} />;
}
function ClassificationEditor({ canManage }: { canManage: boolean }) {
  const { dateRange } = useDateRange();
  const [config, setConfig] = useState<Configuration | null>(null);
  const [brandId, setBrandId] = useState(0), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [dimension, setDimension] = useState<'cep' | 'intention'>('cep'), [raw, setRaw] = useState(''), [ceps, setCeps] = useState<string[]>([]), [intention, setIntention] = useState('disc');
  const [preview, setPreview] = useState<{ signature: string; result: Preview } | null>(null);
  const [category, setCategory] = useState<CategoryDraft | null>(null);
  const [retiring, setRetiring] = useState<CepCategory | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const load = useCallback(async () => {
    const r = await getMetaTaxonomyConfiguration();
    if (r.error) { setError(r.error); return; }
    if (r.data) {
      setConfig(r.data);
      setBrandId(id => r.data.brands.some(b => b.id === id) ? id : r.data.brands.find(b => b.name.toLowerCase() === 'roove')?.id || r.data.brands[0]?.id || 0);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    void getMetaTaxonomyConfiguration().then(r => {
      if (!alive) return;
      if (r.error) setError(r.error);
      else if (r.data) { setConfig(r.data); setBrandId(r.data.brands.find(b => b.name.toLowerCase() === 'roove')?.id || r.data.brands[0]?.id || 0); }
    }).catch(() => { if (alive) setError('Konfigurasi belum berhasil dimuat.'); });
    return () => { alive = false; };
  }, []);
  const brand = config?.brands.find(b => b.id === brandId);
  const catalog = config?.catalog.filter(c => c.brand_id === brandId) || [];
  const active = catalog.filter(c => c.is_active !== false), inactive = catalog.filter(c => c.is_active === false);
  const intentions = config?.intentions.filter(c => c.brand_id === brandId) || [];
  const rules = config?.rules.filter(r => r.brand_id === brandId) || [];
  const rule = rules.find(r => r.dimension === dimension && r.raw_key === mappingUnit(dimension, raw).key);
  const ruleChoices = catalog.filter(c => c.is_active !== false || rule?.cep_keys.includes(c.key));
  const input = useMemo(() => ({ brandId, dimension, raw, ceps, intention, revision: config?.rules.find(r => r.brand_id === brandId && r.dimension === dimension && r.raw_key === mappingUnit(dimension, raw).key)?.revision || 0, from: dateRange.from, to: dateRange.to }), [brandId, dimension, raw, ceps, intention, config, dateRange.from, dateRange.to]);
  const signature = JSON.stringify(input), validPreview = preview?.signature === signature ? preview.result : null;
  async function run(work: () => Promise<{ error?: string; data?: unknown }>, success: string, after?: () => void) {
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await work();
      if (r.error) setError(r.error);
      else { setNotice(success); after?.(); await load(); }
    } catch { setError('Koneksi terputus. Silakan muat ulang dan coba lagi.'); }
    finally { setBusy(false); }
  }
  const editCategory = (c?: CepCategory) => { setRetiring(null); setCategory(c ? { key: c.key, label: c.label, description: c.description, revision: c.revision } : emptyCategory()); };
  const cepLabel = (key: string) => { const c = catalog.find(c => c.key === key); return `${c?.label || key}${c?.is_active === false ? ' (nonaktif)' : ''}`; };

  return <div className={`${styles.page} ${styles.taxonomyGrid}`}>
    <MetaAdsNav title="Kategori iklan" subtitle="Tentukan CEP yang ingin ditargetkan setiap brand, lalu petakan iklannya." />
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.info}>{notice}</p>}
    {!config ? <p role="status">{error ? 'Konfigurasi belum tersedia.' : 'Memuat kategori…'}</p> : <>
      <label className={styles.taxonomyBrand}>Brand<select value={brandId} disabled={busy} onChange={e => {
        setBrandId(Number(e.target.value)); setCeps([]); setRaw(''); setPreview(null); setCategory(null); setRetiring(null); setShowInactive(false); setNotice(''); setError('');
      }}>{config.brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>

      <section className={styles.card} aria-labelledby="cep-heading">
        <div className={styles.sectionHeader}>
          <div><h2 id="cep-heading">CEP {brand?.name}</h2><p className={styles.muted}>{active.length} aktif · {inactive.length} nonaktif</p></div>
          {canManage && <button className={styles.primary} disabled={busy} onClick={() => editCategory()}>+ Tambah CEP</button>}
        </div>
        <p>Satu iklan boleh memiliki beberapa CEP. Nilai iklan masuk penuh ke setiap CEP yang dipilih; total brand tetap dihitung sekali.</p>
        {!active.length && <p>Belum ada CEP aktif. Tambahkan CEP atau aktifkan kembali kategori yang sudah ada.</p>}
        {catalog.filter(c => c.is_active !== false || showInactive).map(c => <div key={c.key} className={styles.cepCategoryRow}>
          <div><div className={styles.cepCategoryTitle}><b>{c.label}</b><span className={c.is_active === false ? styles.cepInactive : styles.cepActive}>{c.is_active === false ? 'Nonaktif' : 'Aktif'}</span></div><p className={styles.muted}>{c.description || 'Definisi belum ditambahkan.'}</p></div>
          {canManage && <div className={styles.actions}>
            <button className={styles.button} disabled={busy} onClick={() => editCategory(c)} aria-label={`Edit CEP ${c.label}`}>Edit</button>
            <button className={styles.button} disabled={busy} onClick={() => c.is_active === false
              ? void run(() => setMetaCepCategoryActive({ brandId, key: c.key, revision: c.revision, active: true }), `${c.label} aktif kembali.`, () => { setCategory(null); setRetiring(null); })
              : (setCategory(null), setRetiring(c))}>{c.is_active === false ? 'Aktifkan kembali' : 'Nonaktifkan'}</button>
          </div>}
        </div>)}
        {!!inactive.length && <button className={styles.button} disabled={busy} onClick={() => setShowInactive(!showInactive)}>{showInactive ? 'Sembunyikan CEP nonaktif' : `Tampilkan ${inactive.length} CEP nonaktif`}</button>}
        {retiring && <div role="region" aria-label={`Konfirmasi nonaktifkan ${retiring.label}`} className={styles.cepLifecycleNotice}>
          <b>Nonaktifkan {retiring.label}?</b>
          <p>CEP ini tidak akan ditawarkan untuk pemetaan atau aturan baru. Pemetaan lama dan laporan tetap tersimpan. Anda bisa mengaktifkannya kembali kapan saja.</p>
          <p>{rules.filter(r => r.dimension === 'cep' && r.cep_keys.includes(retiring.key)).length} aturan yang memakai CEP ini tetap berlaku, termasuk untuk iklan baru yang cocok. Ubah aturan tersebut jika ingin menghentikan pemetaan otomatisnya.</p>
          <div className={styles.actions}><button className={styles.primary} disabled={busy} onClick={() => void run(() => setMetaCepCategoryActive({ brandId, key: retiring.key, revision: retiring.revision, active: false }), `${retiring.label} dinonaktifkan. Riwayat pemetaan tetap tersimpan.`, () => setRetiring(null))}>Ya, nonaktifkan CEP</button><button className={styles.button} disabled={busy} onClick={() => setRetiring(null)}>Batal</button></div>
        </div>}
        {category && <form className={`${styles.taxonomyForm} ${styles.cepCategoryForm}`} aria-label={category.revision ? 'Edit CEP' : 'Tambah CEP'} onSubmit={e => {
          e.preventDefault(); void run(() => saveMetaCepCategory({ brandId, ...category }), category.revision ? 'Definisi CEP diperbarui.' : 'CEP baru ditambahkan. Petakan iklan melalui Pemetaan Ads atau aturan di bawah.', () => setCategory(null));
        }}>
          <h3>{category.revision ? 'Edit CEP' : 'Tambah CEP'}</h3>
          <label>Nama CEP<input autoFocus required maxLength={100} value={category.label} placeholder="Contoh: Aktivitas harian" onChange={e => setCategory({ ...category, label: e.target.value })} /></label>
          <label>Definisi<textarea required maxLength={1000} rows={3} value={category.description} placeholder="Kebutuhan atau situasi apa yang ditargetkan CEP ini?" onChange={e => setCategory({ ...category, description: e.target.value })} /></label>
          <div className={styles.actions}><button className={styles.primary} disabled={busy || !category.label.trim() || !category.description.trim()}>{busy ? 'Menyimpan…' : 'Simpan CEP'}</button><button type="button" className={styles.button} disabled={busy} onClick={() => setCategory(null)}>Batal</button></div>
        </form>}
        <p className={styles.muted}>CEP nonaktif tetap tersedia pada laporan historis. Kategori diarsipkan melalui status nonaktif agar riwayatnya tidak terhapus.</p>
      </section>

      <MetaIntentionCatalog key={brandId} brandId={brandId} catalog={intentions} canManage={canManage} onSaved={load} />
      <section className={styles.card}><h2>Aturan pemetaan</h2><p>Hubungkan istilah pada nama iklan ke kategori resmi. Aturan berlaku untuk iklan lama maupun baru; koreksi manual tetap dipertahankan.</p>
        {!rules.length && <p className={styles.muted}>Belum ada aturan tambahan untuk brand ini.</p>}
        {rules.map(r => <div className={styles.unitRow} key={`${r.dimension}:${r.raw_key}`}><span><b>{r.raw_key}</b> → {r.dimension === 'cep' ? r.cep_keys.map(cepLabel).join(' · ') : intentions.find(c => c.key === r.intention_key)?.label || r.intention_key}</span>{canManage && <button className={styles.button} disabled={busy} onClick={() => { setDimension(r.dimension); setRaw(r.raw_key); setCeps(r.cep_keys); setIntention(r.intention_key || 'disc'); setPreview(null); }}>Edit aturan</button>}</div>)}
        {canManage && <form className={styles.taxonomyForm} onSubmit={e => {
          e.preventDefault(); void (async () => {
            setBusy(true); setError('');
            try { const r = await previewMetaTaxonomyRule(input); if (r.error) setError(r.error); else if (r.data) setPreview({ signature, result: r.data }); }
            catch { setError('Pratinjau belum berhasil dimuat. Silakan coba lagi.'); }
            finally { setBusy(false); }
          })();
        }}>
          <label>Dimensi<select value={dimension} onChange={e => { setDimension(e.target.value as 'cep' | 'intention'); setCeps([]); }}><option value="cep">CEP</option><option value="intention">Intention</option></select></label>
          <label>Istilah yang terbaca dari nama iklan<input required maxLength={500} value={raw} onChange={e => { setRaw(e.target.value); setCeps([]); }} placeholder={dimension === 'cep' ? 'Contoh: sport' : 'Contoh: edukasi'} /></label>
          {dimension === 'cep' ? <fieldset><legend>Petakan ke CEP</legend>{ruleChoices.map(c => <label key={c.key}><input type="checkbox" checked={ceps.includes(c.key)} disabled={c.is_active === false && !ceps.includes(c.key)} onChange={e => setCeps(e.target.checked ? [...ceps, c.key] : ceps.filter(k => k !== c.key))} />{cepLabel(c.key)}</label>)}</fieldset> : <label>Intention<select value={intention} onChange={e => setIntention(e.target.value)}>{intentions.filter(c => c.is_active !== false || c.key === rule?.intention_key).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>}
          <button className={styles.button} disabled={busy || !raw.trim() || (dimension === 'cep' && !ceps.length)}>Pratinjau pemetaan</button>
          {validPreview && <div className={styles.info}><b>{validPreview.eligible} iklan akan memakai aturan ini</b><p>{validPreview.manualPreserved} koreksi manual dipertahankan dari {validPreview.matched} iklan dengan istilah yang sama.</p><p>Spend periode terpilih: {Object.entries(validPreview.spendByCurrency).map(([currency, spend]) => formatCompactMoney(spend, currency)).join(' · ') || 'Tidak ada spend tercatat.'}</p>
            {validPreview.samples.map(a => <p key={`${a.account_id}:${a.ad_id}`}>{a.ad_name}</p>)}<p>Pengelompokan laporan historis ikut berubah; angka performa asli tetap. Perubahan dicatat untuk audit.</p>
            <button type="button" className={styles.primary} disabled={busy} onClick={() => void run(() => saveMetaTaxonomyRule(input), 'Aturan disimpan dan berlaku untuk iklan lama maupun baru.', () => setPreview(null))}>Terapkan aturan untuk brand ini</button>
          </div>}
        </form>}
      </section>
    </>}
  </div>;
}

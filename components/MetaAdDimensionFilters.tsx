'use client';
import type { AdDimensionFilters, dimensionOptions } from '@/lib/meta-ad-dimensions';
import styles from '@/app/dashboard/meta-funnels/page.module.css';
type Options = ReturnType<typeof dimensionOptions>;
export default function MetaAdDimensionFilters({ value, options, ready, onChange }: { value: AdDimensionFilters; options: Options; ready: boolean; onChange: (value:AdDimensionFilters)=>void }) {
  const select=(dimension:keyof AdDimensionFilters,label:string,choices:Options['ceps'],total:number)=><label>{label}<select disabled={!ready} title="Jumlah ad pada periode, monitoring, dan filter lainnya yang dipilih" value={value[dimension] || ''} onChange={e=>onChange({...value,[dimension]:e.target.value || undefined})}>
    <option value="">Semua {dimension === 'objective' ? 'objective' : dimension === 'cep' ? 'CEP' : 'intention'} ({total})</option>{choices.map(o=><option key={o.value} value={o.value}>{o.label} ({o.count})</option>)}
  </select></label>;
  return <div className={styles.dimensionFilters}>
    {select('cep','CEP',options.ceps,options.cepTotal)}{select('intention','Intention',options.intentions,options.intentionTotal)}{select('objective','Objective Meta',options.objectives,options.objectiveTotal)}
    {(value.cep || value.objective || value.intention) && <button className={styles.button} onClick={()=>onChange({})}>Reset filter</button>}
  </div>;
}

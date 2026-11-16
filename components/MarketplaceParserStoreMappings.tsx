'use client';

import { useMemo, useState } from 'react';
import type { Catalog, MarketplaceAccount, RouteDecision } from '@/lib/marketplace-parser/types';
import styles from './MarketplaceParserTool.module.css';

type Props = { accounts: MarketplaceAccount[]; catalog: Catalog };

export default function MarketplaceParserStoreMappings({ accounts, catalog }: Props) {
  const [query, setQuery] = useState('');
  const mappings = useMemo(() => {
    const accountNames = new Map(accounts.map(account => [account.id, account.label]));
    const storeNames = new Map(catalog.stores.map(store => [store.id, store.name]));
    const latest = new Map<string, RouteDecision>();

    for (const decision of catalog.decisions || []) {
      const key = JSON.stringify([decision.account, decision.business, decision.caseKey]);
      if (decision.revision > (latest.get(key)?.revision ?? 0)) latest.set(key, decision);
    }

    return Array.from(latest.values(), decision => ({
      id: decision.id,
      account: accountNames.get(decision.account) || decision.accountLabel || decision.account,
      business: decision.business,
      items: decision.items,
      store: storeNames.get(decision.storeId) || decision.storeName || `Store #${decision.storeId}`,
    })).sort((a, b) => a.account.localeCompare(b.account, 'id') || a.business.localeCompare(b.business)
      || a.items[0].sku.localeCompare(b.items[0].sku, 'id') || a.store.localeCompare(b.store, 'id'));
  }, [accounts, catalog.decisions, catalog.stores]);

  const search = query.trim().toLowerCase();
  const visible = search ? mappings.filter(mapping =>
    [mapping.account, mapping.business, mapping.store, ...mapping.items.map(item => item.sku)]
      .some(value => value.toLowerCase().includes(search))
  ) : mappings;

  return <details>
    <summary>Mapping bundle ke Store <span>{mappings.length} mapping</span></summary>
    {mappings.length === 0 ? <p>Belum ada mapping. Pilih Store pada preview order lalu klik Gunakan &amp; simpan.</p> : <>
      <label className={styles.search}>Cari akun, SKU, atau Store
        <input type="search" value={query} onChange={event => setQuery(event.target.value)}/>
      </label>
      {visible.length === 0 ? <p role="status">Tidak ada mapping yang cocok dengan pencarian.</p> :
        <div className={`${styles.tableWrap} ${styles.mappingList}`} tabIndex={0} role="region" aria-label="Daftar mapping tersimpan">
          <table aria-label="Mapping bundle ke Store">
            <thead><tr><th scope="col">Akun asal</th><th scope="col">SKU atau kombinasi SKU</th><th scope="col">Store tujuan</th></tr></thead>
            <tbody>{visible.map(mapping => <tr key={mapping.id}>
              <td>{mapping.account}<small>{mapping.business}</small></td>
              <td>{mapping.items.length === 1 ? <>{mapping.items[0].sku}<small>Semua jumlah</small></> :
                mapping.items.map(item => <div key={JSON.stringify([item.bundleId, item.sku])}>{item.sku} × {item.quantity}</div>)}</td>
              <td>{mapping.store}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </>}
  </details>;
}

// Minimal queryable catalog fixture. Filters really apply, so cross-workspace,
// exact identifier and pagination tests cannot accidentally accept all rows.
export function diagnosisDb(tables: Record<string,any[]>, beforeRead?: (table: string, count: number) => void) {
  const queries: { table: string; columns: string; filters: [string,string,unknown][] }[] = [];
  const reads: Record<string,number> = {};
  return { queries, from(table: string) {
    const query = { table,columns: '',filters: [] as [string,string,unknown][] };
    let start = 0, end = Infinity, order = '';
    const q: any = {
      select(columns: string) { query.columns = columns; return q; },
      eq(key: string,value: unknown) { query.filters.push(['eq',key,value]); return q; },
      in(key: string,value: unknown[]) { query.filters.push(['in',key,value]); return q; },
      order(key: string) { order = key; return q; },
      range(from: number,to: number) { start = from; end = to; return q; },
      then(resolve: (result: unknown) => void) {
        beforeRead?.(table,reads[table] = (reads[table] || 0) + 1);
        queries.push(query);
        const rows = (tables[table] || []).filter(row => query.filters.every(([op,key,value]) => op === 'eq' ? row[key] === value : (value as unknown[]).includes(row[key])));
        if (order) rows.sort((a,b) => String(a[order]).localeCompare(String(b[order]),'en',{ numeric: true }));
        return resolve({ data: rows.slice(start,end + 1).map(row => Object.fromEntries(query.columns.split(',').map(key => [key,row[key]]))),error: null });
      },
    };
    return q;
  } };
}

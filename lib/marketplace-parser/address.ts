import type { CsvRow, SourceOrder } from './types';

function shopeeSubdistrict(address: string, city: string, province: string): string {
  const normalize = (value: string) => value.trim().toLocaleLowerCase('id');
  const cityKey = normalize(city);
  const provinceKey = normalize(province);
  if (!cityKey || !provinceKey) return '';

  // In the orders export the administrative suffix contains city, district, province.
  // Keep empty segments: dropping one could turn a different address part into the district.
  const parts = address.split(',').map(part => part.trim());
  const candidates = parts.filter((_, i) =>
    i > 0 && i + 1 < parts.length &&
    normalize(parts[i - 1]) === cityKey && normalize(parts[i + 1]) === provinceKey
  );
  if (candidates.length !== 1) return '';
  const [district] = candidates;
  return /^\p{L}[\p{L}\p{M}\d .()'-]*$/u.test(district) ? district : '';
}

export function orderAddress(source: SourceOrder): Pick<CsvRow, 'address' | 'subdistrict' | 'city'> {
  // Raw cells are also present in archived batches created before address mapping.
  const raw = source.lines[0]?.raw ?? {};
  if (source.platform === 'tiktokshop') {
    return {
      address: raw['Detail Address'] ?? '',
      subdistrict: raw.Districts ?? '',
      city: raw['Regency and City'] ?? '',
    };
  }
  if (source.platform === 'shopee') {
    const address = raw['Alamat Pengiriman'] ?? '';
    const city = raw['Kota/Kabupaten'] ?? '';
    return { address, subdistrict: shopeeSubdistrict(address, city, raw.Provinsi ?? ''), city };
  }
  return { address: '', subdistrict: '', city: '' };
}

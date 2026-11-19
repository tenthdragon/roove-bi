// All arithmetic uses integer hundredths of IDR. Unknown != zero.
export function moneyCents(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  // Numeric Excel cells have no locale separators. Never interpret a numeric
  // 1.234 as the localized string "1.234" (one thousand two hundred thirty four).
  if (typeof value === 'number' && (!Number.isFinite(value) || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value)))) throw new Error('Nominal angka harus memiliki maksimal dua angka desimal.');
  let s = String(value).trim().replace(/^(?:Rp\.?|IDR)\s*/i, '').replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g,'').replace(',','.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g,'');
  else if (/^-?\d+(,\d{1,2})$/.test(s)) s = s.replace(',','.');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) throw new Error('Format nominal tidak valid.');
  const negative = s.startsWith('-');const [whole,fraction=''] = s.replace('-','').split('.');
  const amount = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(amount)) throw new Error('Nominal terlalu besar.');
  return negative ? -amount : amount;
}
export function centsText(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('Nominal bukan nilai eksak.');
  const abs=Math.abs(cents);const whole=Math.floor(abs/100);const remainder=abs%100;
  return `${cents<0?'-':''}${whole}${remainder?'.'+String(remainder).padStart(2,'0').replace(/0$/,''):''}`;
}
// At most two price groups preserve both the source quantity and exact subtotal.
// BigInt also keeps division/remainders exact near Number.MAX_SAFE_INTEGER.
export function allocateUnitPrices(totalCents: number, quantity: number) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1000000) {
    throw new Error('Total dan quantity tidak valid untuk pembagian harga.');
  }
  const total = BigInt(totalCents), count = BigInt(quantity);
  const base = total / count, remainder = Number(total % count);
  return [
    { quantity: quantity - remainder, unitCents: Number(base) },
    ...(remainder ? [{ quantity: remainder, unitCents: Number(base + BigInt(1)) }] : []),
  ];
}
export function quantity(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const n=Number(value);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 1000000) throw new Error('Quantity harus bilangan bulat positif, maksimal 1.000.000.');
  return n;
}

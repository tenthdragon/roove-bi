const UNKNOWN = '__unknown__';
// Escape the separator and the escape marker, preserving ordinary tag keys.
// Migration 216 applies the same replacements before concatenating the parts.
const encodePart = (value: string) => value.replace(/%/g, '%25').replace(/:/g, '%3A');
export function cepGroupKey(cep: string | null | undefined, intention: string | null | undefined) {
  return `cep:${encodePart(cep ?? UNKNOWN)}:${encodePart(intention ?? UNKNOWN)}`;
}
export function parseCepKey(key: string): { cep: string; intention: string } | null {
  const match = key.match(/^cep:([^:]*):([^:]*)$/);
  if (!match) return null;
  try {
    return { cep: decodeURIComponent(match[1]) || UNKNOWN, intention: decodeURIComponent(match[2]) || UNKNOWN };
  } catch { return null; }
}

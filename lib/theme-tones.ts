// Theme-aware text colors for hues that used to be hardcoded as hex values.
//
// Palette hex values (e.g. '#8b5cf6', '#fca5a5') read well on the dark theme
// but drop well below WCAG AA on the light theme. Each --tone-* token in
// app/globals.css resolves to a light-theme shade (Tailwind 700/800) and a
// dark-theme shade (Tailwind 300) that both keep >= 4.5:1 on cards and tinted
// backgrounds. Keep raw hex values for fills, strokes and `${hex}20` alpha
// tints; route anything rendered as text through toneText().

const TONES: Record<string, readonly string[]> = {
  red: ['#fca5a5', '#fecaca', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#ff6b6b', '#f43f5e', '#fb7185'],
  orange: ['#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c'],
  amber: ['#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#facc15', '#eab308', '#fef08a'],
  green: ['#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#25d366'],
  emerald: ['#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857'],
  teal: ['#5eead4', '#2dd4bf', '#14b8a6', '#0d9488'],
  cyan: ['#67e8f9', '#22d3ee', '#06b6d4', '#0891b2', '#00f2ea'],
  sky: ['#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#00a5f4'],
  blue: ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1877f2'],
  indigo: ['#a5b4fc', '#818cf8', '#6366f1', '#a0aaff'],
  violet: ['#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9'],
  purple: ['#d8b4fe', '#c084fc', '#a855f7'],
  pink: ['#f9a8d4', '#f472b6', '#ec4899'],
  shopee: ['#ee4d2d'],
};

const NEUTRALS: Record<string, string> = {
  '#94a3b8': 'var(--dim)',
  '#64748b': 'var(--dim)',
};

export const TONE_TEXT_BY_HEX: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(TONES).flatMap(([tone, hexes]) => hexes.map((hex) => [hex, `var(--tone-${tone})`])),
  ),
  ...NEUTRALS,
};

/** Map a palette color to a readable text color for the active theme. Unknown values pass through. */
export function toneText<T extends string | null | undefined>(color: T): T | string {
  if (typeof color !== 'string') return color;
  return TONE_TEXT_BY_HEX[color.trim().toLowerCase()] ?? color;
}

// Solid shades that keep >= 4.5:1 against white text, for pills and buttons
// whose fill comes from the same palette as above.
const SOLID_BY_TONE: Record<string, string> = {
  red: '#b91c1c',
  orange: '#c2410c',
  amber: '#b45309',
  green: '#15803d',
  emerald: '#047857',
  teal: '#0f766e',
  cyan: '#0e7490',
  sky: '#0369a1',
  blue: '#1d4ed8',
  indigo: '#4338ca',
  violet: '#6d28d9',
  purple: '#7e22ce',
  pink: '#be185d',
  shopee: '#c2381a',
};

const SOLID_BY_VALUE: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(TONES).flatMap(([tone, hexes]) => hexes.map((hex) => [hex, SOLID_BY_TONE[tone]])),
  ),
  '#94a3b8': 'var(--muted-solid)',
  '#64748b': 'var(--muted-solid)',
  'var(--accent)': 'var(--accent-solid)',
  'var(--green)': 'var(--green-solid)',
  'var(--red)': 'var(--red-solid)',
  'var(--yellow)': 'var(--yellow-solid)',
  'var(--dim)': 'var(--muted-solid)',
  'var(--text-muted)': 'var(--muted-solid)',
};

/** Map a palette color to a fill that white text stays readable on. Unknown values pass through. */
export function toneFill<T extends string | null | undefined>(color: T): T | string {
  if (typeof color !== 'string') return color;
  return SOLID_BY_VALUE[color.trim().toLowerCase()] ?? color;
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { TONE_TEXT_BY_HEX, toneFill, toneText } from '../lib/theme-tones';

type Rgba = [number, number, number, number];

const css = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `missing ${selector} block`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return Object.fromEntries(
    [...css.slice(open + 1, close).matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

function parse(color: string): Rgba {
  if (color.startsWith('#')) {
    const hex = color.length === 4 ? color.slice(1).split('').map((c) => c + c).join('') : color.slice(1);
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1) as Rgba;
  }
  const parts = color.match(/rgba?\(([^)]+)\)/)?.[1].split(',').map(Number);
  assert.ok(parts, `unparseable color ${color}`);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

const blend = (top: Rgba, under: Rgba): Rgba =>
  [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as Rgba;

const luminance = ([r, g, b]: Rgba) =>
  [r, g, b]
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

function contrast(fg: string, bg: string, base: string): number {
  const under = parse(base);
  const background = parse(bg)[3] < 1 ? blend(parse(bg), under) : parse(bg);
  const a = luminance(parse(fg));
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const SURFACES = ['bg', 'bg-deep', 'card', 'card-hover', 'input-bg'];
const TINTS = ['accent-subtle', 'green-subtle', 'red-subtle', 'yellow-subtle', 'badge-green-bg', 'badge-yellow-bg', 'badge-red-bg'];
const SOLIDS = ['accent-solid', 'green-solid', 'red-solid', 'yellow-solid', 'muted-solid', 'accent-hover'];

for (const theme of ['light', 'dark'] as const) {
  const t = tokens(`[data-theme='${theme}'] {`);

  test(`${theme}: every text token keeps WCAG AA on surfaces and tints`, () => {
    const textTokens = ['text', 'text-secondary', 'dim', 'text-muted', 'accent', 'green', 'red', 'yellow', 'delta-up', 'delta-down',
      ...Object.keys(t).filter((key) => key.startsWith('tone-'))];
    for (const fg of textTokens) {
      for (const bg of [...SURFACES, ...TINTS]) {
        const ratio = contrast(t[fg], t[bg], t.card);
        assert.ok(ratio >= 4.5, `${theme} --${fg} on --${bg} is ${ratio.toFixed(2)}:1`);
      }
    }
  });

  test(`${theme}: white text stays readable on solid fills`, () => {
    for (const bg of SOLIDS) {
      const ratio = contrast(t['on-solid'], t[bg], t.card);
      assert.ok(ratio >= 4.5, `${theme} --on-solid on --${bg} is ${ratio.toFixed(2)}:1`);
    }
  });
}

test('toneText maps palette hexes to defined tone tokens and passes other values through', () => {
  const defined = new Set(Object.keys(tokens("[data-theme='light'] {")));
  for (const value of new Set(Object.values(TONE_TEXT_BY_HEX))) {
    const name = value.match(/^var\(--([\w-]+)\)$/)?.[1];
    assert.ok(name && defined.has(name), `${value} is not defined in globals.css`);
  }
  assert.equal(toneText('#FCA5A5'), 'var(--tone-red)');
  assert.equal(toneText('var(--text)'), 'var(--text)');
  assert.equal(toneText(undefined), undefined);
});

test('toneFill returns fills that hold white text', () => {
  const light = tokens("[data-theme='light'] {");
  for (const hex of Object.keys(TONE_TEXT_BY_HEX)) {
    const fill = toneFill(hex);
    const resolved = fill.startsWith('var(') ? light[fill.slice(6, -1)] : fill;
    const ratio = contrast('#ffffff', resolved, '#ffffff');
    assert.ok(ratio >= 4.5, `toneFill(${hex}) -> ${fill} is ${ratio.toFixed(2)}:1 with white`);
  }
  assert.equal(toneFill('var(--green)'), 'var(--green-solid)');
  assert.equal(toneFill('#005BAA'), '#005BAA');
});

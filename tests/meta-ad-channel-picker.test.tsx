import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';

Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
require.extensions['.css'] = (_module: any) => {
  _module.exports = { default: new Proxy({}, { get: (_target, name) => String(name) }) };
};
const MetaAdChannelPicker = require('../components/MetaAdChannelPicker').default as typeof import('../components/MetaAdChannelPicker').default;

test('channel picker exposes three accessible choices with the selected state', () => {
  const html = renderToStaticMarkup(<MetaAdChannelPicker value="cpas" onChange={() => {}} />);
  assert.match(html, /role="group" aria-label="Jenis iklan"/);
  assert.match(html, /aria-pressed="false"[^>]*>.*Non-CPAS/s);
  assert.match(html, /aria-pressed="true"[^>]*>.*CPAS/s);
  assert.match(html, /aria-pressed="false"[^>]*>.*Perlu verifikasi/s);
  assert.equal((html.match(/<button\b/g) || []).length, 3);
  assert.doesNotMatch(html, />\s*(Semua|All)\s*</i);
});

test('channel labels have concise descriptions and counts use Indonesian formatting', () => {
  const html = renderToStaticMarkup(<MetaAdChannelPicker
    value="unknown"
    counts={{ non_cpas: 1234, cpas: 0, unknown: 7 }}
    onChange={() => {}}
  />);
  assert.match(html, /Tanpa tujuan atau katalog Shopee/);
  assert.match(html, /Tujuan atau katalog Shopee/);
  assert.match(html, /Data tujuan belum lengkap atau belum terverifikasi/);
  assert.match(html, /1\.234/);
  assert.match(html, />0</);
  assert.match(html, />7</);
});

test('loading disables all choices and no aggregate choice is rendered', () => {
  const html = renderToStaticMarkup(<MetaAdChannelPicker value="non_cpas" loading onChange={() => {}} />);
  assert.equal((html.match(/<button\b[^>]*disabled=""/g) || []).length, 3);
  assert.doesNotMatch(html, /Semua jenis|Semua iklan|All ads/i);
});

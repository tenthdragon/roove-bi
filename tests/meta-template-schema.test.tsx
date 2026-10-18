import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import MetaTemplateSuggestionButton from '../components/MetaTemplateSuggestionButton';
import { assertMetaTemplateMutation, META_TEMPLATE_SCHEMA_MESSAGE, metaTemplateFailure, MetaTemplateSchemaNotReadyError } from '../lib/meta-template-settings';

test('missing template tables produce a safe error code while retaining migration diagnostics for logs', () => {
  for (const code of ['42P01', 'PGRST205']) {
    const databaseError = { code, message: 'private schema detail' };
    try {
      assertMetaTemplateMutation(databaseError);
      assert.fail('Missing schema must reject the mutation');
    } catch (error) {
      assert.ok(error instanceof MetaTemplateSchemaNotReadyError);
      assert.match(error.message, /211_meta_landing_page_templates.sql/);
      assert.equal(error.cause, databaseError);
      const result = metaTemplateFailure(error, 'Mutation failed');
      assert.deepEqual(result, { code: 'TEMPLATE_SCHEMA_NOT_READY', error: META_TEMPLATE_SCHEMA_MESSAGE });
      assert.doesNotMatch(JSON.stringify(result), /private|211_|migration/);
    }
  }
  assert.doesNotThrow(() => assertMetaTemplateMutation(null));
});

test('unrelated database failures remain generic and do not claim a missing migration', () => {
  try {
    assertMetaTemplateMutation({ code: '42501', message: 'private database permissions' });
    assert.fail('Database error expected');
  } catch (error) {
    assert.deepEqual(metaTemplateFailure(error, 'Belum berhasil disimpan.'), { error: 'Belum berhasil disimpan.' });
  }
  assert.deepEqual(metaTemplateFailure(new Error('URL tidak valid.'), 'Gagal'), { error: 'URL tidak valid.' });
});

test('suggestions cannot submit while template schema is unavailable or a mutation is pending', () => {
  let submitted = 0;
  for (const [rulesReady, busy] of [[false, false], [true, true], [false, true]]) {
    const props = { rulesReady, busy, onApply: () => { submitted++; } };
    const html = renderToStaticMarkup(<MetaTemplateSuggestionButton {...props} />);
    assert.match(html, /disabled=""/);
    if (!rulesReady) assert.ok(html.includes(META_TEMPLATE_SCHEMA_MESSAGE));
    MetaTemplateSuggestionButton(props).props.onClick();
  }
  assert.equal(submitted, 0);
  const ready = { rulesReady: true, busy: false, onApply: () => { submitted++; } };
  assert.doesNotMatch(renderToStaticMarkup(<MetaTemplateSuggestionButton {...ready} />), /disabled|title=/);
  MetaTemplateSuggestionButton(ready).props.onClick();
  assert.equal(submitted, 1);
});

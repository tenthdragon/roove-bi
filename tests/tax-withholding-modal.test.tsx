import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { ModalShell } from '../components/TaxWithholdingShared';

const require = createRequire(import.meta.url);
const { create, act } = require('react-test-renderer');

test('dialog dismissal protects dirty inputs, blocks while busy and removes unload guard after save', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const listeners = new Map<string, (event: any) => void>();
  let confirmDiscard = false, prompts = 0, closed = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    confirm: () => { prompts++; return confirmDiscard; },
    addEventListener: (name: string, callback: any) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  } });
  let renderer: any;
  const tree = (dirty: boolean, busy: boolean) => <ModalShell title="Edit" onClose={() => closed++} dirty={dirty} busy={busy}><input defaultValue="Invoice" /></ModalShell>;
  const cancel = async () => {
    let prevented = false;
    await act(async () => renderer.root.findByType('dialog').props.onCancel({ preventDefault: () => { prevented = true; } }));
    assert.equal(prevented, true, 'native Escape must not bypass the guard');
  };
  try {
    await act(async () => { renderer = create(tree(true, false)); });
    await cancel();
    assert.equal(closed, 0);
    assert.equal(prompts, 1);
    let warned = false;
    listeners.get('beforeunload')!({ preventDefault: () => { warned = true; } });
    assert.equal(warned, true);
    confirmDiscard = true;
    await cancel();
    assert.equal(closed, 1);
    await act(async () => renderer.update(tree(true, true)));
    await cancel();
    assert.equal(closed, 1);
    assert.equal(prompts, 2, 'busy state must neither dismiss nor offer discard');
    assert.equal(renderer.root.findByProps({ 'aria-label': 'Tutup dialog' }).props.disabled, true);
    await act(async () => renderer.update(tree(false, false)));
    assert.equal(listeners.has('beforeunload'), false);
    await cancel();
    assert.equal(closed, 2);
    assert.equal(prompts, 2, 'unchanged forms close without confirmation');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  APP_DEFAULT_THEME,
  isThemePreference,
  profileThemePreference,
  resolveTheme,
} from '../lib/theme-preference';

test('the app defaults to dark until a user picks a theme', () => {
  assert.equal(APP_DEFAULT_THEME, 'dark');
  assert.equal(resolveTheme(null), 'dark');
  assert.equal(resolveTheme(undefined), 'dark');
  assert.equal(resolveTheme('light'), 'light');
  assert.equal(resolveTheme('dark'), 'dark');
});

test('only light, dark or null are accepted as a saved preference', () => {
  for (const value of ['light', 'dark', null]) assert.equal(isThemePreference(value), true);
  for (const value of ['system', '', undefined, 1, {}]) assert.equal(isThemePreference(value), false);
});

test('profiles without the column fall back to the browser theme', () => {
  assert.equal(profileThemePreference(null), undefined);
  assert.equal(profileThemePreference({ id: 'u1' }), undefined);
  assert.equal(profileThemePreference({ id: 'u1', theme_preference: null }), null);
  assert.equal(profileThemePreference({ id: 'u1', theme_preference: 'light' }), 'light');
  assert.equal(profileThemePreference({ id: 'u1', theme_preference: 'sepia' }), null);
});

test('migration constrains stored values to the accepted preferences', () => {
  const sql = readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '197_profile_theme_preference.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS theme_preference text/);
  assert.match(sql, /theme_preference IS NULL OR theme_preference IN \('light', 'dark'\)/);
});

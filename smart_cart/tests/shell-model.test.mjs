import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePreference } from '../src/features/theme/palette.ts';
import { destination, rememberDestination, clearDestination } from '../src/features/auth/navigation.ts';
test('motyw odtwarza wyłącznie trzy poprawne preferencje', () => {
  for (const value of ['light', 'dark', 'system']) assert.equal(parsePreference(value), value);
  for (const value of [null, '', 'auto', {}, 0]) assert.equal(parsePreference(value), 'system');
});
test('nowe cele nawigacji są dozwolone, dynamiczne ID są walidowane, logout usuwa cel', () => {
  for (const path of ['/help', '/rules', '/leaflets', '/leaflets/siec-2026_11']) { rememberDestination(path); assert.equal(destination(), path); }
  for (const path of ['/leaflets/../profile', '/leaflets/%2f', '/leaflets/a/b', '//outside.invalid']) { rememberDestination(path); assert.equal(destination(), '/leaflets/siec-2026_11'); }
  clearDestination(); assert.equal(destination(), '/');
});

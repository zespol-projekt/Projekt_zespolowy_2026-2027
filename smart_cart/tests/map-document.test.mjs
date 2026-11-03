import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createMapDocument, createNativeMapSource, MAP_DOCUMENT_BASE_URL } from '../src/features/stores/map/document.js';

test('dokument działa bez odtwarzania źródła funkcji przez Hermes', () => {
  const original = Function.prototype.toString;
  Function.prototype.toString = () => { throw new Error('Hermes does not preserve source'); };
  try {
    const html = createMapDocument('test');
    assert.ok(html.includes('function startMap'));
    assert.ok(html.includes('6.16.0/dist/maplibre-gl.mjs'));
    // Parse the embedded script before running it in an actual browser in e2e.
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
    assert.doesNotThrow(() => new vm.Script(script));
  } finally { Function.prototype.toString = original; }
});
test('identyfikator kanału nie może zamknąć skryptu HTML', () => {
  const html = createMapDocument('</script><img src=x onerror=alert(1)>');
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  assert.ok(!html.includes('<img'));
});
test('Android dostaje HTML z początkiem adresu HTTPS potrzebnym do uruchomienia workerów', () => {
  const html = createMapDocument('native-test');
  const source = createNativeMapSource(html);
  assert.equal(source.html, html);
  assert.equal(source.baseUrl, MAP_DOCUMENT_BASE_URL);
  assert.equal(new URL(source.baseUrl).protocol, 'https:');
  assert.notEqual(new URL(source.baseUrl).origin, 'null');
});

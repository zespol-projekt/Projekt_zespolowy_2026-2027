import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createExpression, featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { createMapDocument, createNativeMapSource, MAP_DOCUMENT_BASE_URL } from '../src/features/stores/map/document.js';

test('drogi, budynki i nazwy miejscowości są widoczne tylko w Polsce', async () => {
  let mapOptions;
  const ML = {
    setWorkerCount() {},
    Map: class {
      constructor(options) {
        mapOptions = options;
        throw new Error('Stop after capturing map options');
      }
    },
  };
  const script = createMapDocument('coverage').match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  await vm.runInNewContext(script.replace(/import\('[^']+'\)/, 'Promise.resolve(ML)'), {
    ML, window: { addEventListener() {}, parent: { postMessage() {} } },
  });
  const labels = { id: 'cities', type: 'symbol', 'source-layer': 'place', filter: ['==', 'class', 'city'],
    layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']] } };
  const water = { id: 'water', 'source-layer': 'water' };
  const layers = [
    { id: 'roads', 'source-layer': 'transportation', filter: ['in', 'class', 'primary', 'secondary'] },
    { id: 'road-labels', type: 'symbol', 'source-layer': 'transportation_name', layout: { 'text-field': '{name:en} {ref}' } },
    { id: 'buildings', 'source-layer': 'building' },
    labels,
    water,
  ];
  const [roads, roadLabels, buildings, cities, waterLayer] = mapOptions.transformStyle(undefined, { layers }).layers;
  const testAt = (layer, type, longitude, latitude, properties = {}) => {
    const z = 14, n = 2 ** z, extent = 8192;
    const tileX = (longitude + 180) / 360 * n;
    const tileY = (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * n;
    const x = Math.floor(tileX), y = Math.floor(tileY);
    const px = Math.round((tileX - x) * extent), py = Math.round((tileY - y) * extent);
    const ring = [{ x: px, y: py }, { x: px + 10, y: py }, { x: px + 10, y: py + 10 },
      { x: px, y: py + 10 }, { x: px, y: py }];
    const geometry = [type === 1 ? ring.slice(0, 1) : type === 2 ? ring.slice(0, 2) : ring];
    const { filter } = featureFilter(layer.filter, layer.id);
    return filter({ zoom: z }, { type, geometry, properties }, { z, x, y });
  };
  assert.equal(waterLayer, water);
  const textAt = (layer, properties) => {
    const compiled = createExpression(layer.layout['text-field'], 'text-field');
    assert.equal(compiled.result, 'success');
    return compiled.value.evaluate({ zoom: 12 }, { type: 1, properties });
  };
  assert.equal(textAt(cities, { 'name:pl': 'Warszawa', 'name:en': 'Warsaw' }), 'Warszawa');
  assert.equal(textAt(cities, { name: 'Kraków', 'name:en': 'Krakow' }), 'Kraków');
  assert.equal(textAt(roadLabels, { name: 'Aleja Wolności', ref: '12' }), 'Aleja Wolności 12');
  assert.equal(mapOptions.locale['NavigationControl.ZoomIn'], 'Przybliż');
  assert.equal(testAt(cities, 1, 21.01, 52.23, { class: 'city' }), true);
  assert.equal(testAt(cities, 1, 21.01, 52.23, { class: 'town' }), false);
  assert.equal(testAt(cities, 1, 13.41, 52.52, { class: 'city' }), false);
  assert.equal(testAt(roads, 2, 21.01, 52.23, { class: 'primary' }), true);
  assert.equal(testAt(roads, 2, 21.01, 52.23, { class: 'service' }), false);
  assert.equal(testAt(roads, 2, 13.41, 52.52, { class: 'primary' }), false);
  assert.equal(testAt(roadLabels, 1, 13.41, 52.52), false);
  assert.equal(testAt(buildings, 3, 21.01, 52.23), true);
  assert.equal(testAt(buildings, 3, 13.41, 52.52), false);
  assert.ok(mapOptions.bounds && mapOptions.maxBounds);
});

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

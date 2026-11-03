import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalog, filterStores, directionsUrl, distanceMeters } from '../src/features/stores/model.ts';

const stores = [
  { id: 'lidl:1', chain: 'lidl', name: 'Lidl', address: 'Łódź, Żółta 1', latitude: 51.75, longitude: 19.45 },
  { id: 'dino:1', chain: 'dino', name: 'Dino', address: 'Poznań, Długa 2', latitude: 52.40, longitude: 16.92 },
];
const catalog = () => ({ version: 1, updatedAt: '2026-11-02T12:00:00Z', count: 2, stores: structuredClone(stores) });

test('katalog odrzuca błędne współrzędne, duplikaty i niezgodną liczbę punktów', () => {
  assert.equal(parseCatalog(catalog()).stores.length, 2);
  for (const mutate of [
    c => { c.stores[0].latitude = NaN; },
    c => { c.stores[0].longitude = 0; },
    c => { c.stores[1] = c.stores[0]; },
    c => { c.count = 1; },
    c => { c.stores[0].chain = 'unknown'; },
    c => { c.stores[0].address = ''; },
  ]) {
    const value = catalog(); mutate(value);
    assert.throws(() => parseCatalog(value));
  }
});
test('filtry sieci i wyszukiwanie obsługują polskie litery i wiele słów', () => {
  assert.deepEqual(filterStores(stores, ['lidl'], 'LODZ zolTa').map(s => s.id), ['lidl:1']);
  assert.equal(filterStores(stores, ['dino'], 'Łódź').length, 0);
  assert.equal(filterStores(stores, [], '').length, 0);
});
test('nawigacja przekazuje cel w kolejności szerokość/długość', () => {
  assert.equal(new URL(directionsUrl(stores[0], 'android')).searchParams.get('destination'), '51.75,19.45');
  assert.equal(new URL(directionsUrl(stores[0], 'ios')).searchParams.get('daddr'), '51.75,19.45');
  assert.equal(distanceMeters(stores[0], stores[0]), 0);
  assert.ok(distanceMeters(stores[0], stores[1]) > 180000);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { listelemeSiralamasi, rpcsizListelenebilir } from './listingSort.js';

/*
 * Bu testler SQL'i taklit etmez; SQL ile AYNI OLMASI GEREKEN kararı
 * sabitler. `search_products` sıralamasındaki her bir davranış burada tek
 * tek yazılı, çünkü aradaki sessiz bir fark üretimde "sayfa 2'de aynı ürün
 * yine çıkıyor" olarak görünür ve kod okunarak fark edilmez.
 */

test('offers siralamasi: once teklif sayisi AZALAN, sonra baslik ARTAN', () => {
  assert.deepEqual(listelemeSiralamasi('offers'), [
    { sutun: 'offer_count', artan: false },
    { sutun: 'title', artan: true },
  ]);
});

test('price_asc: fiyat ARTAN, price_desc: fiyat AZALAN', () => {
  assert.deepEqual(listelemeSiralamasi('price_asc'), [
    { sutun: 'min_price_cents', artan: true },
    { sutun: 'title', artan: true },
  ]);
  assert.deepEqual(listelemeSiralamasi('price_desc'), [
    { sutun: 'min_price_cents', artan: false },
    { sutun: 'title', artan: true },
  ]);
});

test('relevance, serbest metin YOKKEN yalnizca baslik siralamasidir', () => {
  /* RPC'de `relevance`, sorgu boşken her satır için sabit 1.0 döner; sabit
     bir sütun sıralamayı değiştirmez, geriye `title asc` kalır. */
  assert.deepEqual(listelemeSiralamasi('relevance'), [{ sutun: 'title', artan: true }]);
});

test('baslik HER sıralamada son anahtardir', () => {
  for (const sort of ['relevance', 'price_asc', 'price_desc', 'offers'] as const) {
    const anahtarlar = listelemeSiralamasi(sort);
    const son = anahtarlar[anahtarlar.length - 1];
    assert.equal(son?.sutun, 'title', `${sort} icin son anahtar baslik degil`);
    assert.equal(son?.artan, true);
  }
});

test('hicbir siralama ayni sutunu iki kez kullanmaz', () => {
  for (const sort of ['relevance', 'price_asc', 'price_desc', 'offers'] as const) {
    const sutunlar = listelemeSiralamasi(sort).map((a) => a.sutun);
    assert.equal(new Set(sutunlar).size, sutunlar.length, `${sort} icin sutun tekrari var`);
  }
});

test('serbest metin varsa RPC atlanmaz', () => {
  assert.equal(rpcsizListelenebilir({ query: 'kulaklik' }), false);
});

test('yalnizca bosluktan olusan sorgu, sorgu SAYILMAZ', () => {
  /* Arayüz boş kutuyu '' yerine '   ' gönderebiliyor; bunu "arama var"
     saymak bütün kategori sayfalarını yavaş yola geri gönderirdi. */
  assert.equal(rpcsizListelenebilir({ query: '   ' }), true);
  assert.equal(rpcsizListelenebilir({ query: '' }), true);
});

test('marka filtresi RPC gerektirir, BOS dizi gerektirmez', () => {
  assert.equal(rpcsizListelenebilir({ brands: ['Apple'] }), false);
  assert.equal(rpcsizListelenebilir({ brands: [] }), true);
});

test('ucretsiz kargo filtresi RPC gerektirir, false gerektirmez', () => {
  assert.equal(rpcsizListelenebilir({ freeShipping: true }), false);
  assert.equal(rpcsizListelenebilir({ freeShipping: false }), true);
});

test('filtresiz kategori listelemesi RPC ATLAR', () => {
  assert.equal(rpcsizListelenebilir({}), true);
});

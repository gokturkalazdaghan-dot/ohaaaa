import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { normalizeGtin, normalizeRecords, parseStock } from './normalize.js';
import type { FieldMapping, RawRecord } from './types.js';

const MAPPING: FieldMapping = {
  external_id: 'id',
  title: 'title',
  price: 'price',
  url: 'link',
  gtin: 'gtin',
  brand: 'brand',
  image: 'image',
  stock: 'availability',
  compare_at_price: 'list_price',
};

const OPTIONS = {
  defaultCurrency: 'TRY',
  allowedHosts: ['magaza.example'],
};

function record(overrides: Partial<RawRecord> = {}): RawRecord {
  return {
    id: 'SKU-1',
    title: 'Test Ürün',
    price: '1.299,90',
    link: 'https://magaza.example/p/1',
    ...overrides,
  };
}

test('geçerli kayıt kuruşa çevrilerek normalize edilir', () => {
  const { offers, errors } = normalizeRecords([record()], MAPPING, OPTIONS);

  assert.equal(errors.length, 0);
  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.priceCents, 129_990, 'Türkçe biçim doğru okunmalı');
  assert.equal(offers[0]?.externalId, 'SKU-1');
  assert.equal(offers[0]?.currency, 'TRY');
});

test('İngilizce fiyat biçimi de okunur', () => {
  const { offers } = normalizeRecords([record({ price: '1,299.90' })], MAPPING, OPTIONS);
  assert.equal(offers[0]?.priceCents, 129_990);
});

test('sıfır fiyat REDDEDİLİR (karşılaştırmanın tepesine oturmasın)', () => {
  const { offers, errors } = normalizeRecords(
    [record({ price: '0' }), record({ id: 'SKU-2', price: '0,00' })],
    MAPPING,
    OPTIONS,
  );

  assert.equal(offers.length, 0);
  assert.equal(errors.length, 2);
  assert.match(errors[0]!.reason, /sıfır veya negatif/);
});

test('okunamayan fiyat atlanır, kayıt sessizce geçmez', () => {
  const { offers, errors } = normalizeRecords(
    [record({ price: 'fiyat sorunuz' })],
    MAPPING,
    OPTIONS,
  );

  assert.equal(offers.length, 0);
  assert.equal(errors[0]?.externalId, 'SKU-1');
  assert.match(errors[0]!.reason, /fiyat okunamadı/);
});

test('mağazaya ait olmayan adres reddedilir', () => {
  const { offers, errors } = normalizeRecords(
    [record({ link: 'https://baska-site.example/p/1' })],
    MAPPING,
    OPTIONS,
  );

  assert.equal(offers.length, 0);
  assert.match(errors[0]!.reason, /mağazaya ait değil/);
});

test('benzer görünen alan adı reddedilir (magaza.example.saldirgan.net)', () => {
  const { offers } = normalizeRecords(
    [record({ link: 'https://magaza.example.saldirgan.net/p/1' })],
    MAPPING,
    OPTIONS,
  );
  assert.equal(offers.length, 0);
});

test('alt alan adı kabul edilir', () => {
  const { offers } = normalizeRecords(
    [record({ link: 'https://shop.magaza.example/p/1' })],
    MAPPING,
    OPTIONS,
  );
  assert.equal(offers.length, 1);
});

test('feed içi mükerrer external_id atlanır (upsert çakışmasını önler)', () => {
  const { offers, errors } = normalizeRecords(
    [record(), record({ title: 'Aynı SKU tekrar' })],
    MAPPING,
    OPTIONS,
  );

  assert.equal(offers.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!.reason, /mükerrer/);
});

test('satış fiyatından düşük "üstü çizili" fiyat yok sayılır', () => {
  // Sahte indirim göstermektense alanı boş bırakmak doğrudur.
  const { offers } = normalizeRecords(
    [record({ list_price: '999,00' })], // satış 1.299,90
    MAPPING,
    OPTIONS,
  );

  assert.equal(offers[0]?.compareAtPriceCents, null);

  const { offers: valid } = normalizeRecords(
    [record({ list_price: '1.999,00' })],
    MAPPING,
    OPTIONS,
  );
  assert.equal(valid[0]?.compareAtPriceCents, 199_900);
});

test('başlıksız veya external_id olmayan kayıt atlanır', () => {
  const { offers, errors } = normalizeRecords(
    [record({ title: '' }), record({ id: '' })],
    MAPPING,
    OPTIONS,
  );

  assert.equal(offers.length, 0);
  assert.equal(errors.length, 2);
});

test('görseller ayrıştırılır, http olmayanlar elenir', () => {
  const { offers } = normalizeRecords(
    [record({ image: 'https://cdn.example/a.jpg|javascript:alert(1)|https://cdn.example/b.jpg' })],
    MAPPING,
    OPTIONS,
  );

  assert.deepEqual(offers[0]?.imageUrls, [
    'https://cdn.example/a.jpg',
    'https://cdn.example/b.jpg',
  ]);
});

// --- Stok -------------------------------------------------------------------

test('stok: sayı, Google Merchant ve boolean biçimleri', () => {
  assert.equal(parseStock('42'), 42);
  assert.equal(parseStock('0'), 0);
  assert.equal(parseStock('in stock'), 100);
  assert.equal(parseStock('out of stock'), 0);
  assert.equal(parseStock('tükendi'), 0);
  assert.equal(parseStock('var'), 100);
});

test('stok: alan yoksa stokta varsayılır, anlaşılmıyorsa stoksuz', () => {
  // Ortaklık feed'lerinin çoğu yalnızca satılabilir ürünü yayınlar.
  assert.equal(parseStock(null), 100);
  assert.equal(parseStock(''), 100);

  // Belirsizlikte ürünü göstermemek, olmayanı satmaktan iyidir.
  assert.equal(parseStock('belirsiz-değer'), 0);
  assert.equal(parseStock('preorder'), 0);
});

// --- GTIN -------------------------------------------------------------------

test('GTIN kontrol basamağı doğrulanır', () => {
  // Gerçek, geçerli barkodlar
  assert.equal(normalizeGtin('0195949038204'), '0195949038204'); // iPhone 15
  assert.equal(normalizeGtin('4548736134546'), '4548736134546'); // Sony XM5

  // Ayırıcılar temizlenir
  assert.equal(normalizeGtin(' 4548736134546 '), '4548736134546');
  assert.equal(normalizeGtin('4-548736-134546'), '4548736134546');
});

test('kontrol basamağı hatalı GTIN reddedilir', () => {
  // Tek hane değiştirildi: biçim doğru ama barkod geçersiz.
  // Kabul edilseydi İKİ FARKLI ürün birleşir, kullanıcı yanlış ürünü alırdı.
  assert.equal(normalizeGtin('4548736134547'), null);
  assert.equal(normalizeGtin('0195949038205'), null);
});

test('geçersiz uzunluktaki GTIN reddedilir', () => {
  assert.equal(normalizeGtin('12345'), null);
  assert.equal(normalizeGtin('123456789012345'), null);
  assert.equal(normalizeGtin(''), null);
  assert.equal(normalizeGtin(null), null);
});

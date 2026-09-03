import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  intentToSearchParams,
  looksLikeNaturalLanguage,
  searchIntentSchema,
  tlToCents,
  type SearchIntent,
} from './searchIntent.js';

const temelNiyet: SearchIntent = {
  query: 'oyuncu kulaklığı',
  maxPriceTl: 5000,
  minPriceTl: null,
  brands: [],
  freeShipping: false,
  sort: 'relevance',
  understood: true,
  summary: '5.000 TL altı oyuncu kulaklığı',
};

/*
 * Model cagrisi PARA VE GECIKME. "iphone 16" yazan birinin cumlesinde
 * ayiklanacak bir sey yok; o aramanin modele ugramamasi gerekiyor.
 */
test('duz urun adi modele gitmez, cumle gider', () => {
  for (const duz of ['iphone 16', 'sony kulaklık', 'airfryer', 'ps5']) {
    assert.equal(looksLikeNaturalLanguage(duz), false, `modele gitmemeliydi: ${duz}`);
  }

  for (const cumle of [
    '5000 TL altında kablosuz kulaklık bul',
    '5 bin liraya kadar oyuncu kulaklığı',
    'en ucuz iphone 16 nerede',
    'bana uygun fiyatlı bir airfryer öner',
    '₺2.500 altı bluetooth hoparlör',
  ]) {
    assert.equal(looksLikeNaturalLanguage(cumle), true, `modele gitmeliydi: ${cumle}`);
  }
});

test('cok kisa girdi hicbir zaman modele gitmez', () => {
  assert.equal(looksLikeNaturalLanguage('bul'), false);
  assert.equal(looksLikeNaturalLanguage('   '), false);
});

/* Para kurusa cevrilir: kayan noktali TL ile hesap yapmak 0.1+0.2 problemini
 * faturaya tasimak olurdu. */
test('TL kurusa dogru cevriliyor', () => {
  assert.equal(tlToCents(5000), 500000);
  assert.equal(tlToCents(0), 0);
  assert.equal(tlToCents(null), null);
  assert.equal(tlToCents(-5), null);
  assert.equal(tlToCents(Number.NaN), null);
});

test('niyet paylasilabilir bir arama adresine ceviriliyor', () => {
  const p = intentToSearchParams(temelNiyet);
  assert.equal(p.get('q'), 'oyuncu kulaklığı');
  assert.equal(p.get('max'), '5000');
  assert.equal(p.get('min'), null);
  assert.equal(p.get('ai'), '1');
  assert.equal(p.get('sirala'), null, 'varsayilan siralama adrese yazilmamali');

  const cok = intentToSearchParams({
    ...temelNiyet,
    brands: ['Sony', 'Logitech'],
    freeShipping: true,
    sort: 'price_asc',
    minPriceTl: 1000,
  });
  // Arama sayfasi markayi VIRGULLE ayrilmis okuyor ve kargo degeri 'bedava'.
  // Bu iddia adres bicimini sayfayla birlikte sabitliyor: biçim degisirse
  // burasi duser, sessizce yanlis filtre uygulanmaz.
  assert.equal(cok.get('marka'), 'Sony,Logitech');
  assert.equal(cok.get('kargo'), 'bedava');
  assert.equal(cok.get('sirala'), 'price_asc');
  assert.equal(cok.get('min'), '1000');
});

/*
 * SEMA BIR GUVENLIK SINIRIDIR: modelin cikrisi buradan gecmeden hicbir yere
 * gitmiyor. Basarili bir prompt injection bile en fazla "yanlis filtre"
 * uretebilmeli -- sorgu calistiramamali.
 */
test('sema sinir disi ciktiyi reddediyor', () => {
  assert.equal(searchIntentSchema.safeParse({ ...temelNiyet, sort: 'drop table' }).success, false);
  assert.equal(searchIntentSchema.safeParse({ ...temelNiyet, maxPriceTl: -1 }).success, false);
  assert.equal(
    searchIntentSchema.safeParse({ ...temelNiyet, query: 'x'.repeat(200) }).success,
    false,
  );
  assert.equal(
    searchIntentSchema.safeParse({ ...temelNiyet, brands: Array(20).fill('a') }).success,
    false,
    'marka listesi sinirsiz olmamali',
  );
  assert.equal(searchIntentSchema.safeParse({ ...temelNiyet, maxPriceTl: 1.5 }).success, false);
});

/* Model her cumleye filtre uydurmak zorunda kalmamali: "merhaba" yazana urun
 * araması yapmak, anlamadigini gizlemektir. */
test('anlasilmayan istek isaretlenebiliyor', () => {
  const sonuc = searchIntentSchema.safeParse({
    ...temelNiyet,
    understood: false,
    query: '',
    summary: '',
  });
  assert.equal(sonuc.success, true);
});

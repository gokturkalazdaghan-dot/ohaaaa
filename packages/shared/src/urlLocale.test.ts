import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dilAlternatifleri, hreflangEtiketi, yolKur, yolSegmentiniCoz,
  yolSegmentiYaz, yoluAyristir, type YolDili,
} from './urlLocale.js';

const VARSAYILAN: YolDili = { locale: 'tr', market: 'TR' };

// --- Segment çözümleme ----------------------------------------------------

test('gecerli segment dile ve pazara ayrilir', () => {
  assert.deepEqual(yolSegmentiniCoz('en-gb'), { locale: 'en', market: 'GB' });
  assert.deepEqual(yolSegmentiniCoz('ar-ae'), { locale: 'ar', market: 'AE' });
});

test('PAZAR BUYUK harfe cevrilir -- veritabanindaki hali', () => {
  assert.equal(yolSegmentiniCoz('tr-nordics')?.market, 'NORDICS');
});

test('bozuk segment null doner', () => {
  for (const bozuk of ['', 'tr', 'trtr', 'e-gb', 'en_gb', '/en-gb', 'en-', '123-45']) {
    assert.equal(yolSegmentiniCoz(bozuk), null, bozuk);
  }
});

test('segment yazma ve cozme birbirinin tersi', () => {
  const s = yolSegmentiYaz('ar', 'AE');
  assert.equal(s, 'ar-ae');
  assert.deepEqual(yolSegmentiniCoz(s), { locale: 'ar', market: 'AE' });
});

// --- Yol ayrıştırma -------------------------------------------------------

test('onekli yol ayrilir, kalan korunur', () => {
  const r = yoluAyristir('/en-gb/kategori/bilgisayar');
  assert.deepEqual(r.segment, { locale: 'en', market: 'GB' });
  assert.equal(r.kalan, '/kategori/bilgisayar');
});

test('oneksiz yol OLDUGU GIBI doner -- varsayilan oneksiz sunuluyor', () => {
  const r = yoluAyristir('/kategori/bilgisayar');
  assert.equal(r.segment, null);
  assert.equal(r.kalan, '/kategori/bilgisayar');
});

test('yalnizca onekten olusan yol koke duser', () => {
  assert.equal(yoluAyristir('/en-gb').kalan, '/');
  assert.equal(yoluAyristir('/en-gb/').kalan, '/');
});

test('kok yol bozulmaz', () => {
  const r = yoluAyristir('/');
  assert.equal(r.segment, null);
  assert.equal(r.kalan, '/');
});

test('onek gibi gorunen ama olmayan segment yol sayilir', () => {
  /* `/urun/...` bir dil oneki degil; yanlislikla soyulursa urun sayfasi kaybolurdu. */
  const r = yoluAyristir('/urun/dizustu-bilgisayar');
  assert.equal(r.segment, null);
  assert.equal(r.kalan, '/urun/dizustu-bilgisayar');
});

// --- Yol kurma ------------------------------------------------------------

test('VARSAYILAN ikili ONEKSIZ kalir -- mevcut adresler degismez', () => {
  assert.equal(yolKur('/kategori/telefon', 'tr', 'TR', VARSAYILAN), '/kategori/telefon');
  assert.equal(yolKur('/', 'tr', 'TR', VARSAYILAN), '/');
});

test('varsayilan disi ikili onek alir', () => {
  assert.equal(yolKur('/kategori/telefon', 'en', 'GB', VARSAYILAN), '/en-gb/kategori/telefon');
  assert.equal(yolKur('/', 'ar', 'AE', VARSAYILAN), '/ar-ae');
});

test('AYNI PAZAR FARKLI DIL ayri adres alir', () => {
  /*
   * Londra'daki Turkce okuyan ziyaretci: Turkce arayuz, sterlin fiyat.
   * Tek bir `/uk/` kodu bunu ifade edemezdi -- dil ve pazar ayri tasiniyor.
   */
  assert.equal(yolKur('/', 'tr', 'UK', VARSAYILAN), '/tr-uk');
  assert.equal(yolKur('/', 'en', 'UK', VARSAYILAN), '/en-uk');
});

test('buyuk-kucuk harf farki varsayilani bozmaz', () => {
  assert.equal(yolKur('/x', 'TR', 'tr', VARSAYILAN), '/x');
});

test('yol kurma ve ayristirma birbirinin tersi', () => {
  const yol = yolKur('/urun/abc', 'ar', 'SA', VARSAYILAN);
  const geri = yoluAyristir(yol);
  assert.deepEqual(geri.segment, { locale: 'ar', market: 'SA' });
  assert.equal(geri.kalan, '/urun/abc');
});

// --- hreflang -------------------------------------------------------------

test('hreflang ULKE kodu ister, pazar kodu DEGIL', () => {
  /* Britanya'nin pazari UK, ulkesi GB. hreflang ulke bekler. */
  assert.equal(hreflangEtiketi('en', 'GB'), 'en-GB');
  assert.equal(hreflangEtiketi('ar', 'AE'), 'ar-AE');
});

test('alternatifler x-default ICERIR ve varsayilana isaret eder', () => {
  const a = dilAlternatifleri('/kategori/x', [
    { locale: 'tr', market: 'TR', countryCode: 'TR' },
    { locale: 'en', market: 'UK', countryCode: 'GB' },
  ], VARSAYILAN, 'https://www.ohaaaa.com');

  const xd = a.find((x) => x.hreflang === 'x-default');
  assert.equal(xd?.href, 'https://www.ohaaaa.com/kategori/x');
});

test('alternatifler MUTLAK adres uretir', () => {
  const a = dilAlternatifleri('/urun/y', [
    { locale: 'en', market: 'UK', countryCode: 'GB' },
  ], VARSAYILAN, 'https://www.ohaaaa.com/');
  assert.equal(a[0]?.href, 'https://www.ohaaaa.com/en-uk/urun/y');
});

test('AYNI hreflang IKI KEZ yazilmaz', () => {
  /*
   * Arama motoru cakisan hreflang'i celiskili sayar ve HEPSINI yok sayabilir.
   * UK pazari ile GB ulkesi ayni etiketi uretirse yalnizca ilki kalir.
   */
  const a = dilAlternatifleri('/', [
    { locale: 'en', market: 'UK', countryCode: 'GB' },
    { locale: 'en', market: 'EU', countryCode: 'GB' },
  ], VARSAYILAN, 'https://x.test');
  assert.equal(a.filter((x) => x.hreflang === 'en-GB').length, 1);
});

test('alternatifler KARARLI sirada', () => {
  const girdi = [
    { locale: 'tr', market: 'TR', countryCode: 'TR' },
    { locale: 'ar', market: 'AE', countryCode: 'AE' },
    { locale: 'en', market: 'UK', countryCode: 'GB' },
  ];
  const a = dilAlternatifleri('/', girdi, VARSAYILAN, 'https://x.test');
  assert.deepEqual(a.map((x) => x.hreflang), ['ar-AE', 'en-GB', 'tr-TR', 'x-default']);
});

test('bos alternatif listesi yalnizca x-default verir', () => {
  const a = dilAlternatifleri('/', [], VARSAYILAN, 'https://x.test');
  assert.deepEqual(a.map((x) => x.hreflang), ['x-default']);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BOS_KATALOG, etkinPazarlar, pazarinParaBirimi, pazarinSayiBicimi,
  pazarinUlkeleri, pazarTaniniyor, ulkeKaydi, ulkeninPazari,
  type MarketKatalogu,
} from './marketCatalog.js';
import { currencyOf, isMarket, localeTag, marketForCountry, resolveMarket } from './market.js';

/*
 * KATALOG, ÜRETİM ŞEMASININ BİREBİR KARŞILIĞI.
 * Körfez ülkeleri ve GCC gerçekten tohumda var (göç 20260907100000,
 * satır 345-346); `default_currency` NULL olması da oradaki gerçek durum.
 */
const K: MarketKatalogu = {
  markets: [
    { code: 'TR', defaultCurrency: 'TRY', isActive: true },
    { code: 'UK', defaultCurrency: 'GBP', isActive: true },
    { code: 'EU', defaultCurrency: 'EUR', isActive: true },
    { code: 'NORDICS', defaultCurrency: null, isActive: true },
    { code: 'GCC', defaultCurrency: null, isActive: true },
    { code: 'KAPALI', defaultCurrency: 'USD', isActive: false },
  ],
  countries: [
    { code: 'TR', defaultCurrency: 'TRY', defaultLocale: 'tr', numberLocale: 'tr-TR', isActive: true },
    { code: 'GB', defaultCurrency: 'GBP', defaultLocale: 'en', numberLocale: 'en-GB', isActive: true },
    { code: 'DE', defaultCurrency: 'EUR', defaultLocale: 'de', numberLocale: 'de-DE', isActive: true },
    { code: 'SE', defaultCurrency: 'SEK', defaultLocale: 'sv', numberLocale: 'sv-SE', isActive: true },
    { code: 'AE', defaultCurrency: 'AED', defaultLocale: 'ar', numberLocale: 'ar-AE', isActive: true },
    { code: 'SA', defaultCurrency: 'SAR', defaultLocale: 'ar', numberLocale: 'ar-SA', isActive: true },
    { code: 'PASIF', defaultCurrency: 'USD', defaultLocale: 'en', numberLocale: 'en-US', isActive: false },
  ],
  membership: [
    { marketCode: 'TR', countryCode: 'TR' },
    { marketCode: 'UK', countryCode: 'GB' },
    { marketCode: 'EU', countryCode: 'DE' },
    { marketCode: 'EU', countryCode: 'SE' },
    { marketCode: 'NORDICS', countryCode: 'SE' },
    { marketCode: 'GCC', countryCode: 'AE' },
    { marketCode: 'GCC', countryCode: 'SA' },
  ],
};

// --- Katalog temelleri ----------------------------------------------------

test('etkin pazarlar listelenir, kapali olan ELENIR', () => {
  assert.deepEqual(etkinPazarlar(K), ['EU', 'GCC', 'NORDICS', 'TR', 'UK']);
});

test('pasif ulke pazarin kapsamina girmez', () => {
  assert.deepEqual(pazarinUlkeleri(K, 'GCC'), ['AE', 'SA']);
  assert.equal(ulkeKaydi(K, 'PASIF'), null);
});

test('ulke kodu buyuk-kucuk harf duyarsiz cozulur', () => {
  assert.equal(ulkeKaydi(K, 'tr')?.code, 'TR');
  assert.equal(ulkeninPazari(K, ' ae '), 'GCC');
});

// --- Çoklu üyelik: kararlı seçim -----------------------------------------

test('ULKEYE OZEL pazar bolgesel pazari YENER', () => {
  /* TR ülkesi hem TR pazarında; kodu aynı olan kazanır. */
  assert.equal(ulkeninPazari(K, 'TR'), 'TR');
});

test('COKLU UYELIKTE para birimi UYUSAN pazar secilir', () => {
  /*
   * İsveç hem EU hem NORDICS üyesi. EU'nun para birimi EUR, İsveç'inki
   * SEK. Euro pazarına koymak ona yanlış birimde fiyat gostermek olurdu;
   * NORDICS'in varsayilani NULL oldugu icin EUR ile de catismaz.
   */
  assert.equal(ulkeninPazari(K, 'SE'), 'NORDICS');
});

test('coklu uyelikte secim KARARLI: ayni girdi ayni cikti', () => {
  const ilk = ulkeninPazari(K, 'SE');
  for (let i = 0; i < 5; i++) assert.equal(ulkeninPazari(K, 'SE'), ilk);
});

test('hicbir pazara uye olmayan ulke null doner, UYDURULMAZ', () => {
  const tek: MarketKatalogu = { ...K, membership: [] };
  assert.equal(ulkeninPazari(tek, 'TR'), null);
});

// --- Para birimi ----------------------------------------------------------

test('pazarin kendi para birimi varsa o kullanilir', () => {
  assert.equal(pazarinParaBirimi(K, 'UK'), 'GBP');
});

test('COK PARA BIRIMLI pazarda birim ULKEDEN gelir', () => {
  /* GCC alti ulkede alti birim tasir; default_currency NULL. */
  assert.equal(pazarinParaBirimi(K, 'GCC', 'AE'), 'AED');
  assert.equal(pazarinParaBirimi(K, 'GCC', 'SA'), 'SAR');
});

test('ulke bilinmiyorsa cok para birimli pazarda TAHMIN URETILMEZ', () => {
  assert.equal(pazarinParaBirimi(K, 'GCC'), null);
});

// --- Sayı biçimi ----------------------------------------------------------

test('sayi bicimi ULKEDEN gelir', () => {
  assert.equal(pazarinSayiBicimi(K, 'GCC', 'SA'), 'ar-SA');
});

test('ulke yoksa pazarin para birimi uyusan ulkesinin bicimi kullanilir', () => {
  assert.equal(pazarinSayiBicimi(K, 'EU'), 'de-DE');
});

// --- market.ts ile bütünleşme --------------------------------------------

test('YENI PAZAR: kodda olmayan GCC katalogla cozulur', () => {
  /*
   * BU TESTIN BUTUN AMACI: 'AE' ve 'GCC' `MARKETS` sabit listesinde YOK.
   * Katalog verildiginde calismasi, yeni ulke eklemenin TypeScript
   * degisikligi GEREKTIRMEDIGINI kanitlar.
   */
  assert.equal(marketForCountry('AE', K), 'GCC');
  assert.equal(isMarket('GCC', K), true);
  assert.equal(currencyOf('GCC', K, 'AE'), 'AED');
});

test('katalog VERILMEZSE bugunku sabit davranis aynen surer', () => {
  assert.equal(marketForCountry('AE'), null);
  assert.equal(isMarket('GCC'), false);
  assert.equal(marketForCountry('DE'), 'EU');
  assert.equal(currencyOf('TR'), 'TRY');
});

test('resolveMarket katalogla yeni pazari IP uzerinden secer', () => {
  const r = resolveMarket({ ipCountry: 'SA' }, K);
  assert.equal(r.market, 'GCC');
  assert.equal(r.currency, 'SAR');
  assert.equal(r.marketSource, 'ip');
});

test('resolveMarket katalogsuz cagirida TR davranisini korur', () => {
  const r = resolveMarket({ ipCountry: 'TR' });
  assert.equal(r.market, 'TR');
  assert.equal(r.currency, 'TRY');
});

test('localeTag bolgeyi ULKEDEN alir, matris gerektirmez', () => {
  assert.equal(localeTag('en', 'GCC', K, 'AE'), 'en-AE');
  assert.equal(localeTag('tr', 'TR', K, 'TR'), 'tr-TR');
});

test('ULKE VERILMEZSE bolge PAZARDAN gelir', () => {
  /*
   * Uretimde olculmus hata: `/en-gb` adresini ABD IP'siyle acan ziyaretci
   * `lang="en-US"` aliyordu, `/tr-uk` ise `tr-US`. Dil ezmesi calisiyor
   * ama pazar ezmesi calismiyordu -- cunku cagiran taraf IP ulkesini
   * KOSULSUZ geciriyordu ve katalog, ulke verildiginde pazari yok sayiyor.
   *
   * Buradaki iki iddia o kurali kilitliyor: ulke YOKSA bolge pazardan
   * turer; ulke VARSA ulke kazanir. Hangisinin gecirilecegine cagiran
   * karar verir ve bu karar `lib/locale.ts` icinde `marketSource`'a bagli.
   */
  assert.equal(localeTag('en', 'UK', K, null), 'en-GB');
  assert.equal(localeTag('tr', 'UK', K, null), 'tr-GB');
  /*
   * `localeTag` yalnizca CEVIRISI OLAN dilleri kabul eder (`Locale` union).
   * Korfez'in bolge kodunu dogrulamak icin katalog fonksiyonuna dogrudan
   * bakiyoruz -- Arapca sozlugu geldigi gun buraya `localeTag` de eklenir.
   */
  assert.equal(pazarinSayiBicimi(K, 'GCC'), 'ar-AE');
});

test('ULKE VERILIRSE ulke kazanir -- cagiran bilincli gecirmeli', () => {
  assert.equal(localeTag('en', 'UK', K, 'DE'), 'en-DE');
});

test('BOS KATALOG guvenli: cokme yok, yedege dusulur', () => {
  assert.deepEqual(etkinPazarlar(BOS_KATALOG), []);
  assert.equal(ulkeninPazari(BOS_KATALOG, 'TR'), null);
  assert.equal(pazarTaniniyor(BOS_KATALOG, 'TR'), false);
  assert.equal(pazarinParaBirimi(BOS_KATALOG, 'TR'), null);
});

test('gecersiz girdi cokertmez', () => {
  for (const bozuk of ['', '  ', 'XX', 'toolongcode']) {
    assert.equal(ulkeninPazari(K, bozuk), null);
    assert.equal(pazarTaniniyor(K, bozuk), false);
  }
  assert.equal(pazarTaniniyor(K, null), false);
  assert.equal(pazarTaniniyor(K, 42), false);
});

test('KAPALI pazar taninmaz', () => {
  assert.equal(pazarTaniniyor(K, 'KAPALI'), false);
  assert.equal(isMarket('KAPALI', K), false);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_LOCALE,
  DEFAULT_MARKET,
  MARKETS,
  MARKET_CONFIG,
  currencyOf,
  formatCount,
  isLocale,
  isMarket,
  localeTag,
  marketForCountry,
  parseAcceptLanguage,
  resolveMarket,
} from './market.js';

// --- Accept-Language ayrıştırma ------------------------------------------

test('Accept-Language q değerine göre sıralanır', () => {
  assert.deepEqual(parseAcceptLanguage('en;q=0.6,de;q=0.9,tr;q=0.2'), ['de', 'en', 'tr']);
});

test('q verilmeyen dil 1 kabul edilir ve öne geçer', () => {
  assert.deepEqual(parseAcceptLanguage('de,tr;q=0.9'), ['de', 'tr']);
});

test('bölge kodu atılır: de-AT Almancadır', () => {
  assert.deepEqual(parseAcceptLanguage('de-AT,en-GB;q=0.5'), ['de', 'en']);
});

test('aynı dil iki kez geçerse bir kez döner', () => {
  assert.deepEqual(parseAcceptLanguage('tr-TR,tr;q=0.9'), ['tr']);
});

test('desteklenmeyen diller elenir', () => {
  assert.deepEqual(parseAcceptLanguage('fr-FR,ja;q=0.8'), []);
});

test('q=0 açıkça reddetme demektir', () => {
  assert.deepEqual(parseAcceptLanguage('de;q=0,tr;q=0.5'), ['tr']);
});

test('boş ve tanımsız başlık boş liste verir', () => {
  assert.deepEqual(parseAcceptLanguage(''), []);
  assert.deepEqual(parseAcceptLanguage(null), []);
  assert.deepEqual(parseAcceptLanguage(undefined), []);
});

test('bozuk q değeri sıralamayı çökertmez', () => {
  assert.deepEqual(parseAcceptLanguage('tr;q=abc,de;q=0.5'), ['de']);
});

// --- Pazar çözümlemesi ----------------------------------------------------

test('sinyal yoksa güvenli varsayılana düşer', () => {
  const r = resolveMarket();
  assert.equal(r.market, DEFAULT_MARKET);
  assert.equal(r.locale, DEFAULT_LOCALE);
  assert.equal(r.currency, 'TRY');
  assert.equal(r.marketSource, 'fallback');
});

test('açık seçim IP ülkesini EZER', () => {
  const r = resolveMarket({ explicitMarket: 'EU', ipCountry: 'US' });
  assert.equal(r.market, 'EU');
  assert.equal(r.currency, 'EUR');
  assert.equal(r.marketSource, 'explicit');
});

test('hesap tercihi IP ülkesini ezer ama açık seçimi ezemez', () => {
  assert.equal(resolveMarket({ accountMarket: 'EU', ipCountry: 'US' }).market, 'EU');
  assert.equal(resolveMarket({ explicitMarket: 'US', accountMarket: 'EU' }).market, 'US');
});

test('başka sinyal yoksa IP ülkesi kullanılır', () => {
  const r = resolveMarket({ ipCountry: 'us' });
  assert.equal(r.market, 'US');
  assert.equal(r.currency, 'USD');
  assert.equal(r.marketSource, 'ip');
});

test('desteklenmeyen ülke varsayılan pazara düşer, uydurma pazar açılmaz', () => {
  // Japonya için pazarımız yok.
  const r = resolveMarket({ ipCountry: 'JP' });
  assert.equal(r.market, DEFAULT_MARKET);
  assert.equal(r.marketSource, 'fallback');
});

// --- Ülke → pazar eşlemesi ------------------------------------------------

test('ÜLKE KODU İLE PAZAR KODU AYNI ŞEY DEĞİL', () => {
  // Britanya'nın ülke kodu GB, veritabanındaki pazar kodu UK. Eskiden IP
  // ülkesi doğrudan pazar sayılıyordu ve bu yüzden 'GB' diye var olmayan
  // bir pazar üretiliyordu.
  assert.equal(marketForCountry('GB'), 'UK');
  assert.equal(marketForCountry('DE'), 'EU');
  assert.equal(marketForCountry('TR'), 'TR');
  assert.equal(marketForCountry('US'), 'US');
  assert.equal(marketForCountry('CA'), 'CA');
});

test('euro bölgesi EU pazarına eşlenir', () => {
  for (const ulke of ['FR', 'IT', 'ES', 'PT', 'NL', 'IE', 'AT', 'FI', 'GR']) {
    assert.equal(marketForCountry(ulke), 'EU', `${ulke} euro bölgesinde`);
  }
});

test('EURO KULLANMAYAN AB ÜYESİ EU pazarına eşlenmez', () => {
  /*
   * İsveç SEK, Polonya PLN, Danimarka DKK kullanır. EU pazarının para birimi
   * EUR; onları oraya eşlemek euro fiyat göstermek olurdu. Kendi pazarları
   * açılana kadar varsayılana düşerler.
   */
  for (const ulke of ['SE', 'PL', 'DK', 'CZ', 'HU', 'RO', 'BG']) {
    assert.equal(marketForCountry(ulke), null, `${ulke} euro kullanmıyor`);
  }
});

test('tanınmayan, boş ve bozuk ülke kodu null döner', () => {
  for (const bad of ['', '  ', 'XX', 'TÜRKİYE', 'GBR', null, undefined]) {
    assert.equal(marketForCountry(bad), null);
  }
});

test('her pazar kodu veritabanındaki markets tablosunda VAR', () => {
  /*
   * Ölçülen tablo: ANZ · CA · EU · GCC · NORDICS · TR · UK · US
   * Uygulama bunun alt kümesini kullanır (para birimi NULL olanlar hariç).
   * Bu testin amacı sözlüğün tekrar veriden UZAKLAŞMASINI engellemek.
   */
  const veritabanindakiler = ['ANZ', 'CA', 'EU', 'GCC', 'NORDICS', 'TR', 'UK', 'US'];
  for (const m of MARKETS) {
    assert.ok(veritabanindakiler.includes(m), `${m} markets tablosunda yok`);
  }
});

test('geçersiz/boş sinyaller sessizce yok sayılır', () => {
  for (const bad of ['', '  ', 'XX', 'TÜRKİYE', null, undefined]) {
    assert.equal(resolveMarket({ ipCountry: bad }).market, DEFAULT_MARKET);
  }
});

// --- Dil çözümlemesi ------------------------------------------------------

test('Avrupa pazarında Türkçe tarayıcı Türkçe arayüz alır', () => {
  const r = resolveMarket({ explicitMarket: 'EU', acceptLanguage: 'tr-TR,tr;q=0.9' });
  assert.equal(r.market, 'EU');
  assert.equal(r.locale, 'tr');
  // Dil Türkçe ama para birimi PAZARIN: Avrupa'ya kargo euro ile ödenir.
  assert.equal(r.currency, 'EUR');
  assert.equal(r.localeSource, 'accept-language');
});

/*
 * BU TEST DE BİR HATANIN ANITIDIR -- ve hata CANLIDA ÖLÇÜLDÜ.
 *
 * `MARKET_CONFIG[market].locales` bir zamanlar tarayıcı dilini SÜZÜYORDU.
 * UK pazarının listesi yalnızca `['en']` olduğu için, Türkçe tarayıcıyla
 * gelen ziyaretçi -- `x-vercel-ip-country: GB` yüzünden -- İngilizce sayfa
 * alıyordu. Canlı ölçüm: `Accept-Language: tr-TR` ile istenen ana sayfa
 * `<html lang="en-US">` ve "We found what you need" dönüyordu.
 *
 * Bu, market.ts'in KENDİ başlığında yanlış diye anlatılan davranıştı:
 * dili pazara zincirlemek. Süzgeç kaldırıldı. Dil kullanıcının okuyabildiği
 * şeydir; pazar, ödeyeceği para birimidir. İkisi ayrı kalır.
 */
test('ABD pazarındaki Türkçe tarayıcı Türkçe arayüz + dolar alır', () => {
  const r = resolveMarket({ explicitMarket: 'US', acceptLanguage: 'tr-TR' });
  assert.equal(r.locale, 'tr');
  assert.equal(r.localeSource, 'accept-language');
  // Dil değişti, PARA BİRİMİ DEĞİŞMEDİ: ABD'ye kargo dolarla ödenir.
  assert.equal(r.currency, 'USD');
  assert.equal(r.market, 'US');
});

test('UK pazarındaki Türkçe tarayıcı Türkçe arayüz + sterlin alır', () => {
  const r = resolveMarket({ ipCountry: 'GB', acceptLanguage: 'tr-TR,tr;q=0.9,en;q=0.8' });
  assert.equal(r.market, 'UK');
  assert.equal(r.marketSource, 'ip');
  assert.equal(r.locale, 'tr');
  assert.equal(r.currency, 'GBP');
});

test('İngilizce tarayıcı Türkiye pazarında İngilizce arayüz alır', () => {
  const r = resolveMarket({ ipCountry: 'TR', acceptLanguage: 'en-GB,en;q=0.9' });
  assert.equal(r.market, 'TR');
  assert.equal(r.locale, 'en');
  assert.equal(r.currency, 'TRY');
});

test('tarayıcı dili tanınmıyorsa pazarın varsayılanına düşülür', () => {
  // Fransızca bir arayüz dilimiz yok; UK pazarının varsayılanı İngilizce.
  const r = resolveMarket({ ipCountry: 'GB', acceptLanguage: 'fr-FR,fr;q=0.9' });
  assert.equal(r.locale, 'en');
  assert.equal(r.localeSource, 'market-default');
});

test('açık dil seçimi tarayıcı dilini ezer', () => {
  const r = resolveMarket({ explicitLocale: 'de', acceptLanguage: 'tr' });
  assert.equal(r.locale, 'de');
  assert.equal(r.localeSource, 'explicit');
});

/*
 * BU TEST BİR HATANIN ANITIDIR.
 *
 * Önceki sürümde pazar ve dil tek bir `explicit` alanında taşınıyordu.
 * "de" değeri büyük harfe çevrilince "DE" oluyor ve geçerli bir ülke kodu
 * olarak okunuyordu: yani yalnızca DİLİNİ Almanca yapmak isteyen kullanıcı
 * sessizce ALMANYA PAZARINA da geçiyordu -- euro fiyatlar, Türkiye'ye
 * gönderim yapmayan satıcılar. Alanlar ayrıldı; bu test ayrımın geri
 * alınmadığını bekler.
 */
test('dil seçmek pazarı DEĞİŞTİRMEZ', () => {
  const r = resolveMarket({ explicitLocale: 'de' });
  assert.equal(r.locale, 'de');
  assert.equal(r.market, DEFAULT_MARKET);
  assert.equal(r.currency, 'TRY');
});

test('pazar seçmek dili zorla değiştirmez: tarayıcı dili hâlâ dinlenir', () => {
  const r = resolveMarket({ explicitMarket: 'EU', acceptLanguage: 'tr' });
  assert.equal(r.market, 'EU');
  assert.equal(r.locale, 'tr');
});

test('dil sinyali bölgeli gelse de tanınır', () => {
  assert.equal(resolveMarket({ explicitLocale: 'de-AT' }).locale, 'de');
  assert.equal(resolveMarket({ explicitLocale: 'EN-gb' }).locale, 'en');
});

test('tanınmayan dil sinyali yok sayılır, çökmez', () => {
  for (const bad of ['fr', '', '  ', 'xx-YY', null, undefined]) {
    const r = resolveMarket({ explicitLocale: bad });
    assert.equal(r.locale, DEFAULT_LOCALE);
  }
});

// --- Etiketler ve yapılandırma -------------------------------------------

test('localeTag bölgeli BCP-47 üretir', () => {
  assert.equal(localeTag('tr', 'TR'), 'tr-TR');
  assert.equal(localeTag('de', 'EU'), 'de-DE');
  assert.equal(localeTag('en', 'US'), 'en-US');
  assert.equal(localeTag('en', 'UK'), 'en-GB');
  // Euro bölgesinde İngilizce, euro biçimi kullanan İrlanda varyantına düşer.
  assert.equal(localeTag('en', 'EU'), 'en-IE');
});

test('her pazarın para birimi ve varsayılan dili tanımlı', () => {
  for (const market of Object.values(MARKET_CONFIG)) {
    assert.ok(market.currency, `${market.code} para birimsiz`);
    assert.ok(market.locales.includes(market.defaultLocale));
    assert.equal(currencyOf(market.code), market.currency);
  }
});

test('tip korumaları yalnızca bilinen değerleri kabul eder', () => {
  assert.ok(isLocale('tr') && isLocale('de') && isLocale('en'));
  assert.ok(!isLocale('fr') && !isLocale('TR') && !isLocale(42));
  assert.ok(isMarket('TR') && isMarket('EU') && isMarket('US') && isMarket('UK'));
  // 'DE' ve 'GB' artık PAZAR DEĞİL -- ikisi de ülke kodu.
  assert.ok(!isMarket('tr') && !isMarket('DE') && !isMarket('GB') && !isMarket(null));
});

// --- Sayı biçimi ----------------------------------------------------------

/*
 * SAYFADA "34510 ürünü karşılaştırıyoruz" YAZIYORDU. Beş haneden sonra
 * basamak ayracı olmadan sayı okunmuyor; ayraç ise dile göre değişiyor.
 */
test('formatCount basamak ayracini OKUYANIN diline gore secer', () => {
  assert.equal(formatCount(34510, 'tr-TR'), '34.510');
  assert.equal(formatCount(34510, 'en-GB'), '34,510');
  assert.equal(formatCount(34510, 'en-US'), '34,510');
});

test('formatCount kucuk sayilari bozmaz', () => {
  assert.equal(formatCount(0, 'tr-TR'), '0');
  assert.equal(formatCount(7, 'en-GB'), '7');
});

test('formatCount etiket verilmezse varsayilan pazara duser', () => {
  assert.equal(formatCount(1234), formatCount(1234, MARKET_CONFIG[DEFAULT_MARKET].numberLocale));
});

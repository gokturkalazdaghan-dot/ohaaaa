import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_LOCALE,
  DEFAULT_MARKET,
  MARKET_CONFIG,
  currencyOf,
  isLocale,
  isMarket,
  localeTag,
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
  const r = resolveMarket({ explicitMarket: 'DE', ipCountry: 'US' });
  assert.equal(r.market, 'DE');
  assert.equal(r.currency, 'EUR');
  assert.equal(r.marketSource, 'explicit');
});

test('hesap tercihi IP ülkesini ezer ama açık seçimi ezemez', () => {
  assert.equal(resolveMarket({ accountMarket: 'DE', ipCountry: 'US' }).market, 'DE');
  assert.equal(resolveMarket({ explicitMarket: 'US', accountMarket: 'DE' }).market, 'US');
});

test('başka sinyal yoksa IP ülkesi kullanılır', () => {
  const r = resolveMarket({ ipCountry: 'us' });
  assert.equal(r.market, 'US');
  assert.equal(r.currency, 'USD');
  assert.equal(r.marketSource, 'ip');
});

test('desteklenmeyen ülke varsayılan pazara düşer, uydurma pazar açılmaz', () => {
  const r = resolveMarket({ ipCountry: 'FR' });
  assert.equal(r.market, DEFAULT_MARKET);
  assert.equal(r.marketSource, 'fallback');
});

test('geçersiz/boş sinyaller sessizce yok sayılır', () => {
  for (const bad of ['', '  ', 'XX', 'TÜRKİYE', null, undefined]) {
    assert.equal(resolveMarket({ ipCountry: bad }).market, DEFAULT_MARKET);
  }
});

// --- Dil çözümlemesi ------------------------------------------------------

test('Almanya pazarında Türkçe tarayıcı Türkçe arayüz alır', () => {
  const r = resolveMarket({ explicitMarket: 'DE', acceptLanguage: 'tr-TR,tr;q=0.9' });
  assert.equal(r.market, 'DE');
  assert.equal(r.locale, 'tr');
  // Dil Türkçe ama para birimi PAZARIN: Almanya'ya kargo euro ile ödenir.
  assert.equal(r.currency, 'EUR');
  assert.equal(r.localeSource, 'accept-language');
});

test('pazarda desteklenmeyen dile düşülmez', () => {
  // ABD pazarı yalnızca İngilizce; Türkçe tarayıcı yine İngilizce alır.
  const r = resolveMarket({ explicitMarket: 'US', acceptLanguage: 'tr-TR' });
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
  const r = resolveMarket({ explicitMarket: 'DE', acceptLanguage: 'tr' });
  assert.equal(r.market, 'DE');
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
  assert.equal(localeTag('de', 'DE'), 'de-DE');
  assert.equal(localeTag('en', 'US'), 'en-US');
  // İngilizce ABD dışında İngiliz varyantına düşer.
  assert.equal(localeTag('en', 'DE'), 'en-GB');
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
  assert.ok(isMarket('TR') && isMarket('DE') && isMarket('US'));
  assert.ok(!isMarket('tr') && !isMarket('FR') && !isMarket(null));
});

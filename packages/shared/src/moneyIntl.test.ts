import assert from 'node:assert/strict';
import { test } from 'node:test';

import { convertMoney, formatMoney, formatMoneyCompact, type ExchangeRate } from './money.js';

/*
 * Intl çıktısındaki boşluk karakteri ortama göre değişir (dar bölünmez
 * boşluk vs normal boşluk). Testin kırılgan olmaması için normalleştirilir
 * -- sınanan şey ayırıcı ve sembol, boşluğun kod noktası değil.
 */
const norm = (s: string) => s.replace(/[   ]/g, ' ');

test('varsayılan biçim para biriminin kendi diline göredir', () => {
  // Node'un ICU'sunda tr-TR sembolü ÖNE koyar: "₺54.999,00".
  // Sınanan şey sembolün yeri değil, ayırıcıların Türkçe olması.
  assert.equal(norm(formatMoney(5499900)), '₺54.999,00');
});

test('okuyanın dili verilince AYIRICILAR ona göre değişir', () => {
  // Aynı tutar, aynı para birimi, farklı okuyucu.
  const tr = norm(formatMoney(123456, 'USD', 'tr-TR'));
  const us = norm(formatMoney(123456, 'USD', 'en-US'));
  // Asıl mesele AYIRICILAR: Türkçede binlik '.', ondalık ','; İngilizcede tersi.
  assert.equal(tr, '$1.234,56');
  assert.equal(us, '$1,234.56');
  assert.notEqual(tr, us);
});

test('para birimi okuyanın diline göre DEĞİŞMEZ', () => {
  // Alman bir kullanıcı Türk lirası fiyatı yine lira olarak görür.
  assert.match(formatMoney(100000, 'TRY', 'de-DE'), /₺|TRY/);
});

test('kısa gösterim de dile duyarlıdır', () => {
  assert.ok(norm(formatMoneyCompact(125_400_000, 'USD', 'en-US')).includes('$'));
  assert.ok(formatMoneyCompact(125_400_000, 'EUR', 'de-DE').includes('€'));
});

test('sıfır ve negatif tutar biçimlenebilir', () => {
  assert.ok(formatMoney(0).length > 0);
  assert.ok(formatMoney(-1500).includes('-') || formatMoney(-1500).includes('−'));
});

// --- Kur çevrimi: kanıt yoksa çevrim yok ---------------------------------

const gecerliKur: ExchangeRate = {
  from: 'EUR',
  to: 'TRY',
  rate: 35,
  source: 'TCMB',
  observedAt: new Date('2026-09-03T00:00:00Z'),
};

test('geçerli kurla çevrim yapılır ve kaynağı taşınır', () => {
  const out = convertMoney(10000, 'TRY', gecerliKur);
  assert.ok(out);
  assert.equal(out.amountCents, 350000);
  assert.equal(out.currency, 'TRY');
  assert.equal(out.via.source, 'TCMB');
});

test('KUR YOKSA ÇEVRİM YOK — uydurma kur üretilmez', () => {
  assert.equal(convertMoney(10000, 'TRY', null), null);
  assert.equal(convertMoney(10000, 'TRY', undefined), null);
});

test('hedef para birimi kurunkiyle uyuşmuyorsa çevrim reddedilir', () => {
  // EUR→TRY kuruyla USD hesaplanamaz. Sessizce yanlış sonuç vermek yerine null.
  assert.equal(convertMoney(10000, 'USD', gecerliKur), null);
});

test('geçersiz kur değeri reddedilir', () => {
  for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(convertMoney(10000, 'TRY', { ...gecerliKur, rate }), null);
  }
});

test('çevrim kuruş tam sayısı döndürür', () => {
  const out = convertMoney(333, 'TRY', { ...gecerliKur, rate: 1.0 / 3.0 });
  assert.ok(out);
  assert.ok(Number.isInteger(out.amountCents));
});

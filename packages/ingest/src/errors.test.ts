/**
 * Hata sınıflandırma testleri.
 *
 * Bu testlerin sorduğu tek soru: BU HATA YENİDEN DENENMELİ Mİ?
 *
 * Yanlış cevabın iki yönü de bedelli ve bedelleri EŞİT DEĞİL:
 *   • Kalıcı hatayı geçici saymak → birkaç boşuna deneme, saatlerce
 *     "yeniden denenecek" görünen ölü bir kaynak.
 *   • Geçici hatayı kalıcı saymak → düzelecek bir arıza ilk denemede
 *     öldürülür, kimse fark etmez.
 * İkincisi daha kötü olduğu için tanınmayan her hata GEÇİCİ kalır.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  IngestError,
  classifyIngestError,
  isPermanentClass,
  type IngestErrorClass,
} from './errors.js';
import {
  CircuitOpenError,
  PermanentHttpError,
  RobotsDisallowedError,
} from './http/politeClient.js';

// --- Kendi hatalarımız ----------------------------------------------------

test('IngestError sınıfını ve kalıcılığını kendi taşır', () => {
  const hata = new IngestError('CONFIG_ERROR', 'ortam değişkeni yok', true);
  assert.deepEqual(classifyIngestError(hata), {
    errorClass: 'CONFIG_ERROR',
    permanent: true,
  });
});

/*
 * Sınıfın varsayılanı ile örneğin taşıdığı değer AYRI olabilir: boş feed
 * PARSER_ERROR ama geçicidir. Sınıflandırıcı örneğe uyar, tabloya değil.
 */
test('IngestError kendi kalıcılık kararını tabloya EZDİRMEZ', () => {
  const bos = new IngestError('PARSER_ERROR', 'feed boş', false);
  assert.equal(classifyIngestError(bos).permanent, false);

  const bozuk = new IngestError('PARSER_ERROR', 'feed bozuk', true);
  assert.equal(classifyIngestError(bozuk).permanent, true);
});

// --- HTTP durum kodları ---------------------------------------------------

/*
 * 401/403 KALICI.
 *
 * Kimlik bilgisi değişmeden tekrar denemek, sağlayıcıya dört kez daha
 * kimliksiz istek göndermektir; bazı ortaklık ağları bunu kötüye kullanım
 * sayar ve hesabı askıya alır.
 */
for (const durum of [401, 403] as const) {
  test(`HTTP ${durum} = AUTH_ERROR ve KALICI`, () => {
    const sonuc = classifyIngestError(
      new PermanentHttpError(durum, 'https://feed.example/x.csv'),
    );
    assert.equal(sonuc.errorClass, 'AUTH_ERROR');
    assert.equal(sonuc.permanent, true);
  });
}

test('HTTP 404 = HTTP_ERROR ve KALICI', () => {
  const sonuc = classifyIngestError(
    new PermanentHttpError(404, 'https://feed.example/yok.csv'),
  );
  assert.equal(sonuc.errorClass, 'HTTP_ERROR');
  assert.equal(sonuc.permanent, true);
});

/*
 * 429 GEÇİCİ. "Yavaşla" demek "bir daha gelme" demek değildir; kalıcı
 * saymak, hız sınırına takılan bir kaynağı kalıcı olarak kapatmak olurdu.
 */
test('HTTP 429 = NETWORK_ERROR ve GEÇİCİ', () => {
  const sonuc = classifyIngestError({ name: 'PermanentHttpError', status: 429 });
  assert.equal(sonuc.errorClass, 'NETWORK_ERROR');
  assert.equal(sonuc.permanent, false);
});

test('HTTP 5xx GEÇİCİ — sunucu toparlanabilir', () => {
  assert.equal(classifyIngestError({ status: 503 }).permanent, false);
  assert.equal(classifyIngestError(new Error('HTTP 502')).permanent, false);
  assert.equal(classifyIngestError(new Error('HTTP 502')).errorClass, 'HTTP_ERROR');
});

// --- Güvenlik -------------------------------------------------------------

/*
 * robots.txt yasağını yeniden denemek yasağı yok saymaktır. Bu proje
 * boyunca robots uyumu pazarlık konusu değil.
 */
test('robots yasağı = SECURITY_ERROR ve KALICI', () => {
  const sonuc = classifyIngestError(
    new RobotsDisallowedError('https://feed.example/x.csv'),
  );
  assert.equal(sonuc.errorClass, 'SECURITY_ERROR');
  assert.equal(sonuc.permanent, true);
});

test('devre kesici = NETWORK_ERROR ve GEÇİCİ', () => {
  const sonuc = classifyIngestError(new CircuitOpenError('feed.example'));
  assert.equal(sonuc.errorClass, 'NETWORK_ERROR');
  assert.equal(sonuc.permanent, false);
});

// --- Ağ -------------------------------------------------------------------

test('ağ hataları GEÇİCİ', () => {
  for (const metin of [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND feed.example',
    'fetch failed',
    'Zaman aşımı (20000 ms)',
  ]) {
    const sonuc = classifyIngestError(new Error(metin));
    assert.equal(sonuc.errorClass, 'NETWORK_ERROR', metin);
    assert.equal(sonuc.permanent, false, metin);
  }
});

// --- Bilinmeyen -----------------------------------------------------------

/*
 * TEMKİNLİ VARSAYIM. Tanımadığımız hatayı kalıcı saymak, düzelebilecek bir
 * arızada kaynağı ilk denemede sessizce öldürmek olurdu.
 */
test('tanınmayan hata UNKNOWN_ERROR ve GEÇİCİ', () => {
  const sonuc = classifyIngestError(new Error('beklenmedik bir şey oldu'));
  assert.equal(sonuc.errorClass, 'UNKNOWN_ERROR');
  assert.equal(sonuc.permanent, false);
});

test('hata olmayan girdi çökertmez', () => {
  assert.equal(classifyIngestError(null).errorClass, 'UNKNOWN_ERROR');
  assert.equal(classifyIngestError(undefined).errorClass, 'UNKNOWN_ERROR');
  assert.equal(classifyIngestError('düz metin').errorClass, 'UNKNOWN_ERROR');
  assert.equal(classifyIngestError(42).errorClass, 'UNKNOWN_ERROR');
});

// --- Sınıf tablosu --------------------------------------------------------

/*
 * TABLO AÇIKÇA KİLİTLİ.
 *
 * Kalıcılık bir iş kararı; sessizce kaymamalı. Biri CONFIG_ERROR'u geçici
 * yapmaya kalkarsa bu test düşer ve gerekçesini yazmak zorunda kalır.
 */
test('kalıcılık tablosu sabit', () => {
  const beklenen: Record<IngestErrorClass, boolean> = {
    CONFIG_ERROR: true,
    AUTH_ERROR: true,
    NETWORK_ERROR: false,
    HTTP_ERROR: true,
    PARSER_ERROR: false,
    VALIDATION_ERROR: true,
    DATABASE_ERROR: false,
    SECURITY_ERROR: true,
    UNKNOWN_ERROR: false,
  };

  for (const [sinif, kalici] of Object.entries(beklenen)) {
    assert.equal(
      isPermanentClass(sinif as IngestErrorClass),
      kalici,
      `${sinif} kalıcılığı değişmiş`,
    );
  }
});

/*
 * ADLAR BİR SÖZLEŞME.
 *
 * `errors.ts` döngüsel ithal olmasın diye `politeClient`'ı ithal etmiyor;
 * hataları `name` alanından tanıyor. Bu test o adları kilitliyor: sınıf
 * yeniden adlandırılırsa sınıflandırma sessizce UNKNOWN_ERROR'a düşerdi ve
 * 401 alan bir kaynak yeniden denenmeye başlardı.
 */
test('politeClient hata adları sınıflandırmanın beklediği gibi', () => {
  assert.equal(new RobotsDisallowedError('https://a.test/x').name, 'RobotsDisallowedError');
  assert.equal(new PermanentHttpError(404, 'https://a.test/x').name, 'PermanentHttpError');
  assert.equal(new CircuitOpenError('a.test').name, 'CircuitOpenError');
  // Durum kodu da alan adıyla taşınıyor; sınıflandırma buna bakıyor.
  assert.equal(new PermanentHttpError(401, 'https://a.test/x').status, 401);
});

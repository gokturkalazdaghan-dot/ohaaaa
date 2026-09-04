/**
 * Maskeleme testleri.
 *
 * BU TESTLERİN İÇİNDE GERÇEK KİMLİK BİLGİSİ YOKTUR. Kullanılan jetonlar
 * uydurma dizgilerdir ve yalnızca "bu dizgi çıktıda görünmemeli" iddiasını
 * kurmak için var.
 *
 * Her testin sorduğu soru tek: gizli değer çıktıda GEÇİYOR MU? Maskenin
 * biçimini değil, sızıntının yokluğunu doğruluyoruz -- biçim değişebilir,
 * sızıntının olmaması değişmemeli.
 */

import { strict as assert } from 'node:assert';
import { afterEach, test } from 'node:test';

import {
  MASKE,
  clearSecretsForTest,
  expandSecretPlaceholders,
  maskUrl,
  redact,
  redactError,
  registerSecret,
} from './redact.js';

/** Uydurma jeton. Gerçek bir ağa ait değildir. */
const SAHTE_JETON = 'tk_ornek_9f4c2b7e51a08d63';

afterEach(() => {
  clearSecretsForTest();
});

// --- Yapısal maskeleme ----------------------------------------------------

test('sorgu dizisindeki TÜM değerler maskelenir', () => {
  const cikti = maskUrl(
    `https://feed.ornek.test/export.csv?publisher=41823&token=${SAHTE_JETON}&format=csv`,
  );

  assert.ok(!cikti.includes(SAHTE_JETON), `jeton sızdı: ${cikti}`);
  // Yalnızca "token" değil, ADI ne olursa olsun her değer gider: hangi
  // anahtarın gizli olduğunu tahmin etmiyoruz.
  assert.ok(!cikti.includes('41823'), `yayıncı kimliği sızdı: ${cikti}`);
  assert.ok(!cikti.includes('csv&') && !cikti.endsWith('csv'), `değer kaldı: ${cikti}`);
});

test('şema, alan adı ve yol KORUNUR', () => {
  const cikti = maskUrl(`https://feed.ornek.test/v2/export.csv?token=${SAHTE_JETON}`);

  // Teşhis edilebilirlik: "HTTP 401" ile "hangi adres 401 verdi" arasındaki fark.
  assert.ok(cikti.startsWith('https://feed.ornek.test/v2/export.csv'), cikti);
  assert.ok(cikti.includes('token='), `anahtar adı kayboldu: ${cikti}`);
});

test('adresteki kullanıcı adı ve parola maskelenir', () => {
  const cikti = maskUrl(`https://yayinci:${SAHTE_JETON}@feed.ornek.test/export.csv`);

  assert.ok(!cikti.includes(SAHTE_JETON), `parola sızdı: ${cikti}`);
  assert.ok(!cikti.includes('yayinci'), `kullanıcı adı sızdı: ${cikti}`);
});

/*
 * Ayrıştırılamayan girdi TAMAMEN maskelenir.
 *
 * Adres olduğundan emin olamadığımız bir dizgiyi olduğu gibi geçirmek,
 * bozuk yazılmış bir adresteki jetonu yayımlamak olurdu.
 */
test('adres olmayan girdi tamamen maskelenir', () => {
  assert.equal(maskUrl(`token=${SAHTE_JETON}`), MASKE);
  assert.equal(maskUrl(''), MASKE);
});

// --- Değer maskeleme ------------------------------------------------------

/*
 * YOLA GÖMÜLÜ JETON YAPISAL MASKELEMEYLE YAKALANMAZ.
 *
 * Bazı ağlar jetonu sorgu dizisinde değil yolda taşır. Yolu tamamen
 * maskelemek teşhisi öldürürdü; bunun yerine BİLİNEN değer birebir
 * siliniyor. Tahmin değil, eşleşme.
 */
test('yola gömülü bilinen jeton silinir', () => {
  registerSecret(SAHTE_JETON);

  const cikti = redact(`HTTP 403 — https://feed.ornek.test/${SAHTE_JETON}/products.csv`);

  assert.ok(!cikti.includes(SAHTE_JETON), `yoldaki jeton sızdı: ${cikti}`);
  assert.ok(cikti.includes('feed.ornek.test'), `alan adı kayboldu: ${cikti}`);
});

test('bilinen jeton adres dışındaki serbest metinde de silinir', () => {
  registerSecret(SAHTE_JETON);

  const cikti = redact(`Yetkilendirme başlığı reddedildi (Bearer ${SAHTE_JETON})`);

  assert.ok(!cikti.includes(SAHTE_JETON), cikti);
});

/*
 * KISA DEĞER GİZLİ SAYILMAZ.
 *
 * "40" gibi bir değeri gizli kabul etseydik, onu taşıyan her hata metni
 * okunamaz hale gelirdi: "HTTP 403" -> "HTTP ***3".
 */
test('çok kısa değerler maskeleme defterine alınmaz', () => {
  registerSecret('40');
  assert.equal(redact('HTTP 403 alındı'), 'HTTP 403 alındı');
});

// --- Hata nesneleri -------------------------------------------------------

test('redactError bilinmeyen tipi de temizler', () => {
  registerSecret(SAHTE_JETON);

  assert.ok(!redactError(new Error(`401 ${SAHTE_JETON}`)).includes(SAHTE_JETON));
  assert.ok(!redactError(`ham dizgi ${SAHTE_JETON}`).includes(SAHTE_JETON));
});

// --- Ortam yer tutucuları -------------------------------------------------

test('yer tutucu ortam değerinden doldurulur ve değer gizli sayılır', () => {
  const adres = expandSecretPlaceholders(
    'https://feed.ornek.test/export.csv?token=${OHAAAA_TEST_FEED_TOKEN}',
    { OHAAAA_TEST_FEED_TOKEN: SAHTE_JETON },
  );

  // İstek GERÇEK değerle gitmeli.
  assert.equal(adres, `https://feed.ornek.test/export.csv?token=${SAHTE_JETON}`);

  // Ve aynı anda deftere yazılmış olmalı: bundan sonra hiçbir metinde görünemez.
  assert.ok(!redact(`istek: ${adres}`).includes(SAHTE_JETON));
});

/*
 * EKSİK DEĞİŞKEN SESSİZ GEÇİLMEZ.
 *
 * Yer tutucuyu olduğu gibi bırakmak, sunucuya `token=${...}` diye istek
 * atıp 401 almak ve sebebi "ağ kimlik doğrulaması bozuk" sanmak olurdu.
 */
test('tanımsız değişken açık hata verir ve DEĞİŞKEN ADINI söyler', () => {
  assert.throws(
    () =>
      expandSecretPlaceholders(
        'https://feed.ornek.test/export.csv?token=${OHAAAA_TEST_FEED_TOKEN}',
        {},
      ),
    (hata: Error) => {
      // Ad güvenlidir ve operatörün neyi tanımlaması gerektiğini söyler.
      assert.ok(hata.message.includes('OHAAAA_TEST_FEED_TOKEN'), hata.message);
      return true;
    },
  );
});

test('boş dizgi tanımlı sayılmaz', () => {
  assert.throws(() =>
    expandSecretPlaceholders('https://a.test/x?t=${OHAAAA_TEST_FEED_TOKEN}', {
      OHAAAA_TEST_FEED_TOKEN: '',
    }),
  );
});

/*
 * Kimlik bilgisi gerektirmeyen açık feed'ler için EK KURAL YOK: yer tutucu
 * içermeyen adres değişmeden geçer.
 */
test('yer tutucusuz adres değişmeden geçer', () => {
  const adres = 'https://feed.ornek.test/public/export.csv';
  assert.equal(expandSecretPlaceholders(adres, {}), adres);
});

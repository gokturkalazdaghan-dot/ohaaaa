/**
 * `formatMoney` — para birimi artık derleme zamanı union DEĞİL.
 *
 * Para birimleri referans verisine taşındı (`public.currencies`), bu yüzden
 * `Currency` tipi `string`. Kaybedilen derleme zamanı korumasının yerini üç
 * katman aldı: veritabanı yabancı anahtarı, sınırda Zod biçim doğrulaması ve
 * BURADA sınanan çalışma zamanı davranışı.
 *
 * Bu dosyanın tek konusu şu: geçersiz bir para birimi geldiğinde ne oluyor?
 * `formatMoney` React render yolunda kullanılıyor (ProductCard, CartDrawer,
 * PriceHistory). Bir istisna fırlatmak tek bozuk satır yüzünden TÜM SAYFAYI
 * düşürürdü; sessizce sıfır göstermek ise yanlış fiyat üretirdi -- ve yanlış
 * fiyat, eksik fiyattan pahalıdır.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { formatMoney, isCurrencyCode } from './money.js';

test('bicim kontrolu ISO 4217 uc buyuk harf ister', () => {
  assert.equal(isCurrencyCode('TRY'), true);
  assert.equal(isCurrencyCode('KWD'), true);
  // Referans tabloda olmayan ama BICIMI gecerli bir kod da gecer: uyelik
  // kontrolu veritabaninin isi, bicim kontrolu buranin.
  assert.equal(isCurrencyCode('XYZ'), true);

  assert.equal(isCurrencyCode('try'), false);
  assert.equal(isCurrencyCode('TRYY'), false);
  assert.equal(isCurrencyCode('TR'), false);
  assert.equal(isCurrencyCode(''), false);
  assert.equal(isCurrencyCode(null), false);
  assert.equal(isCurrencyCode(42), false);
});

test('bilinen para birimi normal bicimlenir', () => {
  assert.match(formatMoney(123456, 'TRY'), /1\.234,56/);
  assert.match(formatMoney(123456, 'USD', 'en-US'), /1,234\.56/);
});

test('referans tabloda yeni olan bir para birimi KOD DEGISIKLIGI OLMADAN calisir', () => {
  // SEK, NOK, AED... hicbiri kodda listelenmiyor. Intl bunlari bugun biliyor.
  const cikti = formatMoney(123456, 'SEK', 'sv-SE');
  assert.match(cikti, /1\s?234,56/);
  assert.ok(cikti.length > 0);
});

test('gecersiz para birimi COKMEZ ve tutari GIZLEMEZ', () => {
  // Bicimi bozuk: kucuk harf, dort harf, bos.
  for (const bozuk of ['try', 'TRYY', '', 'T']) {
    const cikti = formatMoney(123456, bozuk);
    // Cokmedi.
    assert.equal(typeof cikti, 'string');
    // Tutar gorunuyor -- sessizce sifirlanmadi.
    assert.match(cikti, /1234\.56/);
    // Uydurma bir sembol konmadi; ham kod yaninda duruyor.
    assert.ok(cikti.endsWith(bozuk), `ham kod korunmali: ${cikti}`);
  }
});

test('gecersiz bicim etiketi de COKMEZ', () => {
  // Intl gecersiz bir locale etiketinde RangeError firlatir.
  const cikti = formatMoney(123456, 'TRY', 'bu-gecersiz-bir-etiket!!');
  assert.equal(typeof cikti, 'string');
  assert.match(cikti, /1234\.56|1\.234,56/);
});

// ---------------------------------------------------------------------------
// GERCEK PARA BIRIMI GOSTERIMI -- URETIM HATASININ KILIDI
// ---------------------------------------------------------------------------
// Uretimde olculdu: veritabaninda 5.003 urun GBP, site ise `₺` ile
// basiyordu. £23,99 luk urun "₺23,99" gorunuyordu -- fiyat ~44 kat dusuk.
// Sebep `formatMoney`'de DEGILDI: fonksiyon dogru, cagiran taraf para
// birimini gecmiyor ve varsayilan TRY devreye giriyordu.
//
// Asagidaki testler dort pazarin da DOGRU simgeyle basildigini kilitler.

test('GBP kendi simgesiyle basilir -- TRY varsayilanina DUSMEZ', () => {
  const cikti = formatMoney(2399, 'GBP');
  assert.match(cikti, /£/, 'GBP simgesi bulunmali');
  assert.ok(!cikti.includes('₺'), 'TRY simgesi BULUNMAMALI');
  assert.match(cikti, /23[.,]99/);
});

test('USD kendi simgesiyle basilir', () => {
  const cikti = formatMoney(2399, 'USD');
  assert.match(cikti, /\$/);
  assert.ok(!cikti.includes('₺'));
});

test('EUR kendi simgesiyle basilir', () => {
  const cikti = formatMoney(2399, 'EUR');
  assert.match(cikti, /€/);
  assert.ok(!cikti.includes('₺'));
});

test('TRY kendi simgesiyle basilir -- mevcut davranis KORUNUR', () => {
  const cikti = formatMoney(2399, 'TRY');
  assert.match(cikti, /₺/);
});

test('ayni tutar farkli para biriminde FARKLI metin uretir', () => {
  // Bu test sart: para birimini yok sayan bir uygulama dort cagriyi da
  // ayni metne cevirir ve uretimdeki hata sessizce geri gelir.
  const ciktilar = new Set(
    (['GBP', 'USD', 'EUR', 'TRY'] as const).map((kod) => formatMoney(2399, kod)),
  );
  assert.equal(ciktilar.size, 4, 'dort para birimi dort farkli metin vermeli');
});

test('para birimi VERILMEZSE TRY varsayilir -- bu davranis bilinerek duruyor', () => {
  // Varsayilanin kendisi hata DEGIL; hata onu katalog fiyatlarinda kullanmakti.
  // Test varsayilani kilitler ki bir gun degistirilirse bilincli olsun.
  assert.match(formatMoney(2399), /₺/);
});

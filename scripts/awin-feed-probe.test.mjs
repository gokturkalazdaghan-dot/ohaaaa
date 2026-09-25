/**
 * Awin feed sondasının testleri.
 *
 * NEDEN VAR
 * Sondanın iki parçası sessizce bozulabilir ve ikisinin de bedeli somut:
 *
 *   1. `maskele` — bozulursa indirme anahtarı CI GÜNLÜĞÜNE düşer ve CI
 *      günlükleri kalıcıdır. Bir sırrın sızdığı en olası yer bir hata
 *      metninin içidir, o yüzden maskeleme hata yolunda da sınanıyor.
 *
 *   2. `olc().alinabilirYuzde` — bozulursa kapsam kararı yanlış bir sayının
 *      üstüne kurulur. FAZ 2'nin bütün amacı "ilan edilen sayıya değil
 *      ölçülene bakmak"tı; ölçüm aletinin kendisi yanlış sayarsa o amaç
 *      ters döner.
 *
 * Çalıştırma:  node --test scripts/
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  IZINLI_HOST,
  maskele,
  olc,
  sayiMi,
  yarimSatiriAt,
  yerTutucuDoldur,
} from './awin-feed-probe.mjs';

/** FIXTURE — uydurma anahtar. Gerçek bir kimlik bilgisi DEĞİLDİR. */
const SAHTE_ANAHTAR = 'fixture-not-a-real-key-0123456789';

// ===========================================================================
// MASKELEME — anahtar hiçbir çıktıya girmez
// ===========================================================================

test('adresteki anahtar maskelenir', () => {
  const adres = `https://productdata.awin.com/datafeed/download/apikey/${SAHTE_ANAHTAR}/fid/84173/format/csv/`;
  const maskeli = maskele(adres);

  assert.equal(maskeli.includes(SAHTE_ANAHTAR), false, 'anahtar sizdi');
  assert.match(maskeli, /\/apikey\/<REDACTED>\//);
  // Adresin kalanı okunabilir kalmalı: hangi feed'e gidildiği görünmeli.
  assert.match(maskeli, /fid\/84173/);
});

test('ayni metinde birden fazla anahtar da maskelenir', () => {
  const metin = `a /apikey/${SAHTE_ANAHTAR}/x ve b /apikey/${SAHTE_ANAHTAR}/y`;
  const maskeli = maskele(metin);
  assert.equal(maskeli.includes(SAHTE_ANAHTAR), false);
  assert.equal(maskeli.match(/<REDACTED>/g).length, 2);
});

test('anahtar icermeyen metin degismez', () => {
  assert.equal(maskele('HTTP 404'), 'HTTP 404');
});

test('maskele metin olmayan girdiyi de tasir', () => {
  // Hata yolunda `cik()` bir Error nesnesi alabilir; maskeleme patlamamalı.
  assert.equal(maskele(404), '404');
  assert.equal(maskele(new Error('bos')).includes('bos'), true);
});

// ===========================================================================
// YER TUTUCU — eksik degisken SESSIZ GECMEZ
// ===========================================================================

test('yer tutucu ortamdan doldurulur', () => {
  process.env.PROBE_TEST_KEY = 'deger-123';
  const { dolu, eksik } = yerTutucuDoldur('https://x/apikey/${PROBE_TEST_KEY}/fid/1/');
  assert.deepEqual(eksik, []);
  assert.match(dolu, /apikey\/deger-123\//);
  delete process.env.PROBE_TEST_KEY;
});

test('eksik degisken adiyla bildirilir, sessizce bos gecmez', () => {
  const { eksik } = yerTutucuDoldur('https://x/apikey/${PROBE_TEST_YOK}/');
  // Ad bildirilmeliydi: aksi halde kimliksiz istek atılıp 404 "feed yok"
  // sanılırdı -- FAZ 2'de ölçülen tam o tuzak.
  assert.deepEqual(eksik, ['PROBE_TEST_YOK']);
});

test('yer tutucudaki deger URL icin kacirilir', () => {
  process.env.PROBE_TEST_KEY = 'a/b c';
  const { dolu } = yerTutucuDoldur('https://x/apikey/${PROBE_TEST_KEY}/');
  // Kaçırılmasaydı `/` yol ayırıcısı olur ve istek başka bir yola giderdi.
  assert.match(dolu, /apikey\/a%2Fb%20c\//);
  delete process.env.PROBE_TEST_KEY;
});

// ===========================================================================
// YARIM SATIR — kendi kirpmamiz olcumu kirletmez
// ===========================================================================

test('yarim kalan son satir atilir', () => {
  assert.equal(yarimSatiriAt('a,b\n1,2\n3,yar'), 'a,b\n1,2');
});

test('satir sonuyla biten metin oldugu gibi kalir', () => {
  assert.equal(yarimSatiriAt('a,b\n1,2\n'), 'a,b\n1,2');
});

test('hic satir sonu yoksa metin korunur', () => {
  // Tek satırlık bir yanıt (yalnızca başlık) atılmamalı.
  assert.equal(yarimSatiriAt('a,b'), 'a,b');
});

// ===========================================================================
// FIYAT OKUNABILIRLIGI
// ===========================================================================

test('fiyat: sifir ve negatif okunabilir SAYILMAZ', () => {
  // `normalize.ts` sıfır/negatif fiyatı eliyor; sonda da aynı kuralı
  // uygulamalı, yoksa "alınabilir" yüzdesi pipeline'dan yüksek çıkar.
  assert.equal(sayiMi('0'), false);
  assert.equal(sayiMi('-5'), false);
  assert.equal(sayiMi(''), false);
  assert.equal(sayiMi('yok'), false);
});

test('fiyat: ondalik ayirici virgul de okunur', () => {
  // Orta Avrupa feed'lerinde "19,99" biçimi yaygın.
  assert.equal(sayiMi('19,99'), true);
  assert.equal(sayiMi('19.99'), true);
});

// ===========================================================================
// OLCUM — alinabilir satir sayimi
// ===========================================================================

const SAGLAM = {
  aw_product_id: '1',
  product_name: 'Ornek Urun',
  aw_deep_link: 'https://www.awin1.com/cread.php?p=1',
  search_price: '19,99',
  currency: 'PLN',
  in_stock: '1',
  merchant_product_id: 'SKU-1',
};

test('zorunlu alanlari tam olan satir alinabilir sayilir', () => {
  const o = olc([SAGLAM]);
  assert.equal(o.alinabilirYuzde, 100);
  assert.equal(o.fiyatOkunabilirYuzde, 100);
});

test('fiyati olmayan satir alinabilir SAYILMAZ', () => {
  const o = olc([{ ...SAGLAM, search_price: '' }]);
  assert.equal(o.alinabilirYuzde, 0);
});

test('adresi olmayan satir alinabilir SAYILMAZ', () => {
  const o = olc([{ ...SAGLAM, aw_deep_link: '', merchant_deep_link: '' }]);
  assert.equal(o.alinabilirYuzde, 0);
});

test('basligi olmayan satir alinabilir SAYILMAZ', () => {
  const o = olc([{ ...SAGLAM, product_name: '   ' }]);
  assert.equal(o.alinabilirYuzde, 0);
});

test('merchant_deep_link, aw_deep_link yoksa kabul edilir', () => {
  const o = olc([
    { ...SAGLAM, aw_deep_link: '', merchant_deep_link: 'https://magaza.example/u/1' },
  ]);
  assert.equal(o.alinabilirYuzde, 100);
});

test('karisik kumede yuzde dogru hesaplanir', () => {
  const o = olc([SAGLAM, { ...SAGLAM, search_price: '' }, SAGLAM, SAGLAM]);
  assert.equal(o.ornekSatir, 4);
  assert.equal(o.alinabilirYuzde, 75);
});

test('para birimi ve stok degerleri sayilir', () => {
  const o = olc([SAGLAM, { ...SAGLAM, currency: 'pln' }, { ...SAGLAM, currency: 'EUR' }]);
  // Büyük harfe normalize edilir; yoksa 'pln' ile 'PLN' iki ayrı değer sanılır.
  assert.equal(o.paraBirimleri.PLN, 2);
  assert.equal(o.paraBirimleri.EUR, 1);
  assert.equal(o.stokDegerleri['1'], 3);
});

test('stok kolonu stock_status olarak da okunur', () => {
  // Ultrahuman feed'inde `in_stock` yok, `stock_status` var.
  const o = olc([{ ...SAGLAM, in_stock: undefined, stock_status: 'in stock' }]);
  assert.equal(o.stokDegerleri['in stock'], 1);
});

test('deeplink hostlari sayilir, gecersiz adres ayri toplanir', () => {
  const o = olc([SAGLAM, { ...SAGLAM, aw_deep_link: 'bu-bir-url-degil' }]);
  assert.equal(o.deeplinkHostlari['www.awin1.com'], 1);
  assert.equal(o.deeplinkHostlari['<gecersiz-url>'], 1);
});

test('kimlik doluluk oranlari ayri ayri sayilir', () => {
  const o = olc([
    SAGLAM, // yalnizca SKU
    { ...SAGLAM, ean: '05012345678900' },
    { ...SAGLAM, upc: '012345678905', model_number: 'MPN-1' },
  ]);
  assert.equal(o.kimlikler.sku, 100);
  assert.equal(o.kimlikler.ean, 33.3);
  assert.equal(o.kimlikler.upc, 33.3);
  assert.equal(o.kimlikler.mpn, 33.3);
});

test('bos kume patlamaz', () => {
  const o = olc([]);
  assert.deepEqual(o.kolonlar, []);
});

// ===========================================================================
// HOST KISITI
// ===========================================================================

test('sonda tek bir hosta cikar', () => {
  // Veritabanı ele geçse bile istek başka yere gitmesin: `main` içindeki
  // denetim bu sabite bakıyor.
  assert.equal(IZINLI_HOST, 'productdata.awin.com');
});
